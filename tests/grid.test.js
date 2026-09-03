// Tests for attach GRIDS — generated attach points, and parts that occupy
// several cells of one.
//
// This is the case hand-authored points cannot serve: a PALS panel is 7 x 12 =
// 84 attach points from one declaration, and a pouch covers a rectangle of
// them. Both halves are tested here, and the second half — span occupancy — is
// the one with real bugs available: taking one cell instead of six lets two
// pouches sit on top of each other and nothing looks wrong until you count the
// parts list.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describeGltf } from '../src/three/loadGlb.js';
import { extractComponent } from '../src/engine/component.js';
import {
  makeGridCellId, parseGridCellId, isGridCellId, cellsCovered, spanFits,
  footprintCentre2D, gridAttachPoint, expandGridCells, placementsFor,
  validateGrid, GridError, PALS,
} from '../src/engine/grid.js';
import { resolveTransforms, worldSnaps, occupiedCellsFor } from '../src/engine/assembly.js';
import { approxEqual } from '../src/engine/vec.js';

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

// A 7 x 12 PALS grid, unrotated, matching molle-panel.glb.
const FLAT_GRID = {
  id: 'md-grid.pals.front',
  mask: 'pals',
  label: 'front',
  cols: 7,
  rows: 12,
  pitchX: PALS.pitchXMm / 1000,
  pitchY: PALS.pitchYMm / 1000,
  position: [0, 0.165, 0.02],
  rotation: [0, 0, 0, 1],
  facing: [0, 0, 1],
  condition: null,
};

describe('cell ids', () => {
  it('round-trips', () => {
    const id = makeGridCellId('md-grid.pals.front', 3, 7);
    expect(id).toBe('md-grid.pals.front#c3r7');
    expect(parseGridCellId(id)).toEqual({ gridId: 'md-grid.pals.front', col: 3, row: 7 });
  });

  // A cell id travels through the connection graph as an ordinary snap id, so
  // everything downstream needs exactly one way to tell them apart.
  it('is distinguishable from an authored snap id', () => {
    expect(isGridCellId('md-grid.pals.front#c0r0')).toBe(true);
    expect(isGridCellId('md-snap.pals.mount')).toBe(false);
    expect(parseGridCellId('md-snap.pals.mount')).toBeNull();
  });

  it('survives a grid id containing dots', () => {
    expect(parseGridCellId('md-grid.pals.front.001#c1r2'))
      .toEqual({ gridId: 'md-grid.pals.front.001', col: 1, row: 2 });
  });
});

describe('cellsCovered — the bug that lets pouches overlap', () => {
  it('a 1x1 part takes one cell', () => {
    expect(cellsCovered(2, 3)).toEqual(['c2r3']);
  });

  it('a 2x3 part takes SIX cells, not one', () => {
    expect(cellsCovered(0, 0, { cols: 2, rows: 3 }).sort())
      .toEqual(['c0r0', 'c0r1', 'c0r2', 'c1r0', 'c1r1', 'c1r2']);
  });

  it('counts scale with the span', () => {
    expect(cellsCovered(4, 5, { cols: 3, rows: 2 })).toHaveLength(6);
    expect(cellsCovered(0, 0, { cols: 7, rows: 12 })).toHaveLength(84);
  });
});

describe('spanFits', () => {
  it('accepts a span inside the grid', () => {
    expect(spanFits(FLAT_GRID, 0, 0, { cols: 2, rows: 3 })).toBe(true);
    expect(spanFits(FLAT_GRID, 5, 9, { cols: 2, rows: 3 })).toBe(true);   // exactly flush
  });

  it('refuses a span that runs off the edge', () => {
    expect(spanFits(FLAT_GRID, 6, 0, { cols: 2, rows: 3 })).toBe(false);  // 6+2 > 7
    expect(spanFits(FLAT_GRID, 0, 10, { cols: 2, rows: 3 })).toBe(false); // 10+3 > 12
  });

  it('refuses negative anchors', () => {
    expect(spanFits(FLAT_GRID, -1, 0)).toBe(false);
  });
});

describe('footprintCentre2D — cell centre versus footprint centre', () => {
  // The distinction this whole design turns on. For 1x1 they coincide, which is
  // exactly why getting it wrong stays invisible until something spans.
  it('a 1x1 span sits at the cell centre', () => {
    const [x, y] = footprintCentre2D(FLAT_GRID, 0, 0, { cols: 1, rows: 1 });
    expect(x).toBeCloseTo(-0.2667 / 2 + 0.0381 / 2);
    expect(y).toBeCloseTo(-0.3048 / 2 + 0.0254 / 2);
  });

  it('a 2x3 span sits at the centre of its footprint, NOT its anchor cell', () => {
    const [x, y] = footprintCentre2D(FLAT_GRID, 0, 0, { cols: 2, rows: 3 });
    expect(x).toBeCloseTo(-0.13335 + 0.0381);      // one full column in
    expect(y).toBeCloseTo(-0.1524 + 1.5 * 0.0254); // one and a half rows up
  });

  it('a full-width span centres on the grid', () => {
    const [x] = footprintCentre2D(FLAT_GRID, 0, 0, { cols: 7, rows: 12 });
    expect(x).toBeCloseTo(0);
  });
});

