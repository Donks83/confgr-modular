// Configuring without clicking in three dimensions.
//
// The editor's interaction is: pick a part, click a marker in the scene, choose
// between the two ends of the joint if it is ambiguous. It is the most capable
// way to build one of these products and it is the wrong way to hand one to a
// customer on a phone. So this module is the other interaction - a handful of
// named options, a count against each - and the ENGINE does the placing.
//
// WHAT THIS IS NOT. It is not a second attach engine, and it must never become
// one. Every candidate position here comes from `attachMatrix`, every choice
// between candidates from `distinctPlacements`, every rejection from
// `overlaps`. This file contains no geometry, no snap names and no knowledge of
// what a rung is. It is a POLICY over the engine's own answers, and that is the
// whole of the difference between it and the editor: the editor asks a person
// which candidate; this picks one and says which it picked.
//
// That distinction is the reason it is safe to have both. The session that
// built the viewer learned the same lesson three times over - two
// implementations of one idea drift - so the guided flow is deliberately
// parasitic on the machinery the editor already exercises.
//
// WHY THE OPTIONS ARE AUTHORED RATHER THAN DERIVED. It is tempting to infer
// them: group the frames by depth, the shelves by width, call everything else
// an accessory. The range makes that dangerous. Kesseboehmer's own filenames
// and descriptions carry roughly one fault per ten parts - 008533 is called a
// 1200 mm part and is 643.5 mm, 008534 is called a rail and is an extension -
// so a taxonomy read off the names would be wrong in ways nobody would notice
// until a customer received the wrong thing. The option schema is therefore
// DATA, authored once and verified against what actually loaded, exactly like
// the snap spec (SS4.2a) and for the same reason.
//
// It is also what makes this reusable. The next client's range gets its own
// schema; nothing in this file mentions YouK.

import { judge, introduced } from './judge.js';
import { DEFAULT_RULES } from './rules.js';
import {
  attachMatrix, pointsForComponent, placementsAt, distinctPlacements,
  livePoints, pointKey,
  attachAt, placeFree, mountHeightMm, whyComponentFitsNowhere,
  canMove, moveTargets, moveTo,
} from './attach.js';
import { resolveTransforms, snapSupport, productFront } from './assembly.js';
import { overlaps, boxFor } from './collision.js';
import { encodeConfiguration } from './configuration.js';
import { impliedComponentIds } from './implied.js';
import { MOUNTING, isMounting, isGrounded, FOOT, groundClearanceMm } from './ar.js';

export const GUIDED_VERSION = 1;

export class GuidedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuidedError';
  }
}

/**
 * Read an option schema, and refuse one this engine does not understand.
 *
 * Same discipline as the configuration id and the bundle manifest: a version it
 * does not know is refused BY NAME rather than half-read, because a schema is a
 * file somebody may open in two years.
 */
export function parseGuided(json) {
  if (!json || typeof json !== 'object') {
    throw new GuidedError('There is no readable option schema.');
  }
  if (json.version !== GUIDED_VERSION) {
    throw new GuidedError(
      `This option schema is version ${json.version}, and this engine reads `
      + `version ${GUIDED_VERSION}.`,
    );
  }
  if (!Array.isArray(json.variants) || !json.variants.length) {
    throw new GuidedError('An option schema needs at least one variant.');
  }
  for (const v of json.variants) {
    if (!v.id) throw new GuidedError('Every variant needs an id.');
    if (!Array.isArray(v.frames) || !v.frames.length) {
      throw new GuidedError(`Variant "${v.id}" offers no frames, so nothing can stand up.`);
    }
    if (!Array.isArray(v.sizes) || !v.sizes.length) {
      throw new GuidedError(`Variant "${v.id}" offers no sizes.`);
    }
    for (const s of v.sizes) {
      if (!s.id) throw new GuidedError(`Every size in "${v.id}" needs an id.`);
      if (!s.span?.componentId) {
        throw new GuidedError(
          `Size "${v.id}/${s.id}" names no span part, so two frames could never be joined.`,
        );
      }

      /*
       * A PART WITH NO DECLARED KIND IS ITS OWN KIND, and this default is not a
       * tidiness: without it, a schema written before kinds existed loses every
       * accessory it has.
       *
       * Adds are counted by kind now, so that "a metal shelf" can be 008562 in
       * a 600 bay and 008563 in a 900 one. Look a kind up for a part that never
       * declared one and the answer is null, the count is discarded as naming
       * nothing, and the product comes out as bare ladders - which is exactly
       * what eleven tests said when this was first written, all of them using
       * schemas with no kinds.
       *
       * Defaulting to the component id makes those schemas behave precisely as
       * they did: one part, one kind, one width. Only a schema that actually
       * declares kinds gets the new behaviour, which is the right way round.
       */
      if (!s.span.kind) s.span.kind = s.span.componentId;
      for (const a of s.adds || []) {
        if (!a.kind) a.kind = a.componentId;
      }
    }
  }
  return json;
}

/**
 * TWO DIMENSIONS, NOT ONE, and the range decides which.
 *
 * Depth is the variant: it chooses which frames exist and which of the
 * depth-matched accessories do. Width is the size within it: it chooses the
 * span and the width-matched accessories. They are separate because they are
 * separately incompatible - a 320 mm frame will not take a 200 mm hook strip,
 * and a 900 mm bay will not take a 1200 mm shoe rack - and because collapsing
 * them into one list of eight combinations would produce a control nobody could
 * read.
 *
 * The asymmetry is not ours: the 200 mm range has no metal shelf in the whole
 * 80 parts, so its span is a timber one. Authored, because no rule derived from
 * the filenames would have got that right.
 */
export function guidedComponentIds(schema, { includeImplied = true } = {}) {
  const ids = new Set();
  for (const v of schema.variants) {
    for (const f of v.frames) ids.add(f.componentId);
    // A kit's own parts - brackets, arms, clamps - ship with the bundle too,
    // or a cabinet could be chosen and never drawn.
    for (const k of Object.values(v.kits || {})) {
      for (const id of [k.brackets?.end, k.brackets?.shared, k.arm?.componentId, k.clamp?.componentId]) if (id) ids.add(id);
    }
    for (const s of v.sizes) {
      ids.add(s.span.componentId);
      for (const a of s.adds || []) ids.add(a.componentId);
    }
  }
  if (includeImplied) for (const id of impliedComponentIds()) ids.add(id);
  return [...ids].sort();
}

/** The variant a choice set names, or the first one. */
export function variantOf(schema, choices = {}) {
  const wanted = choices.variantId;
  const found = wanted ? schema.variants.find((v) => v.id === wanted) : schema.variants[0];
  if (!found) throw new GuidedError(`This product has no variant called "${wanted}".`);
  return found;
}

/** The size within a variant, or its first. */
export function sizeOf(variant, choices = {}) {
  const fallback = variant.sizes.find((s) => s.default) || variant.sizes[0];
  const wanted = choices.sizeId;
  if (!wanted) return fallback;
  // Falls back rather than throwing for the same reason the frame does:
  // switching depth with a 600 mm width chosen is a normal use of the controls,
  // and the 200 mm range does not offer 600.
  return variant.sizes.find((s) => s.id === wanted) || fallback;
}

/**
 * The size of ONE BAY, which is not necessarily the size of the run.
 *
 * Matt: "i can change the width but it changes the width of all bays". A run of
 * shelving is not one width - a bay against a chimney breast is narrower than
 * the one beside it - so a width belongs to a BAY rather than to the product.
 *
 * Keyed by POSITION, exactly like `frames` (§5.25), and for the same reason:
 * the first bay is the first bay whatever parts happen to be in it, so widening
 * bay 2 does not move a shelf somebody put in bay 1. `choices.sizeId` remains
 * the run's width and the default for any bay that has not been changed, which
 * keeps the Width control meaning what it has always meant - all of them.
 */
export function sizeAt(variant, choices = {}, bay = 0) {
  const overrideId = choices.widths?.[bay];
  if (overrideId) {
    const found = variant.sizes.find((s) => s.id === overrideId);
    if (found) return found;
  }
  return sizeOf(variant, choices);
}

/**
 * Every distinct size in a run, in bay order.
 *
 * What the bill of materials, the part list and the AR export all need: a
 * product whose bays differ references parts no single size knows about.
 */
export function sizesInRun(variant, choices = {}, bays = 1) {
  const out = [];
  for (let bay = 0; bay < bays; bay += 1) out.push(sizeAt(variant, choices, bay));
  return out;
}

/**
 * The part that a KIND becomes at a given size, or null if that size does not
 * offer it.
 *
 * The whole point of kinds. "A metal shelf" is 008563 in a 900 bay and 008562
 * in a 600 one, and with mixed widths in one run the count of shelves cannot
 * name a part number any more - only a kind. See tools/add-kinds.mjs.
 *
 * Null is a real answer rather than a failure: there is no 450 mm clothes rail,
 * so a run with a 450 bay simply cannot put a rail in that bay.
 */
export function componentForKind(size, kind) {
  if (!size || !kind) return null;
  if (size.span?.kind === kind) return size.span.componentId;
  const add = (size.adds || []).find((a) => a.kind === kind);
  return add ? add.componentId : null;
}

/**
 * The add entry that describes a part, found anywhere in the variant.
 *
 * WHICH SIZE'S LIST TO LOOK IN used not to be a question: there was one size
 * per run, so `built.size.adds` held every accessory on the product. With a
 * per-bay width that is false - a 600 bay's shelf is not in a 900 size's list
 * at all - and the two callers that asked it got the wrong answer silently:
 * `moveCandidates` lost the `spans` flag and started offering a shelf
 * positions it is only held at one end by, which `buildGuided` then refuses,
 * which is the spring-back this file already has a comment about.
 *
 * The description is a property of the KIND, not of the length, so any size
 * that offers the part gives the same answer.
 */
export function addForComponent(variant, componentId) {
  for (const size of variant?.sizes || []) {
    const found = (size.adds || []).find((a) => a.componentId === componentId);
    if (found) return found;
  }
  return null;
}

/**
 * Every part a kind can become anywhere in this variant.
 *
 * Placement needs this: a shelf is dropped on a point, and which LENGTH it has
 * to be depends on the bay that point belongs to. Rather than work the bay out
 * geometrically and then look up a part, the engine tries the candidates and
 * lets the snaps decide - a 900 shelf does not fit a 600 bay, so the geometry
 * that already refuses bad joints picks the length for free.
 */
