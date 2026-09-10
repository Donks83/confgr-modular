// The pointer layer: dots you can click, a ghost that shows where a part would
// land, and the one gesture that tells select, add and move apart.
//
// WHY IT LIVES HERE rather than in the editor. Matt, after configuring a
// product with the guided controls: "it needs to be the drag and drop we had at
// the start with the snap dots, click a dot add an accessory to the dot and then
// you can click and drag to change its location." All of that already existed -
// in src/spike/Configurator.jsx, tangled into the editor's own React state. The
// choice was to copy it into the runtime or to share it, and this project has
// now been bitten four times by two implementations of one idea drifting apart
// (§5.21, §5.22, §5.23, and the guided policy measuring support twice in
// §5.24). So it moves DOWN into src/viewer, where the runtime and the editor
// both import it, exactly as the scene and the product drawing did.
//
// THE SHAPE, and it is the shape that makes this testable. Two halves that do
// not know about each other:
//
//   * `createGesture` is the decision - down, move, up, and which of the three
//     outcomes that adds up to. It touches no three.js and no DOM: the hit
//     tests arrive as functions. So the gesture can be driven by fake events in
//     a plain unit test, which is the only way this logic has ever been covered
//     - the raycast wiring itself needs a real GPU and only the probe has one.
//   * everything else is three.js furniture: build the marker meshes, find the
//     one under the cursor, show a translucent copy where a part would land.
//
// A REAL BUG THE MOVE FOUND. The editor called `moveTargetAt(...)` - singular -
// which was never defined anywhere. Every pointermove over a marker during a
// drag threw a ReferenceError, so the ghost preview has never once appeared in
// the editor since it was written. Nothing failed loudly: the marker still grew
// under the cursor and the drop still worked, so the only symptom was a preview
// that was not there. Reading the code to move it is what found it.

import * as THREE from 'three';
import {
  moveTargets, moveTo, distinctPlacements, mountHeightMm,
} from '../engine/attach.js';
import { resolveTransforms } from '../engine/assembly.js';

export { pickInstance } from './product.js';

/**
 * How far the cursor must travel before a press becomes a drag rather than a
 * click. Five pixels: below that, a click on a part with a shaky hand would
 * pick the part up instead of selecting it.
 */
export const DRAG_THRESHOLD_PX = 5;

/** What the dots currently MEAN. Two questions, so two answers. */
export const MARKER_MODE = { ADD: 'add', MOVE: 'move' };

/**
 * The look of one dot.
 *
 * Pure, and separated from the drawing so it can be asserted on. The colours
 * are meanings rather than decoration:
 *
 *   cyan   - a new part could go here
 *   green  - the part you have chosen can go here (part-first)
 *   amber  - the part in your hand can land here (a drag)
 *
 * Grid cells are drawn smaller because a MOLLE panel has 84 of them and the
 * panel disappears under dots otherwise; during a drag everything is enlarged,
 * because the cursor is already carrying something and the target has to be
 * easy to hit.
 */
export function markerStyleFor(point, {
  mode = MARKER_MODE.ADD, pending = false, targeted = false, touch = false,
} = {}) {
  const moving = mode === MARKER_MODE.MOVE;
  return {
    color: moving ? '#f0a53c' : pending ? '#e0a03c' : targeted ? '#3ddc97' : '#4fc3d9',
    opacity: moving ? 0.95 : pending ? 1 : targeted ? 0.9 : 0.55,
    radius: (point?.isGridCell ? 0.006 : 0.014)
      * (pending ? 1.7 : targeted ? 1.35 : 1)
      * (moving ? 1.6 : 1)
      // A THUMB IS NOT A MOUSE. 14 mm of product is a couple of pixels on a
      // phone held at arm's length, and Matt found the dots "very difficult to
      // click" on Android - which is the same complaint as the panel covering
      // them, one layer down. Half again as big, and the invisible hit sphere
      // below does the rest.
      * (touch ? 1.5 : 1),
  };
}

