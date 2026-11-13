// The one judge (docs/design/A2-rule-model.md §3).
//
// "Is this product legal, and if not, why" - asked of the product as it stands,
// from where its parts actually are, by everything that places, moves, offers,
// validates or quotes. The audit found six paths asking six slightly different
// questions; this is the question, once.
//
// It knows contacts, families, ends, floors and sentences. Everything specific
// to a range - which family must be held at both ends, what a refusal says, where
// the rule came from - comes from the range's rules (rules.js).

import { resolveTransforms, worldSnaps, inContact, backToFrontParts } from './assembly.js';
import { overlaps, boxesFor } from './collision.js';
import { isGrounded, MOUNTING, groundClearanceMm } from './ar.js';
import { DEFAULT_RULES, sentence } from './rules.js';

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The instances that touch each other: recorded joints plus every snap contact. */
export function contactPairs(assembly, snaps) {
  const pairs = new Set((assembly.connections || []).map((c) => pairKey(c.fromInstanceId, c.toInstanceId)));
  const real = snaps.filter((s) => !s.isGridCell && s.role);
  for (const a of real) {
    if (a.role !== 'socket') continue;
    for (const b of real) {
      if (b.role === 'plug' && b.instanceId !== a.instanceId && inContact(a, b)) pairs.add(pairKey(a.instanceId, b.instanceId));
    }
  }
  return pairs;
}

/** A world-axis box around every box a part occupies (parts here only ever yaw). */
function worldAabb(component, transform) {
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxesFor(component, transform)) {
    for (let k = 0; k < 3; k += 1) {
      const e = b.axes.reduce((s, ax, i) => s + Math.abs(ax[k]) * b.half[i], 0);
      lo[k] = Math.min(lo[k], b.centre[k] - e);
      hi[k] = Math.max(hi[k], b.centre[k] + e);
    }
  }
  return lo[0] === Infinity ? null : { lo, hi };
}

const volume = (b) => (b.hi[0] - b.lo[0]) * (b.hi[1] - b.lo[1]) * (b.hi[2] - b.lo[2]);
function sharedShare(a, b) {
  let v = 1;
  for (let k = 0; k < 3; k += 1) v *= Math.max(0, Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]));
  const smaller = Math.min(volume(a), volume(b));
  return smaller > 0 ? v / smaller : 0;
}

/**
 * Everything wrong with a product, as sentences.
 *
 * @param {object} assembly
 * @param {Map} components
 * @param {object} [rules]   from parseRules; the physical defaults if omitted
 * @param {object} [opts]
 * @param {string} [opts.mounting]   floor | feet | wall
 * @param {Map}    [opts.transforms] if already resolved
 * @param {string} [opts.focus]      only reasons that involve this instance -
 *   what a placement asks: "does putting THIS here break anything"
 * @param {string[]} [opts.skip]     rules not to ask. Only for a product half
 *   way through being built: a bay's shelf is held at one end until the next
 *   ladder is hung from its other end, and "held" is a fact about the finished
 *   product, not about step three of making it.
 * @returns {Array<{rule, says, instanceId, componentId, otherId?, source?}>}
 */