export function componentsForKind(variant, kind) {
  const ids = [];
  for (const size of variant.sizes || []) {
    const id = componentForKind(size, kind);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The parts a control means, from either a kind or a bare part number.
 *
 * Every caller that used to hold a componentId now holds a kind, and the two
 * cannot be told apart by looking - both are strings. Rather than a flag or a
 * second argument, the variant answers: a kind resolves to parts, and anything
 * that resolves to nothing is taken at face value and used as itself. That is
 * what lets a link written before kinds existed still open.
 *
 * WIDEST FIRST, the same order `buildGuided` places in, so what the dots offer
 * and what pressing + produces cannot come out in a different sequence.
 */
export function candidatesFor(variant, kindOrComponentId) {
  if (!variant || !kindOrComponentId) return [];
  const ids = componentsForKind(variant, kindOrComponentId);
  if (!ids.length) return [kindOrComponentId];
  return ids
    .slice()
    .sort((a, b) => (widthOfComponent(variant, b) - widthOfComponent(variant, a)));
}

/**
 * The width, in millimetres, of the bay a component belongs to.
 *
 * Read off the SIZE that offers the part rather than measured, because the
 * schema already holds the answer and measuring geometry to recover a number
 * somebody wrote down is how two sources of one fact start disagreeing. Zero
 * for a part that is not width-dependent - a side rack is a side rack.
 */
export function widthOfComponent(variant, componentId) {
  const widths = [];
  for (const size of variant.sizes || []) {
    const offered = size.span?.componentId === componentId
      || (size.adds || []).some((a) => a.componentId === componentId);
    if (offered) widths.push(Number(String(size.id).replace(/\D/g, '')) || 0);
  }
  // OFFERED BY MORE THAN ONE WIDTH MEANS IT HAS NO WIDTH. The side rack appears
  // under 450, 600, 900 and 1200 alike because it hangs off a ladder rather
  // than spanning a bay. Returning the first match called it a 450 mm part,
  // which is not wrong by a little - it is a category error, and it would have
  // sorted the candidate list by a number that means nothing.
  if (widths.length !== 1) return 0;
  return widths[0];
}

/**
 * Place the first of several candidate parts that will actually go on.
 *
 * The mechanism behind "a shelf is automatically the correct length": the
 * candidates are the same kind in every width the variant offers, and the
 * winner is whichever one the joint checking accepts. If none fit, the LAST
 * failure is returned rather than the first, because the last is the narrowest
 * and its reason is the one worth reading - "there is nowhere left" rather than
 * "a 1200 shelf does not fit here", which is true of almost everywhere.
 */
export function tryCandidates(assembly, components, candidates, opts) {
  let last = null;
  for (const componentId of candidates) {
    if (!components.has?.(componentId)) continue;
    const r = autoAttach(assembly, components, componentId, opts);
    if (r.ok) return { ...r, componentId };
    last = { ...r, componentId };
  }
  return last || { ok: false, reason: 'No part of that kind fits this product.', componentId: null };
}

/**
 * The kind an add was recorded under, accepting the component id it used to be.
 *
 * URLs written before kinds existed carry `adds: {"008563-shelf-900mm...": 4}`,
 * and a bundle's whole point is that somebody can send the link. An id that is
 * no longer a key still names exactly one kind, so an old link opens as the
 * product it always described rather than as a bare frame.
 */
export function kindFromChoiceKey(variant, key) {
  if (!key) return null;
  for (const size of variant.sizes || []) {
    if (size.span?.kind && size.span.componentId === key) return size.span.kind;
    const add = (size.adds || []).find((a) => a.componentId === key || a.kind === key);
    if (add) return add.kind;
  }
  return null;
}

/**
 * The choices a schema starts on, so a runtime has something to draw before
 * anybody has touched a control.
 *
 * One bay, the first frame offered, no accessories. Deliberately the smallest
 * real product rather than an empty scene: a configurator that opens on nothing
 * has to be understood before it can be used.
 */
export function defaultChoices(schema) {
  const variant = schema.variants[0];
  // `default` rather than `[0]` throughout, so the list can stay in the order a
  // person reads it — 450, 600, 900, 1200 — while the product opens on the size
  // the range is actually known for.
  const size = variant.sizes.find((s) => s.default) || variant.sizes[0];
  const frame = variant.frames.find((f) => f.default) || variant.frames[0];
  return {
    variantId: variant.id,
    sizeId: size.id,
    frameId: frame.componentId,
    frames: {},
    // Per-bay widths, empty until somebody clicks the line between two ladders.
    // An empty map means "every bay is the run's width", which is what the
    // product has always been.
    widths: {},
    bays: variant.defaultBays ?? 1,
    adds: {},
    mounting: variant.defaultMounting || MOUNTING.FLOOR,
    footHeightMm: FOOT.heightsMm[0],
  };
}

/**
 * Clamp a choice set to what the schema actually allows.
 *
 * Called on every change rather than trusted, because these values arrive from
 * a URL as often as from a control - a bundle's whole point is that somebody
 * can send the link - and a count of -3 or a frame from the other variant would
 * otherwise reach the builder as a crash.
 */
export function normaliseChoices(schema, choices = {}) {
  const variant = variantOf(schema, choices);
  const size = sizeOf(variant, choices);
  // Falls back to the variant's own DEFAULT frame rather than erroring, because
  // the commonest way to arrive here with a frame from elsewhere is switching
  // depth with a 320 mm frame already chosen — a normal thing to do with the
  // controls, not a malformed request.
  //
  // `default` and not `[0]`: the first version fell back to the first frame in
  // the list, which for YouK is the 550 mm one, so switching depth silently
  // produced a product two rungs tall and every accessory afterwards was
  // refused for want of anywhere to go. `defaultChoices` honoured the flag and
  // this did not, which is the same fact in two places disagreeing.
  const frame = variant.frames.find((f) => f.componentId === choices.frameId)
    || variant.frames.find((f) => f.default)
    || variant.frames[0];

  const maxBays = variant.maxBays ?? 4;
  const bays = Math.max(1, Math.min(maxBays, Math.round(Number(choices.bays) || 1)));

  // WHICH BAY IS HOW WIDE. Bounded by the bays the run actually has and by the
  // sizes this variant offers, so reducing the bays drops the widths that no
  // longer refer to anything and switching depth cannot leave a 600 recorded
  // against a range that has no 600. An entry equal to the run's width is
  // dropped rather than stored, for the same reason a frame override is: the
  // Width control means "all of them", and a stored duplicate would sit there
  // contradicting it the moment somebody used it.
  const widths = {};
  for (const [key, id] of Object.entries(choices.widths || {})) {
    const bay = Number(key);
    if (!Number.isInteger(bay) || bay < 0 || bay >= bays) continue;
    if (!variant.sizes.some((s) => s.id === id)) continue;
    if (id === size.id) continue;
    widths[bay] = id;
  }

  // ADDS ARE COUNTED BY KIND, not by part number, because with two widths in
  // one run a part number stops naming a choice: "four extra metal shelves" is
  // four shelves whose LENGTHS depend on where they land. See
  // tools/add-kinds.mjs for why the kinds are in the schema rather than
  // inferred.
  //
  // An old key is accepted and converted. A bundle's whole point is that
  // somebody can send the link, and every URL written before today carries
  // `adds` keyed by component id - which still names exactly one kind, so those
  // links open as the product they always described.
  const kindsHere = new Map();
  for (const s of sizesInRun(variant, { ...choices, widths }, bays)) {
    for (const a of s.adds || []) if (!kindsHere.has(a.kind)) kindsHere.set(a.kind, a);
  }

  const adds = {};
  for (const [key, value] of Object.entries(choices.adds || {})) {
    const kind = kindFromChoiceKey(variant, key);
    const spec = kind ? kindsHere.get(kind) : null;
    // A kind no bay in this run can take is dropped rather than carried: with
    // every bay at 450 there is no clothes rail to count.
    if (!spec) continue;
    const asked = Math.round(Number(value) || 0);
    // `max` is per bay where the schema says so: one shoe rack per bay is a
    // sensible ceiling and one shoe rack per product is not, and the difference
    // only appears once somebody asks for three bays.
    const ceiling = spec.perBay ? (spec.max ?? 1) * bays : (spec.max ?? 4);
    const n = Math.max(0, Math.min(ceiling, asked));
    if (n > 0) adds[kind] = Math.max(adds[kind] || 0, n);
  }

  // A mounting the variant does not offer is read as its default (A1 F04): a
  // link asking for 200 mm ladders on feet opens standing on the floor, because
  // those ladders have no fixing for a foot.
  const mountingAsked = isMounting(choices.mounting) ? choices.mounting : MOUNTING.FLOOR;
  const offered = variant.mountings?.length ? variant.mountings : null;
  const mounting = !offered || offered.includes(mountingAsked)
    ? mountingAsked : (offered.includes(variant.defaultMounting) ? variant.defaultMounting : offered[0]);
  const footHeightMm = FOOT.heightsMm.includes(choices.footHeightMm)
    ? choices.footHeightMm : FOOT.heightsMm[0];

  // WHICH LADDER STANDS WHERE. Kept only for positions the run actually has,
  // and only for frames this variant offers - switching depth must not leave a
  // 320 mm ladder recorded against position 2 of a 200 mm run. An entry equal
  // to the global choice is dropped rather than stored, so "make them all
  // 905 mm" leaves nothing behind to contradict it later.
  const frames = {};
  for (const [key, id] of Object.entries(choices.frames || {})) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > bays) continue;
    if (id === frame.componentId) continue;
    if (!variant.frames.some((f) => f.componentId === id)) continue;
    frames[index] = id;
  }

  // Remembered positions, kept only for slots that still exist. A count going
  // from 3 to 1 must not leave a position recorded for the third one: it would
  // come back if the count went up again, which is a product changing shape
  // because of something the person did and then undid.
  const at = {};
  for (const [key, ref] of Object.entries(choices.at || {})) {
    if (!ref || typeof ref !== 'object') continue;
    // A KIT's record is the BAY it stands in (a cabinet, a desk), not a snap:
    // the kit places its own brackets, so the bay is the whole of the choice.
    const bayRecord = Number.isInteger(ref.bay) && ref.bay >= 0 && ref.bay < bays;
    if (!bayRecord && (!ref.instanceId || !ref.snapId)) continue;

    const kept = bayRecord ? { bay: ref.bay } : {
      instanceId: String(ref.instanceId),
      snapId: String(ref.snapId),
    };
    // Which of the part's own snaps mates. Optional, because most parts have
    // one sensible mount and every record written before it existed omits it.
    if (ref.mountSnapId) kept.mountSnapId = String(ref.mountSnapId);
    // The SLOT the record hangs from (A2 §4). Kept here or the whole of the
    // address fix is undone on the way in - the same silent drop §5.26 found
    // for span records.
    if (ref.slot && /^[\w.-]+#\d+$/.test(String(ref.slot))) kept.slot = String(ref.slot);

    // A FRAME SLOT is a position in the run, not a copy of a component, so it
    // is bounded by the bay count rather than by an accessory's count. Position
    // 0 is the anchor and has no recorded height - it stands on the floor by
    // definition - so a record against it is dropped rather than honoured.
    if (isFrameSlot(key)) {
      const index = frameIndexOf(key);
      if (!Number.isInteger(index) || index < 1 || index > bays) continue;
      at[key] = kept;
      continue;
    }

    // A SPAN SLOT is a bay, so it is bounded by the bay count too. Without this
    // branch it fell through to the accessory rule below, where the count of a
    // kind called "span" is zero and every record was dropped on the way in -
    // silently, which is how a move can be recorded, accepted, and have no
    // effect at all. That is exactly what happened the first time this was
    // wired up: the shelf went back to the bottom rung with nothing reported.
    if (isSpanSlot(key)) {
      const bay = spanBayOf(key);
      if (!Number.isInteger(bay) || bay < 0 || bay >= bays) continue;
      at[key] = kept;
      continue;
    }

    const hash = key.lastIndexOf('#');
    if (hash < 0) continue;
    const index = Number(key.slice(hash + 1));
    if (!Number.isInteger(index) || index < 0) continue;

    // The slot names a KIND now. An old record names the component it was, and
    // is rewritten rather than dropped - otherwise sending somebody a link to a
    // product with a moved shelf would deliver the shelf back at the bottom.
    const was = key.slice(0, hash);
    const kind = kindFromChoiceKey(variant, was) || was;
    if (index >= (adds[kind] || 0)) continue;
    at[slotKeyFor(kind, index)] = kept;
  }

  return {
    variantId: variant.id,
    sizeId: size.id,
    frameId: frame.componentId,
    frames,
    widths,
    bays,
    adds,
    at,
    mounting,
    footHeightMm,
  };
}

/**
 * Every position an already-placed accessory could legally take.
 *
 * Built on the EDITOR's own move machinery - `canMove`, `moveTargets`,
 * `moveTo` - because re-hanging a part is exactly the operation the editor
 * already performs and a second implementation of it would drift. What this
 * adds is the checking: each candidate is tried by actually making the move on
 * a copy and surveying the result, so an offered position is one that survives
 * the rebuild.
 *
 * THE SAME RULE PLACEMENT USES. A part the schema calls spanning has to be held
 * at both ends. Without this the move list offered positions that `buildGuided`
 * then refused - so the recorded position was dropped and the part sprang back.
 * Two paths asking different questions about the same thing is exactly how "an
 * offered option works" stops being true.
 *
 * Structural parts - the frames and the spans - are not slots and say so.
 * Moving one would take the run apart.
 *
 * EXTRACTED so that `moveOptions` and `movePoints` cannot disagree. They are
 * two views of one answer: a list of heights for a panel, and a set of dots for
 * the scene. When the dots arrived (§5.25) the obvious thing was to write a
 * second filtered query for them, which is the mistake this project has now
 * made four times.
 */
export function moveCandidates(built, components, instanceId) {
  const slot = built.slots?.[instanceId] || null;
  const instance = built.assembly.instances.find((i) => i.instanceId === instanceId);
  if (!instance) return { ok: false, reason: 'That part is not on this product.', candidates: [] };

  // THREE KINDS OF PART, and they answer differently.
  //
  //   an accessory  - move it, remove it
  //   a ladder      - change its type, change the height it hangs at
  //   a span        - move it; it IS the bay, so it cannot be removed
  //
  // Frames used to fall in with the spans and say "that is part of the frame,
  // change the size or the number of bays instead". Matt asked for the thing
  // that answer refused, so a frame is now its own kind - and then he asked for
  // it again about the shelf: "i cant select what height i want the starter
  // shelf to be, its always on the bottom".
  //
  // So a span MOVES like anything else and is refused only where the refusal is
  // true: it cannot be removed, because a bay with nothing joining its ladders
  // is not a bay. `canDelete` in the panel is what carries that, and the third
  // branch here is a part with no slot at all - something on the product that
  // no choice produced, which should not happen and is not a thing to offer
  // moves for if it does.
  const kind = isFrameSlot(slot) ? 'frame' : (isSpanSlot(slot) ? 'span' : (slot ? 'add' : null));

  if (!kind) {
    return {
      ok: false,
      slot: null,
      kind: 'unknown',
      structural: true,
      reason: 'That part is not one this product knows how to change.',
      candidates: [],
    };
  }

  // A KIT moves as a whole or not at all: its brackets were chosen for the
  // bay it is in. Removing it is offered; moving it is "add it to another bay".
  if (slot && built.kits?.has(slot)) {
    return {
      ok: false, slot, kind: 'add', kit: true, componentId: instance.componentId,
      reason: 'This comes with the brackets it sits on. To have it in another bay, remove it and add it again.',
      candidates: [],
    };
  }

  const { transforms } = resolveTransforms(built.assembly, components);
  const allowed = canMove(built.assembly, instanceId);
  if (!allowed.ok) {
    // The anchor. Its height is not a choice - the whole product is measured
    // from it - but its TYPE still is, which is why this carries `kind` rather
    // than reading as a flat refusal.
    return {
      ok: false,
      slot,
      kind,
      anchor: allowed.reason === 'is-anchor',
      componentId: instance.componentId,
      reason: kind === 'frame' && allowed.reason === 'is-anchor'
        ? (isGrounded(built.mounting)
          ? 'This is the ladder the run stands on, so it stays on the floor. Its type can still change.'
          : 'This is the ladder the run is measured from, so its position is fixed. Its type can still change.')
        : 'That part cannot be moved.',
      candidates: [],
    };
  }

  const { placements } = moveTargets(built.assembly, components, transforms, instanceId, {});
  const mine = placements.filter((p) => p.componentId === instance.componentId);
  const here = transforms.get(instanceId);

  // ASKED OF THE VARIANT, not of the run's size. A 600 bay's shelf is not in a
  // 900 size's add list, so with mixed widths this used to come back null and
  // `mustBeHeld` false - and a spanning shelf was then offered positions where
  // only one end is held, which `buildGuided` refuses. The part springs back
  // and the person sees a control that lied. See addForComponent.
  const add = addForComponent(built.variant, instance.componentId);
  const mustBeHeld = !!add?.spans;

  // NOTHING BELOW THE FLOOR.
  //
  // The first version of the ladder height list offered −1305, −710, −355 and 0
  // mm. All four are legal joints - a ladder mates a span by any of its own
  // rungs, and mating by a high rung hangs the ladder down - and three of them
  // put most of the ladder underground. Legal is not the same as offerable, and
  // this is the second time that distinction has cost a round.
  //
  // Measured from the ANCHOR's base, because for a grounded product that IS the
  // floor: the product's origin is the anchor frame's base centre, which is why
  // the AR export rebases from it. On a wall-mounted product there is no floor
  // and hanging lower is a real option, so the limit simply does not apply.
  const anchorId = built.assembly.instances[0]?.instanceId;
  // The real floor: on feet, the bottom of the foot (see judge.js).
  const floorY = isGrounded(built.mounting) && anchorId
    ? (transforms.get(anchorId)?.translation[1] ?? 0) - groundClearanceMm(built.mounting, built.footHeightMm) / 1000
    : null;
  const FLOOR_TOLERANCE_M = 0.001;

  const candidates = [];
  for (const placement of distinctPlacements(built.assembly, components, mine)) {
    let moved;
    try {
      moved = moveTo(built.assembly, instanceId, placement);
    } catch {
      continue;
    }
    const s = survey(moved, components, instanceId, instance.componentId);
    if (!s) continue;
    if (mustBeHeld && s.met < s.total) continue;
    if (floorY !== null && s.worldY < floorY - FLOOR_TOLERANCE_M) continue;
    // The same judge the build used, so an offered move is one the rebuild keeps.
    if (built.judgeMove && built.judgeMove(built.assembly, moved).length) continue;

    const t = s.transforms.get(instanceId);
    candidates.push({
      point: placement.point,
      // The pose the part would take, kept rather than recomputed. The editor
      // asks the engine again to draw its drag preview; this already knows,
      // because the candidate was only accepted by making the move and looking
      // at the result.
      pose: t,
      at: {
        instanceId: placement.point.instanceId,
        // The SLOT it hangs from, so the record survives a rebuild that numbers
        // instances differently (A2 §4).
        slot: built.slots?.[placement.point.instanceId] || null,
        snapId: placement.point.snapId,
        // Two candidates can share a point and differ only by which of the
        // part's own snaps mates - which for a ladder is the difference between
        // standing on the floor and hanging halfway up.
        mountSnapId: placement.mountSnapId || null,
      },
      heightMm: Math.round(s.worldY * 1000),
      sideways: here ? Math.abs(t.translation[0] - here.translation[0]) : 0,
      current: here
        ? Math.abs(t.translation[1] - here.translation[1]) < 0.0005
          && Math.abs(t.translation[0] - here.translation[0]) < 0.0005
        : false,
      held: s.met,
      heldOf: s.total,
    });
  }

  return {
    // `kind` on EVERY path, including this one. It was on the three early
    // returns and not on the success return, so a ladder that could be moved
    // came back as kind undefined - and the panel, which decides what to offer
    // from it, showed a middle ladder as a nameless accessory with "Remove this
    // one" underneath. The anchor looked right because its answer came from an
    // early return, which is exactly how a partial change survives a test run.
    ok: true, slot, kind, componentId: instance.componentId, candidates,
  };
}

/**
 * The same answer as a list of DISTINCT HEIGHTS, for a panel.
 *
 * Kept because it is still the right control on a phone where a drag across a
 * 3D view with a thumb is fiddly, and because it is what `MovePanel` renders.
 * One entry per height, and where several positions share one, the nearest to
 * where the part already is - so "move it up" does not also slide it into the
 * next bay.
 */
export function moveOptions(built, components, instanceId) {
  const r = moveCandidates(built, components, instanceId);
  if (!r.ok) return { ...r, options: [] };

  const byHeight = new Map();
  for (const c of r.candidates) {
    const existing = byHeight.get(c.heightMm);
    if (!existing || c.sideways < existing.sideways) {
      byHeight.set(c.heightMm, {
        heightMm: c.heightMm,
        sideways: c.sideways,
        at: c.at,
        current: c.current,
        held: c.held,
        heldOf: c.heldOf,
      });
    }
  }

  return {
    ok: true,
    slot: r.slot,
    kind: r.kind,
    componentId: r.componentId,
    options: [...byHeight.values()].sort((a, b) => a.heightMm - b.heightMm),
  };
}

/**
 * The same answer as a set of DOTS, for the scene.
 *
 * This is what Matt asked for: "you can click and drag to change its
 * location". Every position, not one per height - a drag is a gesture in three
 * dimensions and collapsing the targets to heights would put two dots in the
 * same place and drop the one the person aimed at.
 *
 * Each dot carries the point the engine produced, so the drop can be recorded
 * as `{instanceId, snapId}` against the slot without asking a second question.
 */
export function movePoints(built, components, instanceId) {
  const r = moveCandidates(built, components, instanceId);
  if (!r.ok) return [];
  const seen = new Set();
  const out = [];
  for (const c of r.candidates) {
    const key = pointKey(c.point);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.point);
  }
  return out;
}

