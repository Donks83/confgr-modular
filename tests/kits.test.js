// Cabinets in the guided configurator, as KITS (Matt, 13 Nov 2026: "there
// doesn't seem to be cabs available?").
//
// His answers, each one a test below:
//   - all three heights, 200 / 300 / 450
//   - on the bottom rung, with the bay's shelf moving up clear of it
//   - between two cabinets, the ONE extension bracket, chosen automatically
//     (Carcass holder sheet MA 406214 step 1b)
//
// A kit is data - the variant's `kits` in guided.json says which brackets, which
// rung - and the engine places it bay by bay, through the same judge as
// everything else. Needs the YouK models (gitignored).

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGuided, buildGuided, normaliseChoices, defaultChoices, moveCandidates, kitRequests, addAvailability } from '../src/engine/guided.js';
import { parseRules } from '../src/engine/rules.js';
import { judge } from '../src/engine/judge.js';
import { resolveTransforms } from '../src/engine/assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YOUK = join(ROOT, 'youk');
const have = existsSync(join(YOUK, '008560-cabinet-bracket-for-ladder-depth-320mm.glb'));
const OUTER = '008558-outer-cabinet-bracket-for-ladder-depth-320mm';
const EXTENSION = '008560-cabinet-bracket-for-ladder-depth-320mm';
const OUTER_D200 = '008557-outer-cabinet-bracket-for-ladder-depth-200mm';
const LADDER_1500 = '236758-ladder-depth-320mm';
const mm = (v) => Math.round(v * 1000);

