// Parts that are FITTED AS A CONSEQUENCE, not chosen.
//
// Matt's question was "is the foot an option that can be added or not?", and
// the answer he picked was: stay an option, but make it real. That turns out to
// need a mechanism rather than a special case, because the foot is not the only
// thing in this range that nobody clicks and everybody gets.
//
//   * the adjustable foot, one per ladder, when the bay stands on feet
//   * the wall fixings, two per ladder, always - every YouK frame is wall-fixed
//   * the 1.5mm packers, one at every joint the instruction sheets bolt through
//
// A configurator that shows none of these prices a job that cannot be
// installed, and one that makes the customer tick "feet" AND "4 x foot" is
// asking them to do arithmetic the model already knows.
//
// THE RULE THIS FILE IS BUILT ON, and it is the project's central idea applied
// one level up: an implied part is DERIVED, never stored. Nothing is written
// into assembly.instances. Ask for them again after any change and you get the
// right answer, because there was never a second copy of the truth to fall out
// of step. It also means a person cannot delete a foot while the bay is
// standing on feet, which would otherwise be a bug waiting to be filed.
//
// WHAT IS RANGE DATA AND WHAT IS MECHANISM. The masks, the component id and the
// quantities below are YouK's, and they are gathered at the top so they are
// easy to find when a second range arrives. Everything under them is general:
// "an unfilled socket of mask M implies component C, mated at label L" is not a
// fact about shelving. `ar.js` already holds MOUNTING and FOOT the same way.

import { worldSnaps } from './assembly.js';
import { attachAt } from './attach.js';
import { MOUNTING, FOOT } from './ar.js';

/** The mask on a frame's underside fixings, and the foot that bolts into it. */
export const FOOT_SOCKET_MASK = 'youk-foot';
export const FOOT_COMPONENT_ID = '237023-adjustable-foot-100mm';
export const FOOT_SNAP_LABEL = 'foot';

/**
 * The label `carries_socket` gives every socket a part offers to what it
 * carries. Kesseböhmer put a 1.5mm packer in every one of those joints -
 * `Carcass holder` step 5, `Office solution` step 7 - so the label counts them.
 *
 * A label rather than a mask because the mask changes per depth and per carried
 * thing (`youk-carcase-d320`, `youk-desktop-d320`) while the label is the
 * pipeline's own word for the joint, written in one place.
 */
export const CARRIES_LABEL = 'carries';

/** Implied instances are prefixed so nothing can mistake one for a real part. */
export const IMPLIED_PREFIX = 'implied:';

/** Is this instance id one of ours? */
export const isImplied = (instanceId) => String(instanceId).startsWith(IMPLIED_PREFIX);

/**
 * Component ids that are never chosen.
 *
 * The palette is built from everything loaded, which is right until a component
 * exists that only the engine may add. Exported so the UI filters on THIS list
 * rather than on a name, and so adding the second implied part is one line
 * here instead of a hunt through the interface.
 */
export function impliedComponentIds() {
  return [FOOT_COMPONENT_ID];
}

/**
 * Everything the current configuration implies.
 *
 * @param assembly
 * @param components  Map<componentId, component>
 * @param options {{ mounting, footHeightMm }}
 * @returns {{
 *   connections: Array<{ instanceId, componentId, hostInstanceId, hostSnapId, mountSnapId, because }>,
 *   notes: Array<{ code, qty, text }>,
 *   refusals: Array<{ code, message }>,
 * }}
 *
 * `connections` are parts with geometry, to be drawn and priced. `notes` are
 * quantities with no part number on file - the plugs, the screws, the packers.
 * They are kept apart on purpose: a note must never become a quote line,
 * because a line without a price is the one thing quote.js exists to refuse.
 */
