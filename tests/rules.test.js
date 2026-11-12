// The rules file and the judge (A2, A3).
//
// The loader's claims: it fails closed, by name, on anything it does not
// understand, and a range cannot switch the physical rules off by leaving them
// out. The judge's: one sentence per thing wrong, from where the parts are, and
// a delete that says what it would strand.

import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseRules, RulesError, DEFAULT_RULES, sentence } from '../src/engine/rules.js';
import { judge, introduced, removalConsequences, removeCascade } from '../src/engine/judge.js';
import { parseGuided, buildGuided, normaliseChoices, defaultChoices, GUIDED_VERSION } from '../src/engine/guided.js';
import { detach } from '../src/engine/attach.js';
import { MOUNTING } from '../src/engine/ar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 'rack-upright-1800';
const SPAN = 'rack-shelf-900';
const catalogue = {
  items: {
    [FRAME]: { family: 'frames', description: 'Upright 1800' },
    [SPAN]: { family: 'span', description: 'Shelf 900' },
  },
};
const rackRules = () => parseRules({
  version: 1,
  families: {
    frames: { hollow: true, rules: [{ rule: 'mountingNeeds', mounting: 'feet', socketLabel: 'foot', says: 'The {label} takes no foot.' }] },
    span: { held: 'every-end', says: 'The {label} must rest on an upright at both ends.', source: 'test' },
  },
}, { catalogue });

describe('reading a rules file', () => {
  it('reads one, and finds each part\'s family through the catalogue', () => {
    const r = rackRules();
    expect(r.familyOf(SPAN)).toBe('span');
    expect(r.labelOf(SPAN)).toBe('Shelf 900');
    expect(r.families.span.held).toBe('every-end');
  });

  it('refuses an unknown key, rule, value, family or placeholder - by name', () => {
    expect(() => parseRules({ version: 1, colour: 'red' })).toThrow(/Unknown key "colour"/);
    expect(() => parseRules({ version: 1, product: [{ rule: 'notBelowFlor' }] })).toThrow(/Unknown rule "notBelowFlor".*notBelowFloor/);
    expect(() => parseRules({ version: 1, families: { span: { held: 'both', says: 'x' } } }, { catalogue })).toThrow(/"held" must be one of/);
    expect(() => parseRules({ version: 1, families: { shelves: { held: 'none' } } }, { catalogue })).toThrow(/Family "shelves" has no parts/);
    expect(() => parseRules({ version: 1, product: [{ rule: 'noPassThrough', says: 'The {lable} hits it.' }] })).toThrow(/Unknown placeholder \{lable\}/);
    expect(() => parseRules({ version: 2 })).toThrow(/version 2/);
    expect(() => parseRules({ version: 1, families: { span: { held: 'every-end' } } }, { catalogue })).toThrow(/needs a "says"/);
  });

  it('keeps the physical rules when a range leaves them out', () => {
    // A range may reword "not below the floor"; it cannot drop it by omission.
    const r = parseRules({ version: 1, product: [{ rule: 'noPassThrough', says: 'Clash: {label}.' }] });
    expect(r.product.map((p) => p.rule).sort()).toEqual(['noPassThrough', 'notBelowFloor', 'notTwiceInOnePlace']);
    expect(DEFAULT_RULES.product.length).toBe(3);
  });

  it('fills a sentence', () => {
    expect(sentence('The {label} sits {mm} mm low.', { label: 'rack', mm: 59 })).toBe('The rack sits 59 mm low.');
  });

  it('reads YouK\'s own file', () => {
    const Y = join(ROOT, 'youk');
    const r = parseRules(JSON.parse(readFileSync(join(Y, 'rules.json'), 'utf8')),
      { catalogue: JSON.parse(readFileSync(join(Y, 'catalogue.json'), 'utf8')) });
    expect(Object.keys(r.families).sort()).toEqual(['bolted', 'carcase', 'frames', 'hang', 'span', 'wall']);
    expect(r.preferences.byKind['clothes-rail']).toBe('highest');
    // Every refusal says where it came from.
    for (const f of Object.values(r.families)) if (f.held !== 'none') expect(f.source).toBeTruthy();
  });
});

