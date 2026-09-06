// The three.js scene, once, for both the editor and the viewer.
//
// WHY THIS FILE EXISTS, and it is not tidiness. The plan's Phase 2 wants a
// runtime "built on src/engine/*, with no editing affordances". The obvious way
// to get one is to write a second, simpler component that draws the product —
// and that is the mistake. This session has now found the same fault three
// times in one day:
//
//   * the app counted triangles one way and the GLB export another (§5.19)
//   * `describeGlb` and three.js had to be made to agree, and the test that
//     makes them is the only thing that would notice if they stopped
//   * the USDZ exporter had its own idea of which nodes are product, and put
//     the editor's snap planes in a customer's living room (§5.20)
//
// A second renderer would be the same shape of bug with the worst possible
// symptom: the thing the customer sees not matching the thing the salesperson
// approved. So the scene is built HERE, and the editor is the viewer plus
// markers, a ghost and a picker rather than a different program.
//
// Nothing in this file knows what a configuration is. It takes a mount element
// and gives back a context; `product.js` puts parts in it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** The look. Shared so a render and a screenshot cannot disagree about it. */
export const BACKGROUND = '#1b1815';

/**
 * A scene, a camera, a renderer and controls, mounted in `mount`.
 *
 * Orbiting is NOT an editing affordance — looking at a product from another
 * angle is not changing it — so the viewer keeps all of this.
 */
export function createScene(mount, { background = BACKGROUND } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 100);
  camera.position.set(0.8, 0.6, 1.1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // PBR Neutral: accuracy over mood. A finish shown here has to be the finish.
  renderer.toneMapping = THREE.NeutralToneMapping;
  mount.appendChild(renderer.domElement);

  // TOUCH. The canvas must not scroll the page under a finger, and this is the
  // line that stops it — without it a one-finger orbit on a phone drags the
  // page and the product never moves. It belongs here rather than in CSS
  // because the element is created here and nothing else can reach it.
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  // PAN, BOUNDED. Matt, 3 Sep: "when I added a few of the kitchen cabs I could
  // only rotate around a limited section and not view the other areas". Orbit
  // alone pivots about one fixed point, so on a four-metre run you can look at
  // the middle from any angle and never get a close view of an end.
  //
  // The worry that stopped it — losing an anchored product off screen — is real,
  // but the fix is a LEASH, not a ban. See `clampPan`.
  controls.enablePan = true;
  // Screen-space panning drags the product with the cursor, which is what "pan"
  // means to anyone who has used a map. The alternative slides along the ground
  // plane and feels like flying.
  controls.screenSpacePanning = true;

  // ONE FINGER ORBITS, TWO PAN AND ZOOM. three's defaults already do this, but
  // stating them means a three.js change cannot quietly alter how the product
  // behaves on a phone — which is the only device AR exists on.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  scene.add(new THREE.HemisphereLight('#cfd6e4', '#3a3128', 1.0));
  const key = new THREE.DirectionalLight('#fff4e6', 1.6);
  key.position.set(2, 3.5, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 12;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#dfe6f5', 0.35);
  fill.position.set(-2, 1.5, -1.5);
  scene.add(fill);

  // Ground: a grid to read scale from and a shadow catcher. Both are held on the
  // context because a wall-mounted product has no floor under it — leaving them
  // visible draws a floor the product is not standing on, and the shadow lands
  // somewhere the real thing would never cast one.
  const grid = new THREE.GridHelper(4, 40, '#463c33', '#2c2721');
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const productRoot = new THREE.Group();
  scene.add(productRoot);

  const ctx = {
    scene, camera, renderer, controls, productRoot, grid, floor,
    groups: new Map(),
    // The leash. Recomputed from the product's own bounds whenever it changes,
    // so it is never a guess about how big the thing might get.
    panBounds: null,
  };

  // Keep the orbit target inside the leash. The camera is moved by the SAME
  // correction as the target, so the view direction is untouched — it reads as
  // the pan running out of room, not as the camera being snatched away.
  const corrected = new THREE.Vector3();
  ctx.clampPan = () => {
    const box = ctx.panBounds;
    if (!box) return;
    corrected.copy(controls.target).clamp(box.min, box.max);
    if (corrected.distanceToSquared(controls.target) < 1e-12) return;
    camera.position.add(corrected.clone().sub(controls.target));
    controls.target.copy(corrected);
  };

  ctx.resize = () => {
    const { clientWidth: w, clientHeight: h } = mount;
    renderer.setSize(w, h, false);
    camera.aspect = w / h || 1;
    camera.updateProjectionMatrix();
  };
  ctx.resize();

  const observer = new ResizeObserver(ctx.resize);
  observer.observe(mount);

  // Render ON DEMAND as well as in the loop. An uncomposited window stops firing
  // rAF, so the tick loop stalls and the buffer still holds whatever was drawn
  // before — which is how a screenshot ends up showing the state before the
  // clicks. Both the harness and the viewer's own effects call this.
  ctx.render = () => {
    controls.update();
    ctx.clampPan();
    renderer.render(scene, camera);
  };

  let raf = 0;
  ctx.start = () => {
    if (raf) return;
    const tick = () => {
      ctx.render();
      raf = requestAnimationFrame(tick);
    };
    tick();
  };

  ctx.dispose = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    observer.disconnect();
    controls.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    grid.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss();
    if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
  };

  return ctx;
}