export function impliedParts(assembly, components, options = {}) {
  const { mounting = MOUNTING.FLOOR } = options;

  const connections = [];
  const notes = [];
  const refusals = [];

  // Occupancy does not depend on where anything is, so identity transforms are
  // enough here and save resolving the whole assembly to count packers.
  // `occupiedCellsFor` uses the same trick for the same reason.
  const identity = new Map(
    (assembly?.instances || []).map((i) => [
      i.instanceId, { translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ]),
  );
  const snaps = worldSnaps(assembly || { instances: [], connections: [] }, components, identity);

  // ---- The foot -----------------------------------------------------------
  //
  // One per ladder, at the front, and only when the bay stands on feet. The
  // socket is the frame's own measured underside fixing, so a frame that does
  // not have one does not get a foot - which is the 200mm ladders, whose
  // undersides carry corner radii and nothing else.
  if (mounting === MOUNTING.FEET) {
    const hosts = snaps.filter(
      (s) => s.mask === FOOT_SOCKET_MASK && s.label === FOOT_SNAP_LABEL && !s.occupied,
    );

    for (const host of hosts) {
      const foot = components?.get(FOOT_COMPONENT_ID);
      const mount = foot?.snaps?.find((s) => s.mask === FOOT_SOCKET_MASK);
      if (!mount) continue;
      for (let n = 0; n < FOOT.perLadder; n += 1) {
        connections.push({
          instanceId: `${IMPLIED_PREFIX}foot:${host.instanceId}:${n}`,
          componentId: FOOT_COMPONENT_ID,
          hostInstanceId: host.instanceId,
          hostSnapId: host.snapId,
          mountSnapId: mount.id,
          because: 'One adjustable foot per ladder, at the front — mounting instructions Foot.pdf.',
        });
      }
    }

    // A ladder with no foot fixing while the bay is meant to stand on feet is
    // not a missing part, it is a configuration that cannot be built. Said
    // plainly, once, rather than per ladder.
    //
    // "Is it a ladder" is asked as "is it wall-fixed", off the declaration,
    // rather than by matching a label. A rule that reads part names is a rule
    // that breaks on the next range, and this file has already been careful
    // once about which of its constants are YouK's.
    const footless = (assembly?.instances || []).filter((i) => {
      const c = components?.get(i.componentId);
      return (c?.wallFixings || 0) > 0
        && !(c.snaps || []).some((s) => s.mask === FOOT_SOCKET_MASK);
    });
    if (footless.length) {
      refusals.push({
        code: 'NO_FOOT_FIXING',
        message: footless.length === 1
          ? 'One ladder in this configuration has no fixing for a foot — the 200 mm frames '
            + 'do not have them. Stand it on the floor, or hang it on the wall.'
          : `${footless.length} ladders in this configuration have no fixing for a foot — the `
            + '200 mm frames do not have them. Stand it on the floor, or hang it on the wall.',
      });
    }
  }

  // ---- The wall fixings ---------------------------------------------------
  //
  // Every frame is wall-fixed, whatever is happening underneath: the brochure's
  // three options are three GROUND conditions, not three fixings (see FOOT in
  // ar.js). So this is not conditional on the mounting.
  //
  // Two per frame, measured off the +z face: a 6.5mm slot near the bottom and
  // another near the top, and step 2 marks the wall 55mm from the frame's top,
  // which is the upper slot's centre exactly. The 10mm rings beside them are
  // not fixings.
  const wallFixings = (assembly?.instances || []).reduce(
    (n, i) => n + (components?.get(i.componentId)?.wallFixings || 0), 0,
  );
  if (wallFixings) {
    notes.push({
      code: 'WALL_FIXINGS',
      qty: wallFixings,
      text: `${wallFixings} wall fixings — Kesseböhmer's sheet specifies 8 × 50 plugs and a `
        + 'cover cap for each. Not supplied as a part number here; the installer chooses '
        + 'the fixing to suit the wall.',
    });
  }

  // ---- The packers --------------------------------------------------------
  //
  // Two populations, both counted off the joints rather than declared:
  //
  //   * a rung carrying TWO things — a shelf resting on it and an accessory
  //     hooked over it — which the suspension-element and hook-rail sheets bolt
  //     together through a packer.
  //   * every `carries` joint, where a bracket or an arm has something laid on
  //     it: `Carcass holder` step 5 and `Office solution` step 7 both put one
  //     in. Those are already in the geometry — the socket sits a packer above
  //     the part's own top face — so this counts a packer that is being drawn,
  //     not one being invented.
  const sharedRungs = snaps.filter(
    (s) => s.role === 'socket' && (s.occupiedSides?.length || 0) >= 2,
  ).length;

  const carried = (assembly?.connections || []).filter((c) => {
    const from = snapOf(assembly, components, c.fromInstanceId, c.fromSnapId);
    const to = snapOf(assembly, components, c.toInstanceId, c.toSnapId);
    return from?.label === CARRIES_LABEL || to?.label === CARRIES_LABEL;
  }).length;

  const packers = sharedRungs + carried;
  if (packers) {
    notes.push({
      code: 'PACKERS',
      qty: packers,
      text: `${packers} × 1.5 mm packer — ${sharedRungs} where a rung carries two parts bolted `
        + `together, ${carried} between a bracket and what is laid on it. Supplied with the `
        + 'part in Kesseböhmer\'s kits; listed here so an installer can check they are there.',
    });
  }

  return { connections, notes, refusals };
}

/** One snap on one instance, or null. */
function snapOf(assembly, components, instanceId, snapId) {
  const instance = (assembly?.instances || []).find((i) => i.instanceId === instanceId);
  const component = instance && components?.get(instance.componentId);
  return component?.snaps?.find((s) => s.id === snapId) || null;
}

/**
 * The assembly with its implied parts attached, for resolving and drawing.
 *
 * A scratch copy — the real assembly is never touched. Built with `attachAt`
 * rather than by hand so an implied part is placed by exactly the same solver,
 * through exactly the same joint, as one somebody clicked. That is the point of
 * having measured the foot's holes: the position is a consequence of the
 * geometry, not a number typed into this file.
 */
export function withImplied(assembly, components, options = {}) {
  const { connections } = impliedParts(assembly, components, options);
  let out = assembly;
  for (const c of connections) {
    out = attachAt(out, {
      point: { instanceId: c.hostInstanceId, snapId: c.hostSnapId },
      componentId: c.componentId,
      mountSnapId: c.mountSnapId,
    }, c.instanceId);
  }
  return out;
}

/**
 * Implied parts as bill-of-materials rows, ready to sit alongside the chosen
 * ones.
 *
 * Marked `implied: true` so a quote can show them as "included because" rather
 * than as something the customer picked. Nothing here prices anything — that
 * stays in quote.js, which will report them unpriced until Kesseböhmer's list
 * arrives, exactly like every other line.
 */
export function impliedBom(assembly, components, options = {}) {
  const { connections } = impliedParts(assembly, components, options);
  const counts = new Map();
  for (const c of connections) {
    const row = counts.get(c.componentId)
      || { componentId: c.componentId, qty: 0, implied: true, because: c.because };
    row.qty += 1;
    counts.set(c.componentId, row);
  }
  return [...counts.values()].sort((a, b) => a.componentId.localeCompare(b.componentId));
}
