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

/**
 * Describe a loaded glTF in engine terms.
 *
 * Node transforms are read as authored — LOCAL translation and rotation, not
 * world. Every generated component is a flat scene, and a nested snap would have
 * its position silently misread, so nesting is refused rather than flattened.
 */
export function describeGltf(gltf, name) {
  const scene = gltf.scene || gltf.scenes?.[0];
  if (!scene) throw new Error('This file contains no scene.');

  const nodes = [];

  for (const child of scene.children) {
    if (child.children?.length) {
      throw new Error(
        `Node "${child.name}" has children. Components must be a flat list of `
        + 'objects — nesting would make snap positions ambiguous.',
      );
    }
    if (!child.isMesh) continue;

    const geometry = child.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox || new Box3();
    const min = new Vector3(), max = new Vector3();
    box.getCenter(new Vector3());
    min.copy(box.min);
    max.copy(box.max);

    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    nodes.push({
      name: child.name,
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
