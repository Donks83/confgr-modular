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
  add, sub, rotateVec, multiplyQuat, quatFromYaw, quatFromAxisAngle,
  normalise, scale, dot, cross, length, EPS,
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

  // ONE ALIGNMENT, not three special cases.
  //
  // This was a horizontal branch (yaw the child until the facings oppose), a
  // vertical branch (yaw zero, since yaw cannot change a vertical facing), and a
  // refusal for anything mixed. The refusal is what broke: once a joint can
  // carry a ROLL, the face a part is bolted to is no longer square to the world.
  // The office arm tilts 9 degrees and its top face tilts with it, so the desk
  // that sits on that face meets a socket 9 degrees off vertical against a plug
  // that is exactly vertical — "mixed", refused, and the desktop ended up at the
  // origin with nothing said.
  //
  // So: solve a YAW first, then whatever tilt is left over. The yaw is the old
  // yaw-only solve, taken from the horizontal parts of the two facings; the
  // remainder is at most a tilt, and the shortest arc handles it.
  //   - two horizontal facings: the yaw does all of it, exactly as before.
  //   - two vertical facings already opposed: no horizontal parts, so yaw is
  //     zero — which is the product's orientation, as above — and nothing left.
  //   - a 9-degree tilt: the yaw squares the part up, then a 9-degree turn
  //     about a horizontal axis, which is the thing that was missing.
  //
  // The order matters, and a single shortest arc from a to b is NOT the same
  // thing. It was what this did first, and it worked on one side of a bay and
  // not the other: for the SECOND ladder the parts are turned round, so the
  // child's facing starts nearly OPPOSITE its target rather than nearly along
  // it, and the shortest arc between two nearly-opposed vectors is a ~171
  // degree tumble about a horizontal axis instead of "turn it round, then tip
  // it 9 degrees". The clamping angles came out 29.6 mm apart in height on a
  // tilted desk that was otherwise perfect, which is how it was noticed at all.
  // Yawing first removes the ambiguity: after the yaw the two facings are at
  // most a tilt apart, and the shortest arc between near-parallel vectors is
  // the one thing it is reliably good at.
  const a = normalise(childSnap.facing);
  const b = normalise(targetFacing);
  const d = dot(a, b);

  // How far a joint may be off square and still count as the same KIND of
  // joint. The original refusal was worth keeping in spirit: a face meant to be
  // sat on should not end up bolted to a wall, tipped ninety degrees, because
  // somebody authored the wrong facing. The range's only real tilt is 9, so
  // anything approaching a right angle is a different joint rather than a
  // tilted one.
  const MAX_TILT = Math.cos((30 * Math.PI) / 180);
  const aVertical = Math.hypot(a[0], a[2]) < EPS;
  const bVertical = Math.hypot(b[0], b[2]) < EPS;
  if (aVertical !== bVertical && Math.abs(d) < MAX_TILT) {
    throw new AssemblyError(
      'Cannot resolve this joint: one snap lies flat and the other stands upright. A joint '
      + 'may be tilted, but a face meant to be sat on cannot be bolted to a wall.',
      { code: 'FACING_AXIS_MISMATCH' },
    );
  }

  // 1. The yaw, from the horizontal parts of the two facings. Zero when either
  //    facing is vertical — a turn about the vertical cannot change a vertical
  //    facing, so there is nothing for it to solve and the part takes the
  //    product's orientation instead.
  const yaw = (aVertical || bVertical)
    ? 0
    : Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2]);
  let rotation = quatFromYaw(yaw);

  // 2. The tilt that is left. After the yaw the two facings are at most a tilt
  //    apart, so this arc is small and its axis is horizontal.
  const yawed = rotateVec(rotation, a);
  const left = dot(yawed, b);
  if (left < -1 + EPS) {
    // Nothing a tilt can fix: the two faces point the same way up. Only
    // reachable with both facings vertical — a horizontal one would have been
    // turned round by the yaw, and a mixed pair is refused above.
    throw new AssemblyError(
      'Cannot resolve this joint: both faces point the same way up. One has to look down '
      + 'onto the other.',
      { code: 'FACING_SAME_VERTICAL' },
    );
  }
  if (left < 1 - EPS) {
    rotation = multiplyQuat(
      quatFromAxisAngle(cross(yawed, b), Math.acos(Math.max(-1, Math.min(1, left)))),
      rotation,
    );
  }

  // ROLL — a declared turn about the joint's own axis, on top of the solve.
  //
  // Kesseböhmer's office arm is the case. It bolts to the plate through two
  // holes 250 mm apart, and the plate offers two sets of holes: one level, one
  // dropping 39.11 mm over 246.92 mm, which is 9.000 degrees. Same parts, two
  // angles, and the sheet prices it as a feature — a flat desk or a drawing
  // board. Nothing about the FACINGS differs between them, so the solver alone
  // cannot tell them apart: rolling a part about the axis it mates along leaves
  // that axis pointing exactly where it was. It has to be declared.
  //
  // Either end may declare it and the two add, because which end "owns" the
  // angle is a modelling choice rather than a fact. Here it is the plate's,
  // since the plate's holes are what set it.
  //
  // Applied about the joint axis in WORLD space and AFTER the yaw solve. The
  // axis runs through the snap centre, so the centres still coincide exactly
  // and the translation below is unaffected — which is why this can be a
  // post-multiplication rather than a change to the solve.
  const rollDeg = (parentSnap.roll || 0) + (childSnap.roll || 0);
  if (rollDeg) {
    rotation = multiplyQuat(
      quatFromAxisAngle(parentSnapWorldFacing, (rollDeg * Math.PI) / 180),
      rotation,
    );
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
    // Carried through so a caller can re-solve this joint from the world point
    // alone — see attachMatrix, which needs the child's resulting rotation and
    // has no parent transform to hand. Dropping it here made a tilted joint
    // solve flat, which is a 9-degree lie in exactly the place it matters.
    roll: point.roll || 0,
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
 * Which way a placed part is facing, in world space, or null if it has no front.
 */
export function worldFrontOf(component, transform) {
  if (!component?.front || !transform) return null;
  return normalise(rotateVec(transform.rotation, component.front));
}

/**
 * WHICH WAY THE WHOLE PRODUCT FACES.
 *
 * A product has ONE front. That is not a simplification for the sake of an easy
 * rule — it is what a wall-mounted range is: every ladder in a run goes against
 * the same wall, and a bay whose far ladder faced the room would be a bay you
 * could not fix to anything. Kesseböhmer's own photography has no counter-example
 * and neither does their instruction set.
 *
 * Taken from the first placed part that HAS a front, in the order the parts were
 * added, which is the anchor in every assembly the app builds. Deliberately not
 * a world constant: the whole product can be turned round in AR, and when it is,
 * the rule has to turn with it.
 *
 * Null when nothing declares a front, and then the rule below is simply inert —
 * which is what keeps every part authored before this change working unchanged.
 */
export function productFront(assembly, components, transforms) {
  for (const instance of assembly?.instances || []) {
    const front = worldFrontOf(
      components?.get(instance.componentId),
      transforms?.get(instance.instanceId),
    );
    if (front) return front;
  }
  return null;
}

/**
 * Parts that ended up back to front.
 *
 * The check is a sign test, not an angle: a part is wrong the moment its front
 * has any component pointing away from the product's. There is nothing between
 * "facing the room" and "facing the wall" that is worth allowing, and a
 * tolerance here would only decide how far round a ladder may be twisted before
 * somebody notices.
 *
 * Reported rather than thrown, because an assembly that arrives in this state
 * came from stored data or from a wiring change, and the useful thing is to name
 * the parts. attachMatrix stops NEW ones being created.
 */
export function backToFrontParts(assembly, components, transforms) {
  const front = productFront(assembly, components, transforms);
  if (!front) return [];

  const out = [];
  for (const instance of assembly?.instances || []) {
    const component = components?.get(instance.componentId);
    const own = worldFrontOf(component, transforms?.get(instance.instanceId));
    if (own && dot(own, front) < 0) {
      out.push({ instanceId: instance.instanceId, componentId: instance.componentId });
    }
  }
  return out;
}

/**
 * How close a required snap and its support must be to count as met, in metres.
 *
 * 1 mm. Far tighter than the 80 mm the drag path allows, because this is not
 * "did the person mean to connect these" — it is "is there metal under this
 * corner". A millimetre is the assembly tolerance of the range itself.
 */
export const SUPPORT_TOLERANCE_M = 0.001;

/**
 * Is there actually something in this snap, whatever the graph says?
 *
 * THE GRAPH IS A TREE AND THE PRODUCT IS NOT. A cabinet laid across two
 * brackets is held by both, but only one of them can be its parent — the other
 * connection would be a second path to the same part, which `resolveTransforms`
 * deliberately refuses to walk (see §8). So the second bracket is right there,
 * carrying the box, and nothing in `assembly.connections` says so.
 *
 * Asking the geometry instead of the graph gets the right answer and needs no
 * new data: a required point is satisfied by anything compatible sitting in it.
 * The alternative was a "connect two parts that are already placed" flow in the
 * UI, which is a lot of interaction to record something the model can see.
 */
function supportedByGeometry(snap, allSnaps) {
  return allSnaps.some((other) => other.instanceId !== snap.instanceId
    // Same joint, opposite ends — the same pair of tests a drag has to pass.
    && other.mask === snap.mask
    && (!other.role || !snap.role || other.role !== snap.role)
    && length(sub(other.worldPosition, snap.worldPosition)) <= SUPPORT_TOLERANCE_M
    && dot(normalise(other.worldFacing), normalise(snap.worldFacing)) < -0.95);
}

/**
 * Is the assembly complete?
 *
 * Mimeeq gates checkout on this, and it is the right place for it: an
 * unterminated shelving run or an open-ended sofa is a real order that cannot
 * be built. A snap marked required and left empty makes the whole thing invalid
 * — unless something is demonstrably sitting in it, which is a different
 * question from whether the graph records a joint. See supportedByGeometry.
 */
export function validateAssembly(assembly, components, transforms) {
  const snaps = worldSnaps(assembly, components, transforms);
  const missing = snaps.filter(
    (s) => s.required && !s.occupied && !supportedByGeometry(s, snaps),
  );
  // A part fitted back to front is as unbuildable as a missing one, and a good
  // deal harder to see in a render, so it counts against validity too.
  const backToFront = backToFrontParts(assembly, components, transforms);

  return {
    isValid: missing.length === 0 && backToFront.length === 0,
    missingRequiredSnaps: missing.map((s) => ({
      instanceId: s.instanceId,
      snapId: s.snapId,
      mask: s.mask,
      label: s.label,
      // WHERE it is, in world millimetres. "A required point is empty" is not
      // an actionable sentence about a cabinet whose left end is in the air;
      // "carried at 460 mm and nothing at 1380" is. The height is the number
      // somebody needs in order to fit the bracket that fixes it.
      atMm: (s.worldPosition || [0, 0, 0]).map((v) => Math.round(v * 1000)),
    })),
    backToFront,
  };
}
