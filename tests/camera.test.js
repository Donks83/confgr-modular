// The camera, and who is allowed to move it.
//
// `scene.js` has said since it was written that the editor never re-frames -
// "a camera that jumps every time you add a shelf is unusable" - and that the
// viewer frames "once, on load". The runtime framed on EVERY rebuild, so the
// comment described an intention nobody had implemented. In a guided
// configurator that meant every tap on a stepper threw away the angle and the
// zoom the person had just dragged into place.
//
// Testable without a renderer, which is the reason it is tested at all:
// `frameProduct` and `followProduct` are arithmetic over a camera, an orbit
// target and a bounding box. No WebGL, no canvas, no jsdom - just three's own
// maths, which runs perfectly well in node.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { frameProduct, followProduct } from '../src/viewer/scene.js';

/**
 * Enough of a scene context for the camera maths, and no more.
 *
 * `controls.update()` is a no-op here: OrbitControls needs a DOM element and
 * everything under test happens before it would matter.
 */
function ctxWith(sizeM = [0.95, 1.6, 0.32], centre = [0, 0.8, 0]) {
  const productRoot = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...sizeM));
  mesh.position.set(...centre);
  productRoot.add(mesh);

  const camera = new THREE.PerspectiveCamera(45, 0.46, 0.01, 100);
  return {
    productRoot,
    camera,
    controls: { target: new THREE.Vector3(), update: () => {} },
  };
}

const dir = (ctx) => ctx.camera.position.clone().sub(ctx.controls.target).normalize();
const dist = (ctx) => ctx.camera.position.distanceTo(ctx.controls.target);

/**
 * Put the camera a given distance from the target along the direction it is
 * already looking from — which is what a person zooming does.
 *
 * A HELPER BECAUSE THE OBVIOUS ONE-LINER IS WRONG, and it was wrong twice here:
 *
 *     ctx.camera.position.copy(ctx.controls.target).addScaledVector(dir(ctx), d)
 *
 * `copy` has already moved the camera ONTO the target by the time `dir(ctx)` is
 * evaluated, so the direction is the zero vector and the camera stays at the
 * target. One test failed loudly; the other passed for the wrong reason,
 * asserting 0 ≈ 0 × 3 about a camera that had not moved.
 */
const zoomTo = (ctx, d) => {
  const along = dir(ctx);
  ctx.camera.position.copy(ctx.controls.target).addScaledVector(along, d);
};

describe('framing a product for the first time', () => {
  it('aims at the product and stands back far enough to see it', () => {
    const ctx = ctxWith();
    expect(frameProduct(ctx)).toBe(true);
    expect(ctx.controls.target.y).toBeCloseTo(0.8, 3);
    expect(dist(ctx)).toBeGreaterThan(1);
  });

  it('stands back further for a bigger product', () => {
    const small = ctxWith([0.45, 0.55, 0.32]);
    const big = ctxWith([2.8, 2.21, 0.32]);
    frameProduct(small);
    frameProduct(big);
    expect(dist(big)).toBeGreaterThan(dist(small));
  });

  it('says so when there is nothing to frame', () => {
    const ctx = ctxWith();
    ctx.productRoot.clear();
    expect(frameProduct(ctx)).toBe(false);
  });
});