/**
 * How much bigger a dot is to HIT than to look at.
 *
 * Four times, as an invisible sphere, and the number comes from arithmetic
 * rather than from taste. On a 375 px phone a 950 mm product frames to roughly
 * 225 px, so about 0.24 px per mm. A touch dot is 21 mm across, which draws as
 * ten pixels - visible, and nobody's thumb is that accurate. At four times, the
 * hit sphere is 168 mm across and lands at about 40 px, which is close to the
 * 44 px both platforms ask for.
 *
 * It has to stay clear of its neighbours: YouK rungs are 236.5 mm apart, so
 * anything under a 118 mm hit RADIUS cannot reach the next rung's dot. Four
 * times gives 84 mm. Overlap would not be a disaster - the raycaster returns
 * the nearest hit, so the dot whose centre the ray passes closest to wins - but
 * not overlapping at all is better than relying on that.
 *
 * Growing the visible dot instead would have to reach bauble size before it was
 * reliably tappable, and on a dense grid the dots would start to merge into
 * each other.
 */
export const HIT_SCALE = 4;

/**
 * Is this a touch screen?
 *
 * Asked of the browser rather than of the user agent: `pointer: coarse` is the
 * question "is the pointing device imprecise", which is exactly the question
 * that decides how big a target has to be. A phone answers yes, a laptop
 * trackpad answers no, and a touchscreen laptop answers yes while a mouse is
 * plugged into it - which is the right answer for a target size.
 */
export function isCoarsePointer() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Add the pointer layer's own furniture to a scene built by `createScene`.
 *
 * The ghost gets its own group so the product rebuild, which owns
 * productRoot's children, never has to know it exists.
 */
export function createMarkerLayer(ctx) {
  const markerRoot = new THREE.Group();
  const ghostRoot = new THREE.Group();
  ctx.scene.add(markerRoot, ghostRoot);

  Object.assign(ctx, {
    markerRoot,
    ghostRoot,
    raycaster: ctx.raycaster || new THREE.Raycaster(),
    pointer: ctx.pointer || new THREE.Vector2(),
    markerGeo: new THREE.SphereGeometry(1, 12, 10),
    // One material for every hit box, because they are never drawn and so have
    // nothing to differ about. Shared rather than cloned per dot, and disposed
    // once with the layer.
    hitMaterial: new THREE.MeshBasicMaterial({ visible: false }),
    hovered: null,
  });

  return function dispose() {
    clearMarkers(ctx);
    clearGhost(ctx);
    ctx.markerGeo?.dispose();
    ctx.hitMaterial?.dispose();
    ctx.scene.remove(markerRoot, ghostRoot);
    ctx.markerRoot = null;
    ctx.ghostRoot = null;
  };
}

/** Throw away every dot, and the hover that pointed at one of them. */
export function clearMarkers(ctx) {
  if (!ctx?.markerRoot) return;
  while (ctx.markerRoot.children.length) {
    const m = ctx.markerRoot.children.pop();
    m.material?.dispose();
  }
  // The mesh ctx.hovered pointed at has just been thrown away.
  ctx.hovered = null;
}

/**
 * Draw one dot per point.
 *
 * `pendingKey` is the point already chosen, `targeted` says a part has been
 * picked first so these are "where THAT part can go" rather than "where
 * anything can go".
 */
export function drawMarkers(ctx, points, {
  mode = MARKER_MODE.ADD, pendingKey = null, targeted = false, keyOf,
} = {}) {
  if (!ctx?.markerRoot) return 0;
  clearMarkers(ctx);
  if (!points?.length) return 0;

  const lift = new THREE.Vector3();
  const touch = isCoarsePointer();
  for (const point of points) {
    const key = keyOf ? keyOf(point) : null;
    const style = markerStyleFor(point, {
      mode, pending: key != null && key === pendingKey, targeted, touch,
    });

    const mesh = new THREE.Mesh(ctx.markerGeo, new THREE.MeshBasicMaterial({
      color: style.color,
      transparent: true,
      opacity: style.opacity,
    }));
    mesh.scale.setScalar(style.radius);
    mesh.userData.baseRadius = style.radius;
    mesh.userData.pointKey = key;
    mesh.position.fromArray(point.worldPosition);
    // Lift off the surface so a dot is never buried in the geometry it belongs
    // to.
    lift.fromArray(point.worldFacing);
    mesh.position.addScaledVector(lift, style.radius * 0.9);
    mesh.renderOrder = 2;

    // THE HIT BOX, a child of the dot so it inherits its position and is
    // thrown away with it. `visible: false` keeps it out of the picture and out
    // of the raycast, so `markerAt` asks for it explicitly and nothing else
    // ever sees it - including `fitBounds`, which would otherwise measure the
    // product as 2.5 dots wider than it is.
    const hit = new THREE.Mesh(ctx.markerGeo, ctx.hitMaterial);
    hit.visible = false;
    hit.scale.setScalar(HIT_SCALE);
    hit.userData.pointKey = key;
    hit.userData.isHitBox = true;
    mesh.add(hit);

    ctx.markerRoot.add(mesh);
  }
  return ctx.markerRoot.children.length;
}

