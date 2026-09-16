//
//   node tools/add-normals.mjs youk [--check] [--angle 35]
//
// WHY THIS EXISTS, and why the last answer was wrong.
//
// Every Kesseboehmer part converted from STEP carries POSITION and indices and
// nothing else. No normals. `export-glb.mjs` has a long note arguing that this
// is fine, and the argument is sound as far as it goes: the glTF specification
// says a renderer MUST compute flat face normals when NORMAL is absent, so
// writing them is handing a viewer something it is obliged to work out for
// itself, at three times the file size.
//
// Matt, on an Android phone: "parts of the model are fading to fully
// transparent when viewing in AR mode. and the model is still looking very
// flat there is no definition on edges or creases."
//
// Both of those are one fault. Scene Viewer renders through Filament, which
// builds a tangent frame per vertex; with no normals to build it from the frame
// is degenerate, and a degenerate frame in a PBR shader is a normalize() of a
// zero vector. What comes out the other side is not a defined colour - which is
// why some of it shades flat and some of it disappears altogether. "The spec
// says the renderer will handle it" is a statement about what a renderer ought
// to do, and a phone is a statement about what one does.
//
// So the normals are written at SOURCE rather than in the AR export, because
// every consumer wants them: the app, the AR GLB and the USDZ all read these
// same files, and `export-usdz.mjs` can stop unwelding to invent its own.
//
// NOT FLAT NORMALS, and this is the part worth the effort. `computeVertexNormals`
// after `toNonIndexed` - what the USDZ path does - gives every triangle its own
// three vertices and its own face normal. That is correct and it is brutal:
// three times the vertices, and a tessellated cylinder ends up faceted.
//
// This splits by ANGLE instead. Faces meeting at a vertex are grouped when the
// angle between them is under the threshold, so:
//
//   * a 90-degree fold in pressed steel keeps its hard edge - two groups, two
//     normals, a visible crease;
//   * the 36 facets round a tube stay one group and shade as a cylinder;
//   * a vertex in the middle of a flat plate is not split at all.
//
// Weighted by the angle each face subtends at the vertex, not by face area: a
// long thin triangle and a fat one meeting at a corner contribute according to
// how much of the corner they occupy, which is the standard result and the one
// that does not skew where a tessellator happened to put a diagonal.
//
// It runs AFTER conversion and BEFORE snaps and materials, and like every other
// step in that pipeline it regenerates from the repo: the GLBs are not committed.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

/**
 * How far two faces may disagree and still be shaded as one surface.
 *
 * 35 degrees. The two numbers it has to sit between are set by the range
 * itself: a folded edge on this steel is 90 degrees and must stay hard, and the
 * tube tessellation in `step-to-glb.py` steps by well under 35, so a round
 * section stays round. Anything between about 20 and 60 gives the same answer
 * on these parts; the value is a threshold, not a measurement, and it is here
 * as a flag so a range with different tessellation can say so.
 */
export const DEFAULT_CREASE_DEGREES = 35;

