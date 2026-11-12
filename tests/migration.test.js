// Old links still open (A3; docs/design/A2-rule-model.md §6).
//
// tests/fixtures/links-v1.json is what the engine BEFORE the rules rewrite made of
// 16 real links: the audit's eight, each variant's default, mixed runs, every
// mounting and three moved parts. Captured at commit 97750cf, before any engine
// change, by tools/audit/capture-fixtures.mjs.
//
// Each link must still open. Its product must be the same part for part, EXCEPT
// where the difference is one of the audit's failures being fixed - and every
// such difference is named below with the failure it fixes. A difference that is
// not on this list is a regression.
//
// Needs the YouK models (gitignored), like the other tests on real geometry.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGuided, buildGuided, normaliseChoices } from '../src/engine/guided.js';
import { parseRules } from '../src/engine/rules.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { resolveConfiguration } from '../src/engine/configuration.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YOUK = join(ROOT, 'youk');
const have = existsSync(join(YOUK, '236758-ladder-depth-320mm.glb'));
const fixtures = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'links-v1.json'), 'utf8'));

/**
 * The only differences allowed, per link, and why.
 *   moved   - parts (by article prefix) that may be somewhere else now
 *   gone    - parts that may no longer be on the product
 *   dropped - slots whose old record is now refused with a reason
 */
const EXPECTED = {
  'L1 side rack below floor': { moved: ['008543'], why: 'F01: the side rack no longer hangs 58.5 mm through the floor' },
  'L2 YouboXx below floor': { moved: ['008547'], why: 'F02: the YouboXx no longer sits 12.3 mm below the floor' },
  'L4 ladder springs back': {
    moved: ['008543', '008537'],
    dropped: ['frame#1'],
    why: 'F01, and the recorded ladder move would strand bay 1\'s shelf on one ladder: refused with a reason instead of springing back (F07)',
  },
  'L5 shelf dot lands elsewhere': {
    moved: ['008543', '008537'],
    gone: ['pws-timber-shelf'],
    dropped: ['metal-shelf#1'],
    why: 'F23: the timber shelf was the DOUBLE of a metal one (both at 235/455); on 550 ladders there is no free rung for it. The outboard dot record would cantilever (F08)',
  },
  'L6 hook strip dot lands elsewhere': { moved: ['008543', '008537', '008530'], why: 'F01, F11 (the rail goes to the highest rung), and the strips settle round the lifted rack' },
  'L7 after removal (timber shelf now in bay 1)': { moved: ['008543', '008537'], why: 'F01, and the hook strip takes the face the rack used to' },
  '3 bays mixed widths and ladders': { moved: ['008532'], why: 'F11: the clothes rail goes to the highest rung that takes it, not 26 mm off the floor' },
  'd200 2 bays timber': { moved: ['008542'], why: 'F01: the 200 mm side rack no longer hangs through the floor' },
};

const dec = (o) => JSON.parse(Buffer.from(o.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const mm = (v) => Math.round(v * 10000) / 10;
const spot = (p) => `${p.componentId}@${p.at.join(',')}`;

describe.skipIf(!have)('links written before the rules rewrite', () => {
  let schema; let components; let rules; let catalogue;
  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    ({ components } = loadFolder(YOUK));
    schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
    catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
  }, 120_000);

  it('were captured before the change, and say so', () => {
    expect(fixtures.commit).toBe('97750cf');
    expect(fixtures.links.length).toBe(16);
  });

  for (const link of fixtures.links) {
    it(`opens "${link.name}" as the same product, or with only the named fixes`, () => {
      const allowed = EXPECTED[link.name] || { moved: [], gone: [], dropped: [] };
      const built = buildGuided(schema, normaliseChoices(schema, dec(link.o)), components, { rules });
      const { transforms } = resolveTransforms(built.assembly, components);
      const now = built.assembly.instances.map((i) => ({
        componentId: i.componentId, at: transforms.get(i.instanceId).translation.map(mm),
      }));
      const free = (id) => [...(allowed.moved || []), ...(allowed.gone || [])].some((p) => id.startsWith(p));

      // Every part not named as fixed is exactly where it was.
      const was = link.layout.filter((p) => !free(p.componentId)).map(spot).sort();
      const is = now.filter((p) => !free(p.componentId)).map(spot).sort();
      expect(is, allowed.why || 'no change expected').toEqual(was);

      // A moved part is still on the product; only a "gone" part may be missing.
      for (const prefix of allowed.moved || []) {
        expect(now.filter((p) => p.componentId.startsWith(prefix)).length)
          .toBe(link.layout.filter((p) => p.componentId.startsWith(prefix)).length);
      }

      // Exactly the named records are dropped, each with a sentence.
      expect(built.dropped.map((d) => d.slot).sort()).toEqual([...(allowed.dropped || [])].sort());
      for (const d of built.dropped) expect(d.reason).toMatch(/\w+ \w+/);
    });

    it(`still resolves the configuration id "${link.name}" was shared with`, () => {
      // The id records parts and joints, not choices, so it must open whatever
      // the rules now say about it - with a verdict rather than a refusal.
      const r = resolveConfiguration(link.c, components, { catalogue, rules });
      expect(r.assembly.instances.length).toBe(link.layout.length);
      if (r.quote) expect(['orderable', 'draft']).toContain(r.quote.status);
    });
  }

  it('reports the old below-floor products as drafts when opened by id', () => {
    // An id is a frozen product: L1's id still HAS the rack through the floor,
    // because the id is the product as it was quoted. Opened now, it is a draft.
    const l1 = fixtures.links.find((l) => l.name.startsWith('L1'));
    const r = resolveConfiguration(l1.c, components, { catalogue, rules });
    expect(r.quote.status).toBe('draft');
    expect(r.quote.draftBecause.join(' ')).toMatch(/below the floor/);
  });
});
