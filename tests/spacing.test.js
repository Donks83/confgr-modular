// The line between two neighbouring ladders.
//
// Matt: "can we have a marker similar to the hot spot dots that is a line
// connecting two neighbouring ladders that you can click to choose the spacing
// between those ladders (i cant remember the different distances they do but I
// know we have discussed it in the past".
//
// He could not remember the distances, and he should not have to: the widths
// come off the variant, which is the same list the Width control draws from.
// There is no second table of spacings anywhere and there must never be one.
//
// WHAT THIS PINS:
//
//   1. One line per bay, in bay order, between the ladder that opens it and
//      the ladder that closes it - and no line for a bay the run never built.
//   2. The endpoints are at the LADDERS, along the top and on the front face,
//      taken from their own oriented boxes so a product turned round keeps its
//      lines where somebody can see them.
//   3. `centresMm` is measured, and it is NOT the size's label: a YouK 900 bay
//      stands its ladders 920 mm apart because the shelf overhangs the stiles.
//      Printing the label over the measurement would be inventing a number.
//   4. The current width is marked, so the panel can show what it already is
//      without asking a second question and getting a different answer.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseGuided, defaultChoices, buildGuided, baySpacings,
} from '../src/engine/guided.js';
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

describe.runIf(has)('the line between two ladders', () => {
  it('draws one per bay, in bay order', () => {
    const lines = baySpacings(build({ bays: 3, sizeId: 'w900' }), components);
    expect(lines.map((l) => l.bay)).toEqual([0, 1, 2]);
  });

  it('runs from one ladder to the next, left to right', () => {
    const lines = baySpacings(build({ bays: 3, sizeId: 'w900' }), components);
    for (let i = 0; i < lines.length; i += 1) {
      // The far end of one bay is the near end of the next: they are the same
      // ladder, so this is what says the line belongs to the product rather
      // than to a number somebody computed.
      if (i > 0) expect(lines[i].from).toEqual(lines[i - 1].to);
      expect(lines[i].to[0]).toBeGreaterThan(lines[i].from[0]);
    }
  });

  it('measures the ladder centres rather than repeating the label', () => {
    const [line] = baySpacings(build({ bays: 1, sizeId: 'w900' }), components);
    expect(line.label).toBe('900 mm wide');
    // 920.1 mm, which is what the range actually is. The exact figure comes
    // from the geometry; the claim here is only that the two are not the same
    // number, because the moment they are, one of them has stopped being
    // measured.
    expect(line.centresMm).toBeGreaterThan(900);
    expect(line.centresMm).toBeLessThan(960);
  });

  it('hangs the line along the top, on the front', () => {
    const built = build({ bays: 1, sizeId: 'w900', frameId: undefined });
    const [line] = baySpacings(built, components);
    // Level, because both ends are the top of a ladder of the same height.
    expect(line.from[1]).toBeCloseTo(line.to[1], 6);
    // Above everything the product has. The shelves and the ladders are all
    // below the top of the ladder the line is drawn from.
    expect(line.from[1]).toBeGreaterThan(0.5);
    // The room side. +z is the wall in this project, so the front is negative,
    // and `facing` says so rather than the caller assuming it.
    expect(line.facing[2]).toBeLessThan(0);
    expect(line.from[2]).toBeLessThan(0);
  });

  it('offers the variant\'s own widths and marks the one in use', () => {
    const built = build({ bays: 2, sizeId: 'w900', widths: { 1: 'w450' } });
    const lines = baySpacings(built, components);

    const ids = built.variant.sizes.map((s) => s.id);
    for (const line of lines) expect(line.options.map((o) => o.id)).toEqual(ids);

    expect(lines[0].options.find((o) => o.current).id).toBe('w900');
    expect(lines[1].options.find((o) => o.current).id).toBe('w450');
    expect(lines[1].centresMm).toBeLessThan(lines[0].centresMm);
  });

  it('says nothing rather than throwing when there is no product', () => {
    expect(baySpacings(null, components)).toEqual([]);
    expect(baySpacings({ assembly: null }, components)).toEqual([]);
    expect(baySpacings(build({ bays: 1 }), new Map())).toEqual([]);
  });
});