const sub = (a, b, i, j) => [a[i] - b[j], a[i + 1] - b[j + 1], a[i + 2] - b[j + 2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Per-vertex normals with hard edges kept.
 *
 * Pure, and separated from the file handling so it can be asserted on with a
 * cube: eight corners in, twenty-four vertices out, every normal an axis.
 *
 * @param {Float32Array} positions  3 per vertex
 * @param {Uint32Array|Uint16Array|Array} indices  3 per triangle
 * @returns {{positions: Float32Array, normals: Float32Array, indices: Uint32Array,
 *            remap: number[], split: number}}
 *   `remap[newVertex] = oldVertex`, so every other attribute can follow.
 */
export function creasedNormals(positions, indices, { angleDegrees = DEFAULT_CREASE_DEGREES } = {}) {
  const cosLimit = Math.cos((angleDegrees * Math.PI) / 180);
  const faceCount = indices.length / 3;
  const vertexCount = positions.length / 3;

  // Face normals, unnormalised first so a degenerate triangle can be told from
  // a small one. A zero-area face has no direction and must not be allowed to
  // vote - the tessellator emits a few, and one NaN normal poisons every
  // vertex it touches, which is the very failure this file exists to end.
  const faceNormal = new Float32Array(faceCount * 3);
  const faceOk = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f += 1) {
    const a = indices[f * 3] * 3;
    const b = indices[f * 3 + 1] * 3;
    const c = indices[f * 3 + 2] * 3;
    const n = cross(sub(positions, positions, b, a), sub(positions, positions, c, a));
    const l = len(n);
    if (l > 1e-20) {
      faceNormal[f * 3] = n[0] / l;
      faceNormal[f * 3 + 1] = n[1] / l;
      faceNormal[f * 3 + 2] = n[2] / l;
      faceOk[f] = 1;
    }
  }

  // Which faces touch each vertex. Built as one flat CSR array rather than an
  // array of arrays: these parts run to 7,000 vertices and 7,000 faces each,
  // and there are 80 of them.
  const counts = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i += 1) counts[indices[i] + 1] += 1;
  for (let v = 0; v < vertexCount; v += 1) counts[v + 1] += counts[v];
  const starts = counts;
  const cursor = starts.slice(0, vertexCount);
  const incident = new Uint32Array(indices.length);
  for (let f = 0; f < faceCount; f += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = indices[f * 3 + k];
      incident[cursor[v]] = f;
      cursor[v] += 1;
    }
  }

  const outPositions = [];
  const outNormals = [];
  const remap = [];
  // newIndexOf[face * 3 + corner] = the vertex that corner now uses.
  const newIndices = new Uint32Array(indices.length);
  let split = 0;

  // Scratch reused across vertices; the parts are big enough that allocating
  // per vertex shows up.
  const group = [];
  const parent = [];
  const find = (x) => { let r = x; while (parent[r] !== r) r = parent[r]; return r; };

  for (let v = 0; v < vertexCount; v += 1) {
    const from = starts[v];
    const to = starts[v + 1];
    const k = to - from;
    if (k === 0) {
      // A vertex no triangle uses. It still has to exist, because another
      // attribute may reference it and because dropping it would renumber
      // everything for no gain.
      outPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      outNormals.push(0, 1, 0);
      remap.push(v);
      continue;
    }

    group.length = k;
    parent.length = k;
    for (let i = 0; i < k; i += 1) { group[i] = incident[from + i]; parent[i] = i; }

    // GROUPED, NOT COMPARED PAIRWISE AND LEFT AT THAT. Union-find makes the
    // relation transitive, which is what lets a cylinder stay smooth the whole
    // way round: no two adjacent facets differ by much, and the chain of them
    // adds up to 360 degrees. Comparing each face to a representative would
    // break the ring at an arbitrary place and leave a seam.
    for (let i = 0; i < k; i += 1) {
      if (!faceOk[group[i]]) continue;
      for (let j = i + 1; j < k; j += 1) {
        if (!faceOk[group[j]]) continue;
        const a = group[i] * 3;
        const b = group[j] * 3;
        const c = faceNormal[a] * faceNormal[b]
          + faceNormal[a + 1] * faceNormal[b + 1]
          + faceNormal[a + 2] * faceNormal[b + 2];
        if (c >= cosLimit) {
          const ra = find(i);
          const rb = find(j);
          if (ra !== rb) parent[ra] = rb;
        }
      }
    }

    // One output vertex per group, and the corners that belong to it point at
    // it.
    const emitted = new Map();
    for (let i = 0; i < k; i += 1) {
      const f = group[i];
      const root = faceOk[f] ? find(i) : -1 - i;

      let index = emitted.get(root);
      if (index === undefined) {
        index = outPositions.length / 3;
        emitted.set(root, index);
        outPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        outNormals.push(0, 0, 0);
        remap.push(v);
      }

      // ANGLE-WEIGHTED. The share a face gets is the angle it subtends AT THIS
      // VERTEX, so where a tessellator has cut one quad into a fat triangle and
      // a thin one, the pair together still votes like the quad did.
      if (faceOk[f]) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];
        const other = [i0, i1, i2].filter((x) => x !== v);
        // A triangle using this vertex twice is degenerate; faceOk already
        // caught the ones with no area, and this catches the rest.
        if (other.length === 2) {
          const e1 = sub(positions, positions, other[0] * 3, v * 3);
          const e2 = sub(positions, positions, other[1] * 3, v * 3);
          const l1 = len(e1);
          const l2 = len(e2);
          let w = 0;
          if (l1 > 1e-20 && l2 > 1e-20) {
            const c = Math.min(1, Math.max(-1, dot(e1, e2) / (l1 * l2)));
            w = Math.acos(c);
          }
          outNormals[index * 3] += faceNormal[f * 3] * w;
          outNormals[index * 3 + 1] += faceNormal[f * 3 + 1] * w;
          outNormals[index * 3 + 2] += faceNormal[f * 3 + 2] * w;
        }
      }

      for (let corner = 0; corner < 3; corner += 1) {
        if (indices[f * 3 + corner] === v) newIndices[f * 3 + corner] = index;
      }
    }
    if (emitted.size > 1) split += emitted.size - 1;
  }

  // Normalise, and give anything that still has no direction a usable one
  // rather than a NaN. A vertex only reachable through degenerate faces is the
  // case, and +Y is as good as any: it is wrong in a way that shades, which is
  // the whole point.
  const normals = new Float32Array(outNormals.length);
  for (let i = 0; i < outNormals.length; i += 3) {
    const l = Math.hypot(outNormals[i], outNormals[i + 1], outNormals[i + 2]);
    if (l > 1e-12) {
      normals[i] = outNormals[i] / l;
      normals[i + 1] = outNormals[i + 1] / l;
      normals[i + 2] = outNormals[i + 2] / l;
    } else {
      normals[i + 1] = 1;
    }
  }

  return {
    positions: new Float32Array(outPositions),
    normals,
    indices: newIndices,
    remap,
    split,
  };
}

