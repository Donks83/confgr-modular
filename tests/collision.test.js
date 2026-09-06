// Do two parts occupy the same space?
//
// §3.6 listed collision as missing from the first session and it stayed a line
// on a list until it cost something. The case that finally made it worth
// building is in here as a test: a 920 mm desktop spanning the full ladder
// spacing runs straight through one ladder's uprights, and fourteen probe
// scenarios agreed it was fine because every assertion in them was a coordinate
// somebody had predicted.
//
// This measures. It does NOT refuse - see the note at the top of collision.js
// for why a threshold picked before looking at the numbers would be a threshold
// picked to agree with whatever was believed that morning.

import { describe, it, expect } from 'vitest';
import {
  boxFor, boxesFor, overlapDepth, describeOverlap, overlaps, formatOverlaps,
  CONTACT_EPS_M,
} from '../src/engine/collision.js';

const IDENTITY = { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };
const at = (x, y, z, rotation = [0, 0, 0, 1]) => ({ translation: [x, y, z], rotation });
const yaw = (deg) => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

/** A part whose body runs from its base centre, like everything the pipeline emits. */
const part = (id, w, h, d) => ({
  id,
  body: { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] },
  snaps: [],
  triangleCount: 1,
});

/** The 1500 ladder: 30 across, 320 deep. */
const LADDER = part('ladder', 0.03, 1.5, 0.32);
/** A 900 shelf, as authored: 950.2 wide so it laps the frames at each end. */
const SHELF = part('shelf', 0.9502, 0.0685, 0.287);
/** The desktop, in both the width it has and the width it briefly had. */
const DESK_835 = part('desk835', 0.8356, 0.025, 0.6);
const DESK_920 = part('desk920', 0.9201, 0.025, 0.6);