describe('gridAttachPoint', () => {
  it('places a cell in component-local space', () => {
    const p = gridAttachPoint(FLAT_GRID, 0, 0);
    expect(approxEqual(p.position, [-0.1143, 0.0253, 0.02])).toBe(true);
    expect(approxEqual(p.facing, [0, 0, 1])).toBe(true);
    expect(p.mask).toBe('pals');
    expect(p.id).toBe('md-grid.pals.front#c0r0');
  });

  // A grid on the side of a pack must work exactly like one on the front, with
  // no special casing anywhere downstream.
  it('carries the plane rotation, so a grid on a side face works too', () => {
    const sideways = { ...FLAT_GRID, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
    const p = gridAttachPoint(sideways, 0, 0);
    expect(approxEqual(p.facing, [1, 0, 0])).toBe(true);
  });

  it('refuses an out-of-bounds span with a useful message', () => {
    expect(() => gridAttachPoint(FLAT_GRID, 6, 0, { cols: 2, rows: 3 }))
      .toThrow(/does not fit at column 6, row 0 of a 7x12 grid/);
  });
});

describe('expandGridCells and placementsFor', () => {
  it('one declaration produces every cell', () => {
    // The point of the whole exercise: 84 attach points, nothing authored.
    expect(expandGridCells(FLAT_GRID)).toHaveLength(84);
  });

  it('a bigger part has fewer places to go', () => {
    expect(placementsFor(FLAT_GRID, { cols: 1, rows: 1 })).toHaveLength(84);
    expect(placementsFor(FLAT_GRID, { cols: 2, rows: 3 })).toHaveLength(6 * 10);
    expect(placementsFor(FLAT_GRID, { cols: 3, rows: 2 })).toHaveLength(5 * 11);
    expect(placementsFor(FLAT_GRID, { cols: 7, rows: 12 })).toHaveLength(1);
  });

  it('a part too big for the panel has nowhere to go', () => {
    expect(placementsFor(FLAT_GRID, { cols: 8, rows: 1 })).toHaveLength(0);
  });

  // One occupied cell rules out every placement that would have covered it —
  // which is more placements than one.
  it('a single occupied cell removes several placements', () => {
    const occupied = new Set(['c3r5']);
    const before = placementsFor(FLAT_GRID, { cols: 2, rows: 3 }).length;
    const after = placementsFor(FLAT_GRID, { cols: 2, rows: 3 }, occupied).length;
    expect(after).toBeLessThan(before);
    // A 2x3 covering c3r5 could be anchored at cols 2-3 and rows 3-5: six ways.
    expect(before - after).toBe(6);
  });

  it('excludes every placement overlapping an existing 2x3 pouch', () => {
    const occupied = new Set(cellsCovered(0, 0, { cols: 2, rows: 3 }));
    const places = placementsFor(FLAT_GRID, { cols: 3, rows: 2 }, occupied);
    for (const p of places) {
      const covered = cellsCovered(p.col, p.row, { cols: 3, rows: 2 });
      expect(covered.some((c) => occupied.has(c))).toBe(false);
    }
  });
});

describe('validateGrid', () => {
  it('accepts a plane that matches its declaration', () => {
    expect(() => validateGrid(FLAT_GRID, [0.2667, 0.3048])).not.toThrow();
  });

  // Same discipline as declared millimetres versus geometry: if the drawn region
  // and the declaration disagree, markers land off the webbing and nothing about
  // the render looks wrong.
  it('refuses a plane drawn to a different size than declared', () => {
    expect(() => validateGrid(FLAT_GRID, [0.2, 0.3048])).toThrow(/must agree/);
  });

  it('refuses a grid with no pitch', () => {
    expect(() => validateGrid({ ...FLAT_GRID, pitchX: 0 })).toThrow(GridError);
  });

  it('refuses an empty grid', () => {
    expect(() => validateGrid({ ...FLAT_GRID, cols: 0 })).toThrow(/at least 1/);
  });
});

describe('real GLBs', () => {
  let panel; let pouch23; let pouch32;

  beforeAll(async () => {
    [panel, pouch23, pouch32] = await Promise.all([
      loadComponent('molle-panel.glb'),
      loadComponent('pouch-2x3.glb'),
      loadComponent('pouch-3x2.glb'),
    ]);
  });

  it('loads a panel whose only attach point is a grid', () => {
    expect(panel.snaps).toHaveLength(0);
    expect(panel.grids).toHaveLength(1);
    expect(panel.grids[0]).toMatchObject({ mask: 'pals', cols: 7, rows: 12 });
    expect(panel.grids[0].pitchX * 1000).toBeCloseTo(38.1);
    expect(panel.grids[0].pitchY * 1000).toBeCloseTo(25.4);
  });

  it('loads pouches carrying their spans', () => {
    expect(pouch23.snaps[0].span).toEqual({ cols: 2, rows: 3 });
    expect(pouch32.snaps[0].span).toEqual({ cols: 3, rows: 2 });
  });

  it('a grid-only component is not rejected for having no snaps', () => {
    // Before grids existed, NO_SNAPS was thrown for any component without one.
    expect(panel.grids.length + panel.snaps.length).toBeGreaterThan(0);
  });
});

describe('assembling onto a grid', () => {
  let components;

  beforeAll(async () => {
    const [panel, pouch23, pouch32] = await Promise.all([
      loadComponent('molle-panel.glb'),
      loadComponent('pouch-2x3.glb'),
      loadComponent('pouch-3x2.glb'),
    ]);
    components = new Map([
      ['molle-panel', panel], ['pouch-2x3', pouch23], ['pouch-3x2', pouch32],
    ]);
  });

  const attach = (cells) => ({
    instances: [
      { instanceId: 'p', componentId: 'molle-panel', position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true },
      ...cells.map((c, i) => ({ instanceId: `x${i}`, componentId: c.component, position: null, rotation: null })),
    ],
    connections: cells.map((c, i) => ({
      fromInstanceId: 'p',
      fromSnapId: makeGridCellId('md-grid.pals.front', c.col, c.row),
      toInstanceId: `x${i}`,
      toSnapId: 'md-snap.pals.mount',
    })),
  });

  it('places a 2x3 pouch flat on the panel face', () => {
    const assembly = attach([{ component: 'pouch-2x3', col: 0, row: 0 }]);
    const { transforms } = resolveTransforms(assembly, components);
    const t = transforms.get('x0');

    // Worked through by hand: grid cell footprint centre is
    // [-0.09525, 0.0507, 0.02]; the pouch's mount snap is at
    // [0, 0.0381, -0.03], so the pouch origin lands at the difference.
    expect(approxEqual(t.translation, [-0.09525, 0.0126, 0.05])).toBe(true);
  });

  it('sits the pouch ON the panel face, not inside it', () => {
    const assembly = attach([{ component: 'pouch-2x3', col: 3, row: 6 }]);
    const { transforms } = resolveTransforms(assembly, components);
    // Panel front face is at z = +0.02 (depth 40mm, origin centred in z).
    // The pouch is 60mm deep with its origin at its own back face, so its
    // origin must land at 0.02 + 0.03.
    expect(transforms.get('x0').translation[2]).toBeCloseTo(0.05);
  });

  it('a higher row places the pouch higher up', () => {
    const low = resolveTransforms(attach([{ component: 'pouch-2x3', col: 0, row: 0 }]), components);
    const high = resolveTransforms(attach([{ component: 'pouch-2x3', col: 0, row: 6 }]), components);
    const rise = high.transforms.get('x0').translation[1] - low.transforms.get('x0').translation[1];
    expect(rise).toBeCloseTo(6 * 0.0254);   // six PALS rows
  });

  // THE test for this change. One pouch must take its whole footprint out of
  // circulation, not just its anchor cell.
  it('a 2x3 pouch occupies six cells of the panel', () => {
    const assembly = attach([{ component: 'pouch-2x3', col: 0, row: 0 }]);
    const { transforms } = resolveTransforms(assembly, components);
    const points = worldSnaps(assembly, components, transforms);

    const cells = points.filter((p) => p.isGridCell && p.instanceId === 'p');
    expect(cells).toHaveLength(84);
    expect(cells.filter((c) => c.occupied)).toHaveLength(6);

    const taken = new Set(cells.filter((c) => c.occupied).map((c) => `c${c.col}r${c.row}`));
    expect(taken).toEqual(new Set(['c0r0', 'c0r1', 'c0r2', 'c1r0', 'c1r1', 'c1r2']));
  });

  it('two pouches side by side occupy twelve cells and do not clash', () => {
    const assembly = attach([
      { component: 'pouch-2x3', col: 0, row: 0 },
      { component: 'pouch-3x2', col: 2, row: 0 },
    ]);
    const { transforms } = resolveTransforms(assembly, components);
    const points = worldSnaps(assembly, components, transforms);

    const occupied = points.filter((p) => p.isGridCell && p.occupied);
    expect(occupied).toHaveLength(12);   // 6 + 6, no double counting
  });

  it('refuses to resolve a pouch anchored where its span runs off the panel', () => {
    const assembly = attach([{ component: 'pouch-2x3', col: 6, row: 0 }]);
    expect(() => resolveTransforms(assembly, components)).toThrow(/does not fit/);
  });

  it('the remaining placements exclude everything overlapping what is there', () => {
    const assembly = attach([{ component: 'pouch-2x3', col: 0, row: 0 }]);
    const occupied = occupiedCellsFor(assembly, components, 'p', 'md-grid.pals.front');
    expect(occupied).toEqual(new Set(['c0r0', 'c0r1', 'c0r2', 'c1r0', 'c1r1', 'c1r2']));

    const panel = components.get('molle-panel');
    const places = placementsFor(panel.grids[0], { cols: 3, rows: 2 }, occupied);

    // Anchoring at c0r0 is now impossible; anchoring clear of it is not.
    expect(places.some((p) => p.col === 0 && p.row === 0)).toBe(false);
    expect(places.some((p) => p.col === 2 && p.row === 0)).toBe(true);
  });
});
