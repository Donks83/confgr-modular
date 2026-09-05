// "What can go where" — the one query both attach flows are built on.
//
// The anchored-product model (plan section 2A) replaced dragging with clicking
// an attach point. That turns out to need only ONE function, because the two
// orders a person might work in are the same data filtered two ways:
//
//   Point first — click a marker, see the parts that fit there.
//   Part first  — pick a part, see the points it could go on.
//
// So this builds a list of valid (point, part, mount) triples once, and the UI
// filters it. There is no second code path for the second flow, which is why
// supporting both was cheap rather than twice the work.
//
// Grid cells appear in the list exactly like authored points, with one extra
// rule: a spanning part must FIT at that cell and none of the cells it would
// cover may be taken. A 3x2 pouch therefore shows fewer markers than a 1x1 one
// on the same panel, which is the correct and useful behaviour.

import { worldSnaps, resolveTransforms } from './assembly.js';
import { canConnectLogically, REASONS, REASON_TEXT } from './snapMatch.js';
import { snapBearingSide } from './component.js';
import { parseGridCellId, cellsCovered, spanFits } from './grid.js';

/** Stable key for an attach point: which instance, which point on it. */
export const pointKey = (p) => `${p.instanceId}::${p.snapId}`;

/**
 * Every legal placement, given what is on the product now and what is in the
 * catalogue.
 *
 * @param assembly    the current assembly
 * @param components  Map<componentId, component> — everything loaded
 * @param catalogue   componentIds a person is allowed to add
 * @param transforms  from resolveTransforms, so points are in world space
 * @param ctx         { evaluateCondition } for conditional points, Phase 1
 */
export function attachMatrix(assembly, components, catalogue, transforms, ctx = {}) {
  const allPoints = worldSnaps(assembly, components, transforms);

  // Occupied grid cells, per instance and grid, so span overlap can be tested
  // without recomputing it for every candidate part.
  const takenCells = new Map();
  for (const p of allPoints) {
    if (!p.isGridCell || !p.occupied) continue;
    const key = `${p.instanceId}::${p.gridId}`;
    if (!takenCells.has(key)) takenCells.set(key, new Set());
    takenCells.get(key).add(`c${p.col}r${p.row}`);
  }

  const gridOf = (instanceId, gridId) => {
    const instance = (assembly.instances || []).find((i) => i.instanceId === instanceId);
    const component = instance && components.get(instance.componentId);
    return (component?.grids || []).find((g) => g.id === gridId) || null;
  };

  const placements = [];
  const rejected = [];

  for (const point of allPoints) {
    // A rung carries two things at once, and Kesseböhmer's own instructions say
    // so: a shelf RESTS ON it while a hook rail or a YouboXx HOOKS OVER the same
    // rung and hangs beneath, the two then bolted together through a 1.5 mm
    // packer. So a SOCKET is full only when both sides of it are taken.
    //
    // A plug is different and stays exclusive. A shelf's end plug holds one
    // frame; nothing in the range hangs a second part off the same plug, and
    // allowing it would let two frames meet one shelf end at the same instant.
    // Grid cells are excluded: a covered cell is covered, and grid overlap is
    // already handled properly below by cellsCovered. Letting a cell be "half
    // taken" would put two pouches in one square.
    const shareable = point.role === 'socket' && !point.isGridCell;
    const takenSides = new Set(shareable ? point.occupiedSides || [] : []);

    // An occupied point is recorded as a rejection rather than skipped
    // silently, so whyNothingFits can answer for EVERY point. A function that
    // returns null half the time pushes that gap into the UI.
    if (point.occupied && (!shareable || takenSides.size >= 2)) {
      rejected.push({
        point, componentId: null, mountSnapId: null,
        ok: false, reason: REASONS.ALREADY_OCCUPIED,
        message: shareable
          ? 'This rung already carries something above and below it.'
          : 'Something is already fitted here.',
      });
      continue;
    }

    for (const componentId of catalogue) {
      const candidate = components.get(componentId);
      if (!candidate) continue;

      for (const mount of candidate.snaps) {
        // The half of the point this particular part would fill.
        if (takenSides.size) {
          const side = snapBearingSide(candidate, mount.id);
          if (takenSides.has(side)) {
            rejected.push({
              point, componentId, mountSnapId: mount.id,
              ok: false, reason: REASONS.ALREADY_OCCUPIED,
              message: side === 'above'
                ? 'Something already rests on this rung.'
                : 'Something already hangs from this rung.',
            });
            continue;
          }
        }

        // Stage 1: logical. Masks and conditions, no geometry. Identical to the
        // check the old drag path used, so the rules did not change with the
        // interaction.
        //
        // The occupancy question has already been settled above, per side, so a
        // shareable point is presented as free here. Leaving it set would have
        // canConnectLogically refuse on ALREADY_OCCUPIED for a rung that still
        // has its underside going spare - the exact case this all exists for.
        const logical = canConnectLogically(
          mount, shareable ? { ...point, occupied: false } : point, ctx,
        );
        if (!logical.ok) {
          rejected.push({ point, componentId, mountSnapId: mount.id, ...logical });
          continue;
        }

        // Stage 2 for grids: does the footprint fit, and is it clear?
        const span = mount.span || { cols: 1, rows: 1 };

        if (point.isGridCell) {
          const grid = gridOf(point.instanceId, point.gridId);
          if (!grid) continue;

          if (!spanFits(grid, point.col, point.row, span)) {
            rejected.push({
              point, componentId, mountSnapId: mount.id,
              ok: false, reason: REASONS.TOO_FAR,
              message: `A ${span.cols}x${span.rows} part does not fit here — it would run off the edge.`,
            });
            continue;
          }

          const taken = takenCells.get(`${point.instanceId}::${point.gridId}`) || new Set();
          const covered = cellsCovered(point.col, point.row, span);
          if (covered.some((c) => taken.has(c))) {
            rejected.push({
              point, componentId, mountSnapId: mount.id,
              ok: false, reason: REASONS.ALREADY_OCCUPIED,
              message: `A ${span.cols}x${span.rows} part would overlap something already fitted.`,
            });
            continue;
          }
        } else if (mount.span) {
          // A spanning part needs a grid. Offering it an authored single point
          // would place it by its footprint centre against a point that has no
          // footprint — geometrically meaningless.
          continue;
        }

        placements.push({
          pointKey: pointKey(point),
          point,
          componentId,
          mountSnapId: mount.id,
          // The snap itself, not just its id. Two placements at one point differ
          // ONLY by this, so anything asking a person to choose between them
          // needs its label and its height without a second lookup.
          mountSnap: mount,
          span: mount.span || null,
        });
      }
    }
  }

  return { placements, rejected };
}