/**
 * Where one MORE of a component could go.
 *
 * The add flow's half of the same idea: green dots for "a new one can go here",
 * amber for "the one in your hand can land here". Asked of `attachMatrix` and
 * narrowed by `pointsForComponent`, which is what the editor's part-first flow
 * does - a 3x2 pouch legitimately offers fewer dots than a 1x1 one, and that is
 * the useful behaviour rather than a special case.
 */
export function addPoints(built, components, kind) {
  if (!built?.assembly || !components?.size || !kind) return [];
  try {
    // THE UNION OF EVERY LENGTH THE KIND CAN BE, because "where can a metal
    // shelf go" in a run of a 900 bay and a 600 one is both bays, answered by
    // two different part numbers. Asking about one length would light up half
    // the product and quietly lose the other half.
    const catalogue = candidatesFor(built.variant, kind);
    const { transforms } = resolveTransforms(built.assembly, components);
    const matrix = attachMatrix(built.assembly, components, catalogue, transforms);
    const allowed = new Set();
    for (const id of catalogue) {
      for (const p of pointsForComponent(matrix, id)) allowed.add(p.pointKey);
    }
    // A DOT IS A PROMISE (A1 F08, F09). The matrix says what could JOIN here;
    // the rebuild also asks whether it is held, clashes, or breaks a rule - and
    // when it said no, the part went somewhere else and the dot had lied. So a
    // dot is offered only where placing this kind there is what the rebuild
    // would actually keep: the same tryCandidates, narrowed to the point, with
    // the same judge.
    const add = (built.adds || []).find((a) => a.kind === kind);
    return livePoints(matrix).filter((p) => {
      if (!allowed.has(pointKey(p))) return false;
      const r = tryCandidates(built.assembly, components, catalogue, {
        instanceId: '__dot', catalogue, policy: PLACE.FILL, requireFullyHeld: !!add?.spans, judge: built.judge, at: p,
      });
      return r.ok && r.point.instanceId === p.instanceId && r.point.snapId === p.snapId;
    });
  } catch {
    return [];
  }
}