describe.skipIf(!have)('cabinets as kits', () => {
  let components; let rules; let schema;

  const build = (patch) => {
    const c = normaliseChoices(schema, { ...defaultChoices(schema), at: {}, adds: {}, ...patch });
    const built = buildGuided(schema, c, components, { rules });
    const { transforms } = resolveTransforms(built.assembly, components);
    const parts = built.assembly.instances.map((i) => ({
      ...i, slot: built.slots[i.instanceId] || null, x: mm(transforms.get(i.instanceId).translation[0]), y: mm(transforms.get(i.instanceId).translation[1]),
    }));
    const said = judge(built.assembly, components, rules, { mounting: c.mounting, footHeightMm: c.footHeightMm });
    return { built, parts, said, c };
  };
  const ladders = (parts) => parts.filter((p) => /^frame#/.test(p.slot)).map((p) => p.x).sort((a, b) => a - b);
  const inBay = (x, xs, bay) => x > xs[bay] && x < xs[bay + 1];

  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    ({ components } = loadFolder(YOUK));
    const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
    schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  });

  it('offers all three heights, in storage, on every 320 and 200 size', () => {
    for (const variant of schema.variants) {
      for (const size of variant.sizes) {
        const kinds = (size.adds || []).filter((a) => a.kit === 'cabinet');
        expect(kinds.map((a) => a.kind).sort(), `${variant.id} ${size.id}`).toEqual(['cabinet-200', 'cabinet-300', 'cabinet-450']);
        for (const a of kinds) expect(a).toMatchObject({ group: 'storage', max: 1, perBay: true });
      }
    }
  });

  it('two cabinets side by side share ONE extension bracket on the ladder between them', () => {
    const { built, parts, said } = build({ variantId: 'd320', sizeId: 'w900', frameId: LADDER_1500, bays: 2, mounting: 'feet', adds: { 'cabinet-450': 2 } });
    expect(built.refused).toEqual([]);
    expect(said).toEqual([]);
    const xs = ladders(parts);
    const brackets = parts.filter((p) => p.componentId === OUTER || p.componentId === EXTENSION);
    expect(brackets.map((p) => [p.componentId, p.x])).toEqual([[OUTER, 15], [EXTENSION, 920], [OUTER, 1825]]);
    const cabinets = parts.filter((p) => /cabinet-900mm-h450mm/.test(p.componentId));
    expect(cabinets).toHaveLength(2);
    expect(cabinets.map((p) => [0, 1].findIndex((bay) => inBay(p.x, xs, bay))).sort()).toEqual([0, 1]);
    expect(built.kits.has('cabinet-450#0') && built.kits.has('cabinet-450#1')).toBe(true);
  });

  it('moves the bay shelf up clear of a 450 cabinet, and only as far as it must', () => {
    // 1500 ladder rungs at 100, 455, 810. A 450 cabinet on rung 1 reaches 553.
    const tall = build({ variantId: 'd320', sizeId: 'w900', frameId: LADDER_1500, bays: 1, mounting: 'floor', adds: { 'cabinet-450': 1 } });
    expect(tall.said).toEqual([]);
    expect(tall.parts.find((p) => p.slot === 'span#0').y).toBe(810);
    // A 300 one reaches 403, so rung 2 is clear and the shelf stops there.
    const low = build({ variantId: 'd320', sizeId: 'w900', frameId: LADDER_1500, bays: 1, mounting: 'floor', adds: { 'cabinet-300': 1 } });
    expect(low.said).toEqual([]);
    expect(low.parts.find((p) => p.slot === 'span#0').y).toBe(455);
    // The cabinet itself is on the bottom rung.
    expect(low.parts.find((p) => /cabinet-900mm-h300mm/.test(p.componentId)).y).toBe(103);
  });

  it('mixed heights still share the bracket; a lone cabinet gets two outer ones', () => {
    const { built, parts, said } = build({ variantId: 'd320', sizeId: 'w600', frameId: LADDER_1500, bays: 3, mounting: 'floor', adds: { 'cabinet-200': 1, 'cabinet-300': 1 } });
    expect(built.refused).toEqual([]);
    expect(said).toEqual([]);
    expect(parts.filter((p) => p.componentId === EXTENSION)).toHaveLength(1);
    expect(parts.filter((p) => p.componentId === OUTER)).toHaveLength(2);

    const lone = build({ variantId: 'd320', sizeId: 'w600', frameId: LADDER_1500, bays: 2, mounting: 'floor', adds: { 'cabinet-200': 1 }, at: { 'cabinet-200#0': { bay: 1 } } });
    expect(lone.said).toEqual([]);
    const xs = ladders(lone.parts);
    expect(lone.parts.filter((p) => p.componentId === OUTER).map((p) => p.x)).toEqual([xs[1] + 15, xs[2] - 15]);
    expect(inBay(lone.parts.find((p) => /cabinet-600mm-h200mm/.test(p.componentId)).x, xs, 1)).toBe(true);
  });

  it('keeps the bay a cabinet was recorded in', () => {
    const c = normaliseChoices(schema, { ...defaultChoices(schema), variantId: 'd320', sizeId: 'w900', bays: 3, adds: { 'cabinet-200': 1 }, at: { 'cabinet-200#0': { bay: 2 } } });
    expect(c.at['cabinet-200#0']).toEqual({ bay: 2 });
    const variant = schema.variants.find((v) => v.id === 'd320');
    expect(kitRequests(variant, c)[0].bay).toBe(2);
  });

  it('refuses a cabinet with nowhere to go, in words', () => {
    // One per bay: two cabinets in one bay is one too many.
    const { built, said } = build({ variantId: 'd320', sizeId: 'w900', frameId: LADDER_1500, bays: 1, mounting: 'floor', adds: { 'cabinet-200': 1, 'cabinet-300': 1 } });
    expect(said).toEqual([]);
    expect(built.refused).toHaveLength(1);
    expect(built.refused[0].reason).toBe('every bay has one - add a bay');
  });

  it('the 200 mm range uses its own brackets', () => {
    const { built, parts, said } = build({ variantId: 'd200', sizeId: 'w450', bays: 1, mounting: 'floor', adds: { 'cabinet-200': 1 } });
    expect(built.refused).toEqual([]);
    expect(said).toEqual([]);
    expect(parts.filter((p) => p.componentId === OUTER_D200)).toHaveLength(2);
  });

  it('is not moved part by part: it comes and goes with its brackets', () => {
    const { built } = build({ variantId: 'd320', sizeId: 'w900', frameId: LADDER_1500, bays: 1, mounting: 'floor', adds: { 'cabinet-200': 1 } });
    const cabinet = built.assembly.instances.find((i) => /cabinet-900mm-h200mm/.test(i.componentId));
    const moved = moveCandidates(built, components, cabinet.instanceId);
    expect(moved.ok).toBe(false);
    expect(moved.reason).toMatch(/comes with the brackets/);
  });
});