/** Distinct attach points that could take this component. Part-first flow. */
export function pointsForComponent(matrix, componentId) {
  const seen = new Set();
  const out = [];
  for (const p of matrix.placements) {
    if (p.componentId !== componentId) continue;
    if (seen.has(p.pointKey)) continue;
    seen.add(p.pointKey);
    out.push(p);
  }
  return out;
}

/**
 * EVERY way one component could sit at one point — one row per mount snap.
 *
 * A joint has two ends and the matrix has always known both: `pointKey` names
 * the end on the product, `mountSnapId` names the end on the part arriving.
 * `pointsForComponent` and `componentsForPoint` both dedupe, which is right for
 * "where can this go" and "what fits here" — and wrong the moment more than one
 * answer shares a point.
 *
 * It usually does. A second ladder offered at a shelf's free end fits by ANY of
 * its own rungs: eight placements, one point, eight heights (see
 * tests/stagger.test.js). The old UI called `.find()` and silently took the
 * first, so the staggered layouts in Kesseböhmer's own photography were
 * unreachable — and, worse, a part could be spun 180° to make the chosen end
 * fit, because the solver always satisfies facing by yawing the child. Matt
 * reported both, separately, and they are the same bug: the interaction named
 * one end and let the engine guess the other.
 *
 * Ordered by how far up the arriving part its snap sits, so a list of these
 * reads bottom-to-top like the thing itself.
 */
export function placementsAt(matrix, key, componentId) {
  return matrix.placements
    .filter((p) => p.pointKey === key && p.componentId === componentId)
    .sort((a, b) => mountHeightMm(a) - mountHeightMm(b));
}