/**
 * The top-front corner of a placed part, in world space.
 *
 * Where a dimension line hangs off. The box is ORIENTED - a part is yawed to
 * face its joint - so the extent along a world direction is the sum of its own
 * three half-extents projected onto that direction, which is the same
 * arithmetic `overlapDepth` does one axis at a time.
 */
function topFrontOf(box, front) {
  if (!box) return null;
  const along = (dir) => Math.abs(box.axes[0][0] * dir[0] + box.axes[0][1] * dir[1] + box.axes[0][2] * dir[2]) * box.half[0]
    + Math.abs(box.axes[1][0] * dir[0] + box.axes[1][1] * dir[1] + box.axes[1][2] * dir[2]) * box.half[1]
    + Math.abs(box.axes[2][0] * dir[0] + box.axes[2][1] * dir[1] + box.axes[2][2] * dir[2]) * box.half[2];

  const up = along([0, 1, 0]);
  const out = along(front);
  return [
    box.centre[0] + front[0] * out,
    box.centre[1] + up,
    box.centre[2] + front[2] * out,
  ];
}

/**
 * The line between each pair of neighbouring ladders, and what it can be set to.
 *
 * Matt: "can we have a marker similar to the hot spot dots that is a line
 * connecting two neighbouring ladders that you can click to choose the spacing
 * between those ladders".
 *
 * THE CONTROL IS WHERE THE THING IS. A width control in a panel has to say
 * which bay it means, and in a run of four the answer is a number somebody has
 * to map onto the product in front of them. A line drawn between the two
 * ladders it governs does not have that problem: it is the bay, and tapping it
 * is unambiguous even when three bays are already different widths.
 *
 * DRAWN ALONG THE TOP AND AT THE FRONT rather than through the middle of the
 * bay, because the middle of the bay is where the shelves are. Read off the
 * ladders' own oriented boxes, so it follows a product that has been turned
 * round in AR instead of assuming which way is out of the screen.
 *
 * `centresMm` is MEASURED - the distance between the two ladders as they
 * actually stand - and it is not the size's label. A YouK 900 bay puts its
 * ladders at 920.1 mm centres because the shelf overhangs; that difference is
 * real, and quietly printing "900" over a measurement would be inventing a
 * number. The control shows the size's own label; this is here for anyone who
 * needs the geometry.
 */
export function baySpacings(built, components) {
  if (!built?.assembly || !components?.size || !built.variant) return [];

  let transforms;
  try { ({ transforms } = resolveTransforms(built.assembly, components)); } catch { return []; }

  // Null when nothing in the range declares a front, and then the line is drawn
  // on the room side of z, which is where this range's fronts point anyway.
  const front = productFront(built.assembly, components, transforms) || [0, 0, -1];

  // BY POSITION IN THE RUN, from the slot rather than from the order of the
  // instances: a frame's slot is `frame#n` precisely so that the nth ladder
  // stays the nth ladder whatever type is standing there.
  const anchors = [];
  for (const instance of built.assembly.instances) {
    const index = frameIndexOf(built.slots?.[instance.instanceId]);
    if (index == null) continue;
    const point = topFrontOf(
      boxFor(components.get(instance.componentId), transforms.get(instance.instanceId)),
      front,
    );
    if (point) anchors[index] = point;
  }

  const options = built.variant.sizes.map((s) => ({ id: s.id, label: s.label }));
  const out = [];
  const sizes = built.sizes || [];
  for (let bay = 0; bay < sizes.length; bay += 1) {
    const from = anchors[bay];
    const to = anchors[bay + 1];
    // A bay whose far ladder was refused has no line. Better than a line to
    // nowhere: the run is already reporting why in `refused`.
    if (!from || !to) continue;

    const size = sizes[bay];
    out.push({
      bay,
      sizeId: size.id,
      label: size.label,
      centresMm: Math.round(
        Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) * 1000,
      ),
      from,
      to,
      midpoint: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      facing: front,
      options: options.map((o) => ({ ...o, current: o.id === size.id })),
    });
  }
  return out;
}

/**
 * Which of a component's copies this is — "the second clothes rail".
 *
 * THE STATE PROBLEM, AND ITS ANSWER. A guided configurator's state is counts:
 * two shelves, one rail. A count cannot say "the rail is on the fourth rung",
 * so as soon as anything is movable the counts stop describing the product.
 *
 * The fix is a SLOT: the nth copy of a component, in the schema's own order,
 * which is also the order `buildGuided` places them. `choices.at[slotKey]`
 * records where that slot was put, and everything else follows:
 *
 *   the whole product stays a pure function of the choices, so the URL and the
 *   configuration id keep round-tripping exactly as they did;
 *   a move is an edit to one entry rather than a new kind of state;
 *   changing a count of one accessory cannot disturb another's position.
 *
 * The alternative was to let a move edit the assembly directly and keep that
 * assembly as the state. That works until the next option change regenerates
 * it, and then every move has to be re-matched onto a product that has moved
 * on. Recording the intent rather than the outcome avoids the whole class.
 */
export const slotKeyFor = (componentId, index) => `${componentId}#${index}`;

/**
 * The slot for the nth FRAME in the run, counting the anchor as zero.
 *
 * Deliberately not `slotKeyFor(componentId, n)`. An accessory slot is "the nth
 * clothes rail", so its key carries the component - which is right, because
 * changing the count of rails must not disturb the shelves. A frame slot is
 * "the second position in the run", and the whole point of the change is that
 * the component AT that position can be swapped. Keying it by component would
 * mean changing a ladder's type moved its recorded height to a different slot,
 * and the ladder would jump.
 */
export const frameSlotFor = (index) => `frame#${index}`;

/** Is this slot a position in the run rather than a copy of an accessory? */
export const isFrameSlot = (slot) => typeof slot === 'string' && slot.startsWith('frame#');

/** Which position in the run, or null. */
export const frameIndexOf = (slot) => (isFrameSlot(slot) ? Number(slot.slice('frame#'.length)) : null);

/**
 * The slot for the SHELF THAT MAKES a bay - the one joining its two ladders.
 *
 * Matt: "the bay does need a shelf but ... i cant select what height i want the
 * starter shelf to be, its always on the bottom".
 *
 * It was not a slot at all before, which is why it could not move: it was
 * placed, the run was built on top of it, and nothing recorded where it went
 * because there was nothing to record. Keyed by POSITION for the same reason a
 * frame is - changing the bay's width changes the PART, and it is still that
 * bay's shelf, so keying it by component would lose the height every time the
 * spacing changed.
 *
 * It is not an accessory slot either, and the difference is deletion: a bay
 * with nothing joining its ladders is not a bay. See `moveCandidates`.
 */
export const spanSlotFor = (bay) => `span#${bay}`;

/** Is this slot the shelf that makes a bay? */
export const isSpanSlot = (slot) => typeof slot === 'string' && slot.startsWith('span#');

/** Which bay's span, or null. */
export const spanBayOf = (slot) => (isSpanSlot(slot) ? Number(slot.slice('span#'.length)) : null);

/**
 * The builder's name for a part that was drawn from a configuration id.
 *
 * TWO ID SPACES, and they are not the same one. `buildGuided` names its
 * instances g1, g2, g3...; the runtime draws the product by RESOLVING a
 * configuration id, and `decodeConfiguration` names what it reads p0, p1,
 * p2... So a customer tapping a part in the scene produces a `p` id, and asking
 * the builder about it got "that part is not on this product" - which was true,
 * and useless.
 *
 * The two are aligned by ORDER: the id records instances in the order they were
 * built and decoding preserves it. That is the invariant this depends on, so it
 * is asserted in a test of its own rather than left as a thing that happens to
 * work - if the encoder ever sorted or de-duplicated, every move would silently
 * address the wrong part.
 *
 * Index alignment rather than matching on componentId, because a product with
 * three identical shelves has three parts that match equally well and only
 * their positions tell them apart.
 */
export function builderIdOf(built, drawnAssembly, drawnInstanceId) {
  const index = (drawnAssembly?.instances || [])
    .findIndex((i) => i.instanceId === drawnInstanceId);
  if (index < 0) return null;

  const mine = built.assembly.instances[index];
  // A sanity check that costs nothing and catches the alignment breaking: the
  // two must at least agree about what KIND of part this is.
  if (!mine || mine.componentId !== drawnAssembly.instances[index].componentId) return null;
  return mine.instanceId;
}

/**
 * Would adding this part put two solid things through one another?
 *
 * The engine's own collision survey, asked about a hypothetical - and asked
 * with the judgement it already makes rather than a new one. Two conditions,
 * and getting either wrong makes the whole guided flow useless:
 *
 *   `joined`   a shelf and the frame it plugs into are MEANT to interpenetrate.
 *   `through`  an unjoined contact is only a fault if one part did not stop.
 *
 * THE SECOND ONE IS THE WHOLE LESSON OF SS5.17, ARRIVING AGAIN. The first
 * version of this refused every unjoined overlap, and that refused almost
 * everything: a span part is joined to ONE frame and physically laps the other
 * by exactly the frame's width - measured at 29.4 mm on a 30 mm stile - because
 * the connection graph is a tree and the product is not. A clothes rail hung in
 * a built bay had twelve candidate positions and every one was rejected for
 * doing precisely what a clothes rail does.
 *
 * `describeOverlap` already tells laps and pass-throughs apart geometrically -
 * an overlap deeper than the thinner part's own extent means one part went
 * through - and the desk that ran through a ladder reads 57.05 mm on a 30 mm
 * frame. So the policy here is not a threshold and not a special case: it is
 * the survey's own verdict, consumed rather than re-derived.
 */
function survey(assembly, components, instanceId, componentId) {
  let transforms;
  try {
    ({ transforms } = resolveTransforms(assembly, components));
  } catch {
    // A hypothetical that will not even resolve is not a candidate.
    return null;
  }

  if (overlaps(assembly, components, transforms).some((o) => !o.joined && o.through)) {
    return null;
  }

  const support = snapSupport(assembly, components, transforms, instanceId);

  // A part in the same place as another of the same part is not a
  // configuration, and no overlap rule catches it: two coincident frames lap
  // each other by exactly their own width, which reads as a lap rather than as
  // a pass-through - correctly, since neither went through anything. Caught
  // here by position instead, because "the same thing twice in one place" is a
  // statement about the product rather than about geometry.
  const here = transforms.get(instanceId);
  for (const other of assembly.instances) {
    if (other.instanceId === instanceId || other.componentId !== componentId) continue;
    const t = transforms.get(other.instanceId);
    if (!t || !here) continue;
    const apart = Math.hypot(
      t.translation[0] - here.translation[0],
      t.translation[1] - here.translation[1],
      t.translation[2] - here.translation[2],
    );
    if (apart < 0.001) return null;
  }

  return {
    transforms,
    // IS IT HELD AT BOTH ENDS - asked of the part's own mounting points rather
    // than of its bounding box. `snapSupport` counts the snaps that landed on
    // something compatible, by the graph or by geometry, so a span between two
    // frames comes back 2 of 2 and the same span off the end of a run 1 of 2.
    //
    // THIS WAS MEASURED THE WRONG WAY TWICE. First by counting unjoined box
    // overlaps, which made a cantilevered shelf score as well as a spanning one
    // - because two shelves at the same height either side of one frame meet
    // INSIDE it and lap each other by exactly its width, indistinguishable from
    // a shelf lapping the frame that carries it. Then by excluding laps against
    // more of the same part, which fixed YouK and silently read zero everywhere
    // on the synthetic rack, whose spans butt flush instead of lapping. A 900 mm
    // YouK shelf is 950.2 mm wide across a 920.1 mm gap; that 15 mm a side is a
    // fact about this range's tolerances, not about what holds a shelf up.
    //
    // The snaps were the right question from the start.
    ...support,
    // WHERE IT ENDED UP, in the world, which is not the same question as how
    // far up the arriving part its own snap sits. `mountHeightMm` is the right
    // LABEL for a person choosing between two placements - it is what the
    // editor's chooser shows - and it is useless as a tie-break here, because
    // every rung on a frame offers the span the same one. Ranking on it left
    // the second bay of a two-bay run 355 mm off the floor, level with nothing.
    worldY: here ? here.translation[1] : 0,
  };
}

