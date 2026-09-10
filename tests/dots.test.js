// The dots: where a new part can go, and where a placed one can go instead.
//
// Matt, having configured a three-bay unit and got a pile: "it needs to be the
// drag and drop we had at the start with the snap dots, click a dot add an
// accessory to the dot and then you can click and drag to change its
// location." These are the two engine queries behind that, and the reason they
// are worth a test of their own is that they must AGREE with placement. An
// offered dot that `buildGuided` then refuses is a part that springs back, and
// that failure already happened once with the height list in §5.24.
//
// What is held here:
//
//   1. Both queries come out of the same candidate list, so the panel's
//      heights and the scene's dots can never disagree.
//   2. A spanning part is only offered positions where it ends up held at both
//      ends - the rule placement uses.
//   3. A point recorded from a dot is honoured on the next build, in the same
//      place, which is the whole contract of `choices.at`.
//   4. Structural parts offer nothing and say why.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseGuided, defaultChoices, buildGuided,
  moveCandidates, moveOptions, movePoints, addPoints, slotKeyFor,
} from '../src/engine/guided.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { pointKey } from '../src/engine/attach.js';
import { loadFolder } from '../tools/export-glb.mjs';

const YOUK = join(process.cwd(), 'youk');
const SHELF = '008563-shelf-900mm-for-ladder-depth-320mm';
const RACK = '008543-rack-for-ladder-depth-320mm';

let schema;
let components;

beforeAll(() => {
  schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  ({ components } = loadFolder(YOUK));
});

const build = (patch = {}) => buildGuided(schema, {
  ...defaultChoices(schema), bays: 1, adds: {}, ...patch,
}, components);

const worldYof = (built, instanceId) => {
  const { transforms } = resolveTransforms(built.assembly, components);
  return Math.round(transforms.get(instanceId).translation[1] * 1000);
};

describe('where a new part can go', () => {
  it('offers dots for an accessory the frame can take', () => {
    const points = addPoints(build(), components, SHELF);
    expect(points.length).toBeGreaterThan(0);
  });

  it('every dot carries what a placement record needs', () => {
    for (const p of addPoints(build(), components, SHELF)) {
      expect(typeof p.instanceId).toBe('string');
      expect(typeof p.snapId).toBe('string');
      expect(p.worldPosition).toHaveLength(3);
      expect(p.worldFacing).toHaveLength(3);
    }
  });

  it('offers nothing for a part this frame cannot take', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' });
    expect(addPoints(built, components, '008531-clothes-rail-900mm')).toEqual([]);
  });

  it('offers more dots on a longer run', () => {
    const one = addPoints(build({ bays: 1 }), components, SHELF).length;
    const three = addPoints(build({ bays: 3 }), components, SHELF).length;
    expect(three).toBeGreaterThan(one);
  });

  it('says nothing rather than throwing when asked about nonsense', () => {
    expect(addPoints(build(), components, 'no-such-part')).toEqual([]);
    expect(addPoints(null, components, SHELF)).toEqual([]);
  });
});

// THE CONTRACT. A dot is only worth showing if pressing it puts the part
// there - and the state model records the INTENT, so the proof is that a
// rebuild from those choices lands the part on the point that was recorded.
describe('a dot that was pressed', () => {
  it('puts the part exactly where the dot was', () => {
    const first = build();
    const points = addPoints(first, components, SHELF);
    // Deliberately not the first: auto-placement takes the lowest, so picking
    // the highest proves the record beat the policy rather than agreeing with
    // it by luck.
    const target = points[points.length - 1];

    const after = build({
      adds: { [SHELF]: 1 },
      at: { [slotKeyFor(SHELF, 0)]: { instanceId: target.instanceId, snapId: target.snapId } },
    });
    expect(after.refused).toEqual([]);
    expect(after.dropped).toEqual([]);

    // The slot landed on the point that was asked for.
    expect(after.slotAt[slotKeyFor(SHELF, 0)]).toEqual({
      instanceId: target.instanceId,
      snapId: target.snapId,
    });
  });

  it('and a different dot puts it somewhere else', () => {
    const first = build();
    const points = addPoints(first, components, SHELF);
    const ys = points.map((target) => {
      const after = build({
        adds: { [SHELF]: 1 },
        at: { [slotKeyFor(SHELF, 0)]: { instanceId: target.instanceId, snapId: target.snapId } },
      });
      const id = Object.entries(after.slots).find(([, s]) => s === slotKeyFor(SHELF, 0))?.[0];
      return worldYof(after, id);
    });
    expect(new Set(ys).size).toBeGreaterThan(1);
  });
});