describe('the judge, on the synthetic rack', () => {
  let components;
  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    ({ components } = loadFolder(join(ROOT, 'test-assets')));
  }, 120_000);

  const schema = () => parseGuided({
    version: GUIDED_VERSION, title: 'Rack',
    variants: [{
      id: 'rack', defaultBays: 1, maxBays: 3, defaultMounting: MOUNTING.FLOOR,
      frames: [{ componentId: FRAME, label: '1800', default: true }],
      sizes: [{ id: 'w900', label: '900', default: true, span: { componentId: SPAN, label: 'Shelf' }, adds: [{ componentId: SPAN, label: 'Extra', max: 6, spans: true }] }],
    }],
  });
  const build = (patch = {}) => {
    const s = schema();
    return buildGuided(s, normaliseChoices(s, { ...defaultChoices(s), ...patch }), components, { rules: rackRules() });
  };

  it('finds nothing wrong with a bay as built', () => {
    const b = build({ bays: 2, adds: { [SPAN]: 2 } });
    expect(judge(b.assembly, components, rackRules())).toEqual([]);
  });

  it('says a frame takes no foot, in the range\'s own words', () => {
    const b = build();
    const why = judge(b.assembly, components, rackRules(), { mounting: MOUNTING.FEET });
    expect(why.map((r) => r.says)).toContain('The Upright 1800 takes no foot.');
  });

  it('says what a delete would strand, and removes it only when asked', () => {
    // Two bays and an extra shelf: delete the last upright and the second bay's
    // shelves are left resting on one upright - the A1 F06 cantilever.
    const b = build({ bays: 2, adds: { [SPAN]: 1 } });
    const last = b.assembly.instances.find((i) => b.slots[i.instanceId] === 'frame#2');
    const cons = removalConsequences(b.assembly, components, rackRules(), last.instanceId, detach);
    expect(cons.leftUnheld.length).toBeGreaterThan(0);
    expect(cons.leftUnheld[0].says).toMatch(/must rest on an upright at both ends/);

    const all = removeCascade(b.assembly, components, rackRules(), last.instanceId, detach);
    expect(judge(all.assembly, components, rackRules()).filter((r) => r.rule === 'held')).toEqual([]);
    expect(all.removed.length).toBeGreaterThan(cons.removed.length);
  });

  it('judges a change by what it introduces, not by what was already wrong', () => {
    const a = [{ rule: 'held', instanceId: 'g4' }];
    const b = [{ rule: 'held', instanceId: 'g4' }, { rule: 'notBelowFloor', instanceId: 'g6' }];
    expect(introduced(a, b)).toEqual([{ rule: 'notBelowFloor', instanceId: 'g6' }]);
  });
});

const YOUK = join(ROOT, 'youk');
describe.skipIf(!existsSync(join(YOUK, '008543-rack-for-ladder-depth-320mm.glb')))('the judge, on YouK', () => {
  let components; let rules; let schema;
  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    ({ components } = loadFolder(YOUK));
    rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')),
      { catalogue: JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8')) });
    schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  }, 120_000);

  it('puts a side rack where it clears the floor when the product stands on it (F01)', async () => {
    const { resolveTransforms } = await import('../src/engine/assembly.js');
    const b = buildGuided(schema, normaliseChoices(schema, { ...defaultChoices(schema), variantId: 'd320', mounting: 'floor', adds: { 'side-rack': 1 } }), components, { rules });
    const rack = b.assembly.instances.find((i) => i.componentId.startsWith('008543'));
    const { transforms } = resolveTransforms(b.assembly, components);
    expect(transforms.get(rack.instanceId).translation[1]).toBeGreaterThan(0);
    expect(judge(b.assembly, components, rules, { mounting: 'floor' })).toEqual([]);
  });

  it('still lets it hang low on a product fixed to the wall', async () => {
    const { resolveTransforms } = await import('../src/engine/assembly.js');
    const b = buildGuided(schema, normaliseChoices(schema, { ...defaultChoices(schema), variantId: 'd320', mounting: 'wall', adds: { 'side-rack': 1 } }), components, { rules });
    const rack = b.assembly.instances.find((i) => i.componentId.startsWith('008543'));
    expect(resolveTransforms(b.assembly, components).transforms.get(rack.instanceId).translation[1]).toBeLessThan(0);
  });

  it('hangs a clothes rail on the highest rung that takes it (F11, Matt)', async () => {
    const { resolveTransforms } = await import('../src/engine/assembly.js');
    const b = buildGuided(schema, normaliseChoices(schema, { ...defaultChoices(schema), variantId: 'd320', frameId: '236762-ladder-depth-320mm', mounting: 'floor', adds: { 'clothes-rail': 1 } }), components, { rules });
    const rail = b.assembly.instances.find((i) => i.componentId.startsWith('008531'));
    expect(resolveTransforms(b.assembly, components).transforms.get(rail.instanceId).translation[1] * 1000).toBeGreaterThan(1500);
  });

  it('allows a clothes rail per bay (F12, Matt)', () => {
    const c = normaliseChoices(schema, { ...defaultChoices(schema), variantId: 'd320', bays: 3, adds: { 'clothes-rail': 3 } });
    expect(c.adds['clothes-rail']).toBe(3);
    const b = buildGuided(schema, c, components, { rules });
    expect(b.assembly.instances.filter((i) => i.componentId.startsWith('008531')).length).toBe(3);
  });

  it('opens a link asking for 200 mm ladders on feet standing on the floor (F04)', () => {
    expect(normaliseChoices(schema, { variantId: 'd200', mounting: 'feet' }).mounting).toBe('floor');
    expect(normaliseChoices(schema, { variantId: 'd320', mounting: 'feet' }).mounting).toBe('feet');
  });

  it('quotes an invalid product as a draft, with the reason (F05, Matt)', async () => {
    const { resolveConfiguration } = await import('../src/engine/configuration.js');
    const fx = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'links-v1.json'), 'utf8')).links;
    const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    const bad = resolveConfiguration(fx[0].c, components, { catalogue, rules });
    expect(bad.quote.status).toBe('draft');
    const good = resolveConfiguration(fx.find((l) => l.name === 'default d320').c, components, { catalogue, rules });
    expect(good.quote.status).toBe('orderable');
    expect(good.quote.draftBecause).toEqual([]);
  });
});