/**
 * The dot under a screen position, or null.
 *
 * WORLD MATRICES FIRST. three.js only recomputes matrixWorld during a render,
 * and between a state change and the next frame a dot's world matrix still says
 * where it used to be - which on an uncomposited window is forever. The same
 * trap `pickInstance` documents.
 */
export function markerAt(ctx, clientX, clientY) {
  const canvas = ctx?.renderer?.domElement;
  if (!canvas || !ctx.markerRoot) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  ctx.scene.updateMatrixWorld(true);
  ctx.pointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera);

  // The dot itself first, so an accurate press on a small dot beats a sloppy
  // one on a big neighbour's hit box.
  const direct = ctx.raycaster.intersectObjects(ctx.markerRoot.children, false);
  if (direct.length) return direct[0].object;

  // Then the hit boxes, which are invisible and therefore skipped by a normal
  // raycast - `recursive: true` alone would not find them, because three's
  // raycaster ignores anything with `visible: false`. Asked for by name, and
  // the DOT is returned rather than the box, so every caller downstream still
  // deals in the thing it can see.
  const boxes = [];
  for (const dot of ctx.markerRoot.children) {
    for (const child of dot.children) if (child.userData.isHitBox) boxes.push(child);
  }
  if (!boxes.length) return null;
  const near = ctx.raycaster.intersectObjects(boxes, false);
  return near.length ? near[0].object.parent : null;
}

/** Clear the drop preview. */
export function clearGhost(ctx) {
  if (!ctx?.ghostRoot) return;
  while (ctx.ghostRoot.children.length) {
    const child = ctx.ghostRoot.children.pop();
    child.traverse((o) => { if (o.isMesh) o.material?.dispose(); });
  }
}

/**
 * Show where a part would land, as a translucent copy at a pose already
 * decided.
 *
 * The part being dragged does NOT follow the cursor - it cannot, because the
 * only legal destinations are the dots, and a part sliding through open space
 * would be promising something the model refuses to deliver. A ghost at the
 * candidate point says the same thing honestly.
 */
export function showGhostAt(ctx, component, pose) {
  clearGhost(ctx);
  if (!ctx?.ghostRoot || !component?.template || !pose) return false;

  const ghost = component.template.clone(true);
  ghost.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.startsWith('md-')) { o.visible = false; return; }
    o.castShadow = false;
    o.receiveShadow = false;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.4;
    o.material.depthWrite = false;
    o.material.emissive = new THREE.Color('#4a3410');
  });
  ghost.position.fromArray(pose.translation);
  ghost.quaternion.fromArray(pose.rotation);
  ctx.ghostRoot.add(ghost);
  return true;
}

/**
 * Where a part would end up if it were moved to this placement.
 *
 * ASKED OF THE ENGINE: rewire the connection, resolve, read the answer back.
 * No second solver, so the preview cannot disagree with the drop.
 */
export function previewMove(assembly, components, instanceId, placement) {
  try {
    const hypothetical = moveTo(assembly, instanceId, placement);
    return resolveTransforms(hypothetical, components).transforms.get(instanceId) || null;
  } catch {
    return null;
  }
}

/**
 * Every way a part could sit at one point, computed FRESH.
 *
 * Deliberately not read out of a memoised matrix: a drag can cross the
 * threshold and finish inside a single frame, before React has rendered the
 * state that would have filled that memo in. Asking the engine costs nothing at
 * this scale and removes the race entirely.
 *
 * Sorted by mount height and reduced to DISTINCT OUTCOMES rather than distinct
 * wirings - a shelf dragged to the far side of a ladder can mate by either end,
 * and the solver satisfies facing by yawing the child 180 degrees, so the
 * "wrong" end always fits, backwards.
 */
export function dropTargets(assembly, components, transforms, instanceId, key) {
  if (!components?.size) return [];
  try {
    const targets = moveTargets(assembly, components, transforms, instanceId);
    const here = targets.placements
      .filter((pl) => pl.pointKey === key)
      .sort((a, b) => mountHeightMm(a) - mountHeightMm(b));
    return distinctPlacements(assembly, components, here);
  } catch {
    return [];
  }
}

