// Ladders of different types in one run, and the height each one sits at.
//
// Matt, after the dots landed: "is it possible to be able to add ladders of
// different types to mix and match? maybe i can click on a ladder in the scene
// and change its type and then change what height it sits?"
//
// The geometry was never the problem - every pair of YouK frame heights carries
// a shelf between them. The POLICY was: `levelTarget` looked for the last part
// with the same componentId, a different frame type has none on the product, so
// it fell through to lowest-world-height, mated by its top rung and hung the
// new ladder up to 2015 mm BELOW THE FLOOR. Every pair did it.
//
// What is held here:
//
//   1. A mixed run stands on the floor. Every ladder, every combination.
//   2. `frames[i]` is a POSITION, not a part number, so changing a ladder's
//      type does not move its recorded height to a different slot.
//   3. A ladder's height is only a choice where there is more than one answer:
//      on the floor there is exactly one, because mating a span by a higher
//      rung hangs the ladder LOWER and below-floor is refused.
//   4. Overrides are cleaned up rather than left to rot - switching depth must
//      not leave a 320 mm ladder recorded against a 200 mm run.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseGuided, defaultChoices, normaliseChoices, buildGuided,
  moveOptions, moveCandidates, frameSlotFor, isFrameSlot, frameIndexOf,
} from '../src/engine/guided.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { MOUNTING } from '../src/engine/ar.js';
import { loadFolder } from '../tools/export-glb.mjs';

const YOUK = join(process.cwd(), 'youk');

let schema;
let components;
let variant;
let byLabel;

beforeAll(() => {
  schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  ({ components } = loadFolder(YOUK));
  [variant] = schema.variants;
  byLabel = Object.fromEntries(variant.frames.map((f) => [f.label, f.componentId]));
});

const build = (patch = {}) => buildGuided(schema, {
  ...defaultChoices(schema), bays: 3, adds: {}, ...patch,
}, components);

/** Every frame in the run: [slot, componentId, worldYmm]. */
const framesOf = (built) => {
  const { transforms } = resolveTransforms(built.assembly, components);
  return built.assembly.instances
    .filter((i) => isFrameSlot(built.slots?.[i.instanceId]))
    .map((i) => [
      built.slots[i.instanceId],
      i.componentId,
      Math.round(transforms.get(i.instanceId).translation[1] * 1000),
    ]);
};

describe('a run of mixed ladders', () => {
  it('gives every position in the run a slot', () => {
    const built = build();
    const slots = framesOf(built).map(([slot]) => slot);
    expect(slots).toEqual([
      frameSlotFor(0), frameSlotFor(1), frameSlotFor(2), frameSlotFor(3),
    ]);
  });

  it('puts the ladder the position asks for at that position', () => {
    const built = build({ frames: { 1: byLabel['2210 mm tall'] } });
    const frames = framesOf(built);
    expect(frames[1][1]).toBe(byLabel['2210 mm tall']);
    expect(frames[0][1]).toBe(built.choices.frameId);
    expect(frames[2][1]).toBe(built.choices.frameId);
  });

  // THE REGRESSION, and the whole reason this file exists.
  it('stands every ladder on the floor whatever the mixture', () => {
    const built = build({
      frameId: byLabel['550 mm tall'],
      frames: {
        1: byLabel['905 mm tall'],
        2: byLabel['1500 mm tall'],
        3: byLabel['2210 mm tall'],
      },
    });
    expect(built.refused).toEqual([]);
    for (const [slot, , y] of framesOf(built)) {
      expect(y, `${slot} should stand on the floor`).toBe(0);
    }
  });

  it('holds for every ordered pair of heights', () => {
    for (const a of variant.frames) {
      for (const b of variant.frames) {
        if (a.componentId === b.componentId) continue;
        const built = build({ bays: 1, frameId: a.componentId, frames: { 1: b.componentId } });
        expect(built.refused, `${a.label} then ${b.label}`).toEqual([]);
        for (const [, , y] of framesOf(built)) {
          expect(y, `${a.label} then ${b.label}`).toBe(0);
        }
      }
    }
  });

  it('keeps the run evenly spaced when the heights differ', () => {
    const built = build({ frames: { 1: byLabel['2210 mm tall'] } });
    const { transforms } = resolveTransforms(built.assembly, components);
    const xs = built.assembly.instances
      .filter((i) => isFrameSlot(built.slots?.[i.instanceId]))
      .map((i) => Math.round(transforms.get(i.instanceId).translation[0] * 1000));
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    expect(new Set(gaps).size).toBe(1);
  });
});

describe('the slot a ladder occupies', () => {
  it('is the position, not the part number', () => {
    expect(frameSlotFor(2)).toBe('frame#2');
    expect(isFrameSlot('frame#2')).toBe(true);
    expect(frameIndexOf('frame#2')).toBe(2);
    // An accessory slot carries its component, which is what keeps counts of
    // different accessories independent.
    expect(isFrameSlot('008563-shelf#0')).toBe(false);
  });

  // If a frame slot were keyed by component, changing a ladder's type would
  // move its recorded height to a different key and the ladder would jump.
  it('survives the ladder at that position changing type', () => {
    const built = build({ bays: 2, frames: { 1: byLabel['2210 mm tall'] } });
    const slot = framesOf(built)[1][0];
    const swapped = build({ bays: 2, frames: { 1: byLabel['905 mm tall'] } });
    expect(framesOf(swapped)[1][0]).toBe(slot);
  });
});

