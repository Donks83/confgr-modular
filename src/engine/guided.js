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
  livePoints, pointKey,
  attachAt, placeFree, mountHeightMm, whyComponentFitsNowhere,
  canMove, moveTargets, moveTo,
} from './attach.js';
import { resolveTransforms, snapSupport } from './assembly.js';
import { overlaps } from './collision.js';
import { encodeConfiguration } from './configuration.js';
import { impliedComponentIds } from './implied.js';
import { MOUNTING, isMounting, isGrounded, FOOT } from './ar.js';

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
    frames: {},
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
    if (!ref || typeof ref !== 'object' || !ref.instanceId || !ref.snapId) continue;

    const kept = {
      instanceId: String(ref.instanceId),
      snapId: String(ref.snapId),
    };
    // Which of the part's own snaps mates. Optional, because most parts have
    // one sensible mount and every record written before it existed omits it.
    if (ref.mountSnapId) kept.mountSnapId = String(ref.mountSnapId);

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

    const hash = key.lastIndexOf('#');
    if (hash < 0) continue;
    const componentId = key.slice(0, hash);
    const index = Number(key.slice(hash + 1));
    if (!Number.isInteger(index) || index < 0) continue;
    if (index >= (adds[componentId] || 0)) continue;
    at[key] = kept;
  }

  return {
    variantId: variant.id,
    sizeId: size.id,
    frameId: frame.componentId,
    frames,
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
  //   a span        - neither; it IS the bay, and taking one out would leave a
  //                   run with a hole in it
  //
  // Frames used to fall in with the spans and say "that is part of the frame,
  // change the size or the number of bays instead". Matt asked for the thing
  // that answer refused, so a frame is now its own kind.
  const kind = isFrameSlot(slot) ? 'frame' : (slot ? 'add' : 'span');

  if (kind === 'span') {
    return {
      ok: false,
      slot: null,
      kind,
      structural: true,
      reason: 'That is a shelf holding the run together. Change the width or the number of bays instead.',
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

  const add = (built.size?.adds || []).find((a) => a.componentId === instance.componentId);
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
  const floorY = isGrounded(built.mounting) && anchorId
    ? (transforms.get(anchorId)?.translation[1] ?? 0)
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
export function addPoints(built, components, componentId) {
  if (!built?.assembly || !components?.size || !componentId) return [];
  try {
    const { transforms } = resolveTransforms(built.assembly, components);
    const matrix = attachMatrix(built.assembly, components, [componentId], transforms);
    const allowed = new Set(pointsForComponent(matrix, componentId).map((p) => p.pointKey));
    return livePoints(matrix).filter((p) => allowed.has(pointKey(p)));
  } catch {
    return [];
  }
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

    const index = bay + 1;
    const frameId = frameIdAt(index);
    const key = frameSlotFor(index);
    const remembered = c.at?.[key] || null;
    const id = nextId();
    const opts = {
      instanceId: id, catalogue, prefer: spanId, policy: PLACE.EXTEND, kin: frameKin,
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
    slotAt[key] = {
      instanceId: r.point.instanceId,
      snapId: r.point.snapId,
      // WHICH OF ITS OWN RUNGS. Every rung of this frame is offered at the same
      // point on the span, so without this the record cannot tell the floor
      // from halfway up.
      mountSnapId: r.placement?.mountSnapId || null,
    };
    growingFrom = id;
  }

  // Accessories last, and in the schema's own order rather than the order the
  // controls happened to be touched, so the same choices always produce the
  // same product. Two customers who picked the same options must get the same
  // configuration id, or a quote cannot be reconciled with a drawing.
  for (const add of size.adds || []) {
    const wanted = c.adds[add.componentId] || 0;
    for (let i = 0; i < wanted; i += 1) {
      const key = slotKeyFor(add.componentId, i);
      const remembered = c.at?.[key] || null;
      const id = nextId();
      const opts = {
        instanceId: id, catalogue, policy: PLACE.FILL, requireFullyHeld: !!add.spans,
      };

      // A remembered position first; auto-placement if it will no longer take.
      // Dropping it rather than refusing the part is the kinder failure: the
      // customer reduced the bays and the rail they had moved has to go
      // SOMEWHERE, and saying "we put it back" beats losing it.
      let r = remembered ? autoAttach(assembly, components, add.componentId, { ...opts, at: remembered }) : null;
      if (r && !r.ok) {
        dropped.push({ slot: key, componentId: add.componentId, label: add.label, reason: r.reason });
        r = null;
      }
      if (!r) r = autoAttach(assembly, components, add.componentId, opts);

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
      // Which slot this instance IS, so a person tapping the part in the scene
      // can be turned back into the choice that produced it.
      slots[id] = key;
      slotAt[key] = { instanceId: r.point.instanceId, snapId: r.point.snapId };
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
    dropped,
    slots,
    slotAt,
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
 *   keyed by componentId. Only entries that are NOT ok carry a reason.
 */
export function addAvailability(built, components) {
  const out = {};
  const adds = built?.size?.adds || [];
  if (!adds.length) return out;

  const catalogue = adds.map((a) => a.componentId);
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
    const id = add.componentId;
    if (pointsForComponent(matrix, id).length > 0) { out[id] = { ok: true }; continue; }
    if (placed.has(id)) { out[id] = { ok: true }; continue; }

    // A STRING, not an object - the editor puts it straight in front of a
    // person. Reading it as `why.reason` silently produced undefined, so every
    // unplaceable part reported "no room left", INCLUDING the two that can
    // never fit at all. Caught by printing the sentence rather than trusting
    // the shape.
    const why = whyComponentFitsNowhere(matrix, id);
    // A joint mismatch is a fact about the PART and the FRAME, so it holds for
    // every bay count and is worth phrasing as a property of the size. Anything
    // else is about how full the product is right now.
    const never = !why || /joint|fit together|different kinds/i.test(why);
    out[id] = never
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
