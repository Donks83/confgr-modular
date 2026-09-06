// The editor and the runtime draw the SAME product. This is what says so.
//
// Phase 2 item 2 is "a viewer built on src/engine/*, with no editing
// affordances", and the tempting way to build it is a second, simpler component
// that draws the parts. That is the mistake — three separate bugs in this one
// session were the same shape (two implementations of one idea, drifting), and
// the worst possible version of it is the thing a customer sees not matching
// the thing a salesperson approved.
//
// So `src/viewer/product.js` is the only code that puts parts in a scene, and
// the editor imports it. These tests cover that shared code directly: no WebGL,
// no canvas, no GLTFLoader — `syncProduct` only ever touches a Group, so it can
// be tested honestly in Node with hand-built parts.
//
// The one thing that is genuinely different between the two callers is
// `selectable`, and that is what the first block is about.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

import {
  syncProduct, setGround, scaffoldKind, describeLayout,
} from '../src/viewer/product.js';
import { fitBounds, frameProduct } from '../src/viewer/scene.js';
import { MOUNTING } from '../src/engine/ar.js';

/** A part: a body, a snap plane, a collision proxy and a dim cube. */
function template(name = 'body') {
  const root = new THREE.Group();
  for (const meshName of [name, 'md-snap.youk-d320.rung-1-left', 'col-body', 'dim']) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 1.5, 0.32),
      new THREE.MeshStandardMaterial({ color: '#8a8a8a' }),
    );
    mesh.name = meshName;
    root.add(mesh);
  }
  return root;
}

// The body mesh is named after the part, so a test can tell the product apart
// from the scaffolding by name.
const component = (id, options = []) => ({ id, options, template: template(id) });

/**
 * The parts of a scene context these functions actually touch.
 *
 * Deliberately not a real `createScene` — that needs WebGL. Writing out exactly
 * what is required is also a statement of the coupling: if one of these
 * functions grows a dependency on a renderer, this stops compiling and somebody
 * has to think about it.
 */
function fakeCtx() {
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.02, 100);
  return {
    camera,
    controls: { target: new THREE.Vector3(), update() {}, minDistance: 0, maxDistance: 0 },
    productRoot: new THREE.Group(),
    grid: new THREE.Group(),
    floor: new THREE.Group(),
    groups: new Map(),
  };
}

const scene = (instances, transforms) => ({
  instances,
  transforms: new Map(Object.entries(transforms)),
});

const at = (x, y = 0, z = 0) => ({ translation: [x, y, z], rotation: [0, 0, 0, 1] });

describe('selectable is the whole of "no editing affordances"', () => {
  let ctx;
  let components;
  let one;

  beforeEach(() => {
    ctx = fakeCtx();
    components = new Map([['ladder', component('ladder')]]);
    one = scene([{ instanceId: 'i1', componentId: 'ladder', selections: {} }], { i1: at(0) });
  });

  it('the editor marks a group with its instanceId, so a picker can find it', () => {
    syncProduct(ctx, one, components, { selectable: true });
    expect(ctx.groups.get('i1').userData.instanceId).toBe('i1');
  });

  it('the viewer does not, so a click falls through to the background', () => {
    // This is the mechanism, and it is worth stating plainly: the picker walks
    // up the parents looking for an instanceId. No instanceId, nothing to
    // select, nothing to move, nothing to delete — with no second code path and
    // no disabled buttons.
    syncProduct(ctx, one, components, { selectable: false });
    expect(ctx.groups.get('i1').userData.instanceId).toBeUndefined();
  });

  it('an implied part is unselectable in BOTH, because nobody chose it', () => {
    const withFoot = scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'implied:foot:i1:0', componentId: 'ladder', selections: {} },
      ],
      { i1: at(0), 'implied:foot:i1:0': at(0, -0.1) },
    );
    syncProduct(ctx, withFoot, components, { selectable: true });
    expect(ctx.groups.get('i1').userData.instanceId).toBe('i1');
    expect(ctx.groups.get('implied:foot:i1:0').userData.instanceId).toBeUndefined();
  });
});

