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
  ROLE_CLASH: 'role-clash',
  TOO_FAR: 'too-far',
  FACING_WRONG: 'facing-wrong',
  FRONT_REVERSED: 'front-reversed',
};

export const REASON_TEXT = {
  [REASONS.SAME_INSTANCE]: 'A part cannot connect to itself.',
  [REASONS.MASK_MISMATCH]: 'These are different kinds of joint and do not fit together.',
  [REASONS.CONDITION_FAILED]: 'This connection point is not available with the current options.',
  [REASONS.ALREADY_OCCUPIED]: 'Something is already connected there.',
  [REASONS.ROLE_CLASH]: 'These are both the same kind of fitting — one has to be a mount and the other a mounting point.',
  [REASONS.TOO_FAR]: 'Move the parts closer together.',
  [REASONS.FACING_WRONG]: 'These faces point the same way — turn one of the parts around.',
  [REASONS.FRONT_REVERSED]: 'Fitting it here would put it back to front.',
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

  // ROLES — added 3 Sep after a real bug. A snap either OFFERS a place
  // (socket) or TAKES one (plug), and two of the same kind must never join.
  //
  // Why this and not a facing check, which was the obvious first guess: the
  // solver ALWAYS succeeds on facing. Given two same-facing snaps it simply
  // yaws the child 180 degrees to make them oppose. So facing can never fail
  // at an authored point — it just silently flips the part. That is exactly
  // what let an upright attach to another upright and pass through a shelf.
  //
  // This is Roomle's parentDockings/childDockings distinction, which their docs
  // describe as sockets a parent offers versus plugs a child presents. A null
  // role means "either", which is what a plain chain of identical parts wants.
  if (a.role && b.role && a.role === b.role) {
    return { ok: false, reason: REASONS.ROLE_CLASH };
  }

  // CONDITIONS. A snap may say it is only legal against certain other snaps.
  // The range's first real case is Kesseböhmer's: the office-solution arm may
  // be fitted at rung 3 and above and nowhere else, which their sheet states
  // with a tick and a cross and nothing in mask-and-role can express. A mask
  // says what KIND of thing fits; a role says which way round; neither can say
  // "this kind, but only there".
  //
  // Still fails closed. A condition the evaluator does not understand refuses
  // the joint rather than waving it through, so a rule that is mis-authored is
  // visible as a part that will not fit rather than invisible as a rule that
  // quietly does nothing.
  const evaluate = ctx.evaluateCondition || evaluateCondition;
  for (const [snap, other] of [[a, b], [b, a]]) {
    if (snap.condition == null) continue;
    if (!evaluate(snap.condition, { self: snap, other })) {
      return {
        ok: false,
        reason: REASONS.CONDITION_FAILED,
        // Authored alongside the rule, so the app can say WHY rather than
        // "not available". A configurator that refuses without a reason is
        // indistinguishable from one that is broken.
        message: typeof snap.condition?.because === 'string'
          ? snap.condition.because
          : undefined,
      };
    }
  }

  return { ok: true, reason: REASONS.OK };
}

/**
 * The built-in condition evaluator.
 *
 * Deliberately NOT an expression language. A condition is a small declarative
 * object with a closed vocabulary, so there is nothing to parse, nothing to
 * execute, and an unrecognised clause is refused rather than guessed at. The
 * expressive version can come later; this exists because the range needs one
 * rule today and an unused field is worth less than a narrow used one.
 *
 * Vocabulary, v1:
 *
 *   otherLabelAnyOf  [string]  the snap on the other end must have one of these
 *                              labels. Authored as an explicit list rather than
 *                              a pattern, and GENERATED from the spec - the
 *                              author writes `minRung: 3` and add-snaps.py
 *                              expands it, so the decision stays a number and
 *                              the list stays mechanical.
 *
 * `because` is documentation for the person, not part of the test.
 */
export function evaluateCondition(condition, { other } = {}) {
  if (condition == null) return true;
  if (typeof condition !== 'object' || Array.isArray(condition)) return false;

  const clauses = Object.keys(condition).filter((k) => k !== 'because');
  if (!clauses.length) return false;

  for (const clause of clauses) {
    switch (clause) {
      case 'otherLabelAnyOf': {
        const allowed = condition.otherLabelAnyOf;
        if (!Array.isArray(allowed)) return false;
        if (!allowed.includes(other?.label)) return false;
        break;
      }
      default:
        return false;   // unknown clause: closed, not open
    }
  }

  return true;
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
