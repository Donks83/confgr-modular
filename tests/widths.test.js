// A width belongs to a BAY, not to the product.
//
// Matt, after using it: "i can change the width but it changes the width of all
// bays". A real run of shelving is not one width - the bay beside a chimney
// breast is narrower than the one next to it - and until now `sizeId` applied
// to everything.
//
// The shape of the fix is the one §5.25 used for ladder heights: an override
// keyed by POSITION, with the global choice as the default for any bay nobody
// has touched. The first bay is the first bay whatever ends up in it, so
// widening bay 2 cannot move a shelf somebody hung in bay 1.
//
// AND THE PART OF IT THAT IS NOT BOOKKEEPING. "when we add a shelf (timber or
// metal) its automatically the correct length" - which means a count of shelves
// can no longer name a part number, because "a metal shelf" is 008561, 008562,
// 008563 or 008564 depending on the bay it lands in. Adds are counted by KIND,
// and the length is settled by the joint checking that has been refusing bad
// placements since week one: a 900 shelf does not reach across a 600 bay, so
// trying the candidates widest-first picks the right one for nothing.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseGuided, defaultChoices, buildGuided, normaliseChoices, sizeAt, sizesInRun,
  componentForKind, componentsForKind, kindFromChoiceKey, widthOfComponent, slotKeyFor,
  moveCandidates, addForComponent,
} from '../src/engine/guided.js';
import { loadFolder } from '../tools/export-glb.mjs';

const YOUK = join(process.cwd(), 'youk');
const has = existsSync(join(YOUK, 'guided.json'));

const SHELF_900 = '008563-shelf-900mm-for-ladder-depth-320mm';
const SHELF_600 = '008562-shelf-600mm-for-ladder-depth-320mm';
const SHELF_450 = '008561-shelf-450mm-for-ladder-depth-320mm';

let schema;
let components;
let variant;

beforeAll(() => {
  if (!has) return;
  schema = parseGuided(JSON.parse(readFileSync(join(YOUK, 'guided.json'), 'utf8')));
  ({ components } = loadFolder(YOUK));
  [variant] = schema.variants;
});

const build = (patch = {}) => buildGuided(schema, { ...defaultChoices(schema), ...patch }, components);
const partsOf = (built) => built.assembly.instances.map((i) => i.componentId);

describe.runIf(has)('which size a bay is', () => {
  it('is the run\'s width until somebody says otherwise', () => {
    const choices = { sizeId: 'w900' };
    expect(sizeAt(variant, choices, 0).id).toBe('w900');
    expect(sizeAt(variant, choices, 3).id).toBe('w900');
  });

  it('takes an override for one bay and leaves the others alone', () => {
    const choices = { sizeId: 'w900', widths: { 1: 'w600' } };
    expect(sizesInRun(variant, choices, 3).map((s) => s.id)).toEqual(['w900', 'w600', 'w900']);
  });

  it('ignores a width this variant does not offer', () => {
    // The 200 mm range has no 600. Switching depth with a 600 recorded is a
    // normal use of the controls, not a malformed request.
    const d200 = schema.variants.find((v) => v.id === 'd200');
    expect(sizeAt(d200, { sizeId: 'w900', widths: { 0: 'w600' } }, 0).id).toBe('w900');
  });
});

describe.runIf(has)('clamping widths that arrived from a URL', () => {
  it('drops a width for a bay the run does not have', () => {
    const c = normaliseChoices(schema, { bays: 2, widths: { 5: 'w600' } });
    expect(c.widths).toEqual({});
  });

  it('drops a width equal to the run\'s own, so the control keeps meaning all', () => {
    // The same rule frame overrides follow. A stored duplicate would sit there
    // contradicting the Width control the moment somebody used it.
    const c = normaliseChoices(schema, { bays: 2, sizeId: 'w900', widths: { 0: 'w900' } });
    expect(c.widths).toEqual({});
  });

  it('keeps a real one', () => {
    const c = normaliseChoices(schema, { bays: 3, sizeId: 'w900', widths: { 1: 'w600' } });
    expect(c.widths).toEqual({ 1: 'w600' });
  });
});