/**
 * How far up the ARRIVING part its own snap sits, in mm.
 *
 * This is the number that distinguishes one placement from another at a shared
 * point, and it is the one a person is actually choosing between: mate by the
 * rung 810 mm up the frame and the frame hangs 810 mm below the shelf.
 *
 * Yaw does not affect it. The solver's only freedom is rotation about the
 * vertical to oppose the facings, and that leaves local y alone — which is why
 * this can be read straight off the component without resolving a transform.
 */
export function mountHeightMm(placement) {
  // Snap positions are in metres — glTF's unit, and what the scene uses. Only
  // the declarations are in millimetres. Getting this backwards would put a
  // frame 810 metres below a shelf and the label would say "0 mm".
  const metres = placement?.mountSnap?.position?.[1];
  return typeof metres === 'number' ? Math.round(metres * 1000) : 0;
}

/**
 * Of those placements, the ones that actually put the part somewhere different.
 *
 * Found by probing rather than by reasoning: attach each candidate to a scratch
 * copy of the assembly, resolve, and keep the first of each distinct resulting
 * pose. Two placements that land the part in the same place at the same angle
 * are the same choice however differently they are wired underneath.
 *
 * This exists because the first version of the chooser asked a question on
 * nearly every click. A 900 shelf meeting a rung can mate by its left plug or
 * its right one; the rung's face already fixes which way the shelf runs, so both
 * end up in the identical place and the question was noise. The frame arriving
 * at that shelf's far end is the opposite case: six rungs, six real heights, and
 * that is the choice worth stopping for.
 *
 * A chooser that fires when there is nothing to choose trains people to click
 * through it, and then it is not there when it matters.
 */
export function distinctPlacements(assembly, components, placements) {
  const seen = new Map();

  for (const p of placements) {
    let key;
    try {
      const probe = attachAt(assembly, p, PROBE_ID);
      const t = resolveTransforms(probe, components).transforms.get(PROBE_ID);
      key = t ? occupiedKey(t, components.get(p.componentId)) : `unresolved:${p.mountSnapId}`;
    } catch {
      // An option the resolver cannot place is still an option the person could
      // pick, and hiding it would be worse than showing it. Keyed by its own id
      // so it survives to be offered - and to fail visibly if chosen.
      key = `unresolved:${p.mountSnapId}`;
    }
    if (!seen.has(key)) seen.set(key, p);
  }

  return [...seen.values()];
}

const PROBE_ID = '__distinct-probe__';

/**
 * WHERE THE PART ENDS UP, not how it is oriented to get there.
 *
 * The first version of this compared poses and was wrong in the case it was
 * written for: mating a symmetric shelf by its right plug instead of its left
 * yaws it 180°, so the quaternions differ while the shelf occupies exactly the
 * same space. A person choosing between those is choosing between two identical
 * pictures.
 *
 * So the key is the part's world-space bounding box, to 0.1 mm. A different
 * height, a different side or a different reach all move it; an end-for-end flip
 * of something symmetric does not.
 *
 * The honest limit: a part whose asymmetry does not change its bounding box - a
 * hook rail with the hooks along one edge, say - would be collapsed when the two
 * options really do look different. Nothing in the range does that today. The
 * fix, when something does, is to compare the silhouette rather than the box;
 * that costs real geometry work and buys nothing yet.
 */
function occupiedKey(t, component) {
  const min = component?.body?.min;
  const max = component?.body?.max;
  if (!min || !max) return `nobody|${(t.translation || []).join(',')}`;

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];

  // All eight corners, because a rotation turns a box into a box with different
  // extents - transforming just min and max would miss that entirely.
  for (let i = 0; i < 8; i += 1) {
    const corner = [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    ];
    const w = rotateByQuat(corner, t.rotation);
    for (let a = 0; a < 3; a += 1) {
      const v = w[a] + (t.translation?.[a] || 0);
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }

  const r = (v) => Math.round(v * 10000) / 10;   // metres -> 0.1 mm
  return `${lo.map(r).join(',')}|${hi.map(r).join(',')}`;
}

