// Working out where every part sits, from who is attached to whom.
//
// THE CENTRAL IDEA, AND IT IS BORROWED DELIBERATELY. Mimeeq stores a connected
// part's position as null, documented as "automatic positioning via connections".
// The assembly does not store coordinates. It stores the graph, and positions
// are derived every time.
//
// That is why their scenes never drift: there is no second copy of the truth to
// fall out of step. Move the root and everything downstream follows because
// nothing downstream ever had an opinion about where it was.
//
// The cost is that this function must be correct and fast, because it runs on
// every change. It is O(parts) with a single breadth-first pass.

import {
  add, sub, rotateVec, multiplyQuat, quatFromYaw, yawOf, normalise, scale, dot,
} from './vec.js';
import {
  isGridCellId, parseGridCellId, gridAttachPoint, expandGridCells, cellsCovered,
} from './grid.js';
import { snapBearingSide } from './component.js';

export class AssemblyError extends Error {
  constructor(message, { code, detail } = {}) {
    super(message);
    this.name = 'AssemblyError';
    this.code = code;
    this.detail = detail;
  }
}

const IDENTITY = { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };

/**
 * Where a child must sit so that its snap meets the parent's snap.
 *
 * Two conditions have to hold at once:
 *   1. The child's snap must face opposite to the parent's snap.
 *   2. The two snap centres must coincide exactly.
 *
 * Rotation is solved as YAW ONLY — a turn about the vertical axis. Infinitely
 * many rotations satisfy condition 1 (you can spin the part about the joint
 * axis), and for floor-standing furniture all but one of them are wrong: a base
 * unit must stay upright. Mimeeq defaults to the same restriction and exposes a
 * `snapUsingNormals` flag to opt out, described as positioning "using snaps
 * normals rather than by forcing euler Y connection". So: forced Y by default,
 * full-normal alignment left as a future per-snap option.
 *
 * VERTICAL JOINTS — one part resting on another's top face — are the exception,
 * added for the YouK carcase and the office desktop. Both are laid ON their
 * brackets and screwed up from below; neither meets anything edge-on, so there
 * is no horizontal facing to solve and the old code refused the joint outright.
 *
 * Yaw is then genuinely undetermined: spinning the part about the vertical
 * leaves two vertical facings opposed. So it has to come from somewhere else,
 * and it is NOT the parent's. A carcase spans two cabinet brackets, one on each
 * ladder of the bay, and those two brackets face opposite ways — inheriting
 * either would put the carcase's door against the wall half the time, depending
 * on which bracket the person happened to click. The product is anchored
 * world-aligned, so the part takes the PRODUCT's orientation: yaw zero.
 *
 * The consequence, stated so nobody trips over it: a part whose orientation must
 * follow its parent cannot use a vertical joint. Everything that sits on top of
 * something is fine, which is the whole set of things this is for.
 *
 * @param parentTransform {{ translation, rotation }} the parent in world space
 * @param parentSnap {{ position, facing }} in parent-local space
 * @param childSnap {{ position, facing }} in child-local space
 */
export function solveChildTransform(parentTransform, parentSnap, childSnap) {
  // The parent's snap, in world space.
  const parentSnapWorldPos = add(
    parentTransform.translation,
    rotateVec(parentTransform.rotation, parentSnap.position),
  );
  const parentSnapWorldFacing = normalise(rotateVec(parentTransform.rotation, parentSnap.facing));

  // The child's snap must look back down the parent's snap normal.
  const targetFacing = scale(parentSnapWorldFacing, -1);

  const targetYaw = yawOf(targetFacing);
  const childYaw = yawOf(childSnap.facing);

  // yawOf returns null for a facing that is straight up or down, so a null here
  // is the test for "this end of the joint is vertical".
  const targetVertical = targetYaw === null;
  const childVertical = childYaw === null;

  if (targetVertical !== childVertical) {
    throw new AssemblyError(
      'Cannot resolve this joint: one snap lies flat and the other stands upright, and no '
      + 'rotation about the vertical brings them together.',
      { code: 'FACING_AXIS_MISMATCH' },
    );
  }

  let rotation;
  if (targetVertical) {
    // Both flat. Yaw cannot change either facing, so unlike the horizontal case
    // the solver CANNOT rescue a mismatch by turning the part around - two
    // upward faces stay two upward faces. Check it rather than place a part
    // through the thing it was supposed to sit on.
    if (dot(normalise(targetFacing), normalise(childSnap.facing)) < 0.99) {
      throw new AssemblyError(
        'Cannot resolve this joint: both faces point the same way up. One has to look down '
        + 'onto the other.',
        { code: 'FACING_SAME_VERTICAL' },
      );
    }
    // Yaw is free, so it comes from the product rather than from the joint.
    // See the note above on why inheriting the parent's would be wrong.
    rotation = quatFromYaw(0);
  } else {
    // Rotate the child so its snap ends up pointing at targetFacing.
    rotation = quatFromYaw(targetYaw - childYaw);
  }

  // Then translate so the two snap centres land on the same point.
  const translation = sub(parentSnapWorldPos, rotateVec(rotation, childSnap.position));

  return { translation, rotation };
}

