// Parts nobody chooses.
//
// Matt asked "is the foot an option that can be added or not?" and chose: stay
// an option, but make it real. What that means concretely is here — the
// mounting dropdown produces geometry and a bill-of-materials line, and it
// refuses a configuration it cannot produce them for.
//
// Built by hand rather than from GLBs, for the same reason as sharedRung and
// partFront: the real YouK models are derived supplier geometry and gitignored,
// so a test that loaded them would pass here and fail on a clean checkout. The
// numbers below are the measured ones — the frame's foot fixings at z −119 and
// −81, the foot's own at ∓19 of its centre — so the arithmetic being checked is
// the arithmetic the real parts do.

import { describe, it, expect } from 'vitest';
import {
  impliedParts, impliedBom, withImplied, impliedComponentIds, isImplied,
  FOOT_COMPONENT_ID, IMPLIED_PREFIX,
} from '../src/engine/implied.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { attachAt } from '../src/engine/attach.js';
import { MOUNTING } from '../src/engine/ar.js';

const snap = (id, mask, label, role, position, facing) => ({
  id, mask, label, position, facing, required: false, condition: null, role, span: null, roll: 0,
});

const RUNG = (i, side, y) => snap(
  `md-snap.youk-d320.rung-${i}-${side}`, 'youk-d320', `rung-${i}-${side}`, 'socket',
  [0, y, 0], side === 'right' ? [1, 0, 0] : [-1, 0, 0],
);

