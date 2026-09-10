// Configuring by option rather than by clicking, and the four wrong products
// that taught the placement policy what it is for.
//
// Built on the SYNTHETIC assets, not on YouK: `rack-upright-1800` is a frame
// with four levels and `rack-shelf-900` is a span with a plug at each end,
// which is the whole shape this module cares about. The supplier geometry is
// gitignored and a test may not depend on it being present - the same rule
// tests/bundle.test.js follows.
//
// Every assertion below about a POSITION exists because the policy once got it
// wrong in a way that compiled, resolved, priced and looked plausible in a
// screenshot:
//
//   the second frame 1305 mm below the floor, hanging by its top rung
//   the second bay 355 mm up in the air, level with nothing
//   the run folding back into bay 1 instead of getting longer
//   "four more shelves" putting two of them out in the air beside the product
//
// None of those is a crash and none of them is a collision. They are all
// legal, buildable products that nobody asked for, which is why the policy is
// tested by where parts END UP rather than by whether the call succeeded.

import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseGuided, guidedComponentIds, variantOf, sizeOf, defaultChoices, normaliseChoices,
  buildGuided, autoAttach, moveOptions, builderIdOf, GuidedError, GUIDED_VERSION, PLACE,
} from '../src/engine/guided.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { overlaps } from '../src/engine/collision.js';
import { resolveConfiguration, decodeConfiguration } from '../src/engine/configuration.js';
import { MOUNTING } from '../src/engine/ar.js';
import { impliedComponentIds } from '../src/engine/implied.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'test-assets');

const FRAME = 'rack-upright-1800';
const SPAN = 'rack-shelf-900';
const DRAWER = 'rack-drawer-900';
const NO_SNAPS = 'molle-panel';

/**
 * A schema over the committed synthetic parts.
 *
 * `floor` mounting deliberately: `feet` would imply the adjustable foot, whose
 * model is supplier geometry and therefore not in git.
 */
const schema = () => parseGuided({
  version: GUIDED_VERSION,
  title: 'Test rack',
  variants: [{
    id: 'rack',
    label: 'Rack',
    defaultBays: 1,
    maxBays: 3,
    defaultMounting: MOUNTING.FLOOR,
    frames: [
      { componentId: FRAME, label: '1800 tall', default: true },
    ],
    sizes: [
      {
        id: 'w900',
        label: '900 wide',
        default: true,
        span: { componentId: SPAN, label: 'Shelf' },
        adds: [
          { componentId: SPAN, label: 'Extra shelf', max: 6, spans: true },
          { componentId: DRAWER, label: 'Drawer', max: 6, spans: true },
        ],
      },
    ],
  }],
});

let components;
beforeAll(async () => {
  const { loadFolder } = await import('../tools/export-glb.mjs');
  ({ components } = loadFolder(ASSETS));
}, 120_000);

const mm = (v) => Math.round(v * 1000);

/** Where every instance ended up, in millimetres. */
function placed(result) {
  const { transforms } = resolveTransforms(result.assembly, components);
  return result.assembly.instances.map((i) => ({
    id: i.instanceId,
    componentId: i.componentId,
    x: mm(transforms.get(i.instanceId).translation[0]),
    y: mm(transforms.get(i.instanceId).translation[1]),
  }));
}

describe('reading an option schema', () => {
  it('refuses one it cannot read at all', () => {
    expect(() => parseGuided(null)).toThrow(GuidedError);
    expect(() => parseGuided('nope')).toThrow(GuidedError);
  });

  it('refuses a version it does not know, by name', () => {
    // Same discipline as the configuration id and the bundle manifest: an
    // unknown version is refused rather than half-read, because a schema is a
    // file somebody may open in two years.
    expect(() => parseGuided({ version: 99, variants: [] }))
      .toThrow(/version 99.*version 1/s);
  });

  it('refuses a product that cannot stand up or cannot be joined', () => {
    expect(() => parseGuided({ version: 1, variants: [] })).toThrow(/at least one variant/);
    expect(() => parseGuided({
      version: 1, variants: [{ id: 'a', sizes: [{ id: 's', span: { componentId: 'x' } }] }],
    })).toThrow(/no frames/);
    expect(() => parseGuided({
      version: 1, variants: [{ id: 'a', frames: [{ componentId: 'f' }], sizes: [{ id: 's' }] }],
    })).toThrow(/no span part/);
  });
});