/**
 * Resolve world transforms for every instance in an assembly.
 *
 * @param assembly {{ instances: Array<{ instanceId, componentId, position?, rotation?, freeMove? }>,
 *                    connections: Array<{ fromInstanceId, fromSnapId, toInstanceId, toSnapId }> }}
 * @param components Map<componentId, { snaps }>
 * @returns {{ transforms: Map<instanceId, {translation, rotation}>, roots: string[], orphans: string[] }}
 */
export function resolveTransforms(assembly, components) {
  const instances = new Map((assembly.instances || []).map((i) => [i.instanceId, i]));
  const transforms = new Map();

  // Adjacency, both ways — a connection is undirected until we pick a root and
  // walk outward. Direction in the stored data records which snap belongs to
  // which part, not which one is "in charge".
  const neighbours = new Map();
  for (const id of instances.keys()) neighbours.set(id, []);

  for (const c of assembly.connections || []) {
    if (!instances.has(c.fromInstanceId) || !instances.has(c.toInstanceId)) {
      throw new AssemblyError(
        'A connection refers to a part that is not in the assembly.',
        { code: 'DANGLING_CONNECTION', detail: c },
      );
    }
    neighbours.get(c.fromInstanceId).push({ other: c.toInstanceId, ownSnap: c.fromSnapId, otherSnap: c.toSnapId });
    neighbours.get(c.toInstanceId).push({ other: c.fromInstanceId, ownSnap: c.toSnapId, otherSnap: c.fromSnapId });
  }

  /**
   * An attach point by id, whether authored or generated from a grid.
   *
   * `span` matters only for a grid cell: a 3x2 pouch glues by the centre of its
   * FOOTPRINT, not the centre of its anchor cell, so the grid has to be told
   * how big the thing landing on it is. Conflating those two is the single
   * likeliest bug in this file.
   */
  const attachPointOf = (instanceId, snapId, span = null) => {
    const instance = instances.get(instanceId);
    const component = components.get(instance.componentId);
    if (!component) {
      throw new AssemblyError(
        `Component "${instance.componentId}" is not loaded.`,
        { code: 'COMPONENT_MISSING', detail: { instanceId, componentId: instance.componentId } },
      );
    }

    const cell = parseGridCellId(snapId);
    if (cell) {
      const grid = (component.grids || []).find((g) => g.id === cell.gridId);
      if (!grid) {
        throw new AssemblyError(
          `Component "${instance.componentId}" has no grid "${cell.gridId}".`,
          { code: 'GRID_MISSING', detail: { instanceId, snapId } },
        );
      }
      return gridAttachPoint(grid, cell.col, cell.row, span || { cols: 1, rows: 1 });
    }

    const snap = component.snaps.find((s) => s.id === snapId);
    if (!snap) {
      throw new AssemblyError(
        `Component "${instance.componentId}" has no snap "${snapId}".`,
        { code: 'SNAP_MISSING', detail: { instanceId, snapId } },
      );
    }
    return snap;
  };

  // A root is any part that carries its own position: an explicitly placed part,
  // or a free-moving one. Everything else is derived.
  const roots = [];
  for (const instance of instances.values()) {
    if (instance.position || instance.freeMove || !neighbours.get(instance.instanceId).length) {
      roots.push(instance.instanceId);
    }
  }

  // A cluster of connected parts where nobody was explicitly placed still has to
  // land somewhere. Anchor it on the first instance rather than throwing — an
  // assembly built entirely by snapping is the normal case, not an error.
  if (!roots.length && instances.size) {
    roots.push(assembly.instances[0].instanceId);
  }

  const visited = new Set();
  const queue = [];

  for (const rootId of roots) {
    if (visited.has(rootId)) continue;
    const instance = instances.get(rootId);
    transforms.set(rootId, {
      translation: instance.position || IDENTITY.translation,
      rotation: instance.rotation || IDENTITY.rotation,
    });
    visited.add(rootId);
    queue.push(rootId);
  }

  while (queue.length) {
    const currentId = queue.shift();
    const currentTransform = transforms.get(currentId);

    for (const edge of neighbours.get(currentId)) {
      // Already placed. We do NOT re-derive it: the first path to a part wins.
      // A cycle (a closed run of units, say) is geometrically over-constrained,
      // and silently re-solving it would make the layout depend on walk order.
      if (visited.has(edge.other)) continue;

      // Resolve the NON-grid side first, because its span is what the grid
      // side needs in order to place a footprint rather than a cell.
      let parentSnap;
      let childSnap;

      if (isGridCellId(edge.ownSnap)) {
        childSnap = attachPointOf(edge.other, edge.otherSnap);
        parentSnap = attachPointOf(currentId, edge.ownSnap, childSnap.span);
      } else if (isGridCellId(edge.otherSnap)) {
        parentSnap = attachPointOf(currentId, edge.ownSnap);
        childSnap = attachPointOf(edge.other, edge.otherSnap, parentSnap.span);
      } else {
        parentSnap = attachPointOf(currentId, edge.ownSnap);
        childSnap = attachPointOf(edge.other, edge.otherSnap);
      }

      transforms.set(edge.other, solveChildTransform(currentTransform, parentSnap, childSnap));
      visited.add(edge.other);
      queue.push(edge.other);
    }
  }

  const orphans = [...instances.keys()].filter((id) => !visited.has(id));

  return { transforms, roots, orphans };
}