describe('where a placed part can go instead', () => {
  const withRack = () => {
    const built = build({ adds: { [RACK]: 1 } });
    const id = Object.entries(built.slots).find(([, s]) => s.startsWith(RACK))?.[0];
    return { built, id };
  };

  it('offers dots for an accessory that is already on', () => {
    const { built, id } = withRack();
    expect(movePoints(built, components, id).length).toBeGreaterThan(0);
  });

  // ONE ANSWER, TWO VIEWS. The panel shows heights and the scene shows dots,
  // and when the dots arrived the obvious thing was to write a second filtered
  // query for them - which is the mistake this project has made four times.
  it('the heights and the dots come from one candidate list', () => {
    const { built, id } = withRack();
    const candidates = moveCandidates(built, components, id).candidates;
    const heights = moveOptions(built, components, id).options;
    const dots = movePoints(built, components, id);

    expect(dots.length).toBe(new Set(candidates.map((c) => pointKey(c.point))).size);
    expect(heights.length).toBe(new Set(candidates.map((c) => c.heightMm)).size);
    // Every height is a height some dot actually has.
    for (const h of heights) {
      expect(candidates.some((c) => c.heightMm === h.heightMm)).toBe(true);
    }
  });

  it('every candidate carries the pose the part would take, for the preview', () => {
    const { built, id } = withRack();
    for (const c of moveCandidates(built, components, id).candidates) {
      expect(c.pose.translation).toHaveLength(3);
      expect(c.pose.rotation).toHaveLength(4);
    }
  });

  // A spanning part held at one end would be refused by buildGuided, so
  // offering the position at all means the part springs back the moment the
  // product rebuilds.
  it('only offers a spanning part positions it survives', () => {
    const built = build({ bays: 2, adds: { [SHELF]: 1 } });
    const id = Object.entries(built.slots).find(([, s]) => s.startsWith(SHELF))?.[0];
    const slot = built.slots[id];

    for (const p of movePoints(built, components, id)) {
      const after = build({
        bays: 2,
        adds: { [SHELF]: 1 },
        at: { [slot]: { instanceId: p.instanceId, snapId: p.snapId } },
      });
      expect(after.dropped).toEqual([]);
      expect(after.refused).toEqual([]);
    }
  });

  // The anchor is a ladder, not a refusal. Matt asked to tap a ladder and
  // change it, so the panel needs to know this one's POSITION is fixed while
  // its type is not - which is why the answer carries `kind` rather than being
  // a flat no.
  it('says the first ladder stays put, and calls it a ladder', () => {
    const built = build();
    const frameId = built.assembly.instances[0].instanceId;
    const r = moveCandidates(built, components, frameId);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('frame');
    expect(r.anchor).toBe(true);
    expect(r.reason).toMatch(/stands on|measured from/i);
    expect(movePoints(built, components, frameId)).toEqual([]);
  });

  // A span is the one thing that is still nobody's to move: it IS the bay, and
  // taking it out would leave a run with a hole in it.
  it('offers nothing for a span, and says what to change instead', () => {
    const built = build();
    const span = built.assembly.instances
      .find((i) => i.componentId === built.size.span.componentId);
    const r = moveCandidates(built, components, span.instanceId);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('span');
    expect(r.structural).toBe(true);
    expect(r.reason).toMatch(/width|bays/i);
  });

  it('offers nothing for a part that is not on the product', () => {
    const built = build();
    expect(moveCandidates(built, components, 'g999').ok).toBe(false);
    expect(movePoints(built, components, 'g999')).toEqual([]);
  });
});