describe('what a schema can reach', () => {
  it('lists frames, spans and accessories, sorted and deduplicated', () => {
    // The span and one of the adds are the same part, deliberately - a bay's
    // shelf and an extra shelf are one article number.
    const ids = guidedComponentIds(schema(), { includeImplied: false });
    expect(ids).toEqual([DRAWER, SPAN, FRAME]);
  });

  it('includes the implied parts by default, because a bundle needs them', () => {
    const ids = guidedComponentIds(schema());
    for (const id of impliedComponentIds()) expect(ids).toContain(id);
  });
});

describe('picking a variant and a size', () => {
  it('takes what was asked for', () => {
    const s = schema();
    expect(variantOf(s, { variantId: 'rack' }).id).toBe('rack');
    expect(sizeOf(s.variants[0], { sizeId: 'w900' }).id).toBe('w900');
  });

  it('names a variant it does not have rather than guessing', () => {
    expect(() => variantOf(schema(), { variantId: 'nope' })).toThrow(/no variant called "nope"/);
  });

  it('falls back on a size it does not have, because switching depth does that', () => {
    // Not an error: choosing 600 wide and then switching to a depth that has no
    // 600 is a normal use of two controls, and it must not throw at somebody.
    expect(sizeOf(schema().variants[0], { sizeId: 'w600' }).id).toBe('w900');
  });
});

describe('the choices a product opens on', () => {
  it('honours the schema\'s own defaults rather than list order', () => {
    const c = defaultChoices(schema());
    expect(c.frameId).toBe(FRAME);
    expect(c.sizeId).toBe('w900');
    expect(c.bays).toBe(1);
    expect(c.adds).toEqual({});
  });

  it('opens on the smallest real product, not an empty scene', () => {
    expect(defaultChoices(schema()).bays).toBeGreaterThan(0);
  });
});

describe('clamping choices that arrived from a URL', () => {
  it('keeps bays inside what the schema allows', () => {
    const s = schema();
    expect(normaliseChoices(s, { bays: 0 }).bays).toBe(1);
    expect(normaliseChoices(s, { bays: -4 }).bays).toBe(1);
    expect(normaliseChoices(s, { bays: 99 }).bays).toBe(3);
    expect(normaliseChoices(s, { bays: '2' }).bays).toBe(2);
  });

  it('drops counts of nothing and caps the rest', () => {
    const s = schema();
    expect(normaliseChoices(s, { adds: { [SPAN]: 0 } }).adds).toEqual({});
    expect(normaliseChoices(s, { adds: { [SPAN]: -3 } }).adds).toEqual({});
    expect(normaliseChoices(s, { adds: { [SPAN]: 99 } }).adds).toEqual({ [SPAN]: 6 });
    expect(normaliseChoices(s, { adds: { 'not-on-offer': 2 } }).adds).toEqual({});
  });

  it('multiplies a per-bay ceiling by the bays', () => {
    const s = schema();
    s.variants[0].sizes[0].adds[0].perBay = true;
    s.variants[0].sizes[0].adds[0].max = 1;
    expect(normaliseChoices(s, { bays: 1, adds: { [SPAN]: 5 } }).adds).toEqual({ [SPAN]: 1 });
    expect(normaliseChoices(s, { bays: 3, adds: { [SPAN]: 5 } }).adds).toEqual({ [SPAN]: 3 });
  });

  it('falls back to the DEFAULT frame, not the first one', () => {
    // The regression this fixes produced a two-rung product: the fallback took
    // frames[0], which for YouK is the 550 mm frame, so switching depth
    // silently shrank the product and every accessory afterwards was refused
    // for want of anywhere to go. `defaultChoices` honoured the flag and this
    // did not - the same fact in two places, disagreeing.
    const s = schema();
    s.variants[0].frames = [
      { componentId: 'short-frame' },
      { componentId: FRAME, default: true },
    ];
    expect(normaliseChoices(s, { frameId: 'from-another-range' }).frameId).toBe(FRAME);
  });

  it('refuses to take a mounting it does not recognise', () => {
    expect(normaliseChoices(schema(), { mounting: 'levitating' }).mounting)
      .toBe(MOUNTING.FLOOR);
  });
});

