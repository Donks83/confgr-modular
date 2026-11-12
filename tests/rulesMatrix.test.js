// Coverage generated from the range, not written by hand (A2 §7).
//
// Every part in the catalogue is offered to a real bay of every depth, standing
// on the floor and fixed to the wall. It must either go on and leave the product
// with nothing wrong, or be refused with a sentence a person can read. A part
// added to the range is covered the moment it is added - which is the point: a
// hand-written list of cases is how coverage silently falls behind a range.
//
// Needs the YouK models (gitignored), like the other tests on real geometry.

import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseRules } from '../src/engine/rules.js';
import { judge } from '../src/engine/judge.js';
import { parseGuided, buildGuided, normaliseChoices, defaultChoices, autoAttach, PLACE } from '../src/engine/guided.js';
import { MOUNTING } from '../src/engine/ar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YOUK = join(ROOT, 'youk');
const have = existsSync(join(YOUK, '236758-ladder-depth-320mm.glb'));
const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
const partIds = Object.keys(catalogue.items).sort();

describe.skipIf(!have)('every part in the catalogue, on every depth of bay', () => {
  let components; let rules; let schema;
  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    ({ components } = loadFolder(YOUK));
    rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
    schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  }, 120_000);

  it('gives every catalogue part a family the rules know', () => {
    for (const id of partIds) expect(Object.keys(rules.families), id).toContain(rules.familyOf(id));
  });

  for (const mounting of [MOUNTING.FLOOR, MOUNTING.WALL]) {
    it(`places or refuses in words, on the ${mounting}`, () => {
      const outcomes = { placed: 0, refused: 0 };
      for (const variant of schema.variants) {
        const bay = buildGuided(schema, normaliseChoices(schema, { ...defaultChoices(schema), variantId: variant.id, mounting, adds: {} }), components, { rules });
        const judgeAt = (a, id) => judge(a, components, rules, { mounting, focus: id });
        for (const id of partIds) {
          if (!components.has(id) || rules.familyOf(id) === 'frames' || rules.familyOf(id) === 'wall') continue;
          const r = autoAttach(bay.assembly, components, id, { instanceId: 'probe', policy: PLACE.FILL, judge: judgeAt });
          if (r.ok) {
            outcomes.placed += 1;
            // On, and nothing wrong anywhere because of it.
            expect(judge(r.assembly, components, rules, { mounting, focus: 'probe' }), `${variant.id} ${id}`).toEqual([]);
          } else {
            outcomes.refused += 1;
            expect(typeof r.reason, `${variant.id} ${id}`).toBe('string');
            expect(r.reason.length, `${variant.id} ${id}`).toBeGreaterThan(12);
            expect(r.reason, `${variant.id} ${id}`).not.toMatch(/undefined|\[object/);
          }
        }
      }
      // Both outcomes happen: a matrix where nothing fits, or everything does,
      // is testing nothing.
      expect(outcomes.placed).toBeGreaterThan(20);
      expect(outcomes.refused).toBeGreaterThan(20);
    });
  }

  it('fits every part of a bay\'s own depth that the guided options offer', () => {
    for (const variant of schema.variants) {
      for (const size of variant.sizes) {
        for (const add of size.adds || []) {
          const c = normaliseChoices(schema, { ...defaultChoices(schema), variantId: variant.id, sizeId: size.id, mounting: variant.defaultMounting, adds: { [add.kind]: 1 } });
          const b = buildGuided(schema, c, components, { rules });
          expect(b.refused, `${variant.id}/${size.id}/${add.kind}`).toEqual([]);
          expect(judge(b.assembly, components, rules, { mounting: c.mounting }), `${variant.id}/${size.id}/${add.kind}`).toEqual([]);
        }
      }
    }
  });
});
