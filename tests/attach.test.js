// Tests for the attach matrix — "what can go where".
//
// This is the query the whole anchored-product interaction rests on, and both
// attach flows are projections of it. If it is right, point-first and
// part-first are both just filters; if it is wrong, every marker on screen is
// wrong and there is no second opinion anywhere in the app.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describeGltf } from '../src/three/loadGlb.js';
import { extractComponent } from '../src/engine/component.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { makeGridCellId } from '../src/engine/grid.js';
import {
  attachMatrix, pointsForComponent, componentsForPoint, livePoints,
  whyNothingFits, attachAt, detach, pointKey,
} from '../src/engine/attach.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
const loader = new GLTFLoader();

function loadComponent(file) {
  const bytes = new Uint8Array(readFileSync(join(ASSETS, file)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(buffer, '',
    (gltf) => {
      try {
        const name = file.replace(/\.glb$/, '');
        resolve({ id: name, ...extractComponent(describeGltf(gltf, name)) });
      } catch (err) { reject(err); }
    }, reject));
}

let components;
let CATALOGUE;

beforeAll(async () => {
  const files = [
    'molle-panel.glb', 'pouch-2x3.glb', 'pouch-3x2.glb',
    'rack-upright-1800.glb', 'rack-shelf-900.glb', 'rack-drawer-900.glb',
    'unit-600.glb', 'unit-900.glb', 'wall-cabinet-720.glb',
  ];
  const loaded = await Promise.all(files.map(loadComponent));
  components = new Map(loaded.map((c) => [c.id, c]));
  CATALOGUE = loaded.map((c) => c.id);
});

const build = (assembly) => {
  const { transforms } = resolveTransforms(assembly, components);
  return attachMatrix(assembly, components, CATALOGUE, transforms);
};

const seed = (componentId) => ({
  instances: [{ instanceId: 'root', componentId, position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true }],
  connections: [],
});

describe('options come off the component definition', () => {
  it('a pouch declares a finish with four values and a default', () => {
    const pouch = components.get('pouch-2x3');
    expect(pouch.options).toHaveLength(1);
    expect(pouch.options[0]).toMatchObject({ id: 'finish', label: 'Finish' });
    expect(pouch.options[0].values.map((v) => v.id))
      .toEqual(['olive', 'coyote', 'black', 'wolf']);
    // Explicit default, so a configuration id always resolves to the same
    // appearance rather than to whatever the renderer happened to show.
    expect(pouch.options[0].defaultValueId).toBe('olive');
  });

  it('a component with no options declares none rather than undefined', () => {
    expect(components.get('unit-600').options).toEqual([]);
  });
});

describe('attachMatrix on a MOLLE panel', () => {
  it('offers only pals-masked parts, never a kitchen unit', () => {
    const matrix = build(seed('molle-panel'));
    const offered = new Set(matrix.placements.map((p) => p.componentId));
    expect(offered).toEqual(new Set(['pouch-2x3', 'pouch-3x2']));
  });

  // The span rule made visible: a bigger pouch has fewer legal cells.
  it('offers each pouch exactly its number of legal placements', () => {
    const matrix = build(seed('molle-panel'));
    expect(pointsForComponent(matrix, 'pouch-2x3')).toHaveLength(6 * 10);
    expect(pointsForComponent(matrix, 'pouch-3x2')).toHaveLength(5 * 11);
  });

  it('draws a marker only where something can actually go', () => {
    const matrix = build(seed('molle-panel'));
    // A cell in the top-right corner takes neither pouch, so it gets no marker
    // even though it is empty. An empty cell and a usable cell are different.
    const corner = `root::${makeGridCellId('md-grid.pals.front', 6, 11)}`;
    expect(livePoints(matrix).some((p) => pointKey(p) === corner)).toBe(false);
    expect(whyNothingFits(matrix, corner)).toMatch(/run off the edge/);
  });

  it('point-first and part-first agree', () => {
    const matrix = build(seed('molle-panel'));
    const key = `root::${makeGridCellId('md-grid.pals.front', 0, 0)}`;

    const partsHere = componentsForPoint(matrix, key).map((p) => p.componentId).sort();
    expect(partsHere).toEqual(['pouch-2x3', 'pouch-3x2']);

    // The same fact reached from the other direction.
    const pointsForPouch = pointsForComponent(matrix, 'pouch-2x3').map((p) => p.pointKey);
    expect(pointsForPouch).toContain(key);
  });
});

describe('attaching, and what it closes off', () => {
  it('attaches a pouch and derives its position from the graph', () => {
    const before = seed('molle-panel');
    const matrix = build(before);
    const placement = pointsForComponent(matrix, 'pouch-2x3')
      .find((p) => p.point.col === 0 && p.point.row === 0);

    const after = attachAt(before, placement, 'a1', { finish: 'coyote' });

    expect(after.instances).toHaveLength(2);
    // The interaction changed; the data model did not. No coordinates stored.
    expect(after.instances[1].position).toBeNull();
    expect(after.instances[1].selections).toEqual({ finish: 'coyote' });
    expect(after.connections).toHaveLength(1);

    const { transforms } = resolveTransforms(after, components);
    expect(transforms.get('a1').translation[2]).toBeCloseTo(0.05);
  });

  it('a fitted 2x3 pouch removes every placement that would overlap it', () => {
    const before = seed('molle-panel');
    const first = pointsForComponent(build(before), 'pouch-2x3')
      .find((p) => p.point.col === 0 && p.point.row === 0);
    const after = attachAt(before, first, 'a1');

    const matrix = build(after);
    const stillFree = pointsForComponent(matrix, 'pouch-2x3').map((p) => p.pointKey);

    // Six cells are covered, and a 2x3 anchored at any of six positions would
    // have hit them.
    expect(stillFree).not.toContain(`root::${makeGridCellId('md-grid.pals.front', 0, 0)}`);
    expect(pointsForComponent(matrix, 'pouch-2x3').length).toBeLessThan(60);
  });

  it('says a covered cell is already taken', () => {
    const before = seed('molle-panel');
    const first = pointsForComponent(build(before), 'pouch-2x3')
      .find((p) => p.point.col === 0 && p.point.row === 0);
    const after = attachAt(before, first, 'a1');

    const covered = `root::${makeGridCellId('md-grid.pals.front', 0, 1)}`;
    expect(whyNothingFits(build(after), covered)).toMatch(/already fitted/);
  });

  // The subtle case, and the reason spans need explaining at all: a cell can be
  // FREE while every part that would sit there overlaps a neighbour. Note this
  // cannot happen between two 2x3 pouches — every overlapping anchor is itself
  // inside the occupied block — so it takes two different footprints to
  // produce, which is exactly why it would be easy to ship broken.
  it('explains that a free cell has no room for a part that would overlap', () => {
    const before = seed('molle-panel');
    const interior = pointsForComponent(build(before), 'pouch-2x3')
      .find((p) => p.point.col === 2 && p.point.row === 4);
    const after = attachAt(before, interior, 'a1');   // covers cols 2-3, rows 4-6

    const matrix = build(after);
    // A 3x2 anchored at col 0 row 5 would cover cols 0-2 of rows 5-6, and
    // (2,5) is taken. The anchor cell itself is empty.
    const free = `root::${makeGridCellId('md-grid.pals.front', 0, 5)}`;

    const stillOffered = componentsForPoint(matrix, free).map((p) => p.componentId);
    expect(stillOffered).toContain('pouch-2x3');      // a 2x3 there is fine
    expect(stillOffered).not.toContain('pouch-3x2');  // a 3x2 is not

    const rejection = matrix.rejected.find(
      (r) => pointKey(r.point) === free && r.componentId === 'pouch-3x2',
    );
    expect(rejection.message).toMatch(/would overlap/);
  });
});

describe('attachMatrix on racking — authored points, not a grid', () => {
  it('offers both level SKUs at every empty level', () => {
    const matrix = build(seed('rack-upright-1800'));
    expect(pointsForComponent(matrix, 'rack-shelf-900')).toHaveLength(4);
    expect(pointsForComponent(matrix, 'rack-drawer-900')).toHaveLength(4);
  });

  it('a filled level stops being offered', () => {
    const before = seed('rack-upright-1800');
    const placement = pointsForComponent(build(before), 'rack-shelf-900')[0];
    const after = attachAt(before, placement, 's1');

    expect(pointsForComponent(build(after), 'rack-shelf-900')).toHaveLength(3);
  });

  // A spanning part has no meaning against a single authored point: it would be
  // placed by its footprint centre against something with no footprint.
  it('never offers a spanning pouch on a shelf level', () => {
    const matrix = build(seed('rack-upright-1800'));
    expect(pointsForComponent(matrix, 'pouch-2x3')).toHaveLength(0);
  });
});

describe('masks still gate everything', () => {
  it('a wall cabinet is never offered on a base unit', () => {
    const matrix = build(seed('unit-600'));
    const offered = new Set(matrix.placements.map((p) => p.componentId));
    expect(offered.has('wall-cabinet-720')).toBe(false);
    expect(offered).toEqual(new Set(['unit-600', 'unit-900', 'corner-connector']
      .filter((id) => components.has(id))));
  });
});

describe('detach cascades', () => {
  it('removes a part', () => {
    const before = seed('molle-panel');
    const placement = pointsForComponent(build(before), 'pouch-2x3')[0];
    const after = detach(attachAt(before, placement, 'a1'), 'a1');

    expect(after.instances).toHaveLength(1);
    expect(after.connections).toHaveLength(0);
    expect(after.removed).toEqual(['a1']);
  });

  // The failure the old drag path had: removing something left whatever hung
  // off it orphaned, and an orphan with no position teleported to the origin.
  it('takes everything hanging off the removed part with it', () => {
    let assembly = seed('unit-600');
    assembly = attachAt(assembly, pointsForComponent(build(assembly), 'unit-900')[0], 'b1');

    // Attach the third unit to b1 SPECIFICALLY. Taking the first available
    // placement would have hung it off the root instead, and the test would
    // have passed for the wrong reason.
    const onB1 = pointsForComponent(build(assembly), 'unit-600')
      .find((p) => p.point.instanceId === 'b1');
    expect(onB1).toBeTruthy();
    assembly = attachAt(assembly, onB1, 'b2');

    expect(assembly.instances).toHaveLength(3);

    const after = detach(assembly, 'b1');
    // b2 hung off b1, so it goes too — no orphan, no teleport.
    expect(after.instances.map((i) => i.instanceId)).toEqual(['root']);
    expect(after.removed.sort()).toEqual(['b1', 'b2']);
  });

  it('leaves the assembly resolvable after a cascade', () => {
    let assembly = seed('unit-600');
    assembly = attachAt(assembly, pointsForComponent(build(assembly), 'unit-900')[0], 'b1');
    const after = detach(assembly, 'b1');
    expect(() => resolveTransforms(after, components)).not.toThrow();
  });
});