describe.runIf(has)('kinds', () => {
  it('turns a kind into the part for a given width', () => {
    expect(componentForKind(sizeAt(variant, { sizeId: 'w900' }), 'metal-shelf')).toBe(SHELF_900);
    expect(componentForKind(sizeAt(variant, { sizeId: 'w600' }), 'metal-shelf')).toBe(SHELF_600);
  });

  it('answers null for a kind a width does not offer', () => {
    // There is no 450 mm clothes rail. A real answer, not a failure.
    expect(componentForKind(sizeAt(variant, { sizeId: 'w450' }), 'clothes-rail')).toBe(null);
  });

  it('lists every length a kind comes in', () => {
    const all = componentsForKind(variant, 'metal-shelf');
    expect(all).toContain(SHELF_450);
    expect(all).toContain(SHELF_600);
    expect(all).toContain(SHELF_900);
  });

  it('reads a width off the size rather than measuring geometry', () => {
    expect(widthOfComponent(variant, SHELF_900)).toBe(900);
    expect(widthOfComponent(variant, SHELF_600)).toBe(600);
    // A side rack is a side rack whatever the bay is.
    expect(widthOfComponent(variant, '008543-rack-for-ladder-depth-320mm')).toBe(0);
  });
});

describe.runIf(has)('links written before kinds existed', () => {
  it('still name the thing they always named', () => {
    // A bundle's whole point is that somebody can send the link, and every URL
    // written before today keys `adds` by component id.
    expect(kindFromChoiceKey(variant, SHELF_900)).toBe('metal-shelf');
    expect(kindFromChoiceKey(variant, SHELF_600)).toBe('metal-shelf');
  });

  it('open as the product they described, counted under the kind', () => {
    const c = normaliseChoices(schema, { adds: { [SHELF_900]: 2 } });
    expect(c.adds).toEqual({ 'metal-shelf': 2 });
  });

  it('keep a position that was recorded against the old key', () => {
    // Otherwise sending somebody a link to a product with a moved shelf would
    // deliver the shelf back at the bottom.
    const c = normaliseChoices(schema, {
      adds: { [SHELF_900]: 1 },
      at: { [`${SHELF_900}#0`]: { instanceId: 'g1', snapId: 'md-snap.x.y' } },
    });
    expect(Object.keys(c.at)).toEqual([slotKeyFor('metal-shelf', 0)]);
  });
});

describe.runIf(has)('a run whose bays differ', () => {
  it('builds, and uses each bay\'s own span', () => {
    const built = build({ bays: 2, sizeId: 'w900', widths: { 1: 'w600' } });
    expect(built.error).toBeFalsy();
    const parts = partsOf(built);
    // One 900 span and one 600 span, which is the whole claim.
    expect(parts.filter((p) => p === SHELF_900).length).toBe(1);
    expect(parts.filter((p) => p === SHELF_600).length).toBe(1);
  });

  it('still stands up: every bay is closed by a ladder', () => {
    const built = build({ bays: 3, sizeId: 'w900', widths: { 1: 'w450' } });
    expect(built.refused).toEqual([]);
    // Matched against the variant's own frame list rather than by name. The
    // first version of this test used /ladder/ and counted seven, because
    // "008563-shelf-900mm-for-ladder-depth-320mm" contains the word - every
    // shelf in the range is named after the ladder it fits.
    const frames = new Set(variant.frames.map((f) => f.componentId));
    const ladders = partsOf(built).filter((p) => frames.has(p));
    // Three bays need four ladders, whatever the spacings are.
    expect(ladders.length).toBe(4);
  });

  it('gives an added shelf the length of the bay it is put in', () => {
    // THE ONE MATT ASKED FOR, asked precisely. An earlier version of this test
    // put two extra shelves on a mixed run and expected one of each length -
    // and got two 900s, because auto-placement filled the 900 bay twice. That
    // is not a fault: nothing says a shelf must go in the empty bay. The claim
    // worth testing is narrower and stronger - a shelf put in the 600 bay is a
    // 600 shelf.
    const built = build({ bays: 2, sizeId: 'w900', widths: { 1: 'w600' } });
    const narrowSpan = built.assembly.instances.find((i) => i.componentId === SHELF_600);
    expect(narrowSpan).toBeTruthy();

    // Hang one on a rung of the ladder that closes the narrow bay.
    const onNarrow = buildGuided(schema, {
      ...built.choices,
      adds: { 'metal-shelf': 1 },
      at: { [slotKeyFor('metal-shelf', 0)]: { instanceId: narrowSpan.instanceId, snapId: null } },
    }, components);

    const extras = partsOf(onNarrow).filter((p) => /^00856[1-4]-shelf/.test(p));
    // Both lengths are present: the two spans plus an extra somewhere.
    expect(extras.filter((p) => p === SHELF_900).length).toBeGreaterThanOrEqual(1);
    expect(extras.filter((p) => p === SHELF_600).length).toBeGreaterThanOrEqual(1);
    expect(extras.length).toBe(3);
  });

  it('does not put a 900 shelf in a 600 bay', () => {
    // The negative of the same claim, and the one that would go unnoticed: a
    // shelf overhanging by 300 mm looks almost right in a screenshot.
    const built = build({ bays: 1, sizeId: 'w600', adds: { 'metal-shelf': 1 } });
    expect(partsOf(built)).not.toContain(SHELF_900);
  });
});

