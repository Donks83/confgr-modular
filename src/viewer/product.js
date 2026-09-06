// Putting the parts in the scene. One implementation, two callers.
//
// This is the half of the drawing that has to be identical in the editor and
// the runtime, because it is the half a customer looks at. Finish colours,
// which nodes are visible, where each part sits — if these two ever disagreed,
// the product a salesperson approved and the product a customer sees would be
// different things, and nobody would find out until it was delivered.
//
// See the note at the top of `scene.js` for why that is not a hypothetical.

import * as THREE from 'three';
import { isImplied } from '../engine/implied.js';
import { isGrounded, groundClearanceMm } from '../engine/ar.js';

/** The selection rim. Never a colour change — see below. */
const SELECTED_EMISSIVE = '#4a2f0d';

/**
 * Is this node the product, or the editor's scaffolding?
 *
 * The same question `tools/export-glb.mjs` asks, and deliberately asked in the
 * same words. Both prefixes survive three.js name sanitisation — it strips
 * dots, not hyphens — which is why matching the mangled name works.
 */
export function scaffoldKind(name) {
  if (name.startsWith('md-snap') || name.startsWith('md-grid')) return 'guide';
  if (name.startsWith('col-') || name === 'dim') return 'box';
  return null;
}

/**
 * Draw a resolved scene.
 *
 * `scene` is `{ instances, transforms }` — the assembly PLUS what it implies,
 * because an implied part is real geometry that is not a real instance. The
 * editor passes its `withImplied` result; the viewer passes what
 * `resolveConfiguration` returned. Same shape, same drawing.
 *
 * `selectable` is the ONE behavioural difference between the two callers, and
 * it is one line: without it no group carries an `instanceId`, so a picker
 * walking up the parents finds nothing and a click falls through to the
 * background. That is how the runtime has "no editing affordances" without a
 * second code path — the same mechanism that already makes implied parts
 * unselectable in the editor.
 */
export function syncProduct(ctx, scene, components, {
  showGuides = false,
  selectedId = null,
  selectable = true,
} = {}) {
  const wanted = new Set(scene.instances.map((i) => i.instanceId));

  for (const [id, group] of ctx.groups) {
    if (!wanted.has(id)) {
      ctx.productRoot.remove(group);
      ctx.groups.delete(id);
    }
  }

  for (const instance of scene.instances) {
    const component = components.get(instance.componentId);
    if (!component) continue;

    // An implied part is not selectable and not removable, in either caller.
    const derived = isImplied(instance.instanceId);

    let group = ctx.groups.get(instance.instanceId);
    if (!group) {
      group = new THREE.Group();
      group.add(component.template.clone(true));
      if (selectable && !derived) group.userData.instanceId = instance.instanceId;
      ctx.productRoot.add(group);
      ctx.groups.set(instance.instanceId, group);
    }

    const t = scene.transforms.get(instance.instanceId);
    if (t) {
      group.position.fromArray(t.translation);
      group.quaternion.fromArray(t.rotation);
    }

    applyFinish(group, component, instance, {
      showGuides,
      isSelected: instance.instanceId === selectedId,
    });
  }

  return ctx.groups.size;
}

/**
 * The finish for THIS instance, and what is visible.
 *
 * Per-part options are the point: eight pouches on a panel are eight instances,
 * each independently coloured.
 */
function applyFinish(group, component, instance, { showGuides, isSelected }) {
  const finishOption = component.options.find((o) => o.id === 'finish');
  const chosenId = instance.selections?.finish || finishOption?.defaultValueId;
  const chosen = finishOption?.values.find((v) => v.id === chosenId);

  group.traverse((o) => {
    if (!o.isMesh) return;
    const kind = scaffoldKind(o.name);

    o.visible = kind ? showGuides : true;
    if (kind) return;

    o.castShadow = true;
    o.receiveShadow = true;
    if (!o.material) return;

    if (!o.userData.baseColour) o.userData.baseColour = o.material.color.clone();
    o.material = o.material.clone();
    if (chosen?.hex) o.material.color.set(`#${chosen.hex}`);
    else o.material.color.copy(o.userData.baseColour);
    // Selection reads as a warm rim, never a colour change — the finish being
    // judged must not be the thing the highlight altered.
    o.material.emissive = new THREE.Color(isSelected ? SELECTED_EMISSIVE : '#000000');
  });
}

/**
 * Where the floor is, and whether there is one.
 *
 * A wall-mounted product has no floor under it, and one on feet stands 100mm
 * above the one it does have. Both callers need this and neither should own it.
 */
export function setGround(ctx, mounting, footHeightMm) {
  const grounded = isGrounded(mounting);
  ctx.grid.visible = grounded;
  ctx.floor.visible = grounded;

  const floorY = -groundClearanceMm(mounting, footHeightMm) / 1000;
  ctx.grid.position.y = floorY;
  ctx.floor.position.y = floorY;
  return floorY;
}

/**
 * Every part's resolved world position and which way it is facing, as text.
 *
 * Lifted out of the editor because the VIEWER needs it too, and for the same
 * reason: a screenshot cannot tell a part from the same part turned round, and
 * a chain that resolves slightly wrong compounds down a run rather than looking
 * obviously broken.
 *
 * Facing is reported as where the part's own +Z ends up, because **+z is the
 * wall** — so `wall +z` on every frame of a bay is what should be there, and
 * one reading `wall -z` is a frame in back to front. Matt has caught two
 * orientation faults in renders that this reported correctly.
 */
export function describeLayout(ctx, scene, connections = []) {
  ctx.productRoot.updateMatrixWorld(true);

  const mm = (v) => (v * 1000).toFixed(1);
  const rows = scene.instances.map((instance) => {
    const group = ctx.groups.get(instance.instanceId);
    if (!group) return `${instance.instanceId} ${instance.componentId} NOT IN SCENE`;

    const p = group.getWorldPosition(new THREE.Vector3());
    const q = group.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const axis = Math.abs(f.x) > Math.abs(f.z)
      ? `${f.x >= 0 ? '+' : '-'}x`
      : `${f.z >= 0 ? '+' : '-'}z`;

    return `${instance.instanceId} ${instance.componentId} `
      + `@ ${mm(p.x)},${mm(p.y)},${mm(p.z)}  wall ${axis}`;
  });

  const conns = connections.map(
    (c) => `${c.fromInstanceId}:${c.fromSnapId} -> ${c.toInstanceId}:${c.toSnapId}`,
  );

  return `${rows.length} instances\n${rows.join('\n')}\n`
    + `${conns.length} connections\n${conns.join('\n')}`;
}