describe('syncProduct draws what the scene says and nothing else', () => {
  let ctx;
  let components;

  beforeEach(() => {
    ctx = fakeCtx();
    components = new Map([['ladder', component('ladder')], ['shelf', component('shelf')]]);
  });

  it('places each part at its resolved transform', () => {
    syncProduct(ctx, scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'i2', componentId: 'ladder', selections: {} },
      ],
      { i1: at(0), i2: at(0.92) },
    ), components, {});

    expect(ctx.groups.get('i1').position.x).toBeCloseTo(0);
    expect(ctx.groups.get('i2').position.x).toBeCloseTo(0.92);
  });

  it('removes a part that is no longer in the scene', () => {
    const two = scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'i2', componentId: 'ladder', selections: {} },
      ],
      { i1: at(0), i2: at(0.92) },
    );
    syncProduct(ctx, two, components, {});
    expect(ctx.productRoot.children).toHaveLength(2);

    syncProduct(ctx, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: {} }],
      { i1: at(0) },
    ), components, {});
    expect(ctx.productRoot.children).toHaveLength(1);
    expect(ctx.groups.has('i2')).toBe(false);
  });

  it('reuses a group rather than rebuilding it, so a move is not a reload', () => {
    const one = scene([{ instanceId: 'i1', componentId: 'ladder', selections: {} }], { i1: at(0) });
    syncProduct(ctx, one, components, {});
    const first = ctx.groups.get('i1');

    syncProduct(ctx, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: {} }],
      { i1: at(0.5) },
    ), components, {});
    expect(ctx.groups.get('i1')).toBe(first);
    expect(first.position.x).toBeCloseTo(0.5);
  });

  it('skips an instance whose component never loaded, rather than throwing', () => {
    syncProduct(ctx, scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'i9', componentId: 'not-a-part', selections: {} },
      ],
      { i1: at(0), i9: at(9) },
    ), components, {});
    expect(ctx.groups.size).toBe(1);
  });
});

describe('the editor\'s scaffolding is hidden unless it is asked for', () => {
  const visibleNames = (ctx) => {
    const names = [];
    ctx.productRoot.traverse((o) => { if (o.isMesh && o.visible) names.push(o.name); });
    return names;
  };

  it('names the three kinds of scaffolding, and nothing else', () => {
    expect(scaffoldKind('md-snap.youk-d320.rung-1-left')).toBe('guide');
    expect(scaffoldKind('md-grid.panel')).toBe('guide');
    expect(scaffoldKind('col-body')).toBe('box');
    expect(scaffoldKind('dim')).toBe('box');
    expect(scaffoldKind('body')).toBeNull();
    // `dimension-plate` starts with "dim" but is not the dim cube. Prefix
    // matching would call it scaffolding and hide a real part.
    expect(scaffoldKind('dimension-plate')).toBeNull();
  });

  it('hides guides and boxes by default', () => {
    const ctx = fakeCtx();
    syncProduct(ctx, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: {} }],
      { i1: at(0) },
    ), new Map([['ladder', component('ladder')]]), {});
    expect(visibleNames(ctx)).toEqual(['ladder']);
  });

  it('shows them when the editor asks', () => {
    const ctx = fakeCtx();
    syncProduct(ctx, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: {} }],
      { i1: at(0) },
    ), new Map([['ladder', component('ladder')]]), { showGuides: true });
    expect(visibleNames(ctx).sort()).toEqual(
      ['col-body', 'dim', 'ladder', 'md-snap.youk-d320.rung-1-left'],
    );
  });
});