describe('the box a placed part occupies', () => {
  // The origin is the base centre, so the BODY's centre is half a height above
  // it. Using the translation would put every box half a part low, and the
  // first version of this did exactly that.
  it('is centred on the body, not on the part origin', () => {
    const box = boxFor(LADDER, IDENTITY);
    expect(box.centre).toEqual([0, 0.75, 0]);
    expect(box.half).toEqual([0.015, 0.75, 0.16]);
  });

  it('turns with the part rather than growing to fit it', () => {
    // A 950 shelf turned 45 degrees has a 1270 mm world footprint. An
    // axis-aligned box would claim all of it, and every one of those inflated
    // millimetres would be a collision that is not there.
    const box = boxFor(SHELF, at(0, 0, 0, yaw(45)));
    expect(box.half).toEqual([0.9502 / 2, 0.0685 / 2, 0.287 / 2]);
    expect(box.axes[0][0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(box.axes[0][2]).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it('says nothing for a part with no body', () => {
    expect(boxFor({}, IDENTITY)).toBeNull();
    expect(boxFor(LADDER, null)).toBeNull();
  });
});

describe('how deep two boxes interpenetrate', () => {
  it('is zero for boxes that are apart', () => {
    expect(overlapDepth(boxFor(LADDER, IDENTITY), boxFor(LADDER, at(1, 0, 0)))).toBe(0);
  });

  // THE TRAP. Without the degenerate-axis skip this pair reports a
  // depth of essentially zero - two boxes solidly inside each other, measured
  // as not touching - because six of their nine cross products are the zero
  // vector. Every box in a rectilinear bay is parallel to every other, so this
  // is the common case here, not the corner one.
  it('is right for two PARALLEL boxes, one inside the other', () => {
    const outer = boxFor(part('outer', 1, 1, 1), IDENTITY);
    const inner = boxFor(part('inner', 0.2, 0.2, 0.2), at(0, 0.4, 0));
    // Both centred at y 0.5, so the small box is wholly inside. You cannot
    // escape containment by moving a little: it would have to travel half of
    // each box - 500 + 100 mm - to come clear.
    expect(overlapDepth(outer, inner)).toBeCloseTo(0.6, 6);
  });

  // The number is the SHORTEST WAY OUT, which is worth a test of its own
  // because it is not the thickness of the shared region and reading it as one
  // is the easiest mistake to make with it.
  it('is the shortest way out, across the thin dimension', () => {
    // A 500 mm post standing through a 20 mm plate. Sliding it sideways means
    // travelling half the plate; lifting it means only the plate's thickness.
    const plate = boxFor(part('plate', 1, 0.02, 1), IDENTITY);
    const post = boxFor(part('post', 0.04, 0.5, 0.04), at(0, 0, 0));
    expect(overlapDepth(plate, post)).toBeCloseTo(0.02, 6);
  });

  it('is zero for two faces exactly touching', () => {
    const lower = boxFor(part('lower', 0.5, 0.5, 0.5), IDENTITY);
    const upper = boxFor(part('upper', 0.5, 0.5, 0.5), at(0, 0.5, 0));
    expect(overlapDepth(lower, upper)).toBeLessThanOrEqual(1e-9);
  });

  // Two boxes that miss each other on every face axis and still cross. This is
  // the case the nine cross products exist for, and the one a six-axis test
  // silently gets wrong.
  it('catches an edge-on crossing that no face axis separates', () => {
    const a = boxFor(part('bar-a', 2, 0.1, 0.1), at(0, 0, 0));
    const b = boxFor(part('bar-b', 2, 0.1, 0.1), at(0, 0.02, 0, yaw(45)));
    expect(overlapDepth(a, b)).toBeGreaterThan(0);
  });
});

describe('the desk that ran through a ladder', () => {
  // Reconstructed from the layout the probe reported when it was wrong. Two
  // ladders 920.1 apart; the desk was widened to 920.1 to span them, which put
  // it from x -42 to 878 with ladder 1 at x +/-15.
  const ladderA = boxFor(LADDER, at(0, 0, 0));
  const ladderB = boxFor(LADDER, at(0.9201, 0, 0));

  it('is found', () => {
    // The desk sits 626.5 up, running through ladder 1.
    const desk = boxFor(DESK_920, at(0.418, 0.6265, -0.14));
    const depth = overlapDepth(ladderA, desk);
    expect(depth).toBeGreaterThan(0);
    // 57.05 mm: the board's left end overhangs the frame's far face by that
    // much, and sliding it sideways is the shortest way to come clear. NOT the
    // frame's 30 mm width, which is what the number looks like it should be -
    // see the note on overlapDepth.
    expect(depth * 1000).toBeCloseTo(57.05, 1);
  });

  // The width it was reverted to. The board runs between the ladders and
  // touches neither, which is what the revert was for.
  it('does not happen at the width the desk actually is', () => {
    const desk = boxFor(DESK_835, at(0.4601, 0.6265, -0.14));
    expect(overlapDepth(ladderA, desk)).toBe(0);
    expect(overlapDepth(ladderB, desk)).toBe(0);
  });
});

// THE RULE, and it came out of the survey rather than ahead of it. Running the
// report across every scenario found exactly two kinds of unjoined overlap in
// the whole range - a 1.5 mm packer and a 30.0 mm lap on a 30 mm frame - and
// both are correct. The desk that ran through a ladder reads 57.05 mm on that
// same 30 mm frame.
//
// So: a lap is BOUNDED BY THE THING BEING LAPPED, because a span part's end is
// authored flush with the frame's outer face. Anything deeper did not stop.
describe('lapping versus going through', () => {
  const frame = boxFor(LADDER, at(0, 0, 0));

  it('calls a shelf lapping its frame a lap, at exactly the frame width', () => {
    const shelf = boxFor(SHELF, at(0.4601, 0.1, 0));
    const d = describeOverlap(frame, shelf);
    expect(d.depth * 1000).toBeCloseTo(30, 0);
    expect(d.spanA * 1000).toBeCloseTo(30, 0);   // the frame, along the way out
    expect(d.through).toBe(false);
  });

  it('calls the desk that ran through the ladder a THROUGH', () => {
    const desk = boxFor(DESK_920, at(0.418, 0.6265, -0.14));
    const d = describeOverlap(frame, desk);
    expect(d.depth * 1000).toBeCloseTo(57.05, 1);
    expect(d.through).toBe(true);
  });

  // The 1.5 mm packer between a shelf and the accessory hooked under the same
  // rung. Every scenario with a shared rung reports one and every one is right.
  it('calls a packer a lap', () => {
    const above = boxFor(part('above', 0.9, 0.0685, 0.287), at(0, 0.1, 0));
    const below = boxFor(part('below', 0.3, 0.16, 0.287), at(0, -0.0585, 0));
    const d = describeOverlap(above, below);
    expect(d.depth * 1000).toBeCloseTo(1.5, 1);
    expect(d.through).toBe(false);
  });

  // Containment cannot be a lap: a part wholly inside another has not stopped
  // at anything.
  it('calls containment a THROUGH', () => {
    const outer = boxFor(part('outer', 1, 1, 1), IDENTITY);
    const inner = boxFor(part('inner', 0.2, 0.2, 0.2), at(0, 0.4, 0));
    expect(describeOverlap(outer, inner).through).toBe(true);
  });

  // The tightest joint in the range, and it is 0.1 mm past flush. A 900 shelf
  // measures 950.2 across two 30 mm frames at 920.1 centres, which want 950.1.
  // That is two independent measurements off two supplier files agreeing to a
  // tenth of a millimetre - and without the flush tolerance it reports as the
  // shelf passing through the far frame.
  it('calls a lap that overhangs by a tenth of a millimetre a lap', () => {
    const far = boxFor(LADDER, at(0.9201, 0, 0));
    const shelf = boxFor(SHELF, at(0.4601, 0.1, 0));
    const d = describeOverlap(far, shelf);
    expect(d.depth * 1000).toBeGreaterThan(30);      // genuinely past flush
    expect(d.depth * 1000).toBeLessThan(30.2);
    expect(d.through).toBe(false);
  });

  it('says nothing at all when the boxes are apart', () => {
    expect(describeOverlap(frame, boxFor(LADDER, at(1, 0, 0)))).toBeNull();
  });
});

// The L that made the case for proxies, at its measured size. A 4 mm leg at
// z -10..-6 running the full height, and a 3 mm foot across the top at
// y 56..60 lapping forward to z +10. Its bounding box is a solid 20 x 60 x 20.
const CLAMP = {
  id: 'clamp',
  body: { min: [-0.01, 0, -0.01], max: [0.01, 0.06, 0.01] },
  collisionBoxes: [
    { name: 'col-leg', min: [-0.01, 0, -0.01], max: [0.01, 0.06, -0.006] },
    { name: 'col-foot', min: [-0.01, 0.056, -0.01], max: [0.01, 0.06, 0.01] },
  ],
  snaps: [],
  triangleCount: 1,
};

describe('collision proxies', () => {
  // The board's back edge in the angle's corner, exactly as the sheet fits it:
  // 25 mm thick, its top face against the foot's underside at y 56, its back
  // edge against the leg's front face at z -6, running forward out of the L.
  // It touches the angle on two faces and shares space with none of its metal.
  const board = boxFor(part('board', 0.9, 0.025, 0.6), at(0, 0.031, 0.294));

  it('is what the body box gets wrong', () => {
    // The solid 20 x 60 x 20 box says the two are inside each other, because
    // the space in the corner of an L is inside the L's box.
    const solid = boxFor(CLAMP, at(0, 0, 0));
    expect(describeOverlap(solid, board)).not.toBeNull();
  });

  it('is what the proxies get right', () => {
    const boxes = boxesFor(CLAMP, at(0, 0, 0));
    expect(boxes).toHaveLength(2);
    // Touching on a face is not sharing space: both come back apart.
    for (const b of boxes) expect(describeOverlap(b, board)?.depth || 0).toBeLessThan(1e-9);
  });

  it('falls back to the body for a part that has none', () => {
    const boxes = boxesFor(LADDER, at(0, 0, 0));
    expect(boxes).toHaveLength(1);
    expect(boxes[0].half).toEqual([0.015, 0.75, 0.16]);
  });

  // The survey has to ask every proxy against every proxy, and let the DEEPEST
  // contact stand for the pair - otherwise a part touching another in two
  // places is described by whichever box happened to be first in the list.
  it('reports the deepest contact of the pair, not the first', () => {
    const components = new Map([['clamp', CLAMP], ['post', part('post', 0.004, 0.5, 0.004)]]);
    const assembly = {
      instances: [
        { instanceId: 'c1', componentId: 'clamp' },
        { instanceId: 'p1', componentId: 'post' },
      ],
      connections: [],
    };
    // A thin post standing up through BOTH the leg and the foot.
    const rows = overlaps(assembly, components, new Map([
      ['c1', at(0, 0, 0)], ['p1', at(0, 0, -0.008)],
    ]));
    expect(rows).toHaveLength(1);
    // The leg is 4 mm through and the foot is 4 mm through; the deepest way out
    // of either is the post's own 4 mm, not the box that came first.
    expect(rows[0].depthMm).toBeGreaterThan(3.9);
  });
});

describe('the survey', () => {
  const components = new Map([
    ['ladder', LADDER], ['shelf', SHELF], ['desk920', DESK_920],
  ]);

  /** A bay with a shelf, plus a desk wide enough to run through ladder 1. */
  const assembly = {
    instances: [
      { instanceId: 'l1', componentId: 'ladder' },
      { instanceId: 's1', componentId: 'shelf' },
      { instanceId: 'l2', componentId: 'ladder' },
      { instanceId: 'd1', componentId: 'desk920' },
    ],
    connections: [
      { fromInstanceId: 'l1', fromSnapId: 'r', toInstanceId: 's1', toSnapId: 'm' },
      { fromInstanceId: 's1', fromSnapId: 'm2', toInstanceId: 'l2', toSnapId: 'r2' },
    ],
  };

  const transforms = new Map([
    ['l1', at(0, 0, 0)],
    ['s1', at(0.4601, 0.1, 0)],
    ['l2', at(0.9201, 0, 0)],
    ['d1', at(0.418, 0.6265, -0.14)],
  ]);

  it('finds the desk through the ladder, and calls it a THROUGH', () => {
    const rows = overlaps(assembly, components, transforms);
    const bad = rows.filter((r) => r.through);
    expect(bad).toHaveLength(1);
    expect(new Set([bad[0].a, bad[0].b])).toEqual(new Set(['l1', 'd1']));
    expect(bad[0].depthMm).toBeCloseTo(57.1, 1);
    expect(bad[0].thinnerMm).toBeCloseTo(30, 0);
    expect(bad[0].joined).toBe(false);
  });

  // The shelf laps BOTH frames by design - 950.2 wide across a 920.1 gap - so
  // it overlaps two ladders and both are joints. That is what the `joined`
  // column is for: without it these would read exactly like the desk.
  //
  // AND THE POINT OF THE WHOLE FILE IS IN THESE TWO ASSERTIONS. The shelf that
  // is SUPPOSED to lap its frame reports 30.1 mm; the desk that ran through a
  // ladder reports 57.1 mm. Same order of magnitude, opposite meanings, and no
  // flat depth threshold separates them - it is the comparison against the
  // frame's OWN 30 mm that does.
  it('finds the shelf lapping its frames, and says those ARE joints', () => {
    const rows = overlaps(assembly, components, transforms);
    const joined = rows.filter((r) => r.joined);
    expect(joined).toHaveLength(2);
    // 30.0 at one end and 30.1 at the other: the 950.2 shelf across a 920.1 gap
    // laps 30.1 in total, and its own centring puts a tenth more of it on one
    // frame than the other. Asserted as a range rather than rounded away,
    // because a lap that came out symmetric would mean the shelf had moved.
    for (const r of joined) {
      expect(r.depthMm).toBeGreaterThan(29.9);
      expect(r.depthMm).toBeLessThan(30.2);
    }
  });

  it('is sorted deepest first', () => {
    const rows = overlaps(assembly, components, transforms);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].depthMm).toBeGreaterThanOrEqual(rows[i].depthMm);
    }
  });

  // A shelf resting on a rung has two surfaces at the same height. Reporting
  // that would bury the survey in every joint in the product.
  it('ignores contact below half a millimetre', () => {
    const touching = new Map([
      ['a', { instanceId: 'a', componentId: 'ladder' }],
      ['b', { instanceId: 'b', componentId: 'ladder' }],
    ]);
    const rows = overlaps(
      { instances: [...touching.values()], connections: [] },
      components,
      new Map([['a', at(0, 0, 0)], ['b', at(0.03 - 0.0002, 0, 0)]]),
    );
    expect(rows).toHaveLength(0);
    expect(CONTACT_EPS_M).toBe(0.0005);
  });

  it('says so plainly when nothing shares space', () => {
    expect(formatOverlaps([])).toBe('no two parts share space');
  });

  it('puts the THROUGH pairs first, because they are the ones that matter', () => {
    const text = formatOverlaps(overlaps(assembly, components, transforms));
    expect(text.indexOf('THROUGH')).toBeLessThan(text.indexOf('at a joint'));
    expect(text).toMatch(/1 THROUGH/);
    expect(text).toMatch(/2 at a joint/);
  });

  it('copes with an assembly whose parts are not all resolved', () => {
    expect(overlaps(assembly, components, new Map([['l1', at(0, 0, 0)]]))).toEqual([]);
    expect(overlaps(null, components, transforms)).toEqual([]);
  });
});