/** A 320 ladder: rungs on both faces, and the two foot fixings underneath. */
const LADDER_320 = {
  id: 'ladder320',
  dimsMm: { widthMm: 30, heightMm: 1500, depthMm: 320 },
  body: { min: [-0.015, 0, -0.16], max: [0.015, 1.5, 0.16] },
  front: [0, 0, -1],
  wallFixings: 2,
  snaps: [
    RUNG(1, 'right', 0.1), RUNG(1, 'left', 0.1),
    snap('md-snap.youk-foot.foot', 'youk-foot', 'foot', 'socket', [0, 0, -0.119], [0, -1, 0]),
    snap('md-snap.youk-foot-adjust.foot-adjust', 'youk-foot-adjust', 'foot-adjust', 'socket',
      [0, 0, -0.081], [0, -1, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

/** A 200 ladder: wall-fixed like every frame, and no foot fixing at all. */
const LADDER_200 = {
  ...LADDER_320,
  id: 'ladder200',
  dimsMm: { widthMm: 30, heightMm: 668, depthMm: 200 },
  body: { min: [-0.015, 0, -0.1], max: [0.015, 0.668, 0.1] },
  snaps: [RUNG(1, 'right', 0.1), RUNG(1, 'left', 0.1)],
};

/** The foot: 99.8 tall, its plate's fixed hole 19 mm forward of its centre. */
const FOOT = {
  id: FOOT_COMPONENT_ID,
  dimsMm: { widthMm: 20, heightMm: 99.8, depthMm: 50 },
  body: { min: [-0.01, 0, -0.025], max: [0.01, 0.0998, 0.025] },
  front: null,
  wallFixings: 0,
  snaps: [
    snap('md-snap.youk-foot.foot', 'youk-foot', 'foot', 'plug', [0, 0.0998, -0.019], [0, 1, 0]),
    snap('md-snap.youk-foot-adjust.foot-adjust', 'youk-foot-adjust', 'foot-adjust', 'plug',
      [0, 0.0998, 0.019], [0, 1, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

/** A shelf, so a rung can be shared and a bay can be built. */
const SHELF = {
  id: 'shelf',
  dimsMm: { widthMm: 900, heightMm: 68, depthMm: 287 },
  body: { min: [-0.45, 0, -0.1435], max: [0.45, 0.068, 0.1435] },
  front: [0, 0, -1],
  wallFixings: 0,
  snaps: [
    snap('mount-left', 'youk-d320', 'mount-left', 'plug', [-0.435, 0, 0], [-1, 0, 0]),
    snap('mount-right', 'youk-d320', 'mount-right', 'plug', [0.435, 0, 0], [1, 0, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

/** A tray: hooks over a rung and hangs beneath it. */
const TRAY = {
  id: 'tray',
  dimsMm: { widthMm: 300, heightMm: 160, depthMm: 287 },
  body: { min: [-0.15, 0, -0.1435], max: [0.15, 0.16, 0.1435] },
  front: null,
  wallFixings: 0,
  snaps: [snap('hook', 'youk-d320', 'hook', 'plug', [0, 0.16, 0], [1, 0, 0])],
  grids: [], options: [], triangleCount: 100,
};

/** A bracket offering a `carries` socket — where the other packer lives. */
const BRACKET = {
  id: 'bracket',
  dimsMm: { widthMm: 315, heightMm: 8, depthMm: 315 },
  body: { min: [-0.1575, 0, -0.1575], max: [0.1575, 0.008, 0.1575] },
  front: null,
  wallFixings: 0,
  snaps: [
    snap('hook', 'youk-d320', 'hook', 'plug', [0, 0.0065, 0], [1, 0, 0]),
    snap('md-snap.youk-carcase-d320.carries', 'youk-carcase-d320', 'carries', 'socket',
      [0, 0.0095, 0], [0, 1, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

const CARCASE = {
  id: 'carcase',
  dimsMm: { widthMm: 890, heightMm: 450, depthMm: 320 },
  body: { min: [-0.445, 0, -0.16], max: [0.445, 0.45, 0.16] },
  front: null,
  wallFixings: 0,
  snaps: [
    snap('down-left', 'youk-carcase-d320', 'down-left', 'plug', [-0.4449, 0, 0], [0, -1, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

const components = new Map(
  [LADDER_320, LADDER_200, FOOT, SHELF, TRAY, BRACKET, CARCASE].map((c) => [c.id, c]),
);

const anchored = (componentId) => ({
  instances: [{
    instanceId: 'l1', componentId, position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
  }],
  connections: [],
});

/** A whole bay: two 320 ladders with a shelf between them. */
function bay() {
  const withShelf = attachAt(anchored('ladder320'), {
    point: { instanceId: 'l1', snapId: 'md-snap.youk-d320.rung-1-right' },
    componentId: 'shelf',
    mountSnapId: 'mount-left',
  }, 's1');
  return attachAt(withShelf, {
    point: { instanceId: 's1', snapId: 'mount-right' },
    componentId: 'ladder320',
    mountSnapId: 'md-snap.youk-d320.rung-1-left',
  }, 'l2');
}

const feet = { mounting: MOUNTING.FEET };

describe('the foot, when the bay stands on feet', () => {
  it('is not in the palette — it is never chosen', () => {
    expect(impliedComponentIds()).toContain(FOOT_COMPONENT_ID);
  });

  it('appears once per ladder', () => {
    const { connections } = impliedParts(bay(), components, feet);
    expect(connections).toHaveLength(2);
    expect(new Set(connections.map((c) => c.hostInstanceId))).toEqual(new Set(['l1', 'l2']));
    for (const c of connections) expect(c.componentId).toBe(FOOT_COMPONENT_ID);
  });

  it('does not appear on the floor or on the wall', () => {
    for (const mounting of [MOUNTING.FLOOR, MOUNTING.WALL]) {
      expect(impliedParts(bay(), components, { mounting }).connections).toHaveLength(0);
    }
  });

  // The whole point of measuring the holes: the position is a consequence of
  // the geometry, not a number typed into implied.js.
  it('lands 99.8 mm under the ladder, centred on the front fixing', () => {
    const scene = withImplied(bay(), components, feet);
    const { transforms } = resolveTransforms(scene, components);
    const t = transforms.get(`${IMPLIED_PREFIX}foot:l1:0`);

    expect(t).toBeTruthy();
    // Its own plug is 99.8 up its body and 19 forward of its centre; the
    // ladder's socket is at y 0, z -119. So the body drops to -0.0998 and the
    // foot's centre lands at z -0.100 — the front of the frame.
    expect(t.translation[0]).toBeCloseTo(0, 6);
    expect(t.translation[1]).toBeCloseTo(-0.0998, 6);
    expect(t.translation[2]).toBeCloseTo(-0.1, 6);
  });

  it('lands under the SECOND ladder too, wherever that is', () => {
    const scene = withImplied(bay(), components, feet);
    const { transforms } = resolveTransforms(scene, components);
    const ladder = transforms.get('l2').translation;
    const foot = transforms.get(`${IMPLIED_PREFIX}foot:l2:0`).translation;

    expect(foot[0]).toBeCloseTo(ladder[0], 6);
    expect(foot[1]).toBeCloseTo(ladder[1] - 0.0998, 6);
    expect(foot[2]).toBeCloseTo(ladder[2] - 0.1, 6);
  });

  // Either fixing puts the foot in the same place — which is what makes the
  // 38.00 mm agreement between the two parts a check rather than a coincidence.
  it('lands identically whichever of the two fixings is used', () => {
    const viaFixed = resolveTransforms(
      attachAt(anchored('ladder320'), {
        point: { instanceId: 'l1', snapId: 'md-snap.youk-foot.foot' },
        componentId: FOOT_COMPONENT_ID,
        mountSnapId: 'md-snap.youk-foot.foot',
      }, 'f'),
      components,
    ).transforms.get('f');

    const viaSlot = resolveTransforms(
      attachAt(anchored('ladder320'), {
        point: { instanceId: 'l1', snapId: 'md-snap.youk-foot-adjust.foot-adjust' },
        componentId: FOOT_COMPONENT_ID,
        mountSnapId: 'md-snap.youk-foot-adjust.foot-adjust',
      }, 'f'),
      components,
    ).transforms.get('f');

    for (let a = 0; a < 3; a += 1) {
      expect(viaSlot.translation[a]).toBeCloseTo(viaFixed.translation[a], 6);
    }
  });

  it('goes on the bill of materials as something included, not chosen', () => {
    const rows = impliedBom(bay(), components, feet);
    expect(rows).toEqual([
      {
        componentId: FOOT_COMPONENT_ID,
        qty: 2,
        implied: true,
        because: expect.stringMatching(/one adjustable foot per ladder/i),
      },
    ]);
  });
});

describe('a ladder that cannot take a foot', () => {
  // Measured, not assumed: the 200 mm frames' undersides carry corner radii and
  // no fixings at all, on both of them.
  it('is refused rather than given one anyway', () => {
    const result = impliedParts(anchored('ladder200'), components, feet);
    expect(result.connections).toHaveLength(0);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0].code).toBe('NO_FOOT_FIXING');
    expect(result.refusals[0].message).toMatch(/200 mm frames do not have them/);
  });

  // One sentence per configuration, not per ladder, and it has to read as
  // English at both counts — the first version said "2 ladders ... has no".
  it('counts the ladders once, in a sentence that reads', () => {
    const two = attachAt(
      attachAt(anchored('ladder200'), {
        point: { instanceId: 'l1', snapId: 'md-snap.youk-d320.rung-1-right' },
        componentId: 'shelf',
        mountSnapId: 'mount-left',
      }, 's1'),
      {
        point: { instanceId: 's1', snapId: 'mount-right' },
        componentId: 'ladder200',
        mountSnapId: 'md-snap.youk-d320.rung-1-left',
      },
      'l2',
    );

    const { refusals } = impliedParts(two, components, feet);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].message).toMatch(/^2 ladders in this configuration have no/);
    expect(impliedParts(anchored('ladder200'), components, feet).refusals[0].message)
      .toMatch(/^One ladder in this configuration has no/);
  });

  it('says nothing when the bay is not on feet', () => {
    expect(impliedParts(anchored('ladder200'), components, { mounting: MOUNTING.FLOOR }).refusals)
      .toHaveLength(0);
  });
});

describe('the wall fixings', () => {
  // Everything is wall-fixed. The brochure's three options are three GROUND
  // conditions, not three fixings, so this is not conditional on the mounting.
  it('are counted for every mounting, two per ladder', () => {
    for (const mounting of [MOUNTING.FLOOR, MOUNTING.WALL, MOUNTING.FEET]) {
      const note = impliedParts(bay(), components, { mounting })
        .notes.find((n) => n.code === 'WALL_FIXINGS');
      expect(note.qty).toBe(4);
    }
  });

  it('are not counted for parts that do not touch a wall', () => {
    const note = impliedParts(anchored('shelf'), components, {})
      .notes.find((n) => n.code === 'WALL_FIXINGS');
    expect(note).toBeUndefined();
  });

  // A note is not a quote line. A line with no price is the thing quote.js
  // exists to refuse, so these must never be able to become one.
  it('never become bill-of-materials rows', () => {
    expect(impliedBom(bay(), components, feet).map((r) => r.componentId))
      .not.toContain('WALL_FIXINGS');
  });
});

describe('the 1.5 mm packers', () => {
  it('counts one where a rung carries two parts bolted together', () => {
    const shared = attachAt(bay(), {
      point: { instanceId: 'l1', snapId: 'md-snap.youk-d320.rung-1-right' },
      componentId: 'tray',
      mountSnapId: 'hook',
    }, 't1');

    const note = impliedParts(shared, components, {}).notes.find((n) => n.code === 'PACKERS');
    expect(note.qty).toBe(1);
    expect(note.text).toMatch(/1 where a rung carries two parts/);
  });

  it('counts one for every part laid on a bracket', () => {
    let a = attachAt(anchored('ladder320'), {
      point: { instanceId: 'l1', snapId: 'md-snap.youk-d320.rung-1-right' },
      componentId: 'bracket',
      mountSnapId: 'hook',
    }, 'b1');
    a = attachAt(a, {
      point: { instanceId: 'b1', snapId: 'md-snap.youk-carcase-d320.carries' },
      componentId: 'carcase',
      mountSnapId: 'down-left',
    }, 'c1');

    const note = impliedParts(a, components, {}).notes.find((n) => n.code === 'PACKERS');
    expect(note.qty).toBe(1);
    expect(note.text).toMatch(/1 between a bracket and what is laid on it/);
  });

  it('counts nothing on a bay where every rung carries one thing', () => {
    expect(impliedParts(bay(), components, {}).notes.find((n) => n.code === 'PACKERS'))
      .toBeUndefined();
  });
});

describe('what "derived, never stored" means', () => {
  it('leaves the real assembly untouched', () => {
    const original = bay();
    const before = JSON.stringify(original);
    withImplied(original, components, feet);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('marks every implied instance so nothing can mistake it for a real part', () => {
    const scene = withImplied(bay(), components, feet);
    const added = scene.instances.filter((i) => !original(i.instanceId));
    expect(added).toHaveLength(2);
    for (const i of added) expect(isImplied(i.instanceId)).toBe(true);
    for (const i of ['l1', 's1', 'l2']) expect(isImplied(i)).toBe(false);
  });

  it('produces the same answer twice, because nothing accumulates', () => {
    const once = withImplied(bay(), components, feet);
    const twice = withImplied(bay(), components, feet);
    expect(twice.instances).toHaveLength(once.instances.length);
    expect(once.instances).toHaveLength(5);
  });

  // The foot socket is filled once a foot is on it, so asking again does not
  // stack a second one underneath the first.
  it('does not add a foot to a ladder that already has one', () => {
    const once = withImplied(bay(), components, feet);
    const again = withImplied(once, components, feet);
    expect(again.instances).toHaveLength(once.instances.length);
  });

  it('copes with an empty assembly', () => {
    const result = impliedParts({ instances: [], connections: [] }, components, feet);
    expect(result).toEqual({ connections: [], notes: [], refusals: [] });
  });
});

const original = (id) => ['l1', 's1', 'l2'].includes(id);
