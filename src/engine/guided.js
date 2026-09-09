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

import {
  attachMatrix, pointsForComponent, placementsAt, distinctPlacements,
  attachAt, placeFree, mountHeightMm, whyComponentFitsNowhere,
} from './attach.js';
import { resolveTransforms, snapSupport } from './assembly.js';
import { overlaps } from './collision.js';
import { encodeConfiguration } from './configuration.js';
import { impliedComponentIds } from './implied.js';
import { MOUNTING, isMounting, FOOT } from './ar.js';

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

  const adds = {};
  for (const a of size.adds || []) {
    const asked = Math.round(Number(choices.adds?.[a.componentId]) || 0);
    // `max` is per bay where the schema says so: one shoe rack per bay is a
    // sensible ceiling and one shoe rack per product is not, and the difference
    // only appears once somebody asks for three bays.
    const ceiling = a.perBay ? (a.max ?? 1) * bays : (a.max ?? 4);
    const n = Math.max(0, Math.min(ceiling, asked));
    if (n > 0) adds[a.componentId] = n;
  }

  const mounting = isMounting(choices.mounting) ? choices.mounting : MOUNTING.FLOOR;
  const footHeightMm = FOOT.heightsMm.includes(choices.footHeightMm)
    ? choices.footHeightMm : FOOT.heightsMm[0];

  return {
    variantId: variant.id,
    sizeId: size.id,
    frameId: frame.componentId,
    bays,
    adds,
    mounting,
    footHeightMm,
  };
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
  requireFullyHeld = false, explain = false,
} = {}) {
  const list = catalogue || [componentId];

  let transforms;
  try {
    ({ transforms } = resolveTransforms(assembly, components));
  } catch (err) {
    return { ok: false, reason: `This product cannot be resolved: ${err.message}` };
  }

  const matrix = attachMatrix(assembly, components, list, transforms);
  const points = pointsForComponent(matrix, componentId);

  if (!points.length) {
    return {
      ok: false,
      reason: whyComponentFitsNowhere(matrix, componentId)
        || 'There is nowhere on this product for that part.',
    };
  }

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
  // So the target is the height of the last part of the SAME component already
  // on the product. Frames come out level with the frames, spans level with the
  // spans, and a run stays a run. With nothing of that component there yet
  // there is nothing to be level with, and the next tie-break takes over.
  const levelTarget = (() => {
    for (let i = assembly.instances.length - 1; i >= 0; i -= 1) {
      if (assembly.instances[i].componentId !== componentId) continue;
      const t = transforms.get(assembly.instances[i].instanceId);
      if (t) return t.translation[1];
    }
    return null;
  })();

  let tried = 0;
  const scored = [];

  for (const point of points) {
    const key = `${point.point.instanceId}::${point.point.snapId}`;
    const candidates = distinctPlacements(
      assembly, components, placementsAt(matrix, key, componentId),
    );

    for (const placement of candidates) {
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
    || (a.worldY - b.worldY));

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
export function buildGuided(schema, choices, components) {
  const c = normaliseChoices(schema, choices);
  const variant = variantOf(schema, c);
  const size = sizeOf(variant, c);

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
  let n = 0;
  const nextId = () => `g${(n += 1)}`;

  let assembly = {
    instances: [{
      instanceId: nextId(),
      componentId: c.frameId,
      selections: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      freeMove: true,
    }],
    connections: [],
  };

  // The frame the run is currently growing from. Not the root - the far end.
  let growingFrom = assembly.instances[0].instanceId;

  for (let bay = 0; bay < c.bays; bay += 1) {
    const span = autoAttach(assembly, components, size.span.componentId, {
      instanceId: nextId(), catalogue, prefer: growingFrom, policy: PLACE.EXTEND,
    });
    if (!span.ok) {
      refused.push({
        componentId: size.span.componentId, label: size.span.label, reason: span.reason,
      });
      break;
    }
    assembly = span.assembly;
    const spanId = assembly.instances[assembly.instances.length - 1].instanceId;

    const frame = autoAttach(assembly, components, c.frameId, {
      instanceId: nextId(), catalogue, prefer: spanId, policy: PLACE.EXTEND,
    });
    if (!frame.ok) {
      refused.push({ componentId: c.frameId, reason: frame.reason });
      break;
    }
    assembly = frame.assembly;
    growingFrom = assembly.instances[assembly.instances.length - 1].instanceId;
  }

  // Accessories last, and in the schema's own order rather than the order the
  // controls happened to be touched, so the same choices always produce the
  // same product. Two customers who picked the same options must get the same
  // configuration id, or a quote cannot be reconciled with a drawing.
  for (const add of size.adds || []) {
    const wanted = c.adds[add.componentId] || 0;
    for (let i = 0; i < wanted; i += 1) {
      const r = autoAttach(assembly, components, add.componentId, {
        instanceId: nextId(), catalogue, policy: PLACE.FILL,
        requireFullyHeld: !!add.spans,
      });
      if (!r.ok) {
        refused.push({
          componentId: add.componentId,
          label: add.label,
          // How many of them DID go on, so the message can be about the
          // shortfall rather than about the failure. "3 of the 4 fit" is a
          // sentence somebody can act on; "could not place" is not.
          placed: i,
          asked: wanted,
          reason: r.reason,
        });
        break;
      }
      assembly = r.assembly;
    }
  }

  return {
    choices: c,
    variant,
    size,
    assembly,
    mounting: c.mounting,
    footHeightMm: c.footHeightMm,
    refused,
    configurationId: encodeConfiguration(assembly, {
      mounting: c.mounting,
      footHeightMm: c.footHeightMm,
    }),
  };
}