describe('following a product that changed', () => {
  /** A shelf inside the existing bay: the product is no bigger. */
  const addShelf = (ctx) => {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.29));
    shelf.position.set(0, 0.45, 0);
    ctx.productRoot.add(shelf);
  };

  /** One bay becomes three: the product triples in width. */
  const addBays = (ctx) => {
    const run = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.6, 0.32));
    run.position.set(0.95, 0.8, 0);
    ctx.productRoot.add(run);
  };

  it('does not move at all when the product did not grow', () => {
    // THE ONE THAT MATTERS. Adding a shelf inside the bay must not move the
    // view by a millimetre.
    const ctx = ctxWith();
    frameProduct(ctx);
    const before = ctx.camera.position.clone();
    const target = ctx.controls.target.clone();

    addShelf(ctx);

    expect(followProduct(ctx)).toBe(false);
    expect(ctx.camera.position.distanceTo(before)).toBeCloseTo(0, 6);
    expect(ctx.controls.target.distanceTo(target)).toBeCloseTo(0, 6);
  });

  it('leaves a deliberate close-up alone', () => {
    // The reason this measures GROWTH rather than whether the product fits.
    // Somebody zoomed right in on a joint does not fit the product in frame on
    // purpose; the first version of this pulled them back out on the next tap.
    const ctx = ctxWith();
    frameProduct(ctx);
    zoomTo(ctx, 0.25);
    const before = ctx.camera.position.clone();

    addShelf(ctx);

    expect(followProduct(ctx)).toBe(false);
    expect(ctx.camera.position.distanceTo(before)).toBeCloseTo(0, 6);
  });

  it('gives a grown product the same room it had, keeping angle and target', () => {
    const ctx = ctxWith();
    frameProduct(ctx);
    const angle = dir(ctx);
    const target = ctx.controls.target.clone();
    const was = dist(ctx);
    const radiusBefore = ctx.productRadius;

    addBays(ctx);

    expect(followProduct(ctx)).toBe(true);
    // Distance scaled by exactly how much bigger the product got — so it
    // occupies the same fraction of the frame as before.
    expect(dist(ctx) / was).toBeCloseTo(ctx.productRadius / radiusBefore, 5);
    expect(dir(ctx).angleTo(angle)).toBeCloseTo(0, 6);
    expect(ctx.controls.target.distanceTo(target)).toBeCloseTo(0, 6);
  });

  it('scales a close-up by the same proportion rather than reframing it', () => {
    // A person zoomed in AND then triples the product: they should still be
    // zoomed in, just far enough out to have kept their share of the view.
    const ctx = ctxWith();
    frameProduct(ctx);
    const framed = dist(ctx);
    zoomTo(ctx, framed * 0.2);
    const close = dist(ctx);
    const radiusBefore = ctx.productRadius;

    addBays(ctx);
    followProduct(ctx);

    // Against the RADIUS ratio, not a guessed number. Tripling the width does
    // not triple the bounding sphere — on a 1600 mm tall bay the height
    // dominates it, so 0.95 m to 2.85 m wide is a growth factor of about 1.74,
    // not 3. The first version of this test asserted ×3 and was measuring my
    // mental model rather than the code.
    expect(dist(ctx)).toBeCloseTo(close * (ctx.productRadius / radiusBefore), 5);
    // Still much closer than a fresh framing of the bigger product would be.
    const fresh = ctxWith([2.85, 1.6, 0.32]);
    frameProduct(fresh);
    expect(dist(ctx)).toBeLessThan(dist(fresh));
  });

  // A SMALL shrink moves nothing. Removing one shelf from a run must leave the
  // view exactly where the person left it - somebody who zoomed out to see the
  // whole thing did that on purpose too.
  it('ignores a part coming off', () => {
    const ctx = ctxWith([2.85, 1.6, 0.32]);
    frameProduct(ctx);
    const far = dist(ctx) * 2;
    zoomTo(ctx, far);

    ctx.productRoot.clear();
    // 5% off the width: the bounding sphere barely notices.
    const nearlySame = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.6, 0.32));
    nearlySame.position.set(0, 0.8, 0);
    ctx.productRoot.add(nearlySame);

    expect(followProduct(ctx)).toBe(false);
    expect(dist(ctx)).toBeCloseTo(far, 6);
  });

  // A BIG shrink does react, and this is a correction rather than the original
  // design. Growth-only left a hole: switching the 320 mm range for the 200 mm
  // one halves the product in every direction, and Matt was left looking at a
  // run occupying a quarter of the frame with empty grid all round it. Nobody
  // chose that zoom.
  it('pulls in when the product becomes a different size altogether', () => {
    const ctx = ctxWith([2.85, 1.6, 0.32]);
    frameProduct(ctx);
    const far = dist(ctx) * 2;
    zoomTo(ctx, far);
    const radiusBefore = ctx.productRadius;

    ctx.productRoot.clear();
    const small = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.67, 0.2));
    small.position.set(0, 0.33, 0);
    ctx.productRoot.add(small);

    expect(followProduct(ctx)).toBe(true);
    // The same proportion of room it had before, which is the whole rule -
    // not a fresh framing, so a deliberate wide view stays wide.
    expect(dist(ctx)).toBeCloseTo(far * (ctx.productRadius / radiusBefore), 5);
    expect(dist(ctx)).toBeLessThan(far);
  });

  it('leaves the direction and the target alone when it does react', () => {
    const ctx = ctxWith([2.85, 1.6, 0.32]);
    frameProduct(ctx);
    zoomTo(ctx, dist(ctx) * 2);
    const before = ctx.camera.position.clone().sub(ctx.controls.target).normalize();
    const target = ctx.controls.target.clone();

    ctx.productRoot.clear();
    const small = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.67, 0.2));
    small.position.set(0, 0.33, 0);
    ctx.productRoot.add(small);
    followProduct(ctx);

    const after = ctx.camera.position.clone().sub(ctx.controls.target).normalize();
    expect(after.angleTo(before)).toBeCloseTo(0, 6);
    expect(ctx.controls.target.distanceTo(target)).toBeCloseTo(0, 6);
  });

  it('has a baseline from the moment it was framed', () => {
    // Without `frameProduct` recording the radius, the first change after a
    // framing would do nothing and the second would over-react to both.
    const ctx = ctxWith();
    frameProduct(ctx);
    expect(ctx.productRadius).toBeGreaterThan(0);
  });

  it('says so when there is nothing to follow', () => {
    const ctx = ctxWith();
    ctx.productRoot.clear();
    expect(followProduct(ctx)).toBe(false);
  });
});