/** v rotated by quaternion q = [x, y, z, w]. */
function rotateByQuat(v, q) {
  if (!q || q.length < 4) return v;
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q_vec x v); v' = v + w*t + q_vec x t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/** Distinct components that could go at this point. Point-first flow. */
export function componentsForPoint(matrix, key) {
  const seen = new Set();
  const out = [];
  for (const p of matrix.placements) {
    if (p.pointKey !== key) continue;
    if (seen.has(p.componentId)) continue;
    seen.add(p.componentId);
    out.push(p);
  }
  return out;
}

/** Every point that can take anything at all — what gets a marker drawn. */
export function livePoints(matrix) {
  const seen = new Map();
  for (const p of matrix.placements) {
    if (!seen.has(p.pointKey)) seen.set(p.pointKey, p.point);
  }
  return [...seen.values()];
}

/**
 * Why nothing can go at a point.
 *
 * Worth surfacing: an empty MOLLE cell near the top edge looks identical to a
 * usable one until you know a 2x3 pouch cannot fit there. Saying so is the
 * difference between a UI that feels broken and one that feels considered.
 */
export function whyNothingFits(matrix, key) {
  const reasons = matrix.rejected.filter((r) => pointKey(r.point) === key);
  if (!reasons.length) return null;

  // Prefer a specific geometric reason over a bare mask mismatch, which usually
  // just means "this point is for a different kind of thing".
  const ranked = [...reasons].sort((a, b) => {
    const rank = { [REASONS.ALREADY_OCCUPIED]: 0, [REASONS.TOO_FAR]: 1, [REASONS.CONDITION_FAILED]: 2, [REASONS.MASK_MISMATCH]: 3 };
    return (rank[a.reason] ?? 9) - (rank[b.reason] ?? 9);
  });

  const top = ranked[0];
  return top.message || REASON_TEXT[top.reason] || 'Nothing in the range fits here.';
}

/**
 * Add a part to the assembly at a placement.
 *
 * Returns a NEW assembly. The attached instance carries no coordinates —
 * position stays null and is derived from the graph, exactly as before. The
 * interaction changed; the data model did not.
 */
export function attachAt(assembly, placement, instanceId, selections = {}) {
  return {
    ...assembly,
    instances: [
      ...assembly.instances,
      {
        instanceId,
        componentId: placement.componentId,
        selections,
        position: null,
        rotation: null,
        freeMove: false,
      },
    ],
    connections: [
      ...assembly.connections,
      {
        fromInstanceId: placement.point.instanceId,
        fromSnapId: placement.point.snapId,
        toInstanceId: instanceId,
        toSnapId: placement.mountSnapId,
      },
    ],
  };
}

/**
 * Add a part that joins nothing, at a position of its own.
 *
 * The YouK shoe rack is the first of these and Kesseböhmer's sheet is
 * unambiguous: a spirit level, a drill and wall plugs, with no ladder in it. It
 * is sized to the bay and sits inside the composition, but it touches none of
 * it — which is why it looks attached in the photography and is not.
 *
 * Matt's call on how to handle that: place it in space as a wall-fixed item, so
 * it is there when AR puts the whole thing on a real wall, rather than
 * pretending it bolts to the ladders.
 *
 * So it becomes a SECOND ANCHOR. The assembly model already allowed this — an
 * instance with a real position and `freeMove` is a root, and `resolveTransforms`
 * walks from every root rather than from one — it had simply never been used for
 * anything but the first part. Nothing new in the data model; a use for something
 * that was already true.
 *
 * The position is derived rather than asked for. Free 3D dragging is the thing
 * this whole interaction removed, and reintroducing it for one part would bring
 * back the four bugs that went with it.
 */
export function placeFree(assembly, instanceId, componentId, position, selections = {}) {
  return {
    ...assembly,
    instances: [
      ...assembly.instances,
      {
        instanceId,
        componentId,
        selections,
        position: [...position],
        rotation: [0, 0, 0, 1],
        freeMove: true,
      },
    ],
    connections: [...(assembly.connections || [])],
  };
}

/**
 * Where to put a wall-fixed part so it reads as part of the composition.
 *
 * Centred on the product in X, set back to the product's own back face in Z, and
 * a little above the floor — which is where a shoe rack goes, and near enough
 * for everything else that the customer can see what they have bought.
 *
 * Deliberately not clever. The honest position is the one the installer chooses
 * with a spirit level, and no amount of arithmetic here knows it.
 */
