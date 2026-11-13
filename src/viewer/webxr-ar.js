// AR INSIDE CHROME, for Android - WebXR, with Google's Scene Viewer kept as the
// fallback.
//
// Matt, 13 Nov 2026: "the augmented reality feature isn't working". On his new
// phone and on his Pixel tablet, "View in your room" started Scene Viewer and it
// closed again at once - and so did Google's own sample avocado, from a QR code,
// on both. It is Google's: current Google app builds (17.68 onwards) close
// Scene Viewer about 30 ms after it opens, whatever the model
// (google-ar/arcore-android-sdk #1795, #1797). His old phone, on an older Google
// app, worked.
//
// Chrome's own AR (WebXR "immersive-ar") does not go through the Google app at
// all - it needs Google Play Services for AR - so a page that asks Chrome first
// does not care which Google app is installed. Scene Viewer stays as the
// fallback, for a phone whose Chrome cannot start a session.
//
// The session draws the SAME file Scene Viewer would have been handed: the AR
// route's GLB for the configuration on screen, or the bundle's shipped one. So
// AR still shows the customer's own product and nothing about the model
// pipeline changes.
//
// Self-contained and per session: its own renderer, scene and overlay, made on
// the tap and disposed when the session ends. No globals and no ids, so two
// configurators on one page cannot collide (the multi-instance rule).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Which way to turn the product so its FRONT faces the person holding the
 * phone. The product's room side is -z and its wall side +z (§5.13); a turn of
 * θ about the vertical takes -z to (-sin θ, 0, -cos θ), so to point it along
 * the direction from the product to the camera, θ = atan2(-dx, -dz).
 */
export function yawToFace(product, camera) {
  const dx = camera.x - product.x;
  const dz = camera.z - product.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return Math.atan2(-dx, -dz);
}

/** Can this browser start AR itself? Never throws: no is an answer too. */
export async function webxrArSupported(xr = (typeof navigator === 'undefined' ? null : navigator.xr)) {
  try {
    return !!xr && typeof xr.isSessionSupported === 'function'
      && (await xr.isSessionSupported('immersive-ar')) === true;
  } catch {
    return false;
  }
}

// What the overlay says, in order. Plain words: this is the only instruction a
// customer gets while holding a phone up at their room.
export const SAY = {
  loading: 'Loading the product…',
  find: 'Point your phone at the floor and move it slowly',
  place: 'Tap to place it',
  placed: 'Tap the floor to move it',
  failed: 'The product could not be loaded.',
};

function overlayFor(doc, title, theme) {
  const root = doc.createElement('div');
  // The configurator's own theme, so the overlay reads its tokens.
  root.className = 'cfgx cfg-theme';
  if (theme) root.dataset.cfgTheme = theme;
  const bar = doc.createElement('div');
  bar.className = 'cfgx-bar';
  const name = doc.createElement('span');
  name.className = 'cfgx-title';
  name.textContent = title || '';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'cfgx-close';
  close.textContent = 'Close';
  bar.append(name, close);
  const hint = doc.createElement('p');
  hint.className = 'cfgx-hint';
  hint.textContent = SAY.loading;
  root.append(bar, hint);
  // A tap on the overlay's own controls is not a tap on the floor.
  bar.addEventListener('beforexrselect', (e) => e.preventDefault());
  return { root, close, hint };
}

/**
 * Start an AR session and place `glbUrl` on the floor where the person taps.
 *
 * MUST be called from the tap itself: Chrome only starts a session inside a
 * user gesture, so `requestSession` is the first thing this does and nothing is
 * awaited before it. Resolves when the session has started; rejects if Chrome
 * refused it, so the caller can fall back to Scene Viewer.
 */
export function startWebXrAr({
  glbUrl, title = null, theme = null, xr = navigator.xr, doc = document, onEnd = null,
} = {}) {
  const ui = overlayFor(doc, title, theme);
  doc.body.appendChild(ui.root);

  let request;
  try {
    request = xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: ui.root },
    });
  } catch (err) {
    ui.root.remove();
    return Promise.reject(err);
  }

  return request.then((session) => run(session, { glbUrl, ui, onEnd }), (err) => {
    ui.root.remove();
    throw err;
  });
}

async function run(session, { glbUrl, ui, onEnd }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // The same tone mapping as the configurator, so the steel is the steel.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  // Lit as the configurator lights it (scene.js): a procedural room for the
  // metal to reflect, a sky/floor hemisphere, a key from the room side.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#cfd6e4', '#8a857c', 1.0));
  const key = new THREE.DirectionalLight('#fff4e6', 1.4);
  key.position.set(-1.5, 3, -1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 8 });
  const product = new THREE.Group();
  product.visible = false;
  key.target = product;
  scene.add(key, product);

  // A soft shadow on the real floor, which is most of what makes a product look
  // as though it is standing there rather than floating in front of the camera.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.3 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.receiveShadow = true;
  product.add(shadow);

  // Where a tap would put it.
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.13, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  let loaded = false;
  let placed = false;
  const say = (text) => { ui.hint.textContent = text; };

  new GLTFLoader().loadAsync(glbUrl).then((gltf) => {
    gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    product.add(gltf.scene);
    loaded = true;
    say(reticle.visible ? SAY.place : SAY.find);
  }, () => say(SAY.failed));

  const here = new THREE.Vector3();
  const viewer = new THREE.Vector3();
  const controller = renderer.xr.getController(0);
  controller.addEventListener('select', () => {
    if (!loaded || !reticle.visible) return;
    here.setFromMatrixPosition(reticle.matrix);
    product.position.copy(here);
    camera.getWorldPosition(viewer);
    // The product stands upright on the floor, front to the person.
    product.rotation.set(0, yawToFace(here, viewer), 0);
    product.visible = true;
    placed = true;
    say(SAY.placed);
  });
  scene.add(controller);

  let hitSource = null;
  session.requestReferenceSpace('viewer')
    .then((space) => session.requestHitTestSource({ space }))
    .then((source) => { hitSource = source; })
    .catch(() => say(SAY.failed));

  const finish = () => {
    renderer.setAnimationLoop(null);
    hitSource?.cancel?.();
    environment.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) m?.dispose?.();
    });
    renderer.dispose();
    ui.root.remove();
    onEnd?.();
  };
  session.addEventListener('end', finish, { once: true });
  ui.close.addEventListener('click', () => session.end().catch(() => {}));

  await renderer.xr.setSession(session);

  renderer.setAnimationLoop((time, frame) => {
    if (frame && hitSource) {
      const space = renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(hitSource);
      const pose = hits.length ? hits[0].getPose(space) : null;
      const was = reticle.visible;
      reticle.visible = !!pose;
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
      if (loaded && !placed && was !== reticle.visible) say(reticle.visible ? SAY.place : SAY.find);
    }
    renderer.render(scene, camera);
  });
  return session;
}