describe('building a product from choices', () => {
  it('makes a bay out of a frame, a span and a frame', () => {
    const r = buildGuided(schema(), { bays: 1 }, components);
    expect(r.assembly.instances.map((i) => i.componentId))
      .toEqual([FRAME, SPAN, FRAME]);
    expect(r.refused).toEqual([]);
  });

  it('grows a run sideways rather than folding it back', () => {
    // The run must get LONGER. Given the choice between hanging the next span
    // off the free end and dropping it back inside the bay it just built, a
    // "well-supported" rule picks the second one every time.
    const r = buildGuided(schema(), { bays: 3 }, components);
    const frames = placed(r).filter((p) => p.componentId === FRAME).map((p) => p.x);
    expect(frames.length).toBe(4);
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
    expect(new Set(frames).size).toBe(4);
  });

  it('keeps every frame on the floor', () => {
    // A frame offered at a span's free end fits by ANY of its own levels, so
    // "lowest world height" mates it by its top one and it dangles below the
    // floor - 1305 mm below, on the real range. Level with its own kind is the
    // rule; this is what checks it.
    const r = buildGuided(schema(), { bays: 3 }, components);
    const ys = new Set(placed(r).filter((p) => p.componentId === FRAME).map((p) => p.y));
    expect([...ys]).toEqual([0]);
  });

  it('keeps a run level', () => {
    const r = buildGuided(schema(), { bays: 3 }, components);
    const ys = new Set(placed(r).filter((p) => p.componentId === SPAN).map((p) => p.y));
    expect(ys.size).toBe(1);
  });

  it('puts extra shelves INSIDE the run and works upward', () => {
    const r = buildGuided(schema(), { bays: 1, adds: { [SPAN]: 2 } }, components);
    const rows = placed(r);
    const frameXs = rows.filter((p) => p.componentId === FRAME).map((p) => p.x);
    const spans = rows.filter((p) => p.componentId === SPAN);

    expect(spans.length).toBe(3);
    for (const s of spans) {
      // Between the frames, not cantilevered off the outside of the end one.
      expect(s.x).toBeGreaterThan(Math.min(...frameXs));
      expect(s.x).toBeLessThan(Math.max(...frameXs));
    }
    // Three different heights, working up from the bottom.
    const heights = spans.map((s) => s.y).sort((a, b) => a - b);
    expect(new Set(heights).size).toBe(3);
    expect(heights[0]).toBeLessThan(heights[2]);
  });

  it('never puts two of the same part in the same place', () => {
    const r = buildGuided(schema(), { bays: 2, adds: { [SPAN]: 4, [DRAWER]: 2 } }, components);
    const keys = placed(r).map((p) => `${p.componentId}@${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts nothing through anything', () => {
    const r = buildGuided(schema(), { bays: 2, adds: { [SPAN]: 3, [DRAWER]: 2 } }, components);
    const { transforms } = resolveTransforms(r.assembly, components);
    const through = overlaps(r.assembly, components, transforms)
      .filter((o) => !o.joined && o.through);
    expect(through).toEqual([]);
  });

  it('says how many fit when fewer fit than were asked for', () => {
    // NOTHING IS SILENTLY DROPPED. A configurator that ignores a control is
    // indistinguishable from one that is broken - the same rule the quote
    // follows with a missing price.
    const r = buildGuided(schema(), { bays: 1, adds: { [SPAN]: 6 } }, components);
    expect(r.refused.length).toBe(1);
    expect(r.refused[0].asked).toBe(6);
    expect(r.refused[0].placed).toBeGreaterThan(0);
    expect(r.refused[0].placed).toBeLessThan(6);
    expect(r.refused[0].reason).toMatch(/already taken/);
  });

  it('names the parts it has not got rather than shrinking the product', () => {
    const s = schema();
    s.variants[0].frames = [{ componentId: 'a-frame-nobody-modelled', default: true }];
    expect(() => buildGuided(s, {}, components))
      .toThrow(/a-frame-nobody-modelled/);
  });
});

describe('the configuration it produces', () => {
  it('is the same id for the same choices', () => {
    // Two customers who picked the same options must get the same id, or a
    // quote cannot be reconciled with a drawing. That is why accessories are
    // applied in the schema's order rather than in the order the controls were
    // touched.
    const a = buildGuided(schema(), { bays: 2, adds: { [SPAN]: 2 } }, components);
    const b = buildGuided(schema(), { bays: 2, adds: { [SPAN]: 2 } }, components);
    expect(a.configurationId).toBe(b.configurationId);
  });

  it('is a different id for different choices', () => {
    const a = buildGuided(schema(), { bays: 1 }, components);
    const b = buildGuided(schema(), { bays: 2 }, components);
    expect(a.configurationId).not.toBe(b.configurationId);
  });

  it('carries the mounting, so a bundle and an AR file agree about the floor', () => {
    const r = buildGuided(schema(), { bays: 1, mounting: MOUNTING.WALL }, components);
    expect(decodeConfiguration(r.configurationId).mounting).toBe(MOUNTING.WALL);
  });

  it('resolves back to the same product with no editor', () => {
    const r = buildGuided(schema(), { bays: 2, adds: { [SPAN]: 1 } }, components);
    const resolved = resolveConfiguration(r.configurationId, components);
    expect(resolved.assembly.instances.length).toBe(r.assembly.instances.length);
    expect(resolved.validity.missingRequiredSnaps).toEqual([]);
  });
});

describe('moving a part that is already on the product', () => {
  // The complaint this answers, in Matt's words: "all of the addons are just on
  // the bottom rail". Auto-placement fills from the bottom, which is right for
  // repeats and wrong as the only option a person has.
  const withDrawer = () => buildGuided(
    schema(), { bays: 2, adds: { [DRAWER]: 1 } }, components,
  );

  const drawerId = (built) => Object.entries(built.slots)
    .find(([, key]) => key.startsWith(DRAWER))?.[0];

  it('maps a part drawn from the id back to the builder\'s own name for it', () => {
    // TWO ID SPACES. The builder names instances g1, g2, g3; the runtime draws
    // by RESOLVING the configuration id, and decoding names what it reads p0,
    // p1, p2. A customer tapping a shelf produces a `p` id, and the first
    // version of the move panel asked the builder about it and was told - truly
    // and uselessly - "that part is not on this product".
    //
    // THIS TEST IS THE INVARIANT, not the mapping: the two are aligned by
    // order, so if the encoder ever sorted or de-duplicated its instances every
    // move would silently address the wrong part.
    const built = withDrawer();
    const drawn = resolveConfiguration(built.configurationId, components).scene.assembly;

    expect(drawn.instances.map((i) => i.componentId))
      .toEqual(built.assembly.instances.map((i) => i.componentId));

    for (let i = 0; i < built.assembly.instances.length; i += 1) {
      expect(builderIdOf(built, drawn, drawn.instances[i].instanceId))
        .toBe(built.assembly.instances[i].instanceId);
    }
  });

  it('does not guess when the drawn part is one it cannot place', () => {
    // The implied foot is drawn but is not a chosen part, and a tap that
    // somehow reached one must produce nothing rather than the wrong slot.
    const built = withDrawer();
    const drawn = resolveConfiguration(built.configurationId, components).scene.assembly;
    expect(builderIdOf(built, drawn, 'implied:foot:p0:0')).toBe(null);
    expect(builderIdOf(built, drawn, 'nonsense')).toBe(null);
  });

  it('knows which choice each part came from', () => {
    // The link that makes a tap in the scene actionable. Without it there is no
    // way back from an instance to the option that produced it.
    const built = withDrawer();
    const id = drawerId(built);
    expect(id).toBeTruthy();
    expect(built.slots[id]).toBe(`${DRAWER}#0`);
  });

  it('offers distinct heights, and marks where it already is', () => {
    const built = withDrawer();
    const r = moveOptions(built, components, drawerId(built));

    expect(r.ok).toBe(true);
    expect(r.options.length).toBeGreaterThan(1);
    // One entry per height, sorted, no duplicates — a dozen legal points on a
    // multi-bay run collapse to the handful of heights a person is choosing
    // between.
    const heights = r.options.map((o) => o.heightMm);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
    expect(new Set(heights).size).toBe(heights.length);
    expect(r.options.filter((o) => o.current).length).toBe(1);
  });

  it('offers only positions that actually work', () => {
    // Each option is built by performing the move on a copy and surveying it,
    // so an offered height is a height that holds.
    const built = withDrawer();
    const r = moveOptions(built, components, drawerId(built));
    for (const o of r.options) expect(o.held).toBe(o.heldOf);
  });

  // WAS "refuses to move the frame, and says what to do instead", and the
  // refusal was the thing Matt then asked for: "click on a ladder in the scene
  // and change its type and then change what height it sits". So a frame is a
  // slot now. The anchor still cannot MOVE - the run is measured from it - but
  // it is answered as a ladder whose position is fixed rather than as a
  // structural part with nothing to offer.
  it('answers the first ladder as a ladder that cannot move', () => {
    const built = withDrawer();
    const r = moveOptions(built, components, built.assembly.instances[0].instanceId);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('frame');
    expect(r.anchor).toBe(true);
    expect(r.options).toEqual([]);
    expect(r.reason).toMatch(/type can still change/i);
  });

  it('puts the part where it was told, and keeps it there', () => {
    // THE ONE THAT MATTERS, and the reason a position is recorded against a
    // SLOT rather than an instance: the product is rebuilt from the choices on
    // every change, so a move has to survive being regenerated.
    const built = withDrawer();
    const r = moveOptions(built, components, drawerId(built));
    const top = r.options[r.options.length - 1];

    const moved = buildGuided(
      schema(),
      { ...built.choices, at: { [r.slot]: top.at } },
      components,
    );
    const at = placed(moved).find((p) => p.componentId === DRAWER);
    expect(at.y).toBe(top.heightMm);
    expect(moved.dropped).toEqual([]);
  });

  it('keeps a moved part put when other counts change', () => {
    const built = withDrawer();
    const r = moveOptions(built, components, drawerId(built));
    const top = r.options[r.options.length - 1];
    const pinned = { ...built.choices, at: { [r.slot]: top.at } };

    // Two more spans arrive. The drawer must not be re-placed.
    const later = buildGuided(schema(), { ...pinned, adds: { ...pinned.adds, [SPAN]: 2 } }, components);
    expect(placed(later).find((p) => p.componentId === DRAWER).y).toBe(top.heightMm);
  });

  it('reports a remembered position it can no longer honour', () => {
    // Reducing the bays can remove the frame something was hung on. Dropping
    // the record and auto-placing beats losing the part — but the caller has to
    // be TOLD, or it keeps a position that will silently come back.
    const built = buildGuided(schema(), { bays: 3, adds: { [DRAWER]: 1 } }, components);
    const r = moveOptions(built, components, drawerId(built));
    const far = r.options.find((o) => o.at.instanceId !== 'g1') || r.options[0];

    const shrunk = buildGuided(
      schema(),
      { ...built.choices, bays: 1, at: { [r.slot]: { instanceId: 'g99', snapId: far.at.snapId } } },
      components,
    );
    expect(shrunk.dropped.length).toBe(1);
    expect(shrunk.dropped[0].slot).toBe(r.slot);
    // And the part is still on the product.
    expect(placed(shrunk).some((p) => p.componentId === DRAWER)).toBe(true);
  });

  it('forgets a position for a slot that no longer exists', () => {
    // Three drawers down to one must not leave a position recorded for the
    // third: it would reappear if the count went back up, which is a product
    // changing because of something done and then undone.
    const s = schema();
    const kept = normaliseChoices(s, {
      adds: { [DRAWER]: 1 },
      at: {
        [`${DRAWER}#0`]: { instanceId: 'g1', snapId: 'x' },
        [`${DRAWER}#2`]: { instanceId: 'g1', snapId: 'y' },
      },
    });
    expect(Object.keys(kept.at)).toEqual([`${DRAWER}#0`]);
  });

  it('ignores a malformed position rather than crashing on it', () => {
    // These arrive from a URL.
    const s = schema();
    const cleaned = normaliseChoices(s, {
      adds: { [DRAWER]: 2 },
      at: {
        [`${DRAWER}#0`]: { instanceId: 'g1' },
        [`${DRAWER}#1`]: 'not-an-object',
        'no-hash-here': { instanceId: 'g1', snapId: 'x' },
      },
    });
    expect(cleaned.at).toEqual({});
  });
});

describe('autoAttach on its own', () => {
  const bay = () => buildGuided(schema(), { bays: 1 }, components);

  it('explains why a part with no snaps can go nowhere', () => {
    // The real one of these was the shoe rack. It has no snaps because
    // youk/snap-spec.json already records that MA 406213 screws it to a wall
    // and no ladder appears in the sheet - so offering it as a bay accessory
    // was an authoring mistake, and this is the sentence that caught it.
    const r = autoAttach(bay().assembly, components, NO_SNAPS, { instanceId: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/nowhere/i);
  });

  it('shows its own ranking when asked', () => {
    const r = autoAttach(bay().assembly, components, SPAN, {
      instanceId: 'x', policy: PLACE.FILL, explain: true,
    });
    expect(r.ok).toBe(true);
    expect(r.ranking.length).toBe(r.considered);
    expect(r.ranking[0]).toHaveProperty('held');
    expect(r.ranking[0]).toHaveProperty('levelDeltaMm');
  });

  it('will not cantilever a spanning part when told it must be held', () => {
    // The same call twice, differing only in `requireFullyHeld`: without it the
    // engine is happy to hang the part off the end of the run.
    const full = buildGuided(schema(), { bays: 1, adds: { [SPAN]: 3 } }, components);

    const loose = autoAttach(full.assembly, components, SPAN, {
      instanceId: 'x', policy: PLACE.FILL, requireFullyHeld: false,
    });
    const held = autoAttach(full.assembly, components, SPAN, {
      instanceId: 'x', policy: PLACE.FILL, requireFullyHeld: true,
    });

    expect(loose.ok).toBe(true);
    expect(held.ok).toBe(false);
    expect(held.reason).toMatch(/already taken/);
  });

  it('prefers the instance it was told to grow from', () => {
    const b = bay();
    const last = b.assembly.instances[b.assembly.instances.length - 1].instanceId;
    const r = autoAttach(b.assembly, components, SPAN, {
      instanceId: 'x', policy: PLACE.EXTEND, prefer: last, explain: true,
    });
    expect(r.ok).toBe(true);
    expect(r.point.instanceId).toBe(last);
  });
});
