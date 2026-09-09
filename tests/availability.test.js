// Which accessories a frame can take at all.
//
// This exists because of a fault Matt found by using the thing: eighteen of the
// 420 option combinations OFFER an add that can never be placed - the 200 mm
// deep variant's 900 mm sizes list a 900 mm clothes rail and a full-width hook
// strip, and neither has a joint matching a 200 mm ladder's rungs. Pressing +
// refused correctly and the control still looked live until it was used.
//
// The claims worth holding:
//
//   1. A part with no matching joint is reported 'never', phrased against the
//      frame, because that answer does not change with the bay count.
//   2. A part that fits is reported ok, and stays ok when one is already on the
//      product - otherwise the last shelf a bay can take would grey out the
//      control holding it.
//   3. The reason comes from the ENGINE. `whyComponentFitsNowhere` returns a
//      STRING; reading it as `.reason` gave undefined and made every
//      unplaceable part say "no room left", including the two that can never
//      fit. That is the actual bug this file would have caught.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseGuided, defaultChoices, buildGuided, addAvailability } from '../src/engine/guided.js';
import { loadFolder } from '../tools/export-glb.mjs';

const YOUK = join(process.cwd(), 'youk');

let schema;
let components;

beforeAll(() => {
  schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  ({ components } = loadFolder(YOUK));
});

const build = (patch) => {
  const variant = schema.variants.find((v) => v.id === (patch.variantId ?? 'd320'));
  const frame = variant.frames.find((f) => f.default) || variant.frames[0];
  return buildGuided(schema, {
    ...defaultChoices(schema),
    frameId: frame.componentId,
    bays: 1,
    adds: {},
    ...patch,
  }, components);
};

describe('what a frame can take', () => {
  it('reports every add on the 320 mm range as available', () => {
    const built = build({ variantId: 'd320', sizeId: 'w900' });
    const avail = addAvailability(built, components);
    expect(Object.keys(avail).length).toBe(built.size.adds.length);
    expect(Object.values(avail).every((a) => a.ok)).toBe(true);
  });

  it('reports the 900 mm rail as never available on 200 mm frames', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' });
    const avail = addAvailability(built, components);
    const rail = avail['008531-clothes-rail-900mm'];
    expect(rail.ok).toBe(false);
    expect(rail.kind).toBe('never');
  });

  // The sentence, not just the flag. 'no room left' would be a lie here and it
  // is exactly what the first version of this said, because the engine's
  // explanation is a string and was being read as an object.
  it('phrases it against the frame rather than against the product', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' });
    const avail = addAvailability(built, components);
    const rail = avail['008531-clothes-rail-900mm'];
    expect(rail.reason).toMatch(/200 mm deep/);
    expect(rail.reason).not.toMatch(/room/);
  });

  it('finds both of the parts the sweep found, and no others', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' });
    const avail = addAvailability(built, components);
    const bad = Object.entries(avail).filter(([, a]) => !a.ok).map(([id]) => id).sort();
    expect(bad).toEqual([
      '008531-clothes-rail-900mm',
      '008540-hook-strip-for-ladder-width-900mm',
    ]);
  });

  // A part already placed proves it fits. Without this the availability check
  // would turn against the product it is describing: fill the last rung and the
  // control holding those parts goes dead.
  it('stays available when the product is already carrying some', () => {
    const built = build({
      variantId: 'd320',
      sizeId: 'w900',
      adds: { '008563-shelf-900mm-for-ladder-depth-320mm': 3 },
    });
    const avail = addAvailability(built, components);
    expect(avail['008563-shelf-900mm-for-ladder-depth-320mm'].ok).toBe(true);
  });

  it('says nothing at all rather than greying everything when it cannot ask', () => {
    const avail = addAvailability({ size: { adds: [{ componentId: 'x' }] }, assembly: null }, components);
    expect(avail).toEqual({});
  });

  it('answers for every variant and size without throwing', () => {
    for (const variant of schema.variants) {
      for (const size of variant.sizes) {
        const built = build({ variantId: variant.id, sizeId: size.id });
        const avail = addAvailability(built, components);
        for (const add of size.adds || []) {
          expect(avail[add.componentId]).toBeTruthy();
          if (!avail[add.componentId].ok) {
            expect(typeof avail[add.componentId].reason).toBe('string');
          }
        }
      }
    }
  });
});