describe('finishes are per instance', () => {
  // The point of per-part options: eight pouches on a panel are eight
  // instances, each independently coloured. If the finish were applied to the
  // shared template instead of the clone, colouring one would colour them all.
  const FINISH = [{
    id: 'finish',
    defaultValueId: 'grey',
    values: [{ id: 'grey', hex: '8a8a8a' }, { id: 'black', hex: '101010' }],
  }];

  const bodyColour = (group) => {
    let hex = null;
    group.traverse((o) => { if (o.isMesh && o.name === 'ladder') hex = o.material.color.getHexString(); });
    return hex;
  };

  it('colours two instances of one component differently', () => {
    const ctx = fakeCtx();
    const components = new Map([['ladder', component('ladder', FINISH)]]);
    syncProduct(ctx, scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: { finish: 'grey' } },
        { instanceId: 'i2', componentId: 'ladder', selections: { finish: 'black' } },
      ],
      { i1: at(0), i2: at(0.92) },
    ), components, {});

    expect(bodyColour(ctx.groups.get('i1'))).toBe('8a8a8a');
    expect(bodyColour(ctx.groups.get('i2'))).toBe('101010');
  });

  it('falls back to the default when nothing is selected', () => {
    const ctx = fakeCtx();
    syncProduct(ctx, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: {} }],
      { i1: at(0) },
    ), new Map([['ladder', component('ladder', FINISH)]]), {});
    expect(bodyColour(ctx.groups.get('i1'))).toBe('8a8a8a');
  });

  it('marks the selected part with a rim, not a colour change', () => {
    // The finish being judged must not be the thing the highlight altered.
    const ctx = fakeCtx();
    const components = new Map([['ladder', component('ladder', FINISH)]]);
    syncProduct(ctx, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: { finish: 'black' } }],
      { i1: at(0) },
    ), components, { selectedId: 'i1' });

    const group = ctx.groups.get('i1');
    expect(bodyColour(group)).toBe('101010');
    let emissive = null;
    group.traverse((o) => { if (o.isMesh && o.name === 'ladder') emissive = o.material.emissive.getHexString(); });
    expect(emissive).not.toBe('000000');
  });
});

describe('the ground', () => {
  it('is drawn for a floor-standing product', () => {
    const ctx = fakeCtx();
    const y = setGround(ctx, MOUNTING.FLOOR, 100);
    expect(ctx.grid.visible).toBe(true);
    expect(ctx.floor.visible).toBe(true);
    expect(y).toBeCloseTo(0);
  });

  it('is not drawn at all for one that hangs on a wall', () => {
    // A floor the product is not standing on, and a shadow the real thing would
    // never cast.
    const ctx = fakeCtx();
    setGround(ctx, MOUNTING.FLOATING, 100);
    expect(ctx.grid.visible).toBe(false);
    expect(ctx.floor.visible).toBe(false);
  });

  it('drops by the foot height when the product is on feet', () => {
    // The measured case (§5.12): the parts keep their coordinates and the
    // ground moves, which is also what the real thing does.
    const ctx = fakeCtx();
    const y = setGround(ctx, MOUNTING.FEET, 100);
    expect(ctx.grid.visible).toBe(true);
    expect(Math.round(y * 1000)).toBe(-100);
    expect(Math.round(ctx.floor.position.y * 1000)).toBe(-100);
  });
});

describe('fitBounds — the pan leash', () => {
  it('gives no bounds for an empty product rather than a degenerate box', () => {
    expect(fitBounds(fakeCtx())).toBeNull();
  });

  it('is bigger than the product, so you can pan past the end of a run', () => {
    const ctx = fakeCtx();
    syncProduct(ctx, scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'i2', componentId: 'ladder', selections: {} },
      ],
      { i1: at(0), i2: at(0.92) },
    ), new Map([['ladder', component('ladder')]]), {});

    const bounds = fitBounds(ctx);
    expect(ctx.panBounds.min.x).toBeLessThan(bounds.min.x);
    expect(ctx.panBounds.max.x).toBeGreaterThan(bounds.max.x);
  });

  it('scales the zoom range to the product, not to a fixed number', () => {
    // A maxDistance that suits a 600mm unit leaves a 4m run half off screen.
    const small = fakeCtx();
    const big = fakeCtx();
    const components = new Map([['ladder', component('ladder')]]);

    syncProduct(small, scene(
      [{ instanceId: 'i1', componentId: 'ladder', selections: {} }],
      { i1: at(0) },
    ), components, {});
    fitBounds(small);

    syncProduct(big, scene(
      Array.from({ length: 5 }, (_, n) => ({
        instanceId: `i${n}`, componentId: 'ladder', selections: {},
      })),
      Object.fromEntries(Array.from({ length: 5 }, (_, n) => [`i${n}`, at(n * 0.92)])),
    ), components, {});
    fitBounds(big);

    expect(big.controls.maxDistance).toBeGreaterThan(small.controls.maxDistance * 2);
  });
});

