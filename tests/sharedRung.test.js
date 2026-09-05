// One rung, two parts — the thing Kesseböhmer's instruction sheets show and the
// engine used to refuse.
//
// `mounting instructions Suspension elements.pdf` step 2 and
// `mounting instructions hook rail.pdf` steps 1-3 both show the same assembly: a
// shelf RESTS ON a rung, an accessory HOOKS OVER the same rung and hangs
// beneath, and the two are then bolted together through a 1.5 mm packer. The
// old occupancy rule was a boolean, so the first part to arrive closed the rung
// and the second was refused - blocking a configuration the manufacturer
// documents.
//
// The parts here are built by hand rather than loaded from GLBs. The real YouK
// models are derived supplier geometry and gitignored, so a test that needed
// them would pass on this machine and fail on a clean checkout. What matters is
// the geometric relationship, and that states in four numbers.

import { describe, it, expect } from 'vitest';
import { snapBearingSide } from '../src/engine/component.js';
import { attachMatrix, attachAt, pointKey, placementsAt } from '../src/engine/attach.js';

const snap = (id, mask, role, y) => ({
  id,
  mask,
  label: id,
  position: [0, y, 0],
  facing: [0, 0, 1],
  required: false,
  condition: null,
  role,
  span: null,
});

/** A ladder: sockets at two rung heights, body spanning the whole thing. */
const FRAME = {
  id: 'frame',
  dimsMm: { widthMm: 30, heightMm: 1500, depthMm: 320 },
  body: { min: [0, 0, 0], max: [0.03, 1.5, 0.32] },
  snaps: [snap('rung-1', 'd320', 'socket', 0.1), snap('rung-2', 'd320', 'socket', 0.455)],
  grids: [],
  options: [],
  triangleCount: 100,
};

/** A shelf: its plug is on the face it lands on, so its body is ABOVE it. */
const SHELF = {
  id: 'shelf',
  dimsMm: { widthMm: 900, heightMm: 68, depthMm: 287 },
  body: { min: [0, 0, 0], max: [0.9, 0.068, 0.287] },
  snaps: [snap('mount', 'd320', 'plug', 0)],
  grids: [],
  options: [],
  triangleCount: 100,
};

/**
 * A tray: its plug comes off the mounting slot near the TOP, so its body hangs
 * BELOW. On the real YouboXx sets that offset is 158.5 mm; the number does not
 * matter here, only the sign.
 */
const TRAY = {
  id: 'tray',
  dimsMm: { widthMm: 300, heightMm: 160, depthMm: 287 },
  body: { min: [0, 0, 0], max: [0.3, 0.16, 0.287] },
  snaps: [snap('hook', 'd320', 'plug', 0.16)],
  grids: [],
  options: [],
  triangleCount: 100,
};

const components = new Map([FRAME, SHELF, TRAY].map((c) => [c.id, c]));
const CATALOGUE = ['shelf', 'tray'];

const identity = (ids) => new Map(
  ids.map((id) => [id, { translation: [0, 0, 0], rotation: [0, 0, 0, 1] }]),
);

const anchored = () => ({
  instances: [{
    instanceId: 'f1', componentId: 'frame',
    position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
  }],
  connections: [],
});

const matrixFor = (assembly) => attachMatrix(
  assembly, components, CATALOGUE,
  identity(assembly.instances.map((i) => i.instanceId)),
);

const RUNG_1 = 'f1::rung-1';

describe('which side of its own snap a part sits on', () => {
  it('reads it off the geometry, with nothing declared', () => {
    expect(snapBearingSide(SHELF, 'mount')).toBe('above');
    expect(snapBearingSide(TRAY, 'hook')).toBe('below');
  });

  it('does not guess when there is nothing to read', () => {
    expect(snapBearingSide(null, 'mount')).toBe('above');
    expect(snapBearingSide({ snaps: [] }, 'nope')).toBe('above');
  });
});

describe('a rung carrying two parts', () => {
  it('offers both the shelf and the tray while it is empty', () => {
    const matrix = matrixFor(anchored());
    const here = matrix.placements.filter((p) => p.pointKey === RUNG_1);
    expect(new Set(here.map((p) => p.componentId))).toEqual(new Set(['shelf', 'tray']));
  });

  // The point of the whole change. Before this, the shelf closed the rung.
  it('still takes the tray after a shelf has been fitted', () => {
    const withShelf = attachAt(anchored(), {
      point: { instanceId: 'f1', snapId: 'rung-1' },
      componentId: 'shelf',
      mountSnapId: 'mount',
    }, 's1');

    const matrix = matrixFor(withShelf);
    expect(placementsAt(matrix, RUNG_1, 'tray').length).toBe(1);
  });

  it('refuses a SECOND shelf on that rung, because the top is taken', () => {
    const withShelf = attachAt(anchored(), {
      point: { instanceId: 'f1', snapId: 'rung-1' },
      componentId: 'shelf',
      mountSnapId: 'mount',
    }, 's1');

    const matrix = matrixFor(withShelf);
    expect(placementsAt(matrix, RUNG_1, 'shelf').length).toBe(0);

    const why = matrix.rejected.find(
      (r) => pointKey(r.point) === RUNG_1 && r.componentId === 'shelf',
    );
    expect(why.message).toMatch(/already rests on this rung/);
  });

  it('closes the rung once both sides are used', () => {
    let a = attachAt(anchored(), {
      point: { instanceId: 'f1', snapId: 'rung-1' },
      componentId: 'shelf',
      mountSnapId: 'mount',
    }, 's1');
    a = attachAt(a, {
      point: { instanceId: 'f1', snapId: 'rung-1' },
      componentId: 'tray',
      mountSnapId: 'hook',
    }, 't1');

    const matrix = matrixFor(a);
    expect(matrix.placements.filter((p) => p.pointKey === RUNG_1).length).toBe(0);

    const why = matrix.rejected.find((r) => pointKey(r.point) === RUNG_1);
    expect(why.message).toMatch(/above and below/);
  });

  it('leaves the other rung completely alone', () => {
    const withShelf = attachAt(anchored(), {
      point: { instanceId: 'f1', snapId: 'rung-1' },
      componentId: 'shelf',
      mountSnapId: 'mount',
    }, 's1');

    const matrix = matrixFor(withShelf);
    const rung2 = matrix.placements.filter((p) => p.pointKey === 'f1::rung-2');
    expect(new Set(rung2.map((p) => p.componentId))).toEqual(new Set(['shelf', 'tray']));
  });
});

describe('what does NOT become shareable', () => {
  // A shelf's end plug holds one frame. Sharing there would let two frames meet
  // the same shelf end, which is not a thing the range does and not a thing the
  // resolver could draw sensibly.
  it('keeps a plug exclusive even when the free side would allow it', () => {
    const withShelf = attachAt(anchored(), {
      point: { instanceId: 'f1', snapId: 'rung-1' },
      componentId: 'shelf',
      mountSnapId: 'mount',
    }, 's1');

    const matrix = matrixFor(withShelf);
    const onShelfPlug = matrix.placements.filter((p) => p.pointKey === 's1::mount');
    expect(onShelfPlug.length).toBe(0);

    const why = matrix.rejected.find((r) => pointKey(r.point) === 's1::mount');
    expect(why.message).toMatch(/already fitted/);
  });
});