export function freePositionFor(assembly, components, transforms, component) {
  const bounds = assemblyBounds(assembly, components, transforms);
  if (!bounds) return [0, 0, 0];

  // Work from the body's OWN bounds rather than assuming it starts at the
  // origin. The pipeline puts a part's origin at its base centre, so a shoe
  // rack's body runs from -449 to +449 in x - subtracting half its width from
  // the product's centre would offset it by a whole width. The first version
  // did exactly that and a test fixture caught it.
  const min = component?.body?.min || [0, 0, 0];
  const max = component?.body?.max || [0, 0, 0];
  const bodyCentreX = (min[0] + max[0]) / 2;

  return [
    (bounds.min[0] + bounds.max[0]) / 2 - bodyCentreX,
    bounds.min[1] + DEFAULT_WALL_HEIGHT_M - min[1],
    bounds.min[2] - min[2],
  ];
}

/** 150 mm off the floor: clear of a skirting board, under the lowest shelf. */
const DEFAULT_WALL_HEIGHT_M = 0.15;

/** World-space bounds of everything currently placed, or null if nothing is. */
function assemblyBounds(assembly, components, transforms) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let any = false;

  for (const instance of assembly?.instances || []) {
    const t = transforms?.get(instance.instanceId);
    const body = components?.get(instance.componentId)?.body;
    if (!t || !body) continue;
    any = true;
    for (let a = 0; a < 3; a += 1) {
      // Axis-aligned is enough here: this decides where to park a part, not
      // whether anything fits.
      const min = body.min[a] + (t.translation?.[a] || 0);
      const max = body.max[a] + (t.translation?.[a] || 0);
      if (min < lo[a]) lo[a] = min;
      if (max > hi[a]) hi[a] = max;
    }
  }

  return any ? { min: lo, max: hi } : null;
}

/**
 * Remove a part, and everything hanging off it.
 *
 * A pouch on a panel has nothing under it, but a shelf carrying a divider does,
 * and leaving an orphan behind is the bug that made the old drag path teleport
 * parts to the origin. Cascade rather than orphan.
 */
export function detach(assembly, instanceId) {
  // A connection's `to` side is the attached child, so the part and everything
  // it carries goes — see subtreeOf.
  const doomed = subtreeOf(assembly, instanceId);

  return {
    ...assembly,
    instances: assembly.instances.filter((i) => !doomed.has(i.instanceId)),
    connections: assembly.connections.filter(
      (c) => !doomed.has(c.fromInstanceId) && !doomed.has(c.toInstanceId),
    ),
    removed: [...doomed],
  };
}

/**
 * The part itself, plus everything hanging off it.
 *
 * Shared by detach (which deletes the lot) and moveTo (which carries the lot).
 * Same walk, two very different intentions, which is why it is now named.
 */
export function subtreeOf(assembly, instanceId) {
  const inSubtree = new Set([instanceId]);

  let grew = true;
  while (grew) {
    grew = false;
    for (const c of assembly.connections || []) {
      if (inSubtree.has(c.fromInstanceId) && !inSubtree.has(c.toInstanceId)) {
        inSubtree.add(c.toInstanceId);
        grew = true;
      }
    }
  }

  return inSubtree;
}

/** Snap ids on one instance that already have something in them. */
function occupiedSnapsOf(assembly, instanceId) {
  const out = new Set();
  for (const c of assembly.connections || []) {
    if (c.fromInstanceId === instanceId) out.add(c.fromSnapId);
    if (c.toInstanceId === instanceId) out.add(c.toSnapId);
  }
  return out;
}

/** The one connection that holds a part on. Null for a root, or if it is ambiguous. */
export function mountingConnection(assembly, instanceId) {
  const incoming = (assembly.connections || []).filter((c) => c.toInstanceId === instanceId);
  return incoming.length === 1 ? incoming[0] : null;
}

/**
 * Can this part be moved at all?
 *
 * Only a part that HANGS off something can be re-hung: the move is a rewiring
 * of one connection, so there has to be exactly one to rewire. The first part
 * on the product is the anchor and has nothing holding it, which is why picking
 * it up does nothing — that is the anchored-product model working, not a bug,
 * and the UI should say so rather than offer a drag that cannot land.
 */
