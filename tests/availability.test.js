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
//   4. It is keyed by KIND, and a kind is unavailable only when EVERY length it
//      can be is. With per-bay widths the control says "clothes rail" and the
//      product may hold a 900 bay and a 600 one; greying the control because
//      the 900 rail will not fit would kill it for a bay that has room.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseGuided, defaultChoices, buildGuided, addAvailability } from '../src/engine/guided.js';
import { loadFolder } from '../tools/export-glb.mjs';

const YOUK = join(process.cwd(), 'youk');

let schema;
let faulty;
let components;

beforeAll(() => {
  const raw = JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8'));
  schema = parseGuided(raw);
  // THE FAULT THIS FILE IS ABOUT, kept as a fixture. A3 took the two 320 mm parts
  // out of the real schema's 200 mm sizes (A1 F13), which is the fix for YouK -
  // but the next range's schema will make the same mistake, and the mechanism
  // that greys such a control with a reason must keep working. So these tests
  // put the faulty listing back, in a copy, rather than lose what they prove.
  const copy = JSON.parse(JSON.stringify(raw));
  const d320w900 = copy.variants.find((v) => v.id === 'd320').sizes.find((x) => x.id === 'w900');
  const d200w900 = copy.variants.find((v) => v.id === 'd200').sizes.find((x) => x.id === 'w900');
  for (const kind of ['clothes-rail', 'hook-strip-full']) {
    if (!d200w900.adds.some((a) => a.kind === kind)) d200w900.adds.push(d320w900.adds.find((a) => a.kind === kind));
  }
  faulty = parseGuided(copy);
  ({ components } = loadFolder(YOUK));
});

const build = (patch, using = schema) => {
  const variant = using.variants.find((v) => v.id === (patch.variantId ?? 'd320'));
  const frame = variant.frames.find((f) => f.default) || variant.frames[0];
  return buildGuided(using, {
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
    expect(Object.keys(avail).length).toBe(built.adds.length);
    expect(Object.values(avail).every((a) => a.ok)).toBe(true);
  });

  it('reports the clothes rail as never available on 200 mm frames', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' }, faulty);
    const avail = addAvailability(built, components);
    const rail = avail['clothes-rail'];
    expect(rail.ok).toBe(false);
    expect(rail.kind).toBe('never');
  });

  // The sentence, not just the flag. 'no room left' would be a lie here and it
  // is exactly what the first version of this said, because the engine's
  // explanation is a string and was being read as an object.
  it('phrases it against the frame rather than against the product', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' }, faulty);
    const avail = addAvailability(built, components);
    const rail = avail['clothes-rail'];
    expect(rail.reason).toMatch(/200 mm deep/);
    expect(rail.reason).not.toMatch(/room/);
  });

  it('finds both of the parts the sweep found, and no others', () => {
    const built = build({ variantId: 'd200', sizeId: 'w900' }, faulty);
    const avail = addAvailability(built, components);
    const bad = Object.entries(avail).filter(([, a]) => !a.ok).map(([id]) => id).sort();
    // AS KINDS, and the count is the same two: on a 200 mm ladder neither the
    // rail nor the full-width hook strip has a matching joint at ANY length, so
    // both are 'never' rather than one length of each being unlucky.
    expect(bad).toEqual(['clothes-rail', 'hook-strip-full']);
  });

  // A part already placed proves it fits. Without this the availability check
  // would turn against the product it is describing: fill the last rung and the
  // control holding those parts goes dead.
  it('stays available when the product is already carrying some', () => {
    const built = build({
      variantId: 'd320',
      sizeId: 'w900',
      adds: { 'metal-shelf': 3 },
    });
    const avail = addAvailability(built, components);
    expect(avail['metal-shelf'].ok).toBe(true);
  });

  // THE CASE PER-BAY WIDTHS INTRODUCED. One 900 bay and one 450: the 900 rail
  // fits the wide bay and there is no 450 rail at all, so the kind is available
  // even though one of its lengths has nowhere to go. Keyed on a part number
  // this control would have been dead for a product that can take one.
  it('keeps a kind available when only one bay can take it', () => {
    const built = build({
      variantId: 'd320',
      sizeId: 'w900',
      bays: 2,
      widths: { 1: 'w450' },
    });
    expect(built.sizes.map((s) => s.id)).toEqual(['w900', 'w450']);
    const avail = addAvailability(built, components);
    expect(avail['clothes-rail'].ok).toBe(true);
  });

  it('says nothing at all rather than greying everything when it cannot ask', () => {
    const avail = addAvailability({ size: { adds: [{ componentId: 'x' }] }, assembly: null }, components);
    expect(avail).toEqual({});
  });

  // A1 F13: the real schema offers nothing that can never be placed.
  it('offers no control in the real schema that can never be used', () => {
    for (const variant of schema.variants) {
      for (const size of variant.sizes) {
        const avail = addAvailability(build({ variantId: variant.id, sizeId: size.id }), components);
        const never = Object.entries(avail).filter(([, a]) => a.kind === 'never').map(([k]) => `${variant.id}/${size.id}/${k}`);
        expect(never).toEqual([]);
      }
    }
  });

  it('answers for every variant and size without throwing', () => {
    for (const variant of schema.variants) {
      for (const size of variant.sizes) {
        const built = build({ variantId: variant.id, sizeId: size.id });
        const avail = addAvailability(built, components);
        for (const add of size.adds || []) {
          expect(avail[add.kind]).toBeTruthy();
          if (!avail[add.kind].ok) {
            expect(typeof avail[add.kind].reason).toBe('string');
          }
        }
      }
    }
  });
});
