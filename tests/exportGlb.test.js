// Two readers, one file, and they had better agree.
//
// `src/three/loadGlb.js` turns a GLB into a component description using
// three.js. `tools/describe-glb.mjs` does the same thing in Node with no
// three.js at all, reading only the glTF JSON header. Everything downstream -
// the headless resolve, the quote, the GLB export - now depends on the second
// one being a faithful stand-in for the first.
//
// So the central test here is not "does describeGlb produce something
// plausible". It is: feed both readers the same file and require the SAME
// ANSWER. That is a real test rather than a restatement, because the two take
// completely different routes to it - three.js decodes the vertex buffer and
// computes a bounding box; describeGlb trusts the accessor min/max the file
// was written with. If the pipeline ever writes an accessor whose declared
// bounds do not match its vertices, these two stop agreeing and this file says
// so. Nothing else in the project would notice.
//
// The rest covers the two decisions the export makes about WHERE the product
// goes: `productBounds` and `floorOffset`. Both are pure and both are the
// difference between a model that arrives standing on the customer's floor and
// one that arrives half-buried in it.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { describeGltf } from '../src/three/loadGlb.js';
import { extractComponent } from '../src/engine/component.js';
import { describeGlb, readGlbJson } from '../tools/describe-glb.mjs';
import { productBounds, floorOffset } from '../tools/export-glb.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
const loader = new GLTFLoader();

// The synthetic assets, which are the ones committed to the repo. The YouK
// parts are derived from Kesseboehmer's STEP files and are gitignored, so a
// test may not depend on them being present.
const SYNTHETIC = [
  'rack-upright-1800.glb',
  'rack-shelf-900.glb',
  'rack-drawer-900.glb',
  'unit-600.glb',
  'unit-900.glb',
  'wall-cabinet-720.glb',
  'corner-connector.glb',
  'molle-panel.glb',
  'pouch-2x3.glb',
  'pouch-3x2.glb',
];

/**
 * A GLB carrying the given glTF JSON and no binary chunk at all.
 *
 * Legal: the spec makes the BIN chunk optional, and `describeGlb` reads only
 * the header, so a file like this is enough to test what the reader refuses.
 * The 12-byte header is magic, version 2, total length; then the chunk's own
 * length, its type, and the JSON padded to a 4-byte boundary with spaces.
 */
function writeJsonOnlyGlb(json) {
  const body = Buffer.from(JSON.stringify(json), 'utf8');
  const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4, 0x20)]);
  const glb = Buffer.alloc(12 + 8 + padded.length);

  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);

  const path = join(tmpdir(), `confgr-test-${randomUUID()}.glb`);
  writeFileSync(path, glb);
  return path;
}

function loadWithThree(file) {
  const bytes = new Uint8Array(readFileSync(join(ASSETS, file)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
}

describe('describeGlb agrees with the three.js reader', () => {
  const viaThree = new Map();

  beforeAll(async () => {
    for (const file of SYNTHETIC) {
      const gltf = await loadWithThree(file);
      viaThree.set(file, describeGltf(gltf, file.replace(/\.glb$/, '')));
    }
  });

  it.each(SYNTHETIC)('%s: the same nodes, in the same order', (file) => {
    const a = viaThree.get(file);
    const b = describeGlb(join(ASSETS, file));
    expect(b.nodes.map((n) => n.name)).toEqual(a.nodes.map((n) => n.name));
  });

  it.each(SYNTHETIC)('%s: the same bounds, to a micrometre', (file) => {
    const a = viaThree.get(file);
    const b = describeGlb(join(ASSETS, file));

    for (const [i, node] of b.nodes.entries()) {
      // A micrometre. Tighter than any measurement the project makes and a
      // thousand times finer than the 1mm tolerances the pipeline works to,
      // so this catches a genuine disagreement without failing on float noise.
      for (let axis = 0; axis < 3; axis += 1) {
        expect(node.min[axis]).toBeCloseTo(a.nodes[i].min[axis], 6);
        expect(node.max[axis]).toBeCloseTo(a.nodes[i].max[axis], 6);
      }
    }
  });

  it.each(SYNTHETIC)('%s: the same placement', (file) => {
    const a = viaThree.get(file);
    const b = describeGlb(join(ASSETS, file));

    for (const [i, node] of b.nodes.entries()) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(node.translation[axis]).toBeCloseTo(a.nodes[i].translation[axis], 6);
      }
      // A quaternion and its negation are the same rotation, so compare what
      // the rotation DOES rather than the four numbers it is written with.
      const dot = node.rotation.reduce((s, v, k) => s + v * a.nodes[i].rotation[k], 0);
      expect(Math.abs(dot)).toBeCloseTo(1, 5);
    }
  });

  it.each(SYNTHETIC)('%s: extractComponent accepts both and gets the same part', (file) => {
    const a = extractComponent(viaThree.get(file));
    const b = extractComponent(describeGlb(join(ASSETS, file)));

    expect(b.dimsMm).toEqual(a.dimsMm);
    expect(b.snaps.map((s) => s.id)).toEqual(a.snaps.map((s) => s.id));
    expect(b.front).toEqual(a.front);
    expect(b.wallFixings).toBe(a.wallFixings);
    expect(b.body.min.map((v) => Math.round(v * 1000)))
      .toEqual(a.body.min.map((v) => Math.round(v * 1000)));
  });
});