export function canMove(assembly, instanceId) {
  const exists = (assembly.instances || []).some((i) => i.instanceId === instanceId);
  if (!exists) return { ok: false, reason: 'not-in-assembly' };

  const instance = assembly.instances.find((i) => i.instanceId === instanceId);
  if (instance.position || instance.freeMove) return { ok: false, reason: 'is-anchor' };
  if (!mountingConnection(assembly, instanceId)) return { ok: false, reason: 'is-anchor' };

  return { ok: true };
}

/**
 * Where an already-placed part could be re-hung.
 *
 * Matt asked to "click and drag an object to a different snap point (not to
 * drag it anywhere in 3d space)". This is that question, and the answer costs
 * almost nothing because positions are derived: rewire the one connection and
 * the part AND EVERYTHING IT CARRIES follows. A shelf with three dividers on it
 * moves as a unit with no extra code, because none of those dividers ever knew
 * where they were.
 *
 * Two exclusions matter and both are about not eating your own tail:
 *   * No point inside the moving part's own subtree. Hanging a shelf off a
 *     divider that the shelf is carrying is a cycle, and the resolver would end
 *     up deriving the shelf's position from itself.
 *   * No mount snap that the part's own children are using. Its left mount is
 *     not free if a divider is in it.
 *
 * The part's CURRENT point is deliberately left in — a move that puts it back
 * where it was is a legal no-op, and filtering it out would make the marker it
 * came from vanish mid-drag.
 */
export function moveTargets(assembly, components, transforms, instanceId, ctx = {}) {
  const allowed = canMove(assembly, instanceId);
  if (!allowed.ok) return { placements: [], rejected: [], blocked: allowed.reason };

  const moving = assembly.instances.find((i) => i.instanceId === instanceId);
  if (!components.get(moving.componentId)) {
    return { placements: [], rejected: [], blocked: 'component-missing' };
  }

  // Vacate the point it is on before asking what is free, or its own current
  // point reads as occupied and the no-op move disappears.
  const held = mountingConnection(assembly, instanceId);
  const vacated = {
    ...assembly,
    connections: (assembly.connections || []).filter((c) => c !== held),
  };

  // The moving cluster floats to the origin in this hypothetical, which is
  // harmless: every point it owns is filtered out below, and nothing here does
  // a proximity test on authored points.
  const { transforms: vacatedTransforms } = resolveTransforms(vacated, components);

  const matrix = attachMatrix(
    vacated, components, [moving.componentId], vacatedTransforms, ctx,
  );

  const ownSubtree = subtreeOf(vacated, instanceId);
  const busyMounts = occupiedSnapsOf(vacated, instanceId);

  const keep = (row) => !ownSubtree.has(row.point.instanceId)
    && !busyMounts.has(row.mountSnapId);

  return {
    placements: matrix.placements.filter(keep).map((p) => ({ ...p, instanceId })),
    rejected: matrix.rejected.filter((r) => !ownSubtree.has(r.point.instanceId)),
    blocked: null,
  };
}

/**
 * Re-hang a part at a different point.
 *
 * Returns a NEW assembly. Nothing about the part's own record changes — it had
 * no coordinates to update, which is the whole reason this is four lines rather
 * than a transform-rebasing exercise across its children.
 */
export function moveTo(assembly, instanceId, placement) {
  const held = mountingConnection(assembly, instanceId);
  if (!held) {
    throw new Error(
      `Part "${instanceId}" is the anchor of this product, so there is no connection to move.`,
    );
  }

  if (subtreeOf(assembly, instanceId).has(placement.point.instanceId)) {
    throw new Error(
      `Part "${instanceId}" cannot be hung off "${placement.point.instanceId}", which it is `
      + 'carrying — that would make a loop.',
    );
  }

  return {
    ...assembly,
    connections: (assembly.connections || []).map((c) => (c === held ? {
      fromInstanceId: placement.point.instanceId,
      fromSnapId: placement.point.snapId,
      toInstanceId: instanceId,
      toSnapId: placement.mountSnapId,
    } : c)),
  };
}
