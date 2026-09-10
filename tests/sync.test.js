// What the scene draws, against what it was asked to draw.
//
// THE BUG THIS EXISTS FOR. Matt changed the depth from 320 mm to 200 mm and
// sent a picture of four frames at two different heights, a metal shelf on a
// range that has no metal shelf, and a size strip reading 1890 x 1500 x 320 mm
// with "200 mm deep" selected. The placement was correct - the engine's numbers
// were right to the tenth of a millimetre. The SCENE was stale.
//
// `syncProduct` cached a group by instanceId alone. In the editor an
// instanceId names the same component for the rest of that part's life, so
// that was safe for fifteen sessions. The runtime draws by resolving a
// configuration id, which names its instances p0, p1, p2 BY POSITION - so
// changing an option keeps the ids and changes the parts, and the cache handed
// back the previous geometry.
//
// It needs three.js but no GPU: nothing here touches a renderer, so a fake ctx
// with a Group and a Map is the whole harness. That is why this was reachable
// as a unit test all along and never written.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { syncProduct } from '../src/viewer/product.js';

/** A component, as far as syncProduct is concerned: a template and options. */
const component = (name, colour = '#888888') => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: colour }),
  );
  mesh.name = name;
  const template = new THREE.Group();
  template.add(mesh);
  return { template, options: [] };
};

const ctxOf = () => {
  const productRoot = new THREE.Group();
  return { productRoot, groups: new Map() };
};

const sceneOf = (pairs) => ({
  instances: pairs.map(([instanceId, componentId]) => ({ instanceId, componentId, selections: {} })),
  transforms: new Map(pairs.map(([instanceId]) => [
    instanceId, { translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
  ])),
});

const drawnNames = (ctx) => {
  const out = [];
  ctx.productRoot.traverse((o) => { if (o.isMesh) out.push(o.name); });
  return out.sort();
};

const components = new Map([
  ['ladder-1500', component('ladder-1500')],
  ['ladder-668', component('ladder-668')],
  ['shelf-metal', component('shelf-metal')],
  ['shelf-timber', component('shelf-timber')],
]);

describe('drawing the product it was given', () => {
  it('draws one group per instance', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500'], ['p1', 'shelf-metal']]), components);
    expect(ctx.groups.size).toBe(2);
    expect(drawnNames(ctx)).toEqual(['ladder-1500', 'shelf-metal']);
  });

  it('removes a part that is no longer in the product', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500'], ['p1', 'shelf-metal']]), components);
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    expect(drawnNames(ctx)).toEqual(['ladder-1500']);
  });

  // THE REGRESSION. Same ids, different parts - which is what every option
  // change looks like to a runtime drawing from a configuration id.
  it('redraws when an id keeps its name and changes its part', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500'], ['p1', 'shelf-metal']]), components);
    syncProduct(ctx, sceneOf([['p0', 'ladder-668'], ['p1', 'shelf-timber']]), components);
    expect(drawnNames(ctx)).toEqual(['ladder-668', 'shelf-timber']);
  });

  it('leaves nothing of the old product behind', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    syncProduct(ctx, sceneOf([['p0', 'ladder-668']]), components);
    // The symptom was a scene containing BOTH, which is what inflated the size
    // strip to 1890 x 1500 x 320 - `fitBounds` measures the scene.
    expect(drawnNames(ctx)).not.toContain('ladder-1500');
    expect(ctx.groups.size).toBe(1);
  });

  it('keeps the group when the part has not changed', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    const first = ctx.groups.get('p0');
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    // Rebuilding an unchanged part on every tap would throw away and re-clone
    // every mesh in the product for nothing.
    expect(ctx.groups.get('p0')).toBe(first);
  });

  it('records which component a group is holding', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    expect(ctx.groups.get('p0').userData.componentId).toBe('ladder-1500');
  });

  it('moves a part that stayed the same and went somewhere else', () => {
    const ctx = ctxOf();
    const scene = sceneOf([['p0', 'ladder-1500']]);
    syncProduct(ctx, scene, components);
    scene.transforms.set('p0', { translation: [1, 2, 3], rotation: [0, 0, 0, 1] });
    syncProduct(ctx, scene, components);
    expect(ctx.groups.get('p0').position.toArray()).toEqual([1, 2, 3]);
  });

  it('skips an instance whose component is not loaded, without throwing', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500'], ['p1', 'not-loaded']]), components);
    expect(ctx.groups.size).toBe(1);
  });

  // Each part owns its material so it can be coloured independently; cloning
  // one per mesh on EVERY sync leaked one per rebuild, which in a configurator
  // is every tap on a stepper.
  it('clones a material once, not on every draw', () => {
    const ctx = ctxOf();
    const scene = sceneOf([['p0', 'ladder-1500']]);
    syncProduct(ctx, scene, components);
    let material = null;
    ctx.groups.get('p0').traverse((o) => { if (o.isMesh) material = o.material; });
    syncProduct(ctx, scene, components);
    syncProduct(ctx, scene, components);
    let after = null;
    ctx.groups.get('p0').traverse((o) => { if (o.isMesh) after = o.material; });
    expect(after).toBe(material);
  });

  it('disposes the material of a part it throws away', () => {
    const ctx = ctxOf();
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    let disposed = false;
    ctx.groups.get('p0').traverse((o) => {
      if (o.isMesh) o.material.addEventListener('dispose', () => { disposed = true; });
    });
    syncProduct(ctx, sceneOf([['p0', 'ladder-668']]), components);
    expect(disposed).toBe(true);
  });

  // A part the template shares with every other clone of it must NOT be
  // disposed with one instance, or the next part of that kind draws nothing.
  it('does not dispose the template geometry', () => {
    const ctx = ctxOf();
    let disposed = false;
    components.get('ladder-1500').template.traverse((o) => {
      if (o.isMesh) o.geometry.addEventListener('dispose', () => { disposed = true; });
    });
    syncProduct(ctx, sceneOf([['p0', 'ladder-1500']]), components);
    syncProduct(ctx, sceneOf([['p0', 'ladder-668']]), components);
    expect(disposed).toBe(false);
  });
});