/**
 * Every attach point in the assembly, in world space, tagged with whether
 * something is already plugged into it.
 *
 * Authored snaps and generated grid cells come out in one list and look
 * identical to callers. Grid cells are emitted at 1x1 granularity because that
 * is what a person sees as a marker — you cannot draw a marker for a span
 * nobody has chosen yet. Validity for a specific part comes from
 * placementsFor in grid.js.
 */
export function worldSnaps(assembly, components, transforms) {
  const spanOf = (instanceId, snapId) => {
    const instance = (assembly.instances || []).find((i) => i.instanceId === instanceId);
    const component = instance && components.get(instance.componentId);
    const snap = component && component.snaps.find((sn) => sn.id === snapId);
    return snap?.span || { cols: 1, rows: 1 };
  };

  // `${instanceId}::${snapId}` -> Set of sides taken ('above' | 'below').
  //
  // Not a boolean any more, because a rung legitimately carries two things: a
  // shelf resting on it and an accessory hooked over it hanging beneath. What
  // fills a socket is a SIDE of it, and only a second part wanting the same side
  // is refused. See snapBearingSide.
  const occupiedSnaps = new Map();
  const occupySnap = (instanceId, snapId, side) => {
    const key = `${instanceId}::${snapId}`;
    if (!occupiedSnaps.has(key)) occupiedSnaps.set(key, new Set());
    occupiedSnaps.get(key).add(side);
  };

  // The side of A's snap that B fills is decided by B's OWN body relative to
  // B's own snap - the two snaps end up at the same point, and yaw does not
  // move anything in y, so the child's local geometry answers it.
  const sideFilledBy = (instanceId, snapId) => {
    const instance = (assembly.instances || []).find((i) => i.instanceId === instanceId);
    const component = instance && components.get(instance.componentId);
    return snapBearingSide(component, snapId);
  };
  // `${instanceId}::${gridId}` -> Set of covered cell keys.
  const occupiedCells = new Map();

  const occupyCells = (instanceId, cell, span) => {
    const key = `${instanceId}::${cell.gridId}`;
    if (!occupiedCells.has(key)) occupiedCells.set(key, new Set());
    const set = occupiedCells.get(key);
    // A 3x2 pouch takes SIX cells out of circulation, not one. Getting this
    // wrong lets two pouches overlap and nothing looks wrong until you count
    // the parts list.
    for (const c of cellsCovered(cell.col, cell.row, span)) set.add(c);
  };

  for (const c of assembly.connections || []) {
    const fromCell = parseGridCellId(c.fromSnapId);
    const toCell = parseGridCellId(c.toSnapId);

    if (fromCell) {
      occupyCells(c.fromInstanceId, fromCell, spanOf(c.toInstanceId, c.toSnapId));
    } else {
      occupySnap(c.fromInstanceId, c.fromSnapId, sideFilledBy(c.toInstanceId, c.toSnapId));
    }

    if (toCell) {
      occupyCells(c.toInstanceId, toCell, spanOf(c.fromInstanceId, c.fromSnapId));
    } else {
      occupySnap(c.toInstanceId, c.toSnapId, sideFilledBy(c.fromInstanceId, c.fromSnapId));
    }
  }

  const toWorld = (instanceId, transform, point, extra = {}) => ({
    instanceId,
    snapId: point.id,
    mask: point.mask,
    label: point.label,
    condition: point.condition,
    required: !!point.required,
    span: point.span || null,
    role: point.role || null,
    worldPosition: add(transform.translation, rotateVec(transform.rotation, point.position)),
    worldFacing: normalise(rotateVec(transform.rotation, point.facing)),
    ...extra,
  });

  const out = [];

  for (const instance of assembly.instances || []) {
    const transform = transforms.get(instance.instanceId);
    const component = components.get(instance.componentId);
    if (!transform || !component) continue;

    for (const snap of component.snaps) {
      const taken = occupiedSnaps.get(`${instance.instanceId}::${snap.id}`);
      out.push(toWorld(instance.instanceId, transform, snap, {
        // Kept as a boolean for every caller that only wants "is anything on
        // this", and joined by the set of sides for the one that needs to know
        // whether there is still room underneath.
        occupied: !!taken?.size,
        occupiedSides: taken ? [...taken] : [],
        isGridCell: false,
      }));
    }

    for (const grid of component.grids || []) {
      const taken = occupiedCells.get(`${instance.instanceId}::${grid.id}`) || new Set();
      for (const cell of expandGridCells(grid)) {
        out.push(toWorld(instance.instanceId, transform, cell, {
          occupied: taken.has(`c${cell.col}r${cell.row}`),
          isGridCell: true,
          gridId: grid.id,
          col: cell.col,
          row: cell.row,
        }));
      }
    }
  }

  return out;
}

