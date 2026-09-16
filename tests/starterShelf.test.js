// The shelf that makes a bay, and the height it hangs at.
//
// Matt: "the bay does need a shelf but i have just noticed i can change the
// width but it changes the width of all bays and i cant select what height i
// want the starter shelf to be, its always on the bottom."
//
// The first half of that sentence became per-bay widths. This is the second.
//
// WHY IT COULD NOT MOVE. It was not a slot at all: the span was placed, the run
// was built on top of it, and nothing recorded where it went because there was
// nothing to record. `moveCandidates` then refused it by name - "that is a
// shelf holding the run together" - which was a true sentence about a thing
// nobody had made movable, not a fact about the product.
//
// The claims worth holding:
//
//   1. It has a slot, keyed by BAY rather than by part number - so changing
//      that bay's width keeps its height, which is the whole reason frames are
//      keyed by position too.
//   2. A recorded height is honoured on the rebuild.
//   3. The LADDERS STAY ON THE FLOOR when it moves. They hang off the span, so
//      lifting the span would take the next ladder with it unless levelling
//      puts it back - and a run standing 455 mm in the air is the kind of thing
//      that looks almost right in a screenshot.
//   4. Each bay is its own. Moving bay 1's shelf must not overwrite a height
//      somebody set for bay 2.
//   5. It still cannot be REMOVED. A bay with nothing joining its ladders is
//      not a bay.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseGuided, defaultChoices, buildGuided, normaliseChoices,
  moveOptions, moveCandidates, spanSlotFor, isSpanSlot, spanBayOf,
} from '../src/engine/guided.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { loadFolder } from '../tools/export-glb.mjs';

const YOUK = join(process.cwd(), 'youk');
const has = existsSync(join(YOUK, 'guided.json'));

let schema;
let components;

beforeAll(() => {
  if (!has) return;
  schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  ({ components } = loadFolder(YOUK));
});

const build = (patch = {}) => buildGuided(
  schema,
  { ...defaultChoices(schema), ...patch },
  components,
);

const instanceInSlot = (built, slot) => Object.entries(built.slots)
  .find(([, s]) => s === slot)?.[0] || null;

const yOf = (built, slot) => {
  const id = instanceInSlot(built, slot);
  if (!id) return null;
  const { transforms } = resolveTransforms(built.assembly, components);
  return Math.round(transforms.get(id).translation[1] * 1000);
};

/** Put a bay's shelf at the first offered height above `aboveMm`. */
const moveSpan = (built, bay, aboveMm) => {
  const id = instanceInSlot(built, spanSlotFor(bay));
  const { options } = moveOptions(built, components, id);
  const target = options.find((o) => o.heightMm > aboveMm);
  expect(target).toBeTruthy();
  return {
    target,
    built: buildGuided(schema, {
      ...built.choices,
      at: { ...built.choices.at, [spanSlotFor(bay)]: target.at },
    }, components),
  };
};

describe.runIf(has)('the shelf that makes a bay', () => {
  it('is a slot, one per bay, keyed by position', () => {
    const built = build({ bays: 3 });
    const spans = Object.values(built.slots).filter(isSpanSlot).sort();
    expect(spans).toEqual(['span#0', 'span#1', 'span#2']);
    expect(spanBayOf('span#2')).toBe(2);
  });

  it('offers more than one height', () => {
    const built = build();
    const id = instanceInSlot(built, spanSlotFor(0));
    const r = moveCandidates(built, components, id);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('span');
    const { options } = moveOptions(built, components, id);
    expect(options.length).toBeGreaterThan(1);
    // It starts on the bottom rung, which is the complaint - the fault was that
    // it could not be anywhere else.
    expect(options[0].heightMm).toBe(yOf(built, spanSlotFor(0)));
  });

  it('honours the height it was given', () => {
    const before = build();
    const { target, built } = moveSpan(before, 0, 300);
    expect(built.dropped).toEqual([]);
    expect(built.refused).toEqual([]);
    expect(yOf(built, spanSlotFor(0))).toBe(target.heightMm);
  });

  // THE ONE THAT WOULD HAVE BEEN MISSED. The ladders hang off the span, so
  // lifting it takes the next ladder with it unless levelling puts it back -
  // and a run standing 455 mm in the air looks almost right in a screenshot.
  it('leaves every ladder on the floor', () => {
    const before = build({ bays: 3 });
    const { built } = moveSpan(before, 0, 300);
    expect(yOf(built, 'frame#0')).toBe(0);
    expect(yOf(built, 'frame#1')).toBe(0);
    expect(yOf(built, 'frame#2')).toBe(0);
    expect(yOf(built, 'frame#3')).toBe(0);
  });

  it('lets each bay have its own height', () => {
    const one = moveSpan(build({ bays: 2 }), 0, 300);
    const two = moveSpan(one.built, 1, 900);
    expect(yOf(two.built, spanSlotFor(0))).toBe(one.target.heightMm);
    expect(yOf(two.built, spanSlotFor(1))).toBe(two.target.heightMm);
    expect(two.target.heightMm).not.toBe(one.target.heightMm);
  });

  // KEYED BY BAY, and this is what that buys. The recorded point is a rung of
  // the LADDER, so changing the part that spans the bay does not lose it.
  it('keeps its height when the bay changes width', () => {
    const { target, built } = moveSpan(build({ bays: 2 }), 0, 300);
    const narrower = buildGuided(schema, { ...built.choices, widths: { 0: 'w450' } }, components);
    expect(narrower.refused).toEqual([]);
    expect(narrower.sizes[0].id).toBe('w450');
    expect(yOf(narrower, spanSlotFor(0))).toBe(target.heightMm);
  });

  // THE FAULT THIS PINS, and it was silent. `normaliseChoices` fell through to
  // the accessory rule, where the count of a kind called "span" is zero, so
  // every recorded height was dropped on the way IN: the move was accepted, the
  // rebuild reported neither a refusal nor a drop, and the shelf was back on
  // the bottom rung.
  it('survives a round trip through the choices', () => {
    const { built } = moveSpan(build(), 0, 300);
    const again = normaliseChoices(schema, built.choices);
    expect(again.at[spanSlotFor(0)]).toBeTruthy();
    expect(again.at[spanSlotFor(0)].mountSnapId).toBeTruthy();
  });

  it('forgets a height recorded for a bay that has gone', () => {
    const { built } = moveSpan(build({ bays: 2 }), 1, 300);
    expect(built.choices.at[spanSlotFor(1)]).toBeTruthy();
    const smaller = normaliseChoices(schema, { ...built.choices, bays: 1 });
    expect(smaller.at[spanSlotFor(1)]).toBeUndefined();
  });

  // A bay with nothing joining its ladders is not a bay. The panel is what
  // refuses it; `kind` is how the panel knows.
  it('reports itself as a span, so the panel can refuse to remove it', () => {
    const built = build();
    const id = instanceInSlot(built, spanSlotFor(0));
    expect(moveCandidates(built, components, id).kind).toBe('span');
  });
});