describe.runIf(has)('changing a width under parts that are already on', () => {
  it('re-lengths the shelves rather than refusing', () => {
    const wide = build({ bays: 1, sizeId: 'w900', adds: { 'metal-shelf': 2 } });
    expect(partsOf(wide).filter((p) => p === SHELF_900).length).toBe(3);

    const narrow = buildGuided(schema, { ...wide.choices, sizeId: 'w600' }, components);
    expect(narrow.refused).toEqual([]);
    expect(partsOf(narrow)).not.toContain(SHELF_900);
    expect(partsOf(narrow).filter((p) => p === SHELF_600).length).toBe(3);
  });

  it('keeps the same number of parts, so the bill of materials follows', () => {
    const wide = build({ bays: 2, sizeId: 'w900', adds: { 'metal-shelf': 2 } });
    const narrow = buildGuided(schema, { ...wide.choices, widths: { 0: 'w450' } }, components);
    expect(narrow.assembly.instances.length).toBe(wide.assembly.instances.length);
  });
});

// ---------------------------------------------------------------------------
// WHAT THE RUN IS, rather than what its Width control says.
//
// `built.size` is the run's width and nothing more once bays can differ. Two
// callers were still reading `built.size.adds` as though it described the
// product, and both failed silently rather than loudly - which is why they are
// pinned here by the behaviour a person would see, not by the field.

describe.runIf(has)('describing a run whose bays differ', () => {
  it('reports every bay\'s own size, in bay order', () => {
    const built = build({ bays: 3, sizeId: 'w900', widths: { 1: 'w600' } });
    expect(built.sizes.map((s) => s.id)).toEqual(['w900', 'w600', 'w900']);
  });

  it('offers a kind the wide bay can take even though the narrow one cannot', () => {
    // There is no 450 mm clothes rail in the whole range. The union is what the
    // control means, because the customer's question is "can this product take
    // a rail", and it can - in the 900 bay.
    const built = build({ bays: 2, sizeId: 'w900', widths: { 1: 'w450' } });
    expect(built.adds.map((a) => a.kind)).toContain('clothes-rail');
  });

  it('still knows a shelf has to be held at both ends in a narrow bay', () => {
    // THE FAULT THIS PINS. `mustBeHeld` came from the RUN's size, so a 600 mm
    // shelf - which is in no 900 size's add list - looked like a part with no
    // `spans` flag. The move list then offered positions holding it at one end,
    // `buildGuided` refused them on the rebuild, and the shelf sprang back to
    // where it started. Every offered position must survive the rebuild.
    const built = build({
      bays: 2, sizeId: 'w900', widths: { 1: 'w600' }, adds: { 'metal-shelf': 1 },
    });
    const extra = [...built.assembly.instances]
      .reverse()
      .find((i) => built.slots?.[i.instanceId]?.startsWith('metal-shelf#'));
    expect(extra).toBeTruthy();

    const r = moveCandidates(built, components, extra.instanceId);
    expect(r.ok).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) expect(c.held).toBe(c.heldOf);
  });

  it('names a tapped shelf by its own length, whichever bay it spans', () => {
    const built = build({ bays: 2, sizeId: 'w900', widths: { 1: 'w600' } });
    expect(addForComponent(variant, SHELF_600)?.kind).toBe('metal-shelf');
    expect(addForComponent(variant, SHELF_900)?.kind).toBe('metal-shelf');
    expect(addForComponent(variant, SHELF_450)?.spans).toBe(true);
    expect(built.sizes.find((s) => s.span.componentId === SHELF_600)).toBeTruthy();
  });
});