describe.skipIf(!have)('what the + says when every bay has one', () => {
  it('names the reason on every cabinet height, and clears it with another bay', async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    const { components } = loadFolder(YOUK);
    const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    const rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
    const schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
    const at = (bays) => addAvailability(buildGuided(schema, normaliseChoices(schema, {
      ...defaultChoices(schema), variantId: 'd320', sizeId: 'w900', frameId: LADDER_1500, bays, adds: { 'cabinet-200': 1 }, at: {},
    }), components, { rules }), components);
    const full = at(1);
    for (const kind of ['cabinet-200', 'cabinet-300', 'cabinet-450']) expect(full[kind]).toEqual({ ok: false, kind: 'full', reason: 'every bay has one - add a bay' });
    const room = at(2);
    for (const kind of ['cabinet-200', 'cabinet-300', 'cabinet-450']) expect(room[kind]).toEqual({ ok: true });
  });
});

describe.skipIf(!have)('a cabinet the ladders are too short for', () => {
  it('is refused in words, and the run stays on the floor', async () => {
    // Sweep O2: a 450 cabinet beside a 550 ladder (rungs 100 and 455) pushed the
    // bay shelf to the 905's rung 3 and the 550 hung 355 mm off the floor to meet it.
    const { loadFolder } = await import('../tools/export-glb.mjs');
    const { components } = loadFolder(YOUK);
    const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    const rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
    const schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
    const c = normaliseChoices(schema, {
      ...defaultChoices(schema), variantId: 'd320', sizeId: 'w450', frameId: '236754-ladder-depth-320mm',
      frames: { 1: '236750-ladder-depth-320mm' }, bays: 1, mounting: 'floor', adds: { 'cabinet-450': 1 }, at: {},
    });
    const built = buildGuided(schema, c, components, { rules });
    const { transforms } = resolveTransforms(built.assembly, components);
    for (const [id, slot] of Object.entries(built.slots)) {
      if (/^frame#/.test(slot)) expect(mm(transforms.get(id).translation[1]), slot).toBe(0);
    }
    expect(built.refused.map((r) => r.reason)).toEqual([expect.stringMatching(/too tall for these ladders/)]);
    expect(built.kits.size).toBe(0);
  });
});

describe.skipIf(!have)('what the customer put somewhere wins', () => {
  it('a part moved by hand keeps its place when another kind is added after it', async () => {
    // Sweep I5: a hook strip moved under bay 1's rung 2, then a second clothes
    // rail. Rails are placed before hook strips, and the rail took the space
    // from the other ladder's side - dropping the customer's hook strip.
    const { loadFolder } = await import('../tools/export-glb.mjs');
    const { components } = loadFolder(YOUK);
    const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    const rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
    const schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
    const choices = (rails) => normaliseChoices(schema, {
      ...defaultChoices(schema), variantId: 'd320', sizeId: 'w900', frameId: '236750-ladder-depth-320mm', bays: 2, mounting: 'floor',
      adds: { 'clothes-rail': rails, 'hook-strip-full': 1, 'cabinet-200': 1, 'cabinet-300': 1 },
      at: { 'hook-strip-full#0': { instanceId: 'g3', slot: 'frame#1', snapId: 'md-snap.youk-d320.rung-2-right' } },
    });
    for (const rails of [1, 2]) {
      const built = buildGuided(schema, choices(rails), components, { rules });
      expect(built.dropped, `${rails} rail(s)`).toEqual([]);
      const strip = built.assembly.instances.find((i) => built.slots[i.instanceId] === 'hook-strip-full#0');
      const { transforms } = resolveTransforms(built.assembly, components);
      expect(mm(transforms.get(strip.instanceId).translation[0]), `${rails} rail(s)`).toBe(1380);
    }
  });
});