/**
 * The two things a guided step can be trying to do. They want opposite
 * placements, and one rule cannot serve both.
 *
 * EXTEND grows the product: the next bay's span has to go on the run's FREE
 * end, so it wants the candidate that meets the least. Given the choice between
 * hanging off the end and dropping back inside the bay it just built, a
 * "well-supported" rule picks the second and the run folds back on itself
 * instead of getting longer.
 *
 * FILL puts something into the product that is already there: an extra shelf
 * belongs between two frames, not cantilevered off the outside of the end one.
 * It wants the candidate that meets the MOST - a part held at both ends.
 *
 * Both read the same number off the same survey and only disagree about its
 * sign, which is why they are two constants rather than two algorithms. The
 * first version of this had only the FILL behaviour by accident, and asking for
 * four extra shelves in a one-bay product put two of them inside the bay and
 * two sticking out of the sides.
 */
export const PLACE = { EXTEND: 'extend', FILL: 'fill' };

/**
 * Put one part on the product, in the best place the engine offers.
 *
 * BEST, not first. Every candidate is attached to a copy, resolved, and
 * surveyed; the ones that put something through something else - or duplicate a
 * part in place - are discarded, and the rest are ranked by the policy and then
 * lowest-first. Lowest-first is what makes repetition work: the first shelf
 * takes the bottom rung, so the second finds it occupied and goes up. Nothing
 * counts rungs, and nothing here knows what a rung is.
 *
 * `prefer` names an instance whose points win outright when any of them works.
 * That is what keeps a run straight: bay 3's span must grow from the frame bay
 * 2 added, and a global ranking would happily put it back in bay 1.
 */
export function autoAttach(assembly, components, componentId, {
  instanceId, catalogue = null, prefer = null, policy = PLACE.FILL,
  requireFullyHeld = false, explain = false, at = null, kin = null,
  judge = null, order = 'lowest', avoid = null,
} = {}) {
  const list = catalogue || [componentId];

  let transforms;
  try {
    ({ transforms } = resolveTransforms(assembly, components));
  } catch (err) {
    return { ok: false, reason: `This product cannot be resolved: ${err.message}` };
  }

  const matrix = attachMatrix(assembly, components, list, transforms);
  let points = pointsForComponent(matrix, componentId);

  if (!points.length) {
    return {
      ok: false,
      reason: whyComponentFitsNowhere(matrix, componentId)
        || 'There is nowhere on this product for that part.',
    };
  }

  // A REMEMBERED POSITION, from somebody having moved this part. Narrow the
  // candidates to that one point and let everything below run unchanged, so a
  // recorded position is still checked for clashes and support rather than
  // trusted: the product may have changed shape since it was recorded.
  //
  // Refused rather than silently auto-placed if the point has gone - reducing
  // the bays can remove the frame a rail was hung on - because the caller has
  // to know its record is stale in order to drop it.
  // POINTS A MOVED PART IS WAITING FOR (A3, sweep I5). A part the customer put
  // somewhere wins over one the policy is placing, so auto-placement goes round
  // the points recorded parts still have to take, rather than taking one first
  // and leaving the moved part to be dropped.
  if (!at && avoid?.size) {
    points = points.filter((p) => !avoid.has(`${p.point.instanceId}::${p.point.snapId}`));
  }
  if (at) {
    points = points.filter(
      (p) => p.point.instanceId === at.instanceId && p.point.snapId === at.snapId,
    );
    if (!points.length) {
      return { ok: false, stale: true, reason: 'That position is no longer part of this product.' };
    }
  }

  // WHICH OF ITS OWN RUNGS IT MATES BY, when the record says.
  //
  // A point is not always a position. A frame offered at a span's free end fits
  // by ANY of its own rungs - eight of them on a 2210 - and every one of those
  // is the same point on the same span, so `{instanceId, snapId}` cannot tell
  // them apart. That is precisely the difference between a frame standing on the
  // floor and the same frame hung halfway up, which is the staggered layout in
  // Kesseboehmer's photography and what Matt asked for: "change what height it
  // sits at".
  //
  // Optional, and absent means "any" - so every record written before this
  // existed still resolves, and an accessory with one sensible mount never has
  // to carry it.
  const wantMount = at?.mountSnapId || null;

  // LEVEL WITH THE ONES ALREADY THERE - the tie-break that actually matters,
  // and the third one tried.
  //
  // A part arriving at a point has a real choice of height, because the solver
  // may mate it by any of its own snaps: a second frame offered at a shelf's
  // free end fits by any of its eight rungs, which is the staggered layout in
  // Kesseboehmer's own photography and the reason the editor asks. Left to
  // "lowest world height" the frame mates by its TOP rung and dangles 1305 mm
  // below the floor - a legal product, and not one anybody asked for.
  //
  // So the target is the height of the last part of the same KIND already on
  // the product. Frames come out level with the frames, spans level with the
  // spans, and a run stays a run. With nothing of that kind there yet there is
  // nothing to be level with, and the next tie-break takes over.
  //
  // KIND, NOT PART NUMBER, and that distinction was worth a second round of
  // this bug. "Same component" was fine while every frame in a run was the same
  // article, and Matt then asked for the thing it could not do: "is it possible
  // to be able to add ladders of different types to mix and match?" A 905 mm
  // frame arriving next to a 668 mm one has no part of its own component on the
  // product, so it found nothing to be level with, fell through to
  // lowest-world-height, mated by its TOP rung and hung 709.5 mm BELOW THE
  // FLOOR. Every pair of heights did it; the geometry was fine and the policy
  // was choosing the worst legal answer.
  //
  // `kin` is the set of component ids that count as the same kind, and it comes
  // from the SCHEMA - the variant's own list of frames - because that is where
  // "these are all ladders" is written down. Deriving it from geometry would be
  // guessing, and this file is not allowed to know what a rung is.
  const isKin = kin ? (id) => kin.has(id) : (id) => id === componentId;

  const levelTarget = (() => {
    for (let i = assembly.instances.length - 1; i >= 0; i -= 1) {
      if (!isKin(assembly.instances[i].componentId)) continue;
      const t = transforms.get(assembly.instances[i].instanceId);
      if (t) return t.translation[1];
    }
    return null;
  })();

  let tried = 0;
  let judged = null;
  const scored = [];

  for (const point of points) {
    const key = `${point.point.instanceId}::${point.point.snapId}`;
    const candidates = distinctPlacements(
      assembly, components, placementsAt(matrix, key, componentId),
    );

    for (const placement of candidates) {
      if (wantMount && placement.mountSnapId !== wantMount) continue;
      tried += 1;
      const next = attachAt(assembly, placement, instanceId);
      const s = survey(next, components, instanceId, componentId);
      if (!s) continue;
      // A part the schema calls spanning has to be HELD AT BOTH ENDS, so a
      // position where it meets nothing but the frame it plugs into is not a
      // position at all. Without this, a fourth shelf asked for in a bay with
      // three free rungs was cantilevered off the outside of the run - legal,
      // buildable, and not what anybody meant by "four shelves".
      //
      // The one-ended accessories - a side rack, a depth hook strip, a YouboXx
      // set - are exactly the parts the schema does not mark, and they keep
      // working because the requirement is per part rather than global.
      if (requireFullyHeld && s.met < s.total) continue;
      // THE JUDGE (A2 §3): does putting THIS here break a rule - under the floor,
      // a span held at one end, two parts in one space. Asked of the hypothetical
      // product, so the reason is about this placement and nothing else.
      if (judge) {
        const why = judge(next, instanceId);
        if (why.length) { judged = judged || why[0]; continue; }
      }
      scored.push({
        assembly: next,
        placement,
        point: point.point,
        preferred: prefer ? point.point.instanceId === prefer : false,
        held: s.met,
        heldOf: s.total,
        worldY: s.worldY,
        levelDelta: levelTarget === null ? 0 : Math.abs(s.worldY - levelTarget),
        heightMm: mountHeightMm(placement),
      });
    }
  }

  if (!scored.length && judged) {
    // Every place it could go breaks a rule - and the rule's own sentence says
    // which, rather than "every position is taken" when none of them is.
    return { ok: false, reason: judged.says, judged };
  }
  if (!scored.length) {
    return {
      ok: false,
      // Named honestly. "It does not fit" is what a broken configurator says
      // too; "every place it could go is already taken" is a sentence somebody
      // can act on by removing something.
      reason: `Every position for that part is already taken (${tried} tried).`,
      occupied: true,
    };
  }

  // Four keys, in this order, and each one earned its place by a product that
  // came out wrong without it:
  //
  //   preferred    grow from the end the caller named, or a 3-bay run folds
  //                back into bay 1
  //   laps         extend into free space, or fill between two frames
  //   levelDelta   level with its own kind, or the second frame dangles
  //   worldY       lowest of what is left, so repeats stack upward
  const sign = policy === PLACE.EXTEND ? 1 : -1;
  scored.sort((a, b) => (b.preferred - a.preferred)
    || (sign * (a.held - b.held))
    || (a.levelDelta - b.levelDelta)
    // Lowest first stacks repeats upward, which is right for shelves. A range
    // may prefer the highest for a kind (YouK: the clothes rail, Matt 12 Nov 2026).
    || (order === 'highest' ? b.worldY - a.worldY : a.worldY - b.worldY));

  const best = scored[0];
  return {
    ok: true,
    assembly: best.assembly,
    placement: best.placement,
    point: best.point,
    considered: scored.length,
    // The ranking, on request, without the assemblies. Every wrong product this
    // policy produced was diagnosed by reading this rather than by reasoning
    // about it - three times running the reasoning was wrong - so it is part of
    // the module rather than a script that gets deleted.
    ranking: explain ? scored.map((s) => ({
      point: `${s.point.instanceId}::${s.point.snapId}`,
      held: s.held,
      levelDeltaMm: Math.round(s.levelDelta * 1000),
      worldYMm: Math.round(s.worldY * 1000),
      preferred: s.preferred,
    })) : null,
  };
}