/**
 * Which cells of one instance's grid are taken.
 *
 * Exported because placementsFor in grid.js needs exactly this set to answer
 * "where could a 3x2 pouch go", and both attach flows are built on that query.
 */
export function occupiedCellsFor(assembly, components, instanceId, gridId) {
  const all = worldSnaps(assembly, components, new Map(
    (assembly.instances || []).map((i) => [i.instanceId, IDENTITY]),
  ));

  const set = new Set();
  for (const p of all) {
    if (p.instanceId === instanceId && p.gridId === gridId && p.occupied) {
      set.add(`c${p.col}r${p.row}`);
    }
  }
  return set;
}

/**
 * Is the assembly complete?
 *
 * Mimeeq gates checkout on this, and it is the right place for it: an
 * unterminated shelving run or an open-ended sofa is a real order that cannot
 * be built. A snap marked required and left empty makes the whole thing invalid.
 */
export function validateAssembly(assembly, components, transforms) {
  const snaps = worldSnaps(assembly, components, transforms);
  const missing = snaps.filter((s) => s.required && !s.occupied);

  return {
    isValid: missing.length === 0,
    missingRequiredSnaps: missing.map((s) => ({
      instanceId: s.instanceId, snapId: s.snapId, mask: s.mask, label: s.label,
    })),
  };
}
