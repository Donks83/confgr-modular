// Integration tests: the REAL GLTFLoader against the REAL test GLBs.
//
// WHY THIS FILE EXISTS. engine.test.js passed 42 assertions while the spike
// loaded nothing at all, because those tests feed the engine hand-written node
// descriptions. The description was right; what three.js actually produces was
// not. Every rule the engine enforces was being tested against a fiction.
//
// So: anything that crosses the three.js boundary gets tested through three.js.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describeGltf, buildNameMap, sanitiseThreeName } from '../src/three/loadGlb.js';
import { extractComponent } from '../src/engine/component.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
const loader = new GLTFLoader();

function loadGlb(file) {
  const bytes = new Uint8Array(readFileSync(join(ASSETS, file)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
}

describe('sanitiseThreeName', () => {
  // Pinning the exact behaviour we discovered, so a three.js upgrade that
  // changes it fails here with an obvious message.
  it('strips the characters three.js reserves', () => {
    expect(sanitiseThreeName('md-snap.carcass-side.left')).toBe('md-snapcarcass-sideleft');
    expect(sanitiseThreeName('a[0].b:c/d')).toBe('a0bcd');
  });

  it('turns whitespace into underscores', () => {
    expect(sanitiseThreeName('left panel')).toBe('left_panel');
  });

  it('leaves hyphens and underscores alone', () => {
    expect(sanitiseThreeName('col-body_02')).toBe('col-body_02');
  });
});

describe('buildNameMap', () => {
  it('maps sanitised names back to what the artist typed', () => {
    const map = buildNameMap({ nodes: [{ name: 'md-snap.carcass-side.left' }] });
    expect(map.get('md-snapcarcass-sideleft')).toBe('md-snap.carcass-side.left');
  });

  it('ignores unnamed nodes', () => {
    expect(buildNameMap({ nodes: [{}, { name: 'body' }] }).size).toBe(1);
  });

  // Two real names that sanitise identically would otherwise attach a snap to
  // the wrong face, and nothing would look wrong until a part faced backwards.
  it('refuses names three.js cannot tell apart', () => {
    expect(() => buildNameMap({
      nodes: [{ name: 'md-snap.side.left' }, { name: 'md-snapside.left' }],
    })).toThrow(/cannot tell apart/);
  });
});

describe('describeGltf against real files', () => {
  let gltf;
  beforeAll(async () => { gltf = await loadGlb('unit-600.glb'); });

  // The regression. Before the name map, this returned the mangled names and
  // extractComponent found no snaps.
  it('recovers the dotted snap names three.js mangled', () => {
    const desc = describeGltf(gltf, 'unit-600');
    const names = desc.nodes.map((n) => n.name).sort();
    expect(names).toEqual([
      'body', 'col-body', 'dim',
      'md-snap.carcass-side.left', 'md-snap.carcass-side.right',
    ]);
  });

  it('also keeps the name three.js uses, so the renderer can find the object', () => {
    const desc = describeGltf(gltf, 'unit-600');
    const left = desc.nodes.find((n) => n.name === 'md-snap.carcass-side.left');
    expect(left.threeName).toBe('md-snapcarcass-sideleft');
    // The spike toggles snap visibility on this prefix - it must survive.
    expect(left.threeName.startsWith('md-snap')).toBe(true);
  });

  it('reads scene extras, which is where declared size lives', () => {
    const desc = describeGltf(gltf, 'unit-600');
    expect(desc.extras.confgr).toMatchObject({ widthMm: 600, heightMm: 720, depthMm: 560 });
  });

  it('reads local transforms and geometry bounds', () => {
    const desc = describeGltf(gltf, 'unit-600');
    const body = desc.nodes.find((n) => n.name === 'body');
    expect(body.vertexCount).toBe(24);
    expect(body.min[1]).toBeCloseTo(0);
    expect(body.max[1]).toBeCloseTo(0.72);

    const right = desc.nodes.find((n) => n.name === 'md-snap.carcass-side.right');
    expect(right.vertexCount).toBe(4);
    expect(right.translation[0]).toBeCloseTo(0.3);
  });
});

describe('extractComponent against real files', () => {
  // The end-to-end assertion: a real GLB becomes a usable component. This is
  // the check that actually corresponds to the spike working.
  it.each([
    ['unit-600.glb', 600, 720, 560, 'carcass-side', 2],
    ['unit-900.glb', 900, 720, 560, 'carcass-side', 2],
    ['corner-connector.glb', 560, 720, 560, 'carcass-side', 2],
    ['wall-cabinet-720.glb', 720, 600, 330, 'wall-side', 2],
  ])('%s loads and validates', async (file, w, h, d, mask, snapCount) => {
    const component = extractComponent(describeGltf(await loadGlb(file), file));

    expect(component.dimsMm).toEqual({ widthMm: w, heightMm: h, depthMm: d });
    expect(component.snaps).toHaveLength(snapCount);
    expect([...new Set(component.snaps.map((s) => s.mask))]).toEqual([mask]);
    expect(component.collisionBox).toBe('present');
    expect(component.dimensionBox).toBe('present');
  });

  it('gives every snap a horizontal outward facing', async () => {
    const component = extractComponent(describeGltf(await loadGlb('unit-600.glb'), 'unit-600'));
    const left = component.snaps.find((s) => s.label === 'left');
    const right = component.snaps.find((s) => s.label === 'right');

    expect(left.facing[0]).toBeCloseTo(-1);
    expect(right.facing[0]).toBeCloseTo(1);
    // No vertical component - a floor-standing part cannot join through a ceiling.
    expect(Math.abs(left.facing[1])).toBeLessThan(1e-6);
  });

  it('the corner connector turns a corner', async () => {
    const component = extractComponent(describeGltf(await loadGlb('corner-connector.glb'), 'corner'));
    const back = component.snaps.find((s) => s.label === 'back');
    expect(back.facing[2]).toBeCloseTo(-1);
  });

  // The deliberately-incompatible component. If this ever shares a mask with
  // the carcass units, the "refuses joints that should not exist" half of
  // Phase 0 stops being tested by the spike at all.
  it('the wall cabinet cannot join the carcass units', async () => {
    const wall = extractComponent(describeGltf(await loadGlb('wall-cabinet-720.glb'), 'wall'));
    const unit = extractComponent(describeGltf(await loadGlb('unit-600.glb'), 'unit'));

    const wallMasks = new Set(wall.snaps.map((s) => s.mask));
    const unitMasks = new Set(unit.snaps.map((s) => s.mask));
    for (const m of wallMasks) expect(unitMasks.has(m)).toBe(false);
  });
});
