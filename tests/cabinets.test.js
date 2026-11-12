// Cabinets across two bays (A1 F14).
//
// The Carcass holder sheet (MA 406214 p.1, step 1b) puts ONE extension bracket
// (008559/60) on the middle ladder of a run, and it carries the cabinet on EACH
// side. Its single carry socket sat on its own centreline - inside the ladder -
// so a cabinet sized for the outer brackets could never meet it, and cabinets
// over more than one bay were "unproven" (§3.6) for the whole of the project.
//
// The bracket now carries at ±15.1 mm, the offset the outer bracket's own
// plug-to-socket measures, and two 900 cabinets sit either side of the middle
// ladder, every end held. Needs the YouK models (gitignored).

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGuided, buildGuided, normaliseChoices, defaultChoices, autoAttach, PLACE } from '../src/engine/guided.js';
import { parseRules } from '../src/engine/rules.js';
import { judge } from '../src/engine/judge.js';
import { resolveTransforms, worldSnaps } from '../src/engine/assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YOUK = join(ROOT, 'youk');
const have = existsSync(join(YOUK, '008560-cabinet-bracket-for-ladder-depth-320mm.glb'));
const OUTER = '008558-outer-cabinet-bracket-for-ladder-depth-320mm';
const EXTENSION = '008560-cabinet-bracket-for-ladder-depth-320mm';
const CABINET = 'pws-timber-cabinet-900mm-h450mm-for-ladder-depth-320mm';
const rung = (n, side) => `md-snap.youk-d320.rung-${n}-${side}`;
const mm = (v) => Math.round(v * 10000) / 10;

describe.skipIf(!have)('cabinets across two bays', () => {
  let components; let rules; let product;

  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    ({ components } = loadFolder(YOUK));
    const catalogue = JSON.parse(readFileSync(join(YOUK, 'catalogue.json'), 'utf8'));
    rules = parseRules(JSON.parse(readFileSync(join(YOUK, 'rules.json'), 'utf8')), { catalogue });
    const schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));

    // Two 900 bays with their shelves at the top rung, so rung 1 is free for the
    // brackets - where the sheet draws them.
    const built = buildGuided(schema, normaliseChoices(schema, {
      ...defaultChoices(schema), variantId: 'd320', sizeId: 'w900', frameId: '236758-ladder-depth-320mm',
      bays: 2, mounting: 'floor', adds: {},
      at: {
        'span#0': { instanceId: 'g1', slot: 'frame#0', snapId: rung(4, 'right') },
        'span#1': { instanceId: 'g3', slot: 'frame#1', snapId: rung(4, 'right') },
      },
    }), components, { rules });
    expect(built.dropped).toEqual([]);

    let a = built.assembly;
    const judgeAt = (x, id) => judge(x, components, rules, { mounting: 'floor', focus: id });
    const put = (id, instanceId, at) => {
      const r = autoAttach(a, components, id, { instanceId, policy: PLACE.FILL, judge: judgeAt, ...(at ? { at } : {}) });
      if (r.ok) a = r.assembly;
      return r;
    };
    product = {
      brackets: [
        put(OUTER, 'b1', { instanceId: 'g1', snapId: rung(1, 'right') }),
        put(EXTENSION, 'b2', { instanceId: 'g3', snapId: rung(1, 'right') }),
        put(OUTER, 'b3', { instanceId: 'g5', snapId: rung(1, 'left') }),
      ],
      cabinets: [put(CABINET, 'c1'), put(CABINET, 'c2')],
      third: put(CABINET, 'c3'),
      get assembly() { return a; },
    };
  }, 120_000);

  it('gives the extension bracket a carry socket each side of the ladder', () => {
    const labels = components.get(EXTENSION).snaps.filter((s) => s.role === 'socket').map((s) => s.label).sort();
    expect(labels).toEqual(['carries-left', 'carries-right']);
    const xs = components.get(EXTENSION).snaps.filter((s) => s.role === 'socket').map((s) => mm(s.position[0])).sort((p, q) => p - q);
    expect(xs).toEqual([-15.1, 15.1]);
  });

  it('places both cabinets, one on each side of the middle ladder', () => {
    for (const r of [...product.brackets, ...product.cabinets]) expect(r.ok, r.reason).toBe(true);
    expect(product.cabinets.map((r) => r.point.instanceId).sort()).toEqual(['b1', 'b2']);
  });

  it('holds every end of both cabinets, meeting the extension 15.1 mm either side of the ladder', () => {
    const { transforms } = resolveTransforms(product.assembly, components);
    const ends = worldSnaps(product.assembly, components, transforms)
      .filter((s) => ['c1', 'c2'].includes(s.instanceId) && s.role === 'plug');
    expect(ends).toHaveLength(4);
    for (const e of ends) expect(e.occupied, `${e.instanceId} ${e.label}`).toBe(true);
    const ladder = transforms.get('g3').translation[0];
    const atLadder = ends.map((e) => mm(e.worldPosition[0] - ladder)).filter((d) => Math.abs(d) < 50).sort((p, q) => p - q);
    expect(atLadder).toEqual([-15.1, 15.1]);
  });

  it('leaves nothing wrong anywhere in the product', () => {
    expect(judge(product.assembly, components, rules, { mounting: 'floor' })).toEqual([]);
  });

  it('refuses a third cabinet, with a reason', () => {
    expect(product.third.ok).toBe(false);
    expect(product.third.reason.length).toBeGreaterThan(12);
  });
});