/**
 * Choices in, a product out.
 *
 * The build order is the one the range itself implies and the one
 * `demoConfiguration` already used: a frame stands up, a span bridges to the
 * next frame, and everything else hangs off what is now there. Extra bays
 * repeat the span-then-frame pair, each time growing from the frame that was
 * added last, which is what keeps a run straight instead of folding back on
 * itself.
 *
 * NOTHING IS SILENTLY DROPPED. A part that will not go on comes back in
 * `refused` with the engine's own reason, and the caller shows it. A
 * configurator that quietly ignores a control is indistinguishable from one
 * that is broken - the same rule the quote follows with a missing price.
 */
/**
 * Re-hang a part already in the product at a recorded point, carrying whatever
 * hangs from it - exactly the move the panel offered (see moveCandidates).
 */
function rehang(assembly, components, instanceId, at, judgeMove) {
  const instance = assembly.instances.find((i) => i.instanceId === instanceId);
  if (!instance || !canMove(assembly, instanceId).ok) return { ok: false, reason: 'That part cannot be moved.' };
  const { transforms } = resolveTransforms(assembly, components);
  const { placements } = moveTargets(assembly, components, transforms, instanceId, {});
  const here = placements.filter((p) => p.componentId === instance.componentId
    && p.point.instanceId === at.instanceId && p.point.snapId === at.snapId
    && (!at.mountSnapId || p.mountSnapId === at.mountSnapId));
  let why = null;
  for (const placement of distinctPlacements(assembly, components, here)) {
    let next;
    try { next = moveTo(assembly, instanceId, placement); } catch { continue; }
    if (!survey(next, components, instanceId, instance.componentId)) continue;
    const reasons = judgeMove(assembly, next);
    if (reasons.length) { why = why || reasons[0].says; continue; }
    return { ok: true, assembly: next, placement };
  }
  return { ok: false, reason: why || 'That position is no longer part of this product.' };
}

/**
 * The choices, with every part's CURRENT position written down.
 *
 * A1 F10: removing one accessory used to move others - the timber shelf jumped
 * from bay 2 to bay 1 - because parts nobody had moved were re-placed by the
 * policy on the rebuild, and the policy saw a different product. Removing a part
 * therefore pins everything else first (Guided's remove), so the only thing that
 * changes is the thing the customer removed.
 */
export function pinPositions(built) {
  const at = { ...(built.choices?.at || {}) };
  for (const [slot, rec] of Object.entries(built.slotAt || {})) {
    if (slot === frameSlotFor(0) || at[slot]) continue;
    if (Number.isInteger(rec.bay)) { at[slot] = { bay: rec.bay }; continue; }
    at[slot] = { instanceId: rec.instanceId, slot: rec.slot || null, snapId: rec.snapId, mountSnapId: rec.mountSnapId || null };
  }
  return { ...built.choices, at };
}


/**
 * KITS: an add that brings the parts that carry it (cabinets, desks).
 *
 * Matt, 13 Nov 2026: cabinets at all three heights on the bottom rung, the bay
 * shelf moving up, the shared bracket chosen automatically; desks at the same
 * time. A kit is described by the variant's `kits` in the schema - which
 * brackets, which arm and clamp, which rung - so another range writes its own
 * recipes and nothing here knows what a cabinet is.
 *
 * One kit per bay. Which bay: the one recorded for that slot, if it is free and
 * that bay's size offers the kind; otherwise the first free bay from the left.
 */
export function kitRequests(variant, c) {
  const kinds = [];
  for (let b = 0; b < c.bays; b += 1) {
    for (const a of sizeAt(variant, c, b).adds || []) if (a.kit && !kinds.includes(a.kind)) kinds.push(a.kind);
  }
  const takes = (b, kind) => (sizeAt(variant, c, b).adds || []).find((a) => a.kind === kind && a.kit) || null;
  const want = [];
  for (const kind of kinds) for (let i = 0; i < (c.adds[kind] || 0); i += 1) want.push({ kind, i, key: slotKeyFor(kind, i) });
  const taken = new Set();
  for (const w of want) {
    const b = c.at?.[w.key]?.bay;
    if (Number.isInteger(b) && b < c.bays && !taken.has(b) && takes(b, w.kind)) { w.bay = b; taken.add(b); }
  }
  for (const w of want) {
    if (w.bay !== undefined) continue;
    for (let b = 0; b < c.bays; b += 1) {
      if (!taken.has(b) && takes(b, w.kind)) { w.bay = b; taken.add(b); break; }
    }
  }
  for (const w of want) {
    if (w.bay === undefined) continue;
    w.add = takes(w.bay, w.kind);
    w.recipe = variant.kits?.[w.add.kit] || null;
  }
  return want;
}

const snapIdByLabel = (components, componentId, label) => components.get(componentId)?.snaps.find((s) => s.label === label)?.id || null;
// What a cabinet sits above its rung (its bracket, ~10 mm) plus room to lift
// it out. The judge still refuses anything that actually meets.
const KIT_CLEAR_M = 0.025;