export function judge(assembly, components, rules = DEFAULT_RULES, {
  mounting = MOUNTING.FLOOR, transforms = null, focus = null, skip = [], footHeightMm = undefined,
} = {}) {
  const t = transforms || resolveTransforms(assembly, components).transforms;
  const instances = (assembly.instances || []).filter((i) => components.get(i.componentId) && t.get(i.instanceId));
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const label = (id) => rules.labelOf?.(byId.get(id)?.componentId) || byId.get(id)?.componentId || id;
  const familyOf = (id) => rules.familyOf?.(byId.get(id)?.componentId) || null;
  const involves = (...ids) => !focus || ids.includes(focus);
  const snaps = worldSnaps(assembly, components, t);
  const touching = contactPairs(assembly, snaps);
  const reasons = [];
  const say = (r, text, values, extra) => {
    if (skip.includes(r.rule || r)) return;
    reasons.push({ rule: r.rule || r, says: sentence(text, values), source: r.source, ...extra });
  };

  // Held: a family's own requirement, read from its plugs and what touches them.
  for (const i of instances) {
    if (!involves(i.instanceId)) continue;
    const fam = rules.families?.[familyOf(i.instanceId)];
    if (!fam) continue;
    const plugs = snaps.filter((s) => s.instanceId === i.instanceId && s.role === 'plug' && !s.isGridCell);
    const met = plugs.filter((s) => s.occupied).length;
    if (plugs.length && ((fam.held === 'every-end' && met < plugs.length) || (fam.held === 'any-end' && met === 0))) {
      say({ rule: 'held', source: fam.source }, fam.says, { label: label(i.instanceId) },
        { instanceId: i.instanceId, componentId: i.componentId, held: met, of: plugs.length });
    }
    // A family's own rules apply whether or not it has to be held - a ladder is
    // never "held", and it is the ladder that has no fixing for a foot.
    for (const r of fam.rules || []) {
      if (r.rule === 'mountingNeeds' && mounting === r.mounting
        && !components.get(i.componentId).snaps.some((s) => s.role === 'socket' && s.label === r.socketLabel)) {
        say(r, r.says, { label: label(i.instanceId), mounting }, { instanceId: i.instanceId, componentId: i.componentId });
      }
    }
  }

  // Product rules: true of any range.
  const anchor = assembly.instances?.[0];
  // THE REAL FLOOR. On feet it is the bottom of the foot, not the ladder's base:
  // the product's origin is the anchor ladder's base and the feet stand below
  // it. Measuring from the base refused a side rack on rung 1 that clears the
  // real floor by 41.5 mm on 100 mm feet (found recording Matt's session, 13 Nov).
  const floorY = (t.get(anchor?.instanceId)?.translation[1] ?? 0) - groundClearanceMm(mounting, footHeightMm) / 1000;
  const boxes = new Map(instances.map((i) => [i.instanceId, worldAabb(components.get(i.componentId), t.get(i.instanceId))]));
  for (const r of rules.product || []) {
    if (r.rule === 'notBelowFloor') {
      if (r.when === 'grounded' && !isGrounded(mounting)) continue;
      const tol = (r.toleranceMm ?? 1) / 1000;
      for (const i of instances) {
        const b = boxes.get(i.instanceId);
        if (!involves(i.instanceId) || !b || b.lo[1] >= floorY - tol) continue;
        say(r, r.says, { label: label(i.instanceId), mm: Math.round((floorY - b.lo[1]) * 1000) },
          { instanceId: i.instanceId, componentId: i.componentId });
      }
    } else if (r.rule === 'noPassThrough') {
      for (const o of overlaps(assembly, components, t)) {
        if (!o.through || touching.has(pairKey(o.a, o.b)) || !involves(o.a, o.b)) continue;
        const [me, other] = focus === o.b ? [o.b, o.a] : [o.a, o.b];
        say(r, r.says, { label: label(me), other: label(other) },
          { instanceId: me, componentId: byId.get(me)?.componentId, otherId: other });
      }
    } else if (r.rule === 'notTwiceInOnePlace') {
      for (let x = 0; x < instances.length; x += 1) {
        for (let y = x + 1; y < instances.length; y += 1) {
          const [A, B] = [instances[x], instances[y]];
          if (!involves(A.instanceId, B.instanceId) || touching.has(pairKey(A.instanceId, B.instanceId))) continue;
          if (rules.families?.[familyOf(A.instanceId)]?.hollow || rules.families?.[familyOf(B.instanceId)]?.hollow) continue;
          const ba = boxes.get(A.instanceId);
          const bb = boxes.get(B.instanceId);
          if (!ba || !bb || sharedShare(ba, bb) <= 0.5) continue;
          const [me, other] = focus === B.instanceId ? [B, A] : [A, B];
          say(r, r.says, { label: label(me.instanceId), other: label(other.instanceId) },
            { instanceId: me.instanceId, componentId: me.componentId, otherId: other.instanceId });
        }
      }
    }
  }

  // Built in rather than authored: a part turned to face the wall is wrong in any range.
  for (const b of backToFrontParts(assembly, components, t)) {
    const id = b.instanceId || b;
    if (!involves(id)) continue;
    if (skip.includes('front')) continue;
    reasons.push({ rule: 'front', says: `The ${label(id)} is fitted back to front.`, instanceId: id, componentId: byId.get(id)?.componentId });
  }
  return reasons;
}

/**
 * The reasons a change INTRODUCES - present after, absent before.
 *
 * A placement can be judged on the new part alone; a move cannot. Moving the
 * middle ladder up leaves the first bay's shelf resting on one ladder, and that
 * reason belongs to the shelf, not to the ladder that moved (A3 sweep, 338 cases).
 */
export function introduced(before, after) {
  const key = (r) => `${r.rule}|${r.instanceId}|${r.otherId || ''}`;
  const had = new Set(before.map(key));
  return after.filter((r) => !had.has(key(r)));
}

/**
 * Remove a part AND everything that would then be left without the support its
 * family needs, repeatedly, so nothing is left hanging (the editor's "remove
 * them too", after it has said what they are).
 */
export function removeCascade(assembly, components, rules, instanceId, detach, opts = {}) {
  let { after, leftUnheld, removed } = removalConsequences(assembly, components, rules, instanceId, detach, opts);
  removed = [...removed];
  for (let guard = 0; leftUnheld.length && guard < 50; guard += 1) {
    const next = removalConsequences(after, components, rules, leftUnheld[0].instanceId, detach, opts);
    after = next.after;
    removed.push(...next.removed);
    leftUnheld = judge(after, components, rules, opts).filter((r) => r.rule === 'held');
  }
  return { assembly: after, removed };
}

/**
 * What removing a part does to the rest of the product (A2 §2; Matt, 12 Nov 2026:
 * "refused with reason or alert the user the consequences").
 *
 * @returns {{ removed: string[], leftUnheld: Array<{instanceId, componentId, says}> }}
 *   `removed` is the part and everything recorded as hanging from it; `leftUnheld`
 *   is what would then stay in the product without the support its family needs -
 *   the cantilevers A1 F06 found the editor leaving behind, 19 times in 19.
 */
export function removalConsequences(assembly, components, rules, instanceId, detach, opts = {}) {
  const after = detach(assembly, instanceId);
  const before = new Set(judge(assembly, components, rules, opts).filter((r) => r.rule === 'held').map((r) => r.instanceId));
  const leftUnheld = judge(after, components, rules, opts)
    .filter((r) => r.rule === 'held' && !before.has(r.instanceId))
    .map(({ instanceId: id, componentId, says }) => ({ instanceId: id, componentId, says }));
  return { removed: after.removed || [instanceId], leftUnheld, after };
}