/**
 * Highlight whatever the cursor is over during a drag, by mutating the mesh
 * rather than by setting state: this runs on every pointermove.
 *
 * Returns true when the hover CHANGED, so the caller only recomputes a ghost
 * when there is something new to preview.
 */
export function hoverMarker(ctx, mesh) {
  const previous = ctx.hovered;
  if (previous === mesh) return false;
  if (previous?.parent) previous.scale.setScalar(previous.userData.baseRadius);
  if (mesh) mesh.scale.setScalar(mesh.userData.baseRadius * 1.8);
  ctx.hovered = mesh || null;
  return true;
}

/**
 * One gesture, three outcomes, decided by what happened between down and up:
 *
 *   down on a dot               -> choose that point (the add flow)
 *   down on a part, no movement -> select it
 *   down on a part, then moved  -> pick it up and drop it on another dot
 *
 * Matt, 3 Sep: "it would be nice for me to be able to click and drag an object
 * to a different snap point (not to drag it anywhere in 3d space but only to
 * another snap point)". So a drag has exactly as many destinations as there are
 * dots - it cannot end anywhere else, and that is the whole safety property.
 *
 * NO THREE.JS AND NO DOM. The hit tests come in as functions and the outcomes
 * go out as hooks, which is what lets a unit test drive the whole state machine
 * with plain objects. Every hook is optional.
 *
 * @param {object} io
 * @param {(x:number,y:number)=>object|null} io.hitMarker   dot under a point
 * @param {(x:number,y:number)=>string|null} io.hitInstance part under a point
 * @param {(id:string)=>{ok:boolean,reason?:string}} io.canDrag
 * @param {object} io.hooks  onPoint, onSelect, onDragStart, onDragOver,
 *                           onDrop, onDragEnd, onBlocked
 */
export function createGesture({
  hitMarker, hitInstance, canDrag = () => ({ ok: true }), hooks = {},
  threshold = DRAG_THRESHOLD_PX,
} = {}) {
  // Drag state is a closure variable, not React state: pointermove fires at
  // screen rate and re-rendering a panel on every one of them would make the
  // drag feel heavy. Only the START and the END touch React.
  let press = null;

  const keyOfMarker = (m) => (m && m.userData ? m.userData.pointKey : m?.pointKey ?? null);

  function down(event) {
    if (event.button != null && event.button !== 0) return;

    // Dots are small and sit on top of the geometry they belong to, so testing
    // the product first would make them almost unclickable.
    const marker = hitMarker?.(event.clientX, event.clientY);
    if (marker) {
      press = null;
      hooks.onPoint?.(keyOfMarker(marker), marker);
      return;
    }

    const instanceId = hitInstance?.(event.clientX, event.clientY) ?? null;
    press = instanceId
      ? { instanceId, x: event.clientX, y: event.clientY, started: false }
      : null;
    if (!instanceId) hooks.onSelect?.(null);
  }

  function move(event) {
    if (!press) return;

    if (press.started) {
      const marker = hitMarker?.(event.clientX, event.clientY) || null;
      hooks.onDragOver?.(keyOfMarker(marker), marker, press.instanceId);
      return;
    }

    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < threshold) return;

    // Past the threshold: this is a drag, if the part can move at all.
    const allowed = canDrag(press.instanceId);
    if (!allowed?.ok) {
      // Not movable - the anchor, usually. Let the orbit continue rather than
      // interrupting it with a message nobody asked for.
      press = null;
      hooks.onBlocked?.(allowed?.reason || 'cannot-move');
      return;
    }
    press.started = true;
    hooks.onDragStart?.(press.instanceId);
  }

  function up(event) {
    const p = press;
    press = null;
    if (!p) return;

    if (!p.started) {
      // A click, not a drag.
      hooks.onSelect?.(p.instanceId);
      return;
    }

    const marker = event ? hitMarker?.(event.clientX, event.clientY) : null;
    hooks.onDragEnd?.(p.instanceId);
    if (!marker) { hooks.onDrop?.(p.instanceId, null, null); return; }
    hooks.onDrop?.(p.instanceId, keyOfMarker(marker), marker);
  }

  /** Abandon a drag without dropping - Escape, or the component unmounting. */
  function cancel() {
    const p = press;
    press = null;
    if (p?.started) hooks.onDragEnd?.(p.instanceId);
  }

  const dragging = () => (press?.started ? press.instanceId : null);

  return {
    onPointerDown: down, onPointerMove: move, onPointerUp: up, cancel, dragging,
  };
}