/**
 * Size the leash and the zoom range to whatever is currently in the product.
 *
 * Called on every rebuild, because adding a part to the end of a run has to
 * extend how far you may pan even though the camera should not jump.
 */
export function fitBounds(ctx) {
  const bounds = new THREE.Box3().setFromObject(ctx.productRoot);
  if (bounds.isEmpty()) {
    ctx.panBounds = null;
    return null;
  }

  const size = bounds.getSize(new THREE.Vector3());
  // A generous margin — half the product's own extent, and never less than
  // 300mm — so panning past the end to look back along a run still works.
  const margin = new THREE.Vector3(
    Math.max(size.x * 0.5, 0.3),
    Math.max(size.y * 0.5, 0.3),
    Math.max(size.z * 0.5, 0.3),
  );
  ctx.panBounds = bounds.clone().expandByVector(margin);

  // Zoom limits scale with the product for the same reason: a fixed maxDistance
  // that suits a 600mm unit leaves a 4m run half off screen.
  const reach = Math.max(size.length(), 0.4);
  ctx.controls.minDistance = 0.15;
  ctx.controls.maxDistance = reach * 4;

  return bounds;
}

/**
 * Point the camera at the whole product.
 *
 * The EDITOR never does this — a camera that jumps every time you add a shelf
 * is unusable, and that is a real difference between the two rather than an
 * oversight. The VIEWER does it once, on load, because a runtime that opens
 * showing the corner of a four-metre run has failed before anyone touches it.
 *
 * The distance comes from the product's bounding sphere and the camera's own
 * field of view, so it frames a 450mm shelf and a 4m run equally well rather
 * than from a number that happened to suit whichever was tried first. The
 * HORIZONTAL fov is taken into account because a phone held upright is the
 * narrow case, and that is the device this has to work on.
 */
export function frameProduct(ctx, { padding = 1.35 } = {}) {
  const bounds = new THREE.Box3().setFromObject(ctx.productRoot);
  if (bounds.isEmpty()) return false;

  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const fov = (ctx.camera.fov * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fov / 2) * ctx.camera.aspect);
  const distance = (sphere.radius * padding) / Math.sin(Math.min(fov, fovH) / 2);

  // Three-quarter view, slightly above: the angle every piece of furniture
  // photography uses, because it shows a front and a side at once.
  const direction = new THREE.Vector3(0.55, 0.42, 1).normalize();
  ctx.controls.target.copy(sphere.center);
  ctx.camera.position.copy(sphere.center).addScaledVector(direction, distance);
  ctx.camera.updateProjectionMatrix();
  ctx.controls.update();
  return true;
}
