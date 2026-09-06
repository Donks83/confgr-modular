// Reading a GLB into the shape `extractComponent` wants, in NODE.
//
// The engine has been renderer-free since the first session and it was never
// quite true in practice: `src/three/loadGlb.js` is the only thing that turns a
// file into a component, and it needs three.js, which needs a DOM. So the
// "headless" resolve was headless right up until it needed a part.
//
// This closes that. It reads the glTF JSON out of a GLB and produces exactly
// the description `extractComponent` takes — the same fields, the same units,
// the same meaning — with no three.js, no canvas and no binary decoding at all.
//
// NO BINARY DECODING, and that is not a shortcut. glTF REQUIRES `min` and `max`
// on a POSITION accessor:
//
//     "Accessors of a POSITION attribute ... MUST have `min` and `max`"
//     — glTF 2.0 §3.7.2.1
//
// which is the bounding box, in the mesh's own space, already computed by
// whatever wrote the file. `count` gives the vertex count and the index
// accessor's count gives the triangles. Everything this file needs is in the
// JSON header; the vertex buffer is never touched, so describing eighty parts
// costs milliseconds rather than megabytes.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const MAGIC = 0x46546c67;      // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** The glTF JSON out of a .glb container. */
export function readGlbJson(path) {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error(`${basename(path)} is not a GLB — the magic number is wrong.`);
  }

  let offset = 12;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === CHUNK_JSON) {
      return JSON.parse(
        new TextDecoder().decode(buffer.subarray(offset + 8, offset + 8 + length)),
      );
    }
    offset += 8 + length;
  }
  throw new Error(`${basename(path)} has no JSON chunk.`);
}

/**
 * One GLB, described the way `extractComponent` expects.
 *
 * REFUSES A NESTED SCENE, exactly as `describeGltf` does, and for the same
 * reason: a component is a flat list of objects, because nesting would make a
 * snap's position depend on a parent transform nobody is reading.
 */
export function describeGlb(path) {
  const json = readGlbJson(path);
  const scene = json.scenes?.[json.scene ?? 0];
  const nodes = [];

  for (const index of scene?.nodes || []) {
    const node = json.nodes?.[index];
    if (!node) continue;
    if (node.children?.length) {
      throw new Error(
        `Node "${node.name}" has children. Components must be a flat list of `
        + 'objects — nesting would make snap positions ambiguous.',
      );
    }
    if (node.mesh == null) continue;

    const { translation, rotation } = trs(node);
    const bounds = meshBounds(json, node.mesh);

    nodes.push({
      name: node.name ?? `node-${index}`,
      threeName: node.name ?? `node-${index}`,
      translation,
      rotation,
      ...bounds,
    });
  }

  return {
    name: basename(path, extname(path)),
    extras: json.scenes?.[json.scene ?? 0]?.extras || json.extras || {},
    nodes,
  };
}

/** Every GLB in a folder, keyed by the id the catalogue uses. */
export function describeFolder(folder, files) {
  const out = new Map();
  for (const file of files) {
    out.set(basename(file, '.glb'), describeGlb(`${folder}/${file}`));
  }
  return out;
}

/**
 * A node's translation and rotation.
 *
 * glTF allows either TRS or a 4x4 `matrix`, and the pipeline writes matrices
 * because that is what trimesh emits. Scale is DELIBERATELY IGNORED rather than
 * silently applied: the pipeline's Rule 1 is that a model is at real-world
 * scale, `extractComponent` cross-checks declared millimetres against measured
 * geometry, and a node scale would make those two disagree in a way that reads
 * as a modelling error rather than as a transform. If one ever appears, the
 * scale check is what will say so.
 */
function trs(node) {
  if (node.matrix) {
    const m = node.matrix;   // column-major
    return {
      translation: [m[12], m[13], m[14]],
      rotation: quatFromMatrix(m),
    };
  }
  return {
    translation: node.translation ? [...node.translation] : [0, 0, 0],
    rotation: node.rotation ? [...node.rotation] : [0, 0, 0, 1],
  };
}

/** The bounding box and the counts, straight off the accessors. */
function meshBounds(json, meshIndex) {
  const mesh = json.meshes?.[meshIndex];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertexCount = 0;
  let triangleCount = 0;

  for (const primitive of mesh?.primitives || []) {
    const position = json.accessors?.[primitive.attributes?.POSITION];
    if (!position) continue;
    if (!position.min || !position.max) {
      throw new Error(
        `Mesh "${mesh.name ?? meshIndex}" has a POSITION accessor with no min/max. `
        + 'glTF requires them, and this reader trusts them rather than decoding '
        + 'the vertex buffer.',
      );
    }
    for (let a = 0; a < 3; a += 1) {
      if (position.min[a] < min[a]) min[a] = position.min[a];
      if (position.max[a] > max[a]) max[a] = position.max[a];
    }
    vertexCount += position.count || 0;
    const indices = primitive.indices != null ? json.accessors[primitive.indices] : null;
    triangleCount += indices ? (indices.count || 0) / 3 : (position.count || 0) / 3;
  }

  return { min, max, vertexCount, triangleCount };
}

/** The rotation out of a column-major 4x4, assuming no scale (see trs). */
function quatFromMatrix(m) {
  const [m00, m01, m02] = [m[0], m[4], m[8]];
  const [m10, m11, m12] = [m[1], m[5], m[9]];
  const [m20, m21, m22] = [m[2], m[6], m[10]];
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
