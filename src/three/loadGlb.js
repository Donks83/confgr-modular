// The only file that knows about both three.js and the snap engine.
//
// Its whole job is to turn a loaded glTF into the plain description that
// src/engine/component.js consumes. Keeping the boundary this thin is what makes
// the engine testable in node, and what means a switch to Babylon.js after the
// Phase 0 spike would rewrite this file and nothing else.

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Vector3 } from 'three';
import { extractComponent } from '../engine/component.js';

const loader = new GLTFLoader();

// PHASE 0 FINDING, 3 Sep 2026 - three.js RENAMES nodes on load.
//
// GLTFLoader runs every node name through PropertyBinding.sanitizeNodeName,
// which strips the characters reserved by three.js's animation property paths.
// So `md-snap.carcass-side.left` arrives as `md-snapcarcass-sideleft`, and the
// snap convention silently stops matching - no error, just zero snaps found.
//
// We do NOT change the convention to dodge this. Dots are what Blender and
// 3ds Max produce (Blender appends .001 to duplicates whether we like it or
// not) and dots are what Mimeeq's own `md-snap.front` examples use. Artists
// will type dots. So instead we read the AUTHORITATIVE names from the raw glTF
// JSON, which three.js leaves untouched, and match them to the loaded objects
// by applying the same sanitisation ourselves.
//
// Mirrors three/src/animation/PropertyBinding.js. If three.js ever changes the
// rule, tests/loadGlb.test.js fails loudly against a real GLB rather than the
// spike quietly loading nothing.
const THREE_RESERVED = /[[\].:/]/g;

export function sanitiseThreeName(name) {
  return String(name).replace(/\s/g, '_').replace(THREE_RESERVED, '');
}

/**
 * Map from the name three.js gives an object back to the name the artist typed.
 *
 * Built from gltf.parser.json, the unmodified source JSON. A collision - two
 * different real names sanitising to the same string - is reported rather than
 * silently resolved, because picking one at random would attach a snap to the
 * wrong face.
 */
export function buildNameMap(gltfJson) {
  const map = new Map();
  const collisions = [];

  for (const node of gltfJson?.nodes || []) {
    if (!node.name) continue;
    const key = sanitiseThreeName(node.name);
    if (map.has(key) && map.get(key) !== node.name) {
      collisions.push([map.get(key), node.name]);
      continue;
    }
    map.set(key, node.name);
  }

  if (collisions.length) {
    const pairs = collisions.map(([a, b]) => `"${a}" and "${b}"`).join(', ');
    throw new Error(
      `Two nodes have names three.js cannot tell apart: ${pairs}. `
      + 'Rename one - three.js strips . : / [ ] from node names on load.',
    );
  }

  return map;
}

/**
 * Describe a loaded glTF in engine terms.
 *
 * Node transforms are read as authored - LOCAL translation and rotation, not
 * world. Every generated component is a flat scene, and a nested snap would have
 * its position silently misread, so nesting is refused rather than flattened.
 */
export function describeGltf(gltf, name) {
  const scene = gltf.scene || gltf.scenes?.[0];
  if (!scene) throw new Error('This file contains no scene.');

  // parser.json is the raw glTF document. Present for anything GLTFLoader
  // parsed; the fallback keeps this working if a caller hands us a scene it
  // built some other way.
  const nameMap = buildNameMap(gltf.parser?.json);

  const nodes = [];

  for (const child of scene.children) {
    if (child.children?.length) {
      throw new Error(
        `Node "${child.name}" has children. Components must be a flat list of `
        + 'objects - nesting would make snap positions ambiguous.',
      );
    }
    if (!child.isMesh) continue;

    const geometry = child.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox || new Box3();
    const min = new Vector3().copy(box.min);
    const max = new Vector3().copy(box.max);

    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    nodes.push({
      // The artist's name, recovered. Falls back to whatever three.js produced
      // so a file with unnamed nodes still describes rather than throwing.
      name: nameMap.get(child.name) ?? child.name,
      // Kept so the renderer can find this object again - the spike toggles
      // visibility by the sanitised name it actually sees in the scene graph.
      threeName: child.name,
      translation: child.position.toArray(),
      // three.js quaternions serialise as [x, y, z, w], the same order glTF
      // uses for node.rotation, so this passes straight through.
      rotation: child.quaternion.toArray(),
      min: min.toArray(),
      max: max.toArray(),
      vertexCount: position ? position.count : 0,
      triangleCount: index ? index.count / 3 : (position ? position.count / 3 : 0),
    });
  }

  return {
    name,
    // glTF puts scene-level extras on scene.userData once three.js has parsed it.
    extras: scene.userData || {},
    nodes,
  };
}

/** Parse GLB bytes into a validated component plus the three.js scene to render. */
export function parseComponentFromBytes(bytes, name) {
  return new Promise((resolve, reject) => {
    const buffer = bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;

    loader.parse(buffer, '', (gltf) => {
      try {
        const description = describeGltf(gltf, name);
        resolve({
          component: { id: name, ...extractComponent(description) },
          scene: gltf.scene,
          description,
        });
      } catch (err) {
        reject(err);
      }
    }, reject);
  });
}

/** Read a model off disk through the main process, then parse it. */
export async function loadComponentFromPath(filePath) {
  const res = await window.confgr.fs.readModel(filePath);
  if (!res.ok) throw new Error(res.error);
  const name = res.name.replace(/\.(glb|gltf)$/i, '');
  return parseComponentFromBytes(new Uint8Array(res.bytes), name);
}
