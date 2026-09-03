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
    // An occupied point is recorded as a rejection rather than skipped
    // silently, so whyNothingFits can answer for EVERY point. A function that
    // returns null half the time pushes that gap into the UI.
    if (point.occupied) {
      rejected.push({
        point, componentId: null, mountSnapId: null,
        ok: false, reason: REASONS.ALREADY_OCCUPIED,
        message: 'Something is already fitted here.',
      });
      continue;
    }

    for (const componentId of catalogue) {
      const candidate = components.get(componentId);
      if (!candidate) continue;

      for (const mount of candidate.snaps) {
        // Stage 1: logical. Masks and conditions, no geometry. Identical to the
        // check the old drag path used, so the rules did not change with the
        // interaction.
        const logical = canConnectLogically(mount, point, ctx);
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
