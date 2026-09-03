// Deciding whether two snaps may connect.
//
// THE TWO-STAGE RULE. Mimeeq and Roomle were built independently and both land
// on the same design, which is strong evidence it is the right one:
//
//   Stage 1, LOGICAL   — do the masks match, and do both conditions hold?
//   Stage 2, GEOMETRIC — are the snaps close enough and facing each other?
//
// Logic first, geometry second. Proximity alone cannot express VALIDITY: a
// bounding-box snapper will happily attach a drawer front to a plinth because
// they happen to be near each other. The mask is what says "these two things
// are the same kind of joint".
//
// Roomle's OAP counterpart calls this matching "logically and geometrically" —
// the same two stages, same order.

import { dot, sub, length, normalise } from './vec.js';

/** How close two snap centres must be, in metres, to be considered coincident. */
export const DEFAULT_POSITION_TOLERANCE = 0.08;

/**
 * How closely facings must oppose. dot(a, b) === -1 is perfectly opposed;
 * -0.95 allows about 18 degrees of slop, which is generous for dragging by hand
 * and still refuses a right-angle mismatch.
 */
export const DEFAULT_FACING_TOLERANCE = -0.95;

export const REASONS = {
  OK: 'ok',
  SAME_INSTANCE: 'same-instance',
  MASK_MISMATCH: 'mask-mismatch',
  CONDITION_FAILED: 'condition-failed',
  ALREADY_OCCUPIED: 'already-occupied',
  TOO_FAR: 'too-far',
  FACING_WRONG: 'facing-wrong',
};

export const REASON_TEXT = {
  [REASONS.SAME_INSTANCE]: 'A part cannot connect to itself.',
  [REASONS.MASK_MISMATCH]: 'These are different kinds of joint and do not fit together.',
  [REASONS.CONDITION_FAILED]: 'This connection point is not available with the current options.',
  [REASONS.ALREADY_OCCUPIED]: 'Something is already connected there.',
  [REASONS.TOO_FAR]: 'Move the parts closer together.',
  [REASONS.FACING_WRONG]: 'These faces point the same way — turn one of the parts around.',
};

/**
 * Stage 1 only. Cheap, no geometry, so it can run across every snap in a
 * catalogue to answer "what could possibly go here" before anything is dragged.
 *
 * @param a {{ mask, condition?, occupied? }}
 * @param b {{ mask, condition?, occupied? }}
 * @param ctx {{ evaluateCondition?: (expr) => boolean, sameInstance?: boolean }}
 */
export function canConnectLogically(a, b, ctx = {}) {
  if (ctx.sameInstance) return { ok: false, reason: REASONS.SAME_INSTANCE };
  if (a.mask !== b.mask) return { ok: false, reason: REASONS.MASK_MISMATCH };
  if (a.occupied || b.occupied) return { ok: false, reason: REASONS.ALREADY_OCCUPIED };

  // Conditions are expressions in Phase 1. Until the evaluator exists, a
  // condition with no evaluator supplied is treated as unmet rather than met —
  // failing closed, so an unevaluated rule never silently permits a bad joint.
  const evaluate = ctx.evaluateCondition;
  for (const snap of [a, b]) {
    if (snap.condition == null) continue;
    if (!evaluate || !evaluate(snap.condition)) {
      return { ok: false, reason: REASONS.CONDITION_FAILED };
    }
  }

  return { ok: true, reason: REASONS.OK };
}

/**
 * Stage 2. Both snaps must already be expressed in WORLD space.
 *
 * @param a {{ worldPosition, worldFacing }}
 * @param b {{ worldPosition, worldFacing }}
 */
export function canConnectGeometrically(a, b, {
  positionTolerance = DEFAULT_POSITION_TOLERANCE,
  facingTolerance = DEFAULT_FACING_TOLERANCE,
} = {}) {
  const distance = length(sub(a.worldPosition, b.worldPosition));
  if (distance > positionTolerance) {
    return { ok: false, reason: REASONS.TOO_FAR, distance };
  }

  const alignment = dot(normalise(a.worldFacing), normalise(b.worldFacing));
  if (alignment > facingTolerance) {
    return { ok: false, reason: REASONS.FACING_WRONG, alignment };
  }

  return { ok: true, reason: REASONS.OK, distance, alignment };
}

/** Both stages, in order. */
export function canConnect(a, b, ctx = {}, tolerances = {}) {
  const logical = canConnectLogically(a, b, ctx);
  if (!logical.ok) return logical;
  return canConnectGeometrically(a, b, tolerances);
}

/**
 * The best candidate joint between a moving part and everything already placed.
 *
 * Returns the closest valid pair, or null. Rejections are collected so the UI
 * can explain WHY nothing snapped — "turn the part around" is a far better
 * message than a part that simply refuses to stick with no explanation.
 */
export function findBestConnection(movingSnaps, placedSnaps, ctx = {}, tolerances = {}) {
  let best = null;
  const rejections = [];

  for (const moving of movingSnaps) {
    for (const placed of placedSnaps) {
      const result = canConnect(moving, placed, {
        ...ctx,
        sameInstance: moving.instanceId === placed.instanceId,
      }, tolerances);

      if (!result.ok) {
        // Only worth surfacing near misses; a mask mismatch across the room is noise.
        if (result.reason !== REASONS.SAME_INSTANCE) {
          rejections.push({ moving, placed, ...result });
        }
        continue;
      }

      if (!best || result.distance < best.distance) {
        best = { moving, placed, ...result };
      }
    }
  }

  return { best, rejections };
}

/**
 * The single most useful rejection to show a person, chosen by how close they
 * came. Facing and occupancy problems mean "you nearly had it"; a mask mismatch
 * means "this was never going to work", so it ranks last.
 */
export function mostRelevantRejection(rejections) {
  if (!rejections?.length) return null;

  const rank = {
    [REASONS.FACING_WRONG]: 0,
    [REASONS.ALREADY_OCCUPIED]: 1,
    [REASONS.CONDITION_FAILED]: 2,
    [REASONS.TOO_FAR]: 3,
    [REASONS.MASK_MISMATCH]: 4,
  };

  const sorted = [...rejections].sort((x, y) => {
    const byRank = (rank[x.reason] ?? 9) - (rank[y.reason] ?? 9);
    if (byRank !== 0) return byRank;
    return (x.distance ?? Infinity) - (y.distance ?? Infinity);
  });

  const top = sorted[0];
  return { ...top, message: REASON_TEXT[top.reason] || 'These parts do not fit together.' };
}