export function buildGuided(schema, choices, components, { rules = DEFAULT_RULES } = {}) {
  const c = normaliseChoices(schema, choices);
  // ONE JUDGE for everything this build places (A2 §3), and handed on in the
  // result so the move list and the dots ask exactly the same question.
  const judgeAt = (assembly, instanceId) => judge(assembly, components, rules, { mounting: c.mounting, footHeightMm: c.footHeightMm, focus: instanceId });
  // While the bays themselves are laid out, a shelf is held at one end until the
  // next ladder hangs from the other. So the STRUCTURE is placed against the
  // physical rules only (floor, through, one space); accessories, moves, dots and
  // the finished product get the whole judge.
  // A MOVE is judged on the whole product, before against after: what it does to
  // the parts around it is the point (moving a ladder can strand a shelf).
  const judgeMove = (before, after) => introduced(
    judge(before, components, rules, { mounting: c.mounting, footHeightMm: c.footHeightMm }),
    judge(after, components, rules, { mounting: c.mounting, footHeightMm: c.footHeightMm }),
  );
  const judgeStructure = (assembly, instanceId) => judge(assembly, components, rules, { mounting: c.mounting, footHeightMm: c.footHeightMm, focus: instanceId, skip: ['held', 'mountingNeeds'] });
  const variant = variantOf(schema, c);
  const size = sizeOf(variant, c);
  // Which bay each cabinet or desk goes in, decided before the bays are built,
  // because a bay with a cabinet has its own shelf placed clear of it.
  const kitWant = kitRequests(variant, c);
  // The bay's shelf goes clear of the cabinet: every rung from the cabinet's
  // own up to the first one above its top. Measured - the rung heights off the
  // ladder, the height off the cabinet - so a 450 mm cabinet on a 1500 ladder
  // (rungs 100, 455, 810) sends the shelf to rung 3, and a 300 one only to 2.
  const kitAvoid = (bay, from) => {
    const w = kitWant.find((x) => x.bay === bay && x.recipe?.spanMovesUp);
    const inst = w && assembly.instances.find((x) => x.instanceId === from);
    if (!inst) return null;
    const rungs = components.get(inst.componentId).snaps.filter((s) => /^rung-\d+-(left|right)$/.test(s.label));
    const base = rungs.find((s) => s.label === `rung-${w.recipe.rung}-left`)?.position[1];
    const tall = (components.get(w.add.componentId)?.dimsMm?.heightMm || 0) / 1000;
    if (base === undefined) return null;
    const avoid = rungs.filter((s) => s.position[1] >= base - 1e-6 && s.position[1] < base + tall + KIT_CLEAR_M);
    // And the shelf has to land where the NEXT ladder has a rung at the same
    // height, or that ladder hangs off the floor to meet it (sweep O2: a 450
    // cabinet beside a 550 ladder, whose top rung is 455). No such rung, no
    // cabinet - refused in words below, rather than the run bent to fit it.
    const next = components.get(frameIdAt(bay + 1));
    const heights = (next?.snaps || []).filter((s) => /^rung-\d+-(left|right)$/.test(s.label)).map((s) => s.position[1]);
    const left = rungs.filter((s) => !avoid.includes(s) && heights.some((h) => Math.abs(h - s.position[1]) < 1e-4));
    if (!left.length) {
      kitBlocked.set(bay, `too tall for these ladders - the shelf above it has no rung to go to`);
      return null;
    }
    return new Set(avoid.map((s) => `${from}::${s.id}`));
  };
  const kitBlocked = new Map();

  const missing = guidedComponentIds(schema, { includeImplied: false })
    .filter((id) => !components.has(id));
  if (missing.length) {
    throw new GuidedError(
      `This product needs ${missing.length} part${missing.length === 1 ? '' : 's'} `
      + `that are not loaded: ${missing.join(', ')}.`,
    );
  }

  const catalogue = guidedComponentIds(schema, { includeImplied: false });
  const refused = [];
  // Overrides that could not be honoured, so the caller can forget them rather
  // than keep a record of a position that no longer exists.
  const dropped = [];
  // instanceId -> slot key, and slot key -> where it actually landed. The first
  // turns a tap in the scene into a choice; the second lets a UI show where a
  // part is now without re-deriving it.
  const slots = {};
  const slotAt = {};
  let n = 0;
  const nextId = () => `g${(n += 1)}`;

  // WHICH LADDER STANDS AT WHICH POSITION IN THE RUN.
  //
  // Matt: "is it possible to be able to add ladders of different types to mix
  // and match? maybe i can click on a ladder in the scene and change its type
  // and then change what height it sits?"
  //
  // So the frame is no longer one global choice. `choices.frames[i]` overrides
  // the i-th frame in the run and defaults to `choices.frameId`, which keeps
  // the Height control meaning what it always meant - all of them - while
  // letting one position differ. Frames get SLOTS for the same reason
  // accessories do (§5.24): a tap in the scene has to come back as a choice,
  // and a count cannot say which ladder was tapped.
  //
  // `kin` is the whole point of the change further up. Every frame in the
  // variant counts as the same KIND for levelling, so a 905 arriving beside a
  // 668 comes out standing on the floor instead of hanging 709.5 mm below it.
  const frameKin = new Set((variant.frames || []).map((f) => f.componentId));
  const frameIdAt = (i) => c.frames?.[i] || c.frameId;

  let assembly = {
    instances: [{
      instanceId: nextId(),
      componentId: frameIdAt(0),
      selections: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      freeMove: true,
    }],
    connections: [],
  };

  // The anchor is a slot like any other, so its TYPE can be changed by tapping
  // it. Its POSITION cannot - it is the thing everything else hangs off, and
  // `canMove` refuses it by name.
  slots[assembly.instances[0].instanceId] = frameSlotFor(0);

  // ADDRESSES, NOT BUILD ORDER (A2 §4; A1 F07, F10). A recorded position used to
  // name the instance it hangs from - `g6` - and instance ids come from build
  // order. So a ladder moved onto an extra shelf recorded a part the rebuild had
  // not placed yet (frames go first), the record was dropped, and the ladder
  // sprang back to the floor: 341 times in the audit.
  //
  // A record now carries the SLOT of what it hangs from (`metal-shelf#0`), read
  // back to whatever instance that slot is in this build. One that names a slot
  // not built YET is deferred, and re-hung once the whole product exists - by the
  // same move the panel previewed (moveTo), so what was offered is what is kept.
  // A record with no slot is a link written before this and is read as before.
  const slotIndex = () => new Map(Object.entries(slots).map(([id, sl]) => [sl, id]));
  const exists = (id) => assembly.instances.some((i) => i.instanceId === id);
  const resolveAt = (at) => {
    if (!at) return null;
    if (at.slot) {
      const id = slotIndex().get(at.slot);
      return id ? { ...at, instanceId: id } : { ...at, pending: true };
    }
    return exists(at.instanceId) ? at : { ...at, pending: true };
  };
  const deferred = [];
  const recordOf = (r) => ({
    instanceId: r.point.instanceId,
    slot: slots[r.point.instanceId] || null,
    snapId: r.point.snapId,
    mountSnapId: r.placement?.mountSnapId || null,
  });

  // The frame the run is currently growing from. Not the root - the far end.
  let growingFrom = assembly.instances[0].instanceId;

  for (let bay = 0; bay < c.bays; bay += 1) {
    // EACH BAY TAKES ITS OWN WIDTH. Matt: "i can change the width but it
    // changes the width of all bays". The span IS the width - it is the shelf
    // that joins two ladders, so the part number chosen here is what sets the
    // spacing, and every later part in that bay has to match it.
    const baySize = sizeAt(variant, c, bay);

    // AND ITS OWN HEIGHT. Matt: "i cant select what height i want the starter
    // shelf to be, its always on the bottom". It is a slot now, and the same
    // two-step every other slot follows: honour what was recorded, and if the
    // product has changed so much that the point is gone, put it back where the
    // policy would have put it and SAY SO.
    const spanKey = spanSlotFor(bay);
    let spanRemembered = resolveAt(c.at?.[spanKey]);
    if (spanRemembered?.pending) { deferred.push({ key: spanKey, at: c.at[spanKey], label: baySize.span.label }); spanRemembered = null; }
    const spanOpts = {
      instanceId: nextId(), catalogue, prefer: growingFrom, policy: PLACE.EXTEND, judge: judgeStructure,
      // Matt, 13 Nov 2026: a cabinet takes the bottom rung and the bay's shelf
      // moves up - so the shelf is placed clear of the cabinet's rung.
      avoid: kitAvoid(bay, growingFrom),
    };
    let span = spanRemembered
      ? autoAttach(assembly, components, baySize.span.componentId, {
        ...spanOpts, at: spanRemembered,
      })
      : null;
    if (span && !span.ok) {
      dropped.push({
        slot: spanKey, componentId: baySize.span.componentId, label: baySize.span.label, reason: span.reason,
      });
      span = null;
    }
    if (!span) {
      span = autoAttach(assembly, components, baySize.span.componentId, spanOpts);
    }

    if (!span.ok) {
      refused.push({
        componentId: baySize.span.componentId, label: baySize.span.label, reason: span.reason,
      });
      break;
    }
    assembly = span.assembly;
    const spanId = assembly.instances[assembly.instances.length - 1].instanceId;
    slots[spanId] = spanKey;
    slotAt[spanKey] = recordOf(span);

    const index = bay + 1;
    const frameId = frameIdAt(index);
    const key = frameSlotFor(index);
    let remembered = resolveAt(c.at?.[key]);
    if (remembered?.pending) { deferred.push({ key, at: c.at[key], label: 'Ladder' }); remembered = null; }
    const id = nextId();
    const opts = {
      instanceId: id, catalogue, prefer: spanId, policy: PLACE.EXTEND, kin: frameKin, judge: judgeStructure,
    };

    // Same two-step as an accessory: honour a recorded height, and if the
    // product has changed so much that it no longer exists, put the frame back
    // where the policy would have put it and SAY SO. A ladder that vanishes
    // because its rung went away would take the rest of the run with it.
    let r = remembered
      ? autoAttach(assembly, components, frameId, { ...opts, at: remembered })
      : null;
    if (r && !r.ok) {
      dropped.push({ slot: key, componentId: frameId, label: 'Ladder', reason: r.reason });
      r = null;
    }
    if (!r) r = autoAttach(assembly, components, frameId, opts);

    if (!r.ok) {
      refused.push({ componentId: frameId, reason: r.reason });
      break;
    }
    assembly = r.assembly;
    slots[id] = key;
    // WHICH OF ITS OWN RUNGS, in the record (mountSnapId). Every rung of this
    // frame is offered at the same point on the span, so without it the record
    // cannot tell the floor from halfway up.
    slotAt[key] = recordOf(r);
    growingFrom = id;
  }

  // Accessories last, and in the schema's own order rather than the order the
  // controls happened to be touched, so the same choices always produce the
  // same product. Two customers who picked the same options must get the same
  // configuration id, or a quote cannot be reconciled with a drawing.
  // Every kind any bay in this run can take, in the schema's order. With one
  // width that is the size's own list; with two it is the union, because a run
  // of a 900 bay and a 450 one offers a clothes rail (900 has one) and the rail
  // can only go in the 900.
  const addKinds = [];
  for (const s of sizesInRun(variant, c, c.bays)) {
    for (const a of s.adds || []) if (!addKinds.some((k) => k.kind === a.kind)) addKinds.push(a);
  }

  // KITS NEXT (cabinets, desks): before the loose accessories, so a cabinet
  // gets the bottom rung Matt chose for it rather than whatever a shelf left.
  // Brackets are planned per LADDER first, because a ladder between two cabinets
  // takes ONE shared bracket carrying both (MA 406214 step 1b), not two outer
  // ones - which would sit in the same place.
  const kitSlots = new Set();
  {
    const byBay = new Map(kitWant.filter((w) => w.bay !== undefined && w.recipe).map((w) => [w.bay, w]));
    for (const w of kitWant) {
      if (w.bay !== undefined && w.recipe) continue;
      refused.push({
        kind: w.kind, kit: true, componentId: null, placed: 0, asked: 1,
        reason: w.bay === undefined
          ? 'every bay has one - add a bay'
          : 'This product has no recipe for fitting that part.',
      });
    }
    const ladderOf = (k) => Object.entries(slots).find(([, sl]) => sl === frameSlotFor(k))?.[0] || null;
    const sharesLadder = (k) => {
      const L = byBay.get(k - 1);
      const R = byBay.get(k);
      return !!(L && R && L.add.kit === R.add.kit && L.recipe.rung === R.recipe.rung && L.recipe.brackets?.shared);
    };
    const sharedAt = new Map();      // ladder index -> instance id of the shared bracket
    const mountOn = (componentId, ladder, rung, faces) => {
      const ladderInst = assembly.instances.find((x) => x.instanceId === ladder);
      let why = 'That ladder has no rung for it.';
      for (const face of faces) {
        const snapId = snapIdByLabel(components, ladderInst.componentId, `rung-${rung}-${face}`);
        if (!snapId) continue;
        const r = autoAttach(assembly, components, componentId, {
          instanceId: nextId(), catalogue: [componentId], policy: PLACE.FILL, judge: judgeAt,
          at: { instanceId: ladder, snapId },
        });
        if (r.ok) return r;
        why = r.reason;
      }
      return { ok: false, reason: why };
    };

    for (const bay of [...byBay.keys()].sort((p, q) => p - q)) {
      const w = byBay.get(bay);
      const { recipe } = w;
      const before = { assembly, slots: { ...slots }, n };
      const placed = [];
      const fail = (reason) => {
        assembly = before.assembly;
        for (const k of Object.keys(slots)) if (!(k in before.slots)) delete slots[k];
        // A shared bracket this kit put up has gone with it, and the next bay
        // no longer has a neighbour to share with.
        for (const [k, id] of [...sharedAt]) if (placed.includes(id)) sharedAt.delete(k);
        byBay.delete(bay);
        refused.push({ kind: w.kind, kit: true, componentId: w.add.componentId, label: w.add.label, placed: 0, asked: 1, reason });
      };
      const keep = (r) => {
        assembly = r.assembly;
        const id = assembly.instances[assembly.instances.length - 1].instanceId;
        slots[id] = w.key;
        placed.push(id);
        return id;
      };

      if (kitBlocked.has(bay)) { fail(kitBlocked.get(bay)); continue; }

      // A support each side: the ladder at the bay's left and the one at its right.
      const supports = [];
      let failed = null;
      for (const [k, faces] of [[bay, ['right', 'left']], [bay + 1, ['left', 'right']]]) {
        const ladder = ladderOf(k);
        if (!ladder) { failed = 'That bay is missing a ladder.'; break; }
        if (sharesLadder(k)) {
          if (sharedAt.has(k)) { supports.push(sharedAt.get(k)); continue; }
          const r = mountOn(recipe.brackets.shared, ladder, recipe.rung, ['right', 'left']);
          if (!r.ok) { failed = r.reason; break; }
          const id = keep(r);
          sharedAt.set(k, id);
          supports.push(id);
          continue;
        }
        const r = mountOn(recipe.brackets.end, ladder, recipe.rung, faces);
        if (!r.ok) { failed = r.reason; break; }
        supports.push(keep(r));
      }
      if (failed) { fail(failed); continue; }

      // A desk's arm on each bracket, at the hole row for a 750 mm top, and the
      // clamping angle on the arm (Office solution steps 3-4).
      let carriers = supports;
      if (recipe.arm) {
        const arms = [];
        for (const plate of supports) {
          const plateInst = assembly.instances.find((x) => x.instanceId === plate);
          const hole = snapIdByLabel(components, plateInst.componentId, recipe.arm.hole?.[c.mounting] || recipe.arm.hole?.floor);
          const mount = snapIdByLabel(components, recipe.arm.componentId, recipe.arm.mount);
          const r = autoAttach(assembly, components, recipe.arm.componentId, {
            instanceId: nextId(), catalogue: [recipe.arm.componentId], policy: PLACE.FILL, judge: judgeAt,
            at: { instanceId: plate, snapId: hole, mountSnapId: mount },
          });
          if (!r.ok) { failed = r.reason; break; }
          const arm = keep(r);
          arms.push(arm);
          if (recipe.clamp) {
            const on = snapIdByLabel(components, recipe.arm.componentId, recipe.clamp.on);
            const cr = autoAttach(assembly, components, recipe.clamp.componentId, {
              instanceId: nextId(), catalogue: [recipe.clamp.componentId], policy: PLACE.FILL, judge: judgeAt,
              at: { instanceId: arm, snapId: on },
            });
            if (!cr.ok) { failed = cr.reason; break; }
            keep(cr);
          }
        }
        if (failed) { fail(failed); continue; }
        carriers = arms;
      }

      // The top - the cabinet, the desktop - on the first carrier, and it must
      // land in THIS bay with both ends held (the judge's every-end rule).
      const { transforms: t } = resolveTransforms(assembly, components);
      const xs = [ladderOf(bay), ladderOf(bay + 1)].map((id) => t.get(id).translation[0]).sort((p, q) => p - q);
      const host = assembly.instances.find((x) => x.instanceId === carriers[0]);
      let top = null;
      let why = 'There is nothing for it to rest on.';
      for (const sock of components.get(host.componentId).snaps.filter((s) => s.role === 'socket' && /^carries/.test(s.label))) {
        const r = autoAttach(assembly, components, w.add.componentId, {
          instanceId: nextId(), catalogue: [w.add.componentId], policy: PLACE.FILL, judge: judgeAt,
          at: { instanceId: host.instanceId, snapId: sock.id },
        });
        if (!r.ok) { why = r.reason; continue; }
        const cx = resolveTransforms(r.assembly, components).transforms.get(r.assembly.instances.at(-1).instanceId).translation[0];
        if (cx > xs[0] && cx < xs[1]) { top = r; break; }
      }
      if (!top) { fail(why); continue; }
      keep(top);
      slotAt[w.key] = { bay };
      kitSlots.add(w.key);
    }
  }

  // Every point a recorded accessory is still to take, so nothing auto-placed
  // before it gets there first. Cleared as each one is placed.
  const reserved = new Set();
  for (const add of addKinds) {
    if (add.kit) continue;
    for (let i = 0; i < (c.adds[add.kind] || 0); i += 1) {
      const rec = resolveAt(c.at?.[slotKeyFor(add.kind, i)]);
      if (rec && !rec.pending) reserved.add(`${rec.instanceId}::${rec.snapId}`);
    }
  }

  // TWO PASSES (sweep I5, 13 Nov 2026): every RECORDED accessory first, across
  // all kinds, then the ones the policy places. In one pass by kind, a second
  // clothes rail - unrecorded, and placed before the hook strips because rails
  // come first - took the space under a rung that a hook strip the customer had
  // moved there was still to take, from the other ladder's side, which the
  // reservation of the hook strip's own point could not see. What the customer
  // put somewhere wins; that was A3's rule and this is what keeps it.
  const placedOf = new Map();          // kind -> how many are on
  const gaveUp = new Set();            // kinds refused: no more of them
  const toPlace = [];
  for (const add of addKinds) {
    // Kits were placed above, with their brackets.
    if (add.kit) continue;
    /*
     * THE LENGTH IS CHOSEN BY THE GEOMETRY, not by bookkeeping.
     *
     * Matt: "when we add a shelf (timber or metal) its automatically the
     * correct length". With mixed widths "a metal shelf" is 008561, 008562,
     * 008563 or 008564 depending on the bay it lands in - and rather than work
     * out which bay a point belongs to and then look the part up, the engine
     * tries the candidates and lets the snaps answer. A 900 shelf does not
     * reach across a 600 bay, so the joint checking that has refused bad
     * placements since week one picks the length for nothing.
     *
     * Widest first, so a run of one width behaves exactly as it did: the widest
     * that fits is the one that spans the bay rather than sitting half way
     * across it.
     */
    const candidates = candidatesFor(variant, add.kind);
    for (let i = 0; i < (c.adds[add.kind] || 0); i += 1) {
      const key = slotKeyFor(add.kind, i);
      let remembered = resolveAt(c.at?.[key]);
      if (remembered?.pending) { deferred.push({ key, at: c.at[key], label: add.label }); remembered = null; }
      toPlace.push({ add, i, key, candidates, remembered });
    }
  }
  const optsFor = (add, id) => ({
    instanceId: id,
    catalogue,
    policy: PLACE.FILL,
    requireFullyHeld: !!add.spans,
    judge: judgeAt,
    order: rules.preferences?.byKind?.[add.kind] || rules.preferences?.default || 'lowest',
    avoid: reserved,
  });
  const keepAdd = (w, id, r) => {
    assembly = r.assembly;
    // Which slot this instance IS, so a person tapping the part in the scene
    // can be turned back into the choice that produced it.
    slots[id] = w.key;
    slotAt[w.key] = recordOf(r);
    placedOf.set(w.add.kind, (placedOf.get(w.add.kind) || 0) + 1);
  };

  // Pass 1: the remembered positions. One that will no longer take is DROPPED
  // and its part goes round again with the policy's - the kinder failure: the
  // customer reduced the bays and the rail they had moved has to go SOMEWHERE,
  // and saying "we put it back" beats losing it.
  const later = [];
  for (const w of toPlace) {
    if (!w.remembered) { later.push(w); continue; }
    reserved.delete(`${w.remembered.instanceId}::${w.remembered.snapId}`);
    const id = nextId();
    const r = tryCandidates(assembly, components, w.candidates, { ...optsFor(w.add, id), at: w.remembered });
    if (!r.ok) {
      dropped.push({ slot: w.key, componentId: r.componentId, label: w.add.label, reason: r.reason });
      later.push(w);
      continue;
    }
    keepAdd(w, id, r);
  }

  // Pass 2: the policy's, in kind order.
  for (const w of later) {
    if (gaveUp.has(w.add.kind)) continue;
    const id = nextId();
    const r = tryCandidates(assembly, components, w.candidates, optsFor(w.add, id));
    if (!r.ok) {
      gaveUp.add(w.add.kind);
      refused.push({
        componentId: r.componentId,
        // THE KIND AS WELL, because the control that asked for it is a kind
        // now. Keyed on the part number alone, the shortfall note went
        // looking for "008562" against a stepper called "metal-shelf" and
        // found nothing - so "only 2 fit" was computed and never shown.
        kind: w.add.kind,
        label: w.add.label,
        // How many of them DID go on, so the message can be about the
        // shortfall rather than about the failure. "3 of the 4 fit" is a
        // sentence somebody can act on; "could not place" is not.
        placed: placedOf.get(w.add.kind) || 0,
        asked: c.adds[w.add.kind] || 0,
        reason: r.reason,
      });
      continue;
    }
    keepAdd(w, id, r);
  }

  // THE DEFERRED RECORDS, now that every slot they could name exists. Re-hung by
  // moveTo - the editor's and the move panel's own mechanism, carrying whatever
  // hangs from the part - and kept only if the judge agrees, so the product is
  // exactly the one the panel previewed when the move was made.
  for (const d of deferred) {
    const at = resolveAt(d.at);
    const instanceId = slotIndex().get(d.key);
    const moved = !at || at.pending || !instanceId
      ? { ok: false, reason: 'That position is no longer part of this product.' }
      : rehang(assembly, components, instanceId, at, judgeMove);
    if (moved.ok) {
      assembly = moved.assembly;
      slotAt[d.key] = { ...at, slot: slots[at.instanceId] || at.slot || null, pending: undefined };
    } else {
      dropped.push({ slot: d.key, label: d.label, reason: moved.reason });
    }
  }

  return {
    choices: c,
    variant,
    size,
    // THE RUN'S OWN LISTS, so nothing downstream has to recompute them and get
    // a different answer. `size` is still the run's width - what the Width
    // control shows - but it no longer describes the product: `sizes` is what
    // each bay actually is, and `adds` is every kind any of them can take.
    sizes: sizesInRun(variant, c, c.bays),
    adds: addKinds,
    assembly,
    mounting: c.mounting,
    footHeightMm: c.footHeightMm,
    refused,
    dropped,
    slots,
    slotAt,
    rules,
    judge: judgeAt,
    judgeMove,
    // The slots that are kits - a cabinet or desk and the brackets under it.
    kits: kitSlots,
    configurationId: encodeConfiguration(assembly, {
      mounting: c.mounting,
      footHeightMm: c.footHeightMm,
    }),
  };
}