/**
 * Write normals into every part in a folder.
 *
 * ONE PRIMITIVE AT A TIME, and every other attribute carried across through the
 * remap. These files have only POSITION today, but a pipeline step that
 * silently drops an attribute somebody adds later is a trap, and the remap is
 * already sitting there.
 *
 * SNAP PLANES AND COLLISION BOXES GET NORMALS TOO. They are meshes in the same
 * file and the export strips them long before anybody renders one, so singling
 * them out here would be a rule to remember for no benefit.
 */
export async function addNormals(folder, { check = false, angleDegrees = DEFAULT_CREASE_DEGREES } = {}) {
  const io = new NodeIO();

  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.glb') && !f.endsWith('.converted.glb'))
    .sort();

  const done = [];
  for (const file of files) {
    const path = join(folder, file);
    const before = statSync(path).size;
    const doc = await io.read(path);
    const prims = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());

    let had = 0;
    let vertsBefore = 0;
    let vertsAfter = 0;
    let split = 0;

    for (const prim of prims) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      vertsBefore += position.getCount();

      if (prim.getAttribute('NORMAL')) {
        had += 1;
        vertsAfter += position.getCount();
        continue;
      }

      const indexAccessor = prim.getIndices();
      // An unindexed primitive already has a vertex per corner, so flat normals
      // are the only answer available and no split can occur.
      const indices = indexAccessor
        ? Uint32Array.from(indexAccessor.getArray())
        : Uint32Array.from({ length: position.getCount() }, (_, i) => i);

      const r = creasedNormals(Float32Array.from(position.getArray()), indices, { angleDegrees });
      vertsAfter += r.positions.length / 3;
      split += r.split;

      if (check) continue;

      // Every attribute the primitive had, rebuilt through the remap. The
      // accessors are replaced rather than edited: an accessor may be shared
      // with another primitive, and growing one in place would corrupt the
      // other.
      for (const name of prim.listSemantics()) {
        const old = prim.getAttribute(name);
        const size = old.getElementSize();
        const src = old.getArray();
        const out = new src.constructor(r.remap.length * size);
        for (let i = 0; i < r.remap.length; i += 1) {
          const from = r.remap[i] * size;
          for (let k = 0; k < size; k += 1) out[i * size + k] = src[from + k];
        }
        prim.setAttribute(name, doc.createAccessor()
          .setType(old.getType())
          .setNormalized(old.getNormalized())
          .setArray(out));
      }

      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(r.normals));

      // AS NARROW AS THE VERTEX COUNT ALLOWS. `creasedNormals` works in
      // Uint32Array because it has to before it knows how many vertices it will
      // emit; writing that straight out doubled every index buffer in the
      // range. The split is 4%, so a part that indexed in 16 bits still does.
      const count = r.positions.length / 3;
      const Indices = count > 65535 ? Uint32Array : Uint16Array;
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Indices.from(r.indices)));
    }

    if (!check) {
      // PRUNE, or none of the above saves anything. Replacing an accessor
      // leaves the old one in the document, and gltf-transform writes what the
      // document holds rather than what the scene reaches - so the first run of
      // this put the normals in AND kept every original buffer beside them, and
      // the range went from 7.2 MB to 18.2 MB. The comment claiming the old
      // accessors were gone was written before the line that removes them.
      await doc.transform(prune());
      const written = await io.writeBinary(doc);
      writeFileSync(path, Buffer.from(written));
    }

    done.push({
      id: basename(file, '.glb'),
      prims: prims.length,
      had,
      vertsBefore,
      vertsAfter,
      split,
      before,
      after: check ? before : statSync(path).size,
    });
  }

  return { angleDegrees, parts: done };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  const folder = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'youk';
  const check = process.argv.includes('--check');
  const at = process.argv.indexOf('--angle');
  const angleDegrees = at >= 0 ? Number(process.argv[at + 1]) : DEFAULT_CREASE_DEGREES;

  const { parts } = await addNormals(folder, { check, angleDegrees });

  const sum = (k) => parts.reduce((n, p) => n + p[k], 0);
  const already = parts.filter((p) => p.had > 0).length;
  console.log(
    `${check ? 'would write' : 'wrote'} normals in ${parts.length} parts in ${folder}`
    + ` at ${angleDegrees} degrees`,
  );
  console.log(
    `  vertices ${sum('vertsBefore').toLocaleString()} -> ${sum('vertsAfter').toLocaleString()}`
    + ` (+${Math.round((sum('vertsAfter') / sum('vertsBefore') - 1) * 100)}%),`
    + ` ${sum('split').toLocaleString()} splits`,
  );
  console.log(
    `  bytes    ${sum('before').toLocaleString()} -> ${sum('after').toLocaleString()}`
    + ` (+${Math.round((sum('after') / sum('before') - 1) * 100)}%)`,
  );
  if (already) console.log(`  ${already} part(s) already had normals and were left alone`);
}