describe('describeGlb refuses what it cannot describe honestly', () => {
  it('rejects a file that is not a GLB', () => {
    expect(() => readGlbJson(join(ASSETS, '..', 'package.json')))
      .toThrow(/not a GLB/);
  });

  it('rejects a nested scene, for the same reason describeGltf does', () => {
    // No committed asset is nested, because the pipeline will not write one -
    // so the file to test the rule against has to be made here. A GLB with a
    // JSON chunk and nothing else is a legal GLB; the reader never opens the
    // binary chunk anyway, which is the whole point of it.
    const path = writeJsonOnlyGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'parent', children: [1], mesh: 0 }, { name: 'child' }],
      meshes: [{ name: 'body', primitives: [] }],
    });
    expect(() => describeGlb(path)).toThrow(/flat list of objects/);
  });

  it('refuses an accessor with no declared bounds rather than guessing', () => {
    // The one thing this reader genuinely trusts the file about. If a writer
    // ever omits min/max - which glTF forbids, but files are written by
    // software - the honest answer is to stop, not to report a part with an
    // infinite bounding box that `extractComponent` would then reject with a
    // confusing message about millimetres.
    const path = writeJsonOnlyGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'body', mesh: 0 }],
      meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ type: 'VEC3', componentType: 5126, count: 3 }],
    });
    expect(() => describeGlb(path)).toThrow(/min\/max/);
  });
});

describe('productBounds', () => {
  const components = new Map([
    ['ladder', { body: { min: [-0.015, 0, -0.16], max: [0.015, 1.5, 0.16] } }],
    ['shelf', { body: { min: [0, 0, -0.16], max: [0.9, 0.03, 0.16] } }],
  ]);

  const scene = (instances) => ({ instances });

  it('is the union of every part\'s body, in world', () => {
    const bounds = productBounds(
      scene([
        { instanceId: 'a', componentId: 'ladder' },
        { instanceId: 'b', componentId: 'shelf' },
        { instanceId: 'c', componentId: 'ladder' },
      ]),
      components,
      new Map([
        ['a', { translation: [0, 0, 0] }],
        ['b', { translation: [0.015, 0.81, 0] }],
        ['c', { translation: [0.93, 0, 0] }],
      ]),
    );

    // -15 to 945 in x: the left ladder's own half-width, out to the right
    // ladder's far face at 930 + 15.
    expect(bounds.min.map((v) => Math.round(v * 1000))).toEqual([-15, 0, -160]);
    expect(bounds.max.map((v) => Math.round(v * 1000))).toEqual([945, 1500, 160]);
  });

  it('ignores an instance whose component never loaded', () => {
    // The export must not silently place a part it could not read, and must
    // not let a missing one poison the bounds with Infinity either.
    const bounds = productBounds(
      scene([
        { instanceId: 'a', componentId: 'ladder' },
        { instanceId: 'z', componentId: 'not-a-part' },
      ]),
      components,
      new Map([['a', { translation: [0, 0, 0] }], ['z', { translation: [99, 99, 99] }]]),
    );
    expect(bounds.max[0]).toBeCloseTo(0.015);
  });

  it('ignores an instance the solver could not place', () => {
    const bounds = productBounds(
      scene([
        { instanceId: 'a', componentId: 'ladder' },
        { instanceId: 'b', componentId: 'shelf' },
      ]),
      components,
      new Map([['a', { translation: [0, 0, 0] }]]),
    );
    expect(bounds.max[0]).toBeCloseTo(0.015);
  });
});

describe('floorOffset', () => {
  it('puts the lowest point on the floor and centres the plan', () => {
    const offset = floorOffset({ min: [-0.015, 0, -0.16], max: [0.945, 1.5, 0.16] });
    expect(offset[0]).toBeCloseTo(-0.465);   // centre of -15..945
    expect(offset[1]).toBeCloseTo(0);        // already standing on it
    expect(offset[2]).toBeCloseTo(0);        // already centred front-to-back
  });

  it('lifts a product that stands on feet', () => {
    // The measured case, and the one that motivated the whole rule: with the
    // 100mm adjustable foot the anchor frame's base centre - the product's own
    // origin - is 100mm ABOVE the floor, so everything is 100mm underground
    // until this moves it.
    const offset = floorOffset({ min: [-0.015, -0.1, -0.16], max: [0.935, 1.5, 0.16] });
    expect(offset[1]).toBeCloseTo(0.1);
  });

  it('does not change the product\'s size', () => {
    const bounds = { min: [-0.015, -0.1, -0.16], max: [0.935, 1.5, 0.16] };
    const offset = floorOffset(bounds);
    const moved = {
      min: bounds.min.map((v, a) => v + offset[a]),
      max: bounds.max.map((v, a) => v + offset[a]),
    };
    for (let a = 0; a < 3; a += 1) {
      expect(moved.max[a] - moved.min[a]).toBeCloseTo(bounds.max[a] - bounds.min[a]);
    }
    expect(moved.min[1]).toBeCloseTo(0);
  });
});