/**
 * Which of this size's accessories can go on the product at all.
 *
 * Matt's sweep found eighteen combinations where an option is OFFERED and can
 * never be placed: the d200 variant's 900 mm sizes list a 900 mm clothes rail
 * and a full-width hook strip, and neither has a joint that matches a 200 mm
 * ladder's rungs. Pressing `+` did exactly what it should - refused, with a
 * reason - and that is still the wrong experience, because the control looked
 * live right up until it was used. A dead control that says why beats a live
 * control that refuses.
 *
 * ASKED OF THE ENGINE, on the product as it currently stands, so this answer
 * cannot disagree with what pressing `+` would do. `pointsForComponent` is the
 * same query `autoAttach` narrows, and `whyComponentFitsNowhere` is the same
 * explanation the editor puts in front of a person. There is no second table of
 * what-fits-what, and there must never be one: a hard-coded exclusion list is
 * how the schema and the parts drift apart.
 *
 * It answers TWO different questions with one mechanism, and the distinction is
 * in `kind` rather than in two functions:
 *
 *   'never'  - no joint on this part matches anything this frame offers. True
 *              for the whole size, and the reason names the frame.
 *   'full'   - it fits this product, but every point it could take is used.
 *              True right now, and it comes back the moment a bay is added.
 *
 * Both are honest, both are worth saying, and the customer reads the sentence
 * rather than the kind.
 *
 * @param {object} built  the result of buildGuided
 * @param {Map} components
 * @returns {Object<string, {ok: boolean, kind: string, reason: string}>}
 *   keyed by the add's KIND. Only entries that are NOT ok carry a reason.
 */
export function addAvailability(built, components) {
  const out = {};
  // KEYED BY KIND, and asked about every length that kind can be. A control
  // says "metal shelf" now, not "008563", so greying it out because the 900 one
  // will not fit would kill the control in a run whose 600 bay has room. The
  // kind is available if ANY of its lengths can go somewhere.
  const adds = built?.adds || built?.size?.adds || [];
  if (!adds.length) return out;

  const variant = built?.variant;
  const partsOf = new Map(adds.map((a) => [a.kind || a.componentId, candidatesFor(variant, a.kind || a.componentId)]));
  const catalogue = [...new Set([...partsOf.values()].flat())];
  let matrix = null;
  try {
    const { transforms } = resolveTransforms(built.assembly, components);
    matrix = attachMatrix(built.assembly, components, catalogue, transforms);
  } catch {
    // No matrix, no opinion. Greying every control because a query threw would
    // turn one fault into a configurator nobody can use.
    return out;
  }

  // A part already on the product proves it fits, whatever the matrix says
  // about room for ANOTHER one - otherwise adding the last shelf a bay can take
  // would grey out the control that is holding it.
  const placed = new Set(built.assembly.instances.map((i) => i.componentId));

  for (const add of adds) {
    const key = add.kind || add.componentId;
    // A kit brings the brackets it sits on, so "nothing on the product can carry
    // it" is not a reason it can never go on. The build says so if it cannot.
    // What stops one is a bay with nothing in it: one cabinet or desk per bay.
    if (add.kit) {
      const c = built.choices || {};
      const used = new Set([...(built.kits || [])].map((k) => built.slotAt?.[k]?.bay));
      let free = false;
      for (let b = 0; b < (c.bays || 1) && !free; b += 1) {
        free = !used.has(b) && (sizeAt(variant, c, b).adds || []).some((a) => a.kind === key && a.kit);
      }
      out[key] = free ? { ok: true } : { ok: false, kind: 'full', reason: 'every bay has one - add a bay' };
      continue;
    }
    const parts = partsOf.get(key) || [];
    if (parts.some((id) => pointsForComponent(matrix, id).length > 0)) { out[key] = { ok: true }; continue; }
    if (parts.some((id) => placed.has(id))) { out[key] = { ok: true }; continue; }

    // A STRING, not an object - the editor puts it straight in front of a
    // person. Reading it as `why.reason` silently produced undefined, so every
    // unplaceable part reported "no room left", INCLUDING the two that can
    // never fit at all. Caught by printing the sentence rather than trusting
    // the shape.
    const whys = parts.map((id) => whyComponentFitsNowhere(matrix, id));
    // A joint mismatch is a fact about the PART and the FRAME, so it holds for
    // every bay count and is worth phrasing as a property of the size. Anything
    // else is about how full the product is right now.
    //
    // EVERY length has to be a mismatch for the KIND to be one. If the 900 rail
    // does not match a 200 mm ladder but the 600 one does, the kind is not
    // unavailable - the product is just full, and it comes back with a bay.
    const never = !whys.length
      || whys.every((w) => !w || /joint|fit together|different kinds/i.test(w));
    out[key] = never
      ? {
        ok: false,
        kind: 'never',
        reason: built.variant?.label
          ? `not available on ${built.variant.label} frames`
          : 'not available on this frame',
      }
      : {
        ok: false,
        kind: 'full',
        reason: 'no room left - add a bay',
      };
  }
  return out;
}
