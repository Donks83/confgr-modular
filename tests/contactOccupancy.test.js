// A socket is occupied by whatever is TOUCHING it, not only by a recorded joint.
//
// A1 F23: the connection graph is a tree, so a shelf spanning two ladders records
// its joint at one of them, and the rung under its other end came out free. The
// next shelf asked for took that rung and landed in the same space as the first -
// a metal and a timber shelf on one rung, both on the bill of materials, in 1,082
// of the audit's builds. Two coincident boards measure as a lap, so no collision
// rule objected.
//
// Proved first on the synthetic rack (committed, so this runs on any checkout),
// then on the YouK parts where they are present.

import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseGuided, buildGuided, normaliseChoices, defaultChoices, GUIDED_VERSION } from '../src/engine/guided.js';
import { resolveTransforms, worldSnaps } from '../src/engine/assembly.js';
import { MOUNTING } from '../src/engine/ar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 'rack-upright-1800';
const SPAN = 'rack-shelf-900';

const schema = () => parseGuided({
  version: GUIDED_VERSION,
  title: 'Test rack',
  variants: [{
    id: 'rack', defaultBays: 1, maxBays: 3, defaultMounting: MOUNTING.FLOOR,
    frames: [{ componentId: FRAME, label: '1800', default: true }],
    sizes: [{
      id: 'w900', label: '900', default: true,
      span: { componentId: SPAN, label: 'Shelf' },
      adds: [{ componentId: SPAN, label: 'Extra shelf', max: 6, spans: true }],
    }],
  }],
});

let components;
beforeAll(async () => {
  const { loadFolder } = await import('../tools/export-glb.mjs');
  ({ components } = loadFolder(join(ROOT, 'test-assets')));
}, 120_000);

describe('a socket under the far end of a shelf', () => {
  it('is occupied, though no joint is recorded there', () => {
    const s = schema();
    const built = buildGuided(s, normaliseChoices(s, { ...defaultChoices(s), adds: { [SPAN]: 1 } }), components);
    const extra = built.assembly.instances.at(-1);
    const { transforms } = resolveTransforms(built.assembly, components);

    // The extra shelf is wired to ONE frame.
    const wiredTo = built.assembly.connections
      .filter((c) => c.toInstanceId === extra.instanceId || c.fromInstanceId === extra.instanceId);
    expect(wiredTo).toHaveLength(1);

    // But every frame socket under one of its plugs is taken - both ends.
    const snaps = worldSnaps(built.assembly, components, transforms);
    const plugs = snaps.filter((p) => p.instanceId === extra.instanceId && p.role === 'plug');
    expect(plugs.length).toBe(2);
    for (const plug of plugs) {
      const under = snaps.find((p) => p.role === 'socket' && p.instanceId !== extra.instanceId
        && Math.hypot(...p.worldPosition.map((v, k) => v - plug.worldPosition[k])) < 0.001);
      expect(under, `a socket under ${plug.snapId}`).toBeTruthy();
      expect(under.occupied, `${under.instanceId} ${under.snapId} occupied`).toBe(true);
    }
  });

  it('is NOT occupied by contact when the caller asks for recorded joints only', () => {
    // implied.js counts with identity transforms, where everything would touch.
    const s = schema();
    const built = buildGuided(s, normaliseChoices(s, { ...defaultChoices(s), adds: { [SPAN]: 1 } }), components);
    const { transforms } = resolveTransforms(built.assembly, components);
    const byJoint = worldSnaps(built.assembly, components, transforms, { byContact: false }).filter((p) => p.occupied);
    const byContact = worldSnaps(built.assembly, components, transforms).filter((p) => p.occupied);
    expect(byContact.length).toBeGreaterThan(byJoint.length);
  });

  it('so two more shelves take two different heights, never one', () => {
    const s = schema();
    const built = buildGuided(s, normaliseChoices(s, { ...defaultChoices(s), adds: { [SPAN]: 3 } }), components);
    const { transforms } = resolveTransforms(built.assembly, components);
    const at = built.assembly.instances.filter((i) => i.componentId === SPAN)
      .map((i) => transforms.get(i.instanceId).translation.map((v) => Math.round(v * 1000)).join(','));
    expect(new Set(at).size).toBe(at.length);
  });
});

const YOUK = join(ROOT, 'youk');
const haveYouk = existsSync(join(YOUK, '008563-shelf-900mm-for-ladder-depth-320mm.glb'));

describe.skipIf(!haveYouk)('YouK: a metal shelf and a timber shelf in one bay (A1 F23)', () => {
  let youk;
  beforeAll(async () => {
    const { loadFolder } = await import('../tools/export-glb.mjs');
    youk = loadFolder(YOUK).components;
  }, 120_000);

  it('never share a rung', () => {
    const s = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
    const built = buildGuided(s, normaliseChoices(s, {
      ...defaultChoices(s), variantId: 'd320', sizeId: 'w900', frameId: '236758-ladder-depth-320mm',
      bays: 2, mounting: MOUNTING.FEET, adds: { 'metal-shelf': 2, 'timber-shelf': 2 }, at: {},
    }), youk);
    const { transforms } = resolveTransforms(built.assembly, youk);
    const spots = built.assembly.instances
      .filter((i) => /shelf/.test(i.componentId))
      .map((i) => transforms.get(i.instanceId).translation.map((v) => Math.round(v * 1000)).join(','));
    expect(new Set(spots).size).toBe(spots.length);
  });
});