describe('frameProduct — the runtime does this, the editor must not', () => {
  const built = () => {
    const ctx = fakeCtx();
    syncProduct(ctx, scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'i2', componentId: 'ladder', selections: {} },
      ],
      { i1: at(0), i2: at(0.92) },
    ), new Map([['ladder', component('ladder')]]), {});
    return ctx;
  };

  it('refuses an empty product rather than pointing at nothing', () => {
    expect(frameProduct(fakeCtx())).toBe(false);
  });

  it('looks at the middle of the product', () => {
    const ctx = built();
    frameProduct(ctx);
    expect(ctx.controls.target.x).toBeCloseTo(0.46, 2);
  });

  it('backs off far enough to see the whole thing', () => {
    const ctx = built();
    frameProduct(ctx);
    const distance = ctx.camera.position.distanceTo(ctx.controls.target);
    // The product's own bounding sphere is about 0.86m in radius here, so a
    // camera nearer than that is inside it.
    expect(distance).toBeGreaterThan(0.9);
  });

  it('backs off FURTHER for a bigger product', () => {
    // The failure this guards against is a hard-coded distance that happened to
    // suit whichever product was on screen when it was written.
    const ctx = built();
    frameProduct(ctx);
    const near = ctx.camera.position.distanceTo(ctx.controls.target);

    const wide = fakeCtx();
    syncProduct(wide, scene(
      Array.from({ length: 6 }, (_, n) => ({
        instanceId: `i${n}`, componentId: 'ladder', selections: {},
      })),
      Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`i${n}`, at(n * 0.92)])),
    ), new Map([['ladder', component('ladder')]]), {});
    frameProduct(wide);

    expect(wide.camera.position.distanceTo(wide.controls.target)).toBeGreaterThan(near * 2);
  });

  it('frames a portrait window without cutting the product off at the sides', () => {
    // A phone held upright is the narrow case and the only device AR runs on.
    // Framing from the vertical fov alone leaves a wide run cropped.
    const portrait = built();
    portrait.camera.aspect = 0.46;
    portrait.camera.updateProjectionMatrix();
    frameProduct(portrait);

    const landscape = built();
    frameProduct(landscape);

    expect(portrait.camera.position.distanceTo(portrait.controls.target))
      .toBeGreaterThan(landscape.camera.position.distanceTo(landscape.controls.target));
  });
});

describe('describeLayout', () => {
  it('reports where each part ended up and which way it faces', () => {
    const ctx = fakeCtx();
    const s = scene(
      [
        { instanceId: 'i1', componentId: 'ladder', selections: {} },
        { instanceId: 'i2', componentId: 'ladder', selections: {} },
      ],
      { i1: at(0), i2: at(0.9201) },
    );
    syncProduct(ctx, s, new Map([['ladder', component('ladder')]]), {});

    const text = describeLayout(ctx, s, [
      { fromInstanceId: 'i1', fromSnapId: 'a', toInstanceId: 'i2', toSnapId: 'b' },
    ]);
    expect(text).toMatch(/2 instances/);
    expect(text).toMatch(/i2 ladder @ 920\.1,0\.0,0\.0 {2}wall \+z/);
    expect(text).toMatch(/1 connections/);
  });

  it('says so when a part is not in the scene, rather than omitting the row', () => {
    const ctx = fakeCtx();
    const s = scene([{ instanceId: 'i1', componentId: 'ghost', selections: {} }], { i1: at(0) });
    expect(describeLayout(ctx, s)).toMatch(/i1 ghost NOT IN SCENE/);
  });
});