describe('the height a ladder sits at', () => {
  const frameIdsOf = (built) => Object.entries(built.slots)
    .filter(([, s]) => isFrameSlot(s))
    .map(([id, s]) => [id, s]);

  it('is fixed for the first ladder, which the run is measured from', () => {
    const built = build({ bays: 2 });
    const [[id]] = frameIdsOf(built);
    const r = moveCandidates(built, components, id);
    expect(r.ok).toBe(false);
    expect(r.anchor).toBe(true);
    expect(r.kind).toBe('frame');
  });

  // A ladder mates a span by one of its OWN rungs, and mating by a higher rung
  // hangs the ladder lower - so on the floor there is exactly one answer and
  // the panel must not draw a "Height" heading over a list of one.
  it('has exactly one answer on a floor-standing run', () => {
    for (const mounting of [MOUNTING.FLOOR, MOUNTING.FEET]) {
      const built = build({ bays: 2, mounting });
      for (const [id, slot] of frameIdsOf(built).slice(1)) {
        const r = moveOptions(built, components, id);
        expect(r.options.length, `${slot} on ${mounting}`).toBe(1);
        expect(r.options[0].heightMm, `${slot} on ${mounting}`).toBe(0);
      }
    }
  });

  // On a wall there is no floor, so hanging a ladder lower is a real option -
  // and the below-floor rule simply does not apply.
  it('has several on a wall-mounted run', () => {
    const built = build({ bays: 2, mounting: MOUNTING.WALL });
    for (const [id] of frameIdsOf(built).slice(1)) {
      expect(moveOptions(built, components, id).options.length).toBeGreaterThan(1);
    }
  });

  it('never offers a position below the floor', () => {
    const built = build({ bays: 2, mounting: MOUNTING.FEET });
    for (const [id] of frameIdsOf(built).slice(1)) {
      for (const o of moveOptions(built, components, id).options) {
        expect(o.heightMm).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // A recorded height has to say which of the ladder's own rungs mates, because
  // every one of them is offered at the same point on the same span.
  it('records which rung it mates by', () => {
    const built = build({ bays: 2, mounting: MOUNTING.WALL });
    const [, [id]] = frameIdsOf(built);
    const options = moveOptions(built, components, id).options;
    const mounts = options.map((o) => o.at.mountSnapId);
    expect(mounts.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
    expect(new Set(mounts).size).toBe(options.length);
  });

  it('puts the ladder at the height it was told, and keeps it there', () => {
    const built = build({ bays: 2, mounting: MOUNTING.WALL });
    const [, [id, slot]] = frameIdsOf(built);
    const options = moveOptions(built, components, id).options;
    const target = options.find((o) => !o.current) || options[0];

    const after = build({
      bays: 2, mounting: MOUNTING.WALL, at: { [slot]: target.at },
    });
    expect(after.dropped).toEqual([]);
    expect(after.refused).toEqual([]);
    const moved = framesOf(after).find(([s]) => s === slot);
    expect(moved[2]).toBe(target.heightMm);
  });
});

describe('cleaning up overrides nobody can use', () => {
  it('drops a ladder recorded for a position the run no longer has', () => {
    const c = normaliseChoices(schema, {
      ...defaultChoices(schema), bays: 1, frames: { 3: byLabel['2210 mm tall'] },
    });
    expect(c.frames).toEqual({});
  });

  it('drops a ladder this variant does not offer', () => {
    const c = normaliseChoices(schema, {
      ...defaultChoices(schema), variantId: 'd200', bays: 2, frames: { 1: byLabel['1500 mm tall'] },
    });
    expect(c.frames).toEqual({});
  });

  // An override equal to the global choice is noise: it says nothing and it
  // would survive a later change to the global control and contradict it.
  it('drops an override that agrees with the global choice', () => {
    const base = defaultChoices(schema);
    const c = normaliseChoices(schema, { ...base, bays: 2, frames: { 1: base.frameId } });
    expect(c.frames).toEqual({});
  });

  it('drops a recorded height for a position the run no longer has', () => {
    const c = normaliseChoices(schema, {
      ...defaultChoices(schema),
      bays: 1,
      at: { [frameSlotFor(3)]: { instanceId: 'g6', snapId: 'x' } },
    });
    expect(c.at).toEqual({});
  });

  // Position 0 stands on the floor by definition, so a height recorded against
  // it is meaningless rather than merely unused.
  it('never keeps a height for the first ladder', () => {
    const c = normaliseChoices(schema, {
      ...defaultChoices(schema),
      bays: 2,
      at: { [frameSlotFor(0)]: { instanceId: 'g1', snapId: 'x' } },
    });
    expect(c.at).toEqual({});
  });
});

// `kind` is what the panel decides everything from - the title, whether there
// is a Type list, whether "Remove this one" appears. It was set on the three
// early returns and not on the success return, so the ANCHOR answered correctly
// while every other ladder came back undefined and rendered as a nameless
// accessory with a Remove button. Found by tapping the second ladder; a test
// that only ever asked about the anchor would never have seen it.
describe('every answer says what kind of part it is', () => {
  it('for a ladder that can be asked about its position', () => {
    const built = build({ bays: 2 });
    for (const [id, slot] of Object.entries(built.slots)) {
      if (!isFrameSlot(slot)) continue;
      expect(moveCandidates(built, components, id).kind, slot).toBe('frame');
      expect(moveOptions(built, components, id).kind, slot).toBe('frame');
    }
  });

  it('for an accessory', () => {
    const SHELF = '008563-shelf-900mm-for-ladder-depth-320mm';
    const built = build({ bays: 2, adds: { [SHELF]: 1 } });
    const id = Object.entries(built.slots).find(([, s]) => s.startsWith(SHELF))?.[0];
    expect(moveCandidates(built, components, id).kind).toBe('add');
  });

  it('for a span, which is neither', () => {
    const built = build({ bays: 2 });
    const span = built.assembly.instances
      .find((i) => i.componentId === built.size.span.componentId);
    expect(moveCandidates(built, components, span.instanceId).kind).toBe('span');
  });
});
