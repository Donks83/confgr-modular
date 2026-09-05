// The anchored-product configurator. Replaces the drag spike.
//
// WHAT CHANGED AND WHY. Plan section 2A: this is not a room designer. The
// product sits at the centre and does not move; parts are added AT ATTACH
// POINTS by clicking. Dragging through open 3D space is gone, and with it went
// four bugs rather than four fixes — snap tolerance, attachment ambiguity,
// collision, and a part orphaning its children when moved.
//
// Both attach orders are supported because they are the same query. The engine
// builds one list of legal (point, part) pairs; this file filters it by point
// or by part depending on which the person touched first. There is no second
// code path.
//
// Still a spike: raw three.js rather than react-three-fiber, markers as
// individual meshes rather than one InstancedMesh. At 84 markers that is fine;
// past a few thousand it would not be, and instancing is the answer then.

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadComponentFromPath } from '../three/loadGlb.js';
import { resolveTransforms, validateAssembly } from '../engine/assembly.js';
import {
  attachMatrix, pointsForComponent, componentsForPoint, livePoints,
  whyNothingFits, attachAt, detach, pointKey,
  canMove, moveTargets, moveTo,
  placementsAt, mountHeightMm, mountLabel, isFlatMount, distinctPlacements,
  placeFree, freePositionFor,
} from '../engine/attach.js';
import { quote, formatQuote } from '../engine/quote.js';
import {
  MOUNTING, FOOT, arReadiness, isGrounded, groundClearanceMm,
} from '../engine/ar.js';

let counter = 0;
const nextId = () => { counter += 1; return `i${counter}`; };

const EMPTY = { instances: [], connections: [] };

export default function Configurator() {
  const mountRef = useRef(null);
  const three = useRef(null);
  const framedFor = useRef('');
  // Drag state lives in a ref, not React state: pointermove fires at screen
  // rate and re-rendering the panel on every one of them would make the drag
  // feel heavy. Only the START and END of a drag touch React.
  const drag = useRef(null);
  const live = useRef({});

  const [components, setComponents] = useState(new Map());
  const [assembly, setAssembly] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [pendingPart, setPendingPart] = useState(null);    // part-first
  const [pendingPoint, setPendingPoint] = useState(null);  // point-first
  const [movingId, setMovingId] = useState(null);          // drag-to-another-point
  const [showMarkers, setShowMarkers] = useState(true);
  const [showGuides, setShowGuides] = useState(false);
  const [status, setStatus] = useState('Loading components.');
  const [loadErrors, setLoadErrors] = useState([]);
  // "priceBook", not "catalogue" - `catalogue` below already means the palette
  // of loadable components, and two different catalogues in one file is how a
  // quote ends up pricing the wrong list.
  const [priceBook, setPriceBook] = useState(null);
  const [priceBookError, setPriceBookError] = useState(null);
  const [tierId, setTierId] = useState(null);
  const [showQuote, setShowQuote] = useState(true);
  // Floor-standing or wall-mounted. Two options and no height: every YouK frame
  // is wall-fixed in reality, and the height it hangs at is chosen when the
  // customer places it in AR, so a height here would be a number nothing reads.
  // What this DOES decide is whether the AR handoff offers vertical surfaces.
  const [mounting, setMounting] = useState(MOUNTING.FLOOR);
  // Which of the two foot SKUs, not a free height. Only read when mounting is
  // FEET; kept across a switch away and back so the choice is not lost.
  const [footHeightMm, setFootHeightMm] = useState(FOOT.heightsMm[0]);
  // The SECOND END OF THE JOINT, when there is more than one answer. A joint
  // has two ends; the point names one and this names the other. Null whenever
  // the answer is unambiguous, which is most of the time.
  const [pendingChoice, setPendingChoice] = useState(null);

  const catalogue = useMemo(() => [...components.keys()], [components]);

  // ---- the one query everything reads -------------------------------------
  const { transforms, matrix, resolveError } = useMemo(() => {
    if (!components.size || !assembly.instances.length) {
      return { transforms: new Map(), matrix: { placements: [], rejected: [] }, resolveError: null };
    }
    try {
      const { transforms: t } = resolveTransforms(assembly, components);
      return { transforms: t, matrix: attachMatrix(assembly, components, catalogue, t), resolveError: null };
    } catch (err) {
      return { transforms: new Map(), matrix: { placements: [], rejected: [] }, resolveError: err.message };
    }
  }, [assembly, components, catalogue]);

  // Where the part being dragged could be re-hung. Computed only during a drag,
  // and it is a DIFFERENT question from the add matrix: the part already exists,
  // so the points on it and on whatever it carries have to come out of the list.
  const moveMatrix = useMemo(() => {
    if (!movingId || !components.size) return null;
    try {
      return moveTargets(assembly, components, transforms, movingId);
    } catch {
      return null;
    }
  }, [movingId, assembly, components, transforms]);

  const markers = useMemo(() => {
    // A drag in progress owns the markers: they are the places this part can
    // land, and showing "where could a new part go" at the same time would be
    // two different meanings in the same colour.
    if (moveMatrix) return livePoints(moveMatrix);

    const all = livePoints(matrix);
    if (!pendingPart) return all;
    // Part-first: show only where THIS part can go. A 3x2 pouch legitimately
    // offers fewer markers than a 1x1 one, which is the useful behaviour.
    const allowed = new Set(pointsForComponent(matrix, pendingPart).map((p) => p.pointKey));
    return all.filter((p) => allowed.has(pointKey(p)));
  }, [matrix, pendingPart, moveMatrix]);

  const partsAtPendingPoint = useMemo(
    () => (pendingPoint ? componentsForPoint(matrix, pendingPoint) : []),
    [matrix, pendingPoint],
  );

  const selectedInstance = assembly.instances.find((i) => i.instanceId === selectedId) || null;
  const selectedComponent = selectedInstance ? components.get(selectedInstance.componentId) : null;
  const rootId = assembly.instances[0]?.instanceId || null;

  const validity = useMemo(() => {
    if (!components.size || !assembly.instances.length) return { isValid: true, missingRequiredSnaps: [] };
    try { return validateAssembly(assembly, components, transforms); } catch { return { isValid: true, missingRequiredSnaps: [] }; }
  }, [assembly, components, transforms]);

  // The pointer handlers are attached once and must not close over a stale
  // assembly. A ref updated every render is the cheapest correct answer.
  live.current = { assembly, components, transforms };

  // ------------------------------------------------------------- three setup
  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b1815');

    const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 100);
    camera.position.set(0.8, 0.6, 1.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    // PBR Neutral: accuracy over mood. A finish shown here has to be the finish.
    renderer.toneMapping = THREE.NeutralToneMapping;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // PAN, BOUNDED. Matt, 3 Sep: "when I added a few of the kitchen cabs I
    // could only rotate around a limited section and not view the other areas".
    // He is right and the original reasoning was wrong: orbit alone pivots about
    // one fixed point, so on a four-metre run of units you can look at the
    // middle from any angle and never get a close view of an end.
    //
    // The worry that stopped me — losing an anchored product off screen — is
    // real, but the fix is a LEASH, not a ban. Pan freely inside a box around
    // the product; the box grows as the product does; step outside and the
    // target is pulled back to the edge. See clampPan in the render loop.
    controls.enablePan = true;
    // Screen-space panning drags the product with the cursor, which is what
    // "pan" means to everyone who has used a map. The alternative slides along
    // the ground plane and feels like flying.
    controls.screenSpacePanning = true;

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

    // Ground: a grid to read scale from and a shadow catcher. Both are held on
    // `three.current` because a wall-mounted product has no floor under it —
    // leaving them visible draws a floor the product is not standing on, and
    // the shadow lands somewhere the real thing would never cast one.
    const grid = new THREE.GridHelper(4, 40, '#463c33', '#2c2721');
    scene.add(grid);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const productRoot = new THREE.Group();
    const markerRoot = new THREE.Group();
    // The ghost lives in its own group so the product rebuild effect, which
    // owns productRoot's children, never has to know it exists.
    const ghostRoot = new THREE.Group();
    scene.add(productRoot, markerRoot, ghostRoot);

    three.current = {
      scene, camera, renderer, controls, productRoot, markerRoot, ghostRoot,
      grid, floor,
      groups: new Map(),
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      markerGeo: new THREE.SphereGeometry(1, 12, 10),
      // The leash. Recomputed from the product's own bounds whenever it
      // changes, so it is never a guess about how big the thing might get.
      panBounds: null,
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h, false);
      camera.aspect = w / h || 1;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Force one frame, then read the buffer. Same reason as `settle` below: an
    // uncomposited window stops firing rAF, so the tick loop stalls and the
    // buffer still holds whatever was drawn before the clicks. Rendering on
    // demand means the capture shows the state the checks just built.
    window.__spikeRender = () => {
      controls.update();
      three.current.clampPan?.();
      renderer.render(scene, camera);
      return true;
    };
    window.__spikeCapture = () => {
      window.__spikeRender();
      return renderer.domElement.toDataURL('image/png');
    };

    // Spike-only handles so an automated check can drive REAL input: project a
    // target's world position to screen coordinates and dispatch there. Unit
    // tests cover the engine; only this covers the raycast-to-attach wiring,
    // which is exactly where the "it doesn't work" rounds came from.
    //
    // Dispatched on the MOUNT, not the canvas. Two reasons, both learned the
    // hard way: React's handlers live on the mount, and OrbitControls calls
    // setPointerCapture on the canvas, which throws for a synthetic pointerId
    // that never existed. Firing one level up reaches our handlers and leaves
    // the controls out of it.
    // WORLD MATRICES FIRST. Every projection and raycast below reads
    // matrixWorld, and three.js only recomputes those during a render. The
    // React effects set a group's LOCAL position, so between a state change and
    // the next frame a part's matrixWorld still says where it used to be — and
    // when the window is not composited that next frame never comes. On 3 Sep
    // that made the harness press the origin instead of the part and report a
    // move that had not happened. One explicit update removes the whole class.
    const freshMatrices = () => scene.updateMatrixWorld(true);

    const toScreen = (worldPosition) => {
      freshMatrices();
      const v = worldPosition.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    };

    let syntheticPointer = 1000;
    const firePointer = (type, at, pointerId, buttons) => {
      mount.dispatchEvent(new PointerEvent(type, {
        pointerId,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons,
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
      }));
    };

    window.__cfgClickMarker = (index = 0) => {
      const marker = markerRoot.children[index];
      if (!marker) return `no marker at ${index} (have ${markerRoot.children.length})`;

      const at = toScreen(marker.position);
      const id = (syntheticPointer += 1);
      firePointer('pointerdown', at, id, 1);
      firePointer('pointerup', at, id, 0);
      return `clicked marker ${index} of ${markerRoot.children.length} at ${Math.round(at.x)},${Math.round(at.y)}`;
    };

    // Drag a placed part onto a marker: down on the part, past the threshold,
    // across to the marker, up. The same four events a hand would produce.
    //
    // ASYNC, and it has to be. Crossing the threshold sets React state, and the
    // markers do not become move targets until React has rendered and the
    // effect has run. Reading the marker list in the same synchronous tick
    // reads the ADD-flow markers — a different list, and the drop would land
    // somewhere nobody asked for. Hence the awaited settle.
    //
    // A TIMER, not requestAnimationFrame. Found the hard way on 3 Sep: an
    // Electron window that is not composited — behind another window, or
    // offscreen in a headless check — stops firing rAF entirely, so a harness
    // awaiting a frame hangs forever and the run produces no capture at all.
    // React's passive effects are scheduled on a timer, not a frame, so a
    // timeout is both sufficient and immune to that.
    const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

    // A press point on the part that is NOT under a marker.
    //
    // Needed because of a false PASS on 3 Sep: the harness pressed the part's
    // centre, a marker happened to lie along that ray, so the press was handled
    // as a marker click, a part was ADDED, and the harness cheerfully reported
    // "dragged". A verification tool that can report success without doing the
    // thing is worse than none, so it now checks and moves the press point.
    const dragRay = new THREE.Raycaster();
    const pressPointOn = (group) => {
      freshMatrices();
      const box = new THREE.Box3().setFromObject(group);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const rect = renderer.domElement.getBoundingClientRect();

      // The centre first, then points drawn in towards it from each face — all
      // still on the part, just not on the same ray as a marker.
      const candidates = [centre];
      for (const f of [0.3, -0.3, 0.15, -0.15]) {
        candidates.push(centre.clone().addScaledVector(
          new THREE.Vector3(size.x, 0, 0), f,
        ));
        candidates.push(centre.clone().addScaledVector(
          new THREE.Vector3(0, 0, size.z), f,
        ));
      }

      for (const world of candidates) {
        const at = toScreen(world);
        freshMatrices();
        dragRay.setFromCamera(new THREE.Vector2(
          ((at.x - rect.left) / rect.width) * 2 - 1,
          -((at.y - rect.top) / rect.height) * 2 + 1,
        ), camera);

        if (dragRay.intersectObjects(markerRoot.children, false).length) continue;

        const onPart = dragRay.intersectObjects([group], true)
          .filter((h) => h.object.visible && !h.object.name.startsWith('md-'));
        if (onPart.length) return at;
      }
      return null;
    };

    window.__cfgDragToMarker = async (instanceId, markerIndex = 0) => {
      const group = three.current.groups.get(instanceId);
      if (!group) return `no part "${instanceId}"`;

      const from = pressPointOn(group);
      if (!from) return `no clear press point on "${instanceId}" — every candidate was under a marker or off the part`;

      const id = (syntheticPointer += 1);

      firePointer('pointerdown', from, id, 1);
      firePointer('pointermove', { x: from.x + 24, y: from.y }, id, 1);

      await settle();

      // Did the press actually start a drag? If the markers did not switch to
      // move targets, something else consumed the press and this run proves
      // nothing — say so rather than continuing and passing.
      const markerCount = markerRoot.children.length;

      const target = markerRoot.children[markerIndex];
      if (!target) {
        firePointer('pointerup', from, id, 0);
        return `drag started but there is no marker ${markerIndex} (have ${markerCount})`;
      }

      const to = toScreen(target.position);
      firePointer('pointermove', to, id, 1);
      await settle(40);
      firePointer('pointerup', to, id, 0);
      await settle();
      // Report what the app SAYS happened, not what the harness attempted.
      // "Moved." is a pass; "Added ..." means the press was taken as a click.
      const said = document.querySelector('.cfg-status')?.textContent || '(no status)';
      return `pressed ${instanceId}, dropped on marker ${markerIndex} of ${markerCount} -> ${said}`;
    };

    // Keep the orbit target inside the leash. The camera is moved by the SAME
    // correction as the target, so the view direction is untouched — it reads as
    // the pan running out of room, not as the camera being snatched away.
    const corrected = new THREE.Vector3();
    const clampPan = () => {
      const box = three.current?.panBounds;
      if (!box) return;
      corrected.copy(controls.target).clamp(box.min, box.max);
      if (corrected.distanceToSquared(controls.target) < 1e-12) return;
      camera.position.add(corrected.clone().sub(controls.target));
      controls.target.copy(corrected);
    };
    three.current.clampPan = clampPan;

    // Prove the leash rather than eyeballing it: shove the orbit target a long
    // way out, let the clamp run, and report where it actually ended up next to
    // the bounds it was held inside. A static screenshot cannot show this.
    window.__cfgPanCheck = (x = 99, y = 99, z = 99) => {
      const box = three.current.panBounds;
      if (!box) return 'no pan bounds yet — nothing on the product';

      // Non-destructive: clampPan corrects the CAMERA by the same delta as the
      // target, so putting the target back is not enough — the first capture
      // after this check came out looking off-centre because of exactly that.
      const beforeTarget = controls.target.clone();
      const beforeCamera = camera.position.clone();

      controls.target.set(x, y, z);
      clampPan();
      const held = controls.target.clone();
      const inside = box.containsPoint(held);

      controls.target.copy(beforeTarget);
      camera.position.copy(beforeCamera);
      controls.update();

      const f = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
      return `asked ${x},${y},${z} -> held at ${f(held)}; `
        + `bounds ${f(box.min)} to ${f(box.max)}; inside=${inside}`;
    };

    let raf = 0;
    const tick = () => {
      controls.update();
      clampPan();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      three.current.markerGeo.dispose();
      ghostRoot.traverse((o) => { if (o.isMesh) o.material?.dispose(); });
      renderer.dispose();
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // ------------------------------------------------------------- load assets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.confgr) { setStatus('Run this inside the desktop app.'); return; }

        const dir = await window.confgr.app.testAssetsDir();
        const listed = await window.confgr.fs.listModels(dir);
        if (!listed.ok) { setStatus(`Could not read ${dir}: ${listed.error}`); return; }
        if (!listed.files.length) { setStatus(`No .glb files in ${dir}. Run: npm run test:assets`); return; }

        const loaded = new Map();
        const errors = [];
        for (const file of listed.files) {
          try {
            const { component, scene } = await loadComponentFromPath(file);
            loaded.set(component.id, { ...component, template: scene });
          } catch (err) {
            errors.push({ file: file.split(/[\\/]/).pop(), message: err.message });
          }
        }
        if (cancelled) return;

        setComponents(loaded);
        setLoadErrors(errors);

        const demo = new URLSearchParams(window.location.search).get('demo');
        const startWith = demo && loaded.has(demo) ? demo
          : demo === 'molle' ? 'molle-panel'
            : demo === 'rack' ? 'rack-upright-1800'
              : null;

        if (startWith && loaded.has(startWith)) {
          setAssembly({
            instances: [{
              instanceId: nextId(), componentId: startWith, selections: {},
              position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
            }],
            connections: [],
          });
          setStatus('Click a green marker to add a part, or pick a part first.');
        } else {
          setStatus(`${loaded.size} components ready. Choose something to start from.`);
        }
      } catch (err) {
        if (cancelled) return;
        setStatus(`Could not load components: ${err.message}`);
        setLoadErrors([{ file: 'startup', message: err.stack || err.message }]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // -------------------------------------------------------- load the prices
  //
  // Separate from the model load and allowed to fail on its own: a price list
  // that is missing or malformed must not stop somebody configuring a product.
  // The quote panel then says why it cannot price rather than showing zeroes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.confgr?.app?.catalogue) return;
      const res = await window.confgr.app.catalogue();
      if (cancelled) return;
      if (res.ok) {
        setPriceBook(res.catalogue);
        setTierId(res.catalogue.tiers?.[0]?.id || null);
      } else {
        setPriceBookError(`${res.error} (${res.path})`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const priced = useMemo(
    () => (priceBook ? quote(assembly, priceBook, { tierId }) : null),
    [assembly, priceBook, tierId],
  );

  const ar = useMemo(
    () => arReadiness(assembly, components, { mounting }),
    [assembly, components, mounting],
  );

  // What a part is CALLED, and it is not the filename. Kesseböhmer's English
  // filenames drop the height on four of the six ladders, so 550, 905, 1500 and
  // 2210 all arrive as "ladder-depth-320mm" and the palette reads like the same
  // part four times. The catalogue already carries the corrected description -
  // including the two filename errors we overrode - so read it from there and
  // fall back to the id only when there is no entry.
  const labelFor = useCallback(
    (c) => priceBook?.items?.[c.id]?.description || c.id,
    [priceBook],
  );
  const articleFor = useCallback(
    (c) => priceBook?.items?.[c.id]?.article || null,
    [priceBook],
  );

  // A floating product does not stand on anything. Drawing a grid and a cast
  // shadow under it says otherwise, and that is the one thing the view is for:
  // showing whether this thing reaches the floor. So the ground goes away when
  // the mounting says wall. The lights keep casting; only the catcher is gone,
  // which is what makes the shadow disappear rather than move.
  useEffect(() => {
    const ctx = three.current;
    if (!ctx) return;
    const grounded = isGrounded(mounting);
    ctx.grid.visible = grounded;
    ctx.floor.visible = grounded;
    window.__spikeRender?.();
  }, [mounting]);

  // For the harness. Reports the ground out of the SCENE, not out of React
  // state, so a `mount:wall` step that changed the dropdown and nothing else
  // reports the grid still visible rather than reporting success.
  useEffect(() => {
    window.__cfgGround = () => {
      const ctx = three.current;
      if (!ctx) return 'no scene';
      return `mounting=${mounting} grid=${ctx.grid.visible} floor=${ctx.floor.visible} `
        + `clearance=${groundClearanceMm(mounting, footHeightMm)}mm `
        + `ar=${ar.placement.vertical ? 'wall' : 'floor'} tris=${ar.triangles} `
        + `ready=${ar.ready} warnings=[${ar.warnings.map((w) => w.code).join(' ')}]`;
    };
  }, [mounting, footHeightMm, ar]);

  // The quote, for the verification harness. Same numbers the panel shows,
  // rendered as text - so a probe can assert on a bill of materials without
  // reading pixels, and a wrong quantity shows up as a wrong line rather than
  // as a picture nobody checks.
  useEffect(() => {
    window.__cfgQuote = () => (priced
      ? formatQuote(priced)
      : `no price book loaded${priceBookError ? `: ${priceBookError}` : ''}`);
  }, [priced, priceBookError]);

  // ------------------------------------------- rebuild the product from state
  useEffect(() => {
    const ctx = three.current;
    if (!ctx || !components.size) return;

    const wanted = new Set(assembly.instances.map((i) => i.instanceId));
    for (const [id, group] of ctx.groups) {
      if (!wanted.has(id)) { ctx.productRoot.remove(group); ctx.groups.delete(id); }
    }

    for (const instance of assembly.instances) {
      const component = components.get(instance.componentId);
      if (!component) continue;

      let group = ctx.groups.get(instance.instanceId);
      if (!group) {
        group = new THREE.Group();
        group.add(component.template.clone(true));
        group.userData.instanceId = instance.instanceId;
        ctx.productRoot.add(group);
        ctx.groups.set(instance.instanceId, group);
      }

      const t = transforms.get(instance.instanceId);
      if (t) { group.position.fromArray(t.translation); group.quaternion.fromArray(t.rotation); }

      // The finish for THIS instance. Per-part options are the point: eight
      // pouches on a panel are eight instances, each independently coloured.
      const finishOption = component.options.find((o) => o.id === 'finish');
      const chosenId = instance.selections?.finish || finishOption?.defaultValueId;
      const chosen = finishOption?.values.find((v) => v.id === chosenId);
      const isSelected = instance.instanceId === selectedId;

      // eslint-disable-next-line no-loop-func
      group.traverse((o) => {
        if (!o.isMesh) return;
        // Both prefixes survive three.js name sanitisation (it strips dots, not
        // hyphens), which is why matching the mangled name works here.
        const isGuide = o.name.startsWith('md-snap') || o.name.startsWith('md-grid');
        const isBox = o.name.startsWith('col-') || o.name === 'dim';

        o.visible = (isGuide || isBox) ? showGuides : true;
        if (!isGuide && !isBox) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            if (!o.userData.baseColour) o.userData.baseColour = o.material.color.clone();
            o.material = o.material.clone();
            if (chosen?.hex) o.material.color.set(`#${chosen.hex}`);
            else o.material.color.copy(o.userData.baseColour);
            // Selection reads as a warm rim, never a colour change — the finish
            // being judged must not be the thing the highlight altered.
            o.material.emissive = new THREE.Color(isSelected ? '#4a2f0d' : '#000000');
          }
        }
      });
    }

    // Where everything actually ENDED UP. A screenshot cannot answer this: one
    // perspective view of a run of frames cannot tell you whether they are
    // evenly spaced and colinear, and a chain that resolves slightly wrong
    // compounds down the run rather than looking obviously broken. So report
    // the resolved world positions and let the numbers say it.
    //
    // Registered here rather than beside the other harness globals because
    // this is the effect that holds the assembly and the resolved transforms.
    // It is re-assigned on every rebuild, which is what keeps it honest.
    window.__cfgLayout = () => {
      ctx.productRoot.updateMatrixWorld(true);
      const rows = assembly.instances.map((instance) => {
        const group = ctx.groups.get(instance.instanceId);
        if (!group) return `${instance.instanceId} ${instance.componentId} NOT IN SCENE`;
        const p = new THREE.Vector3();
        group.getWorldPosition(p);
        const mm = (v) => (v * 1000).toFixed(1);
        return `${instance.instanceId} ${instance.componentId} `
          + `@ ${mm(p.x)},${mm(p.y)},${mm(p.z)}`;
      });
      const conns = (assembly.connections || []).map(
        (c) => `${c.fromInstanceId}:${c.fromSnapId} -> ${c.toInstanceId}:${c.toSnapId}`,
      );
      return `${rows.length} instances\n${rows.join('\n')}\n`
        + `${conns.length} connections\n${conns.join('\n')}`;
    };

    // ---- camera: the leash always, the framing only on a shape change -----
    //
    // Two different jobs that both need the product's bounds. The leash is
    // updated on EVERY rebuild, because adding a part to the end of a run has
    // to extend how far you may pan even though the camera should not jump.
    const bounds = new THREE.Box3().setFromObject(ctx.productRoot);
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3());
      // A generous margin — half the product's own extent, and never less than
      // 300mm — so panning past the end to look back along a run still works.
      const margin = new THREE.Vector3(
        Math.max(size.x * 0.5, 0.3),
        Math.max(size.y * 0.5, 0.3),
        Math.max(size.z * 0.5, 0.3),
      );
      ctx.panBounds = bounds.clone().expandByVector(margin);

      // Zoom limits scale with the product for the same reason: a fixed
      // maxDistance that suits a 600mm unit leaves a 4m run half off screen.
      const reach = Math.max(size.length(), 0.4);
      ctx.controls.minDistance = 0.15;
      ctx.controls.maxDistance = reach * 4;
    }

    const signature = assembly.instances.map((i) => i.instanceId).join(',');
    if (signature && signature !== framedFor.current) {
      framedFor.current = signature;
      if (!bounds.isEmpty()) {
        const centre = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        // Fit the tallest/widest extent rather than the diagonal — the diagonal
        // over-pads and left the first version looking like an empty scene.
        const extent = Math.max(size.y, size.x * 0.8, 0.3);
        const fov = (ctx.camera.fov * Math.PI) / 180;
        const distance = (extent / 2 / Math.tan(fov / 2)) * 1.55;
        const dir = new THREE.Vector3(0.55, 0.42, 0.72).normalize();
        ctx.camera.position.copy(centre).addScaledVector(dir, distance);
        ctx.controls.target.copy(centre);
        ctx.controls.update();
      }
    }
  }, [assembly, components, transforms, selectedId, showGuides]);

  // ------------------------------------------------------- rebuild markers
  useEffect(() => {
    const ctx = three.current;
    if (!ctx) return;

    while (ctx.markerRoot.children.length) {
      const m = ctx.markerRoot.children.pop();
      m.material.dispose();
    }
    // The mesh ctx.hovered pointed at has just been thrown away.
    ctx.hovered = null;
    if (!showMarkers) return;

    const isMoving = !!movingId;

    for (const point of markers) {
      const key = pointKey(point);
      const isPending = key === pendingPoint;
      const isTargeted = !!pendingPart;

      const mesh = new THREE.Mesh(ctx.markerGeo, new THREE.MeshBasicMaterial({
        // Amber during a move. A different question deserves a different colour:
        // green means "a new part can go here", amber means "the thing in your
        // hand can go here".
        color: isMoving ? '#f0a53c' : isPending ? '#e0a03c' : isTargeted ? '#3ddc97' : '#4fc3d9',
        transparent: true,
        opacity: isMoving ? 0.95 : isPending ? 1 : isTargeted ? 0.9 : 0.55,
      }));

      // Grid cells are dense — a MOLLE panel has 84 of them — so their markers
      // are smaller than an authored point's or the panel disappears under dots.
      // During a move they are all enlarged: the cursor is already holding
      // something, so the target has to be easy to hit.
      const r = (point.isGridCell ? 0.006 : 0.014)
        * (isPending ? 1.7 : isTargeted ? 1.35 : 1)
        * (isMoving ? 1.6 : 1);
      mesh.scale.setScalar(r);
      mesh.userData.baseRadius = r;
      mesh.position.fromArray(point.worldPosition);
      // Lift off the surface so a marker is never buried in the geometry.
      mesh.position.addScaledVector(new THREE.Vector3().fromArray(point.worldFacing), r * 0.9);
      mesh.userData.pointKey = key;
      mesh.renderOrder = 2;
      ctx.markerRoot.add(mesh);
    }
  }, [markers, pendingPoint, pendingPart, showMarkers, movingId]);

  // ------------------------------------------------------------- attach flows
  /** Commit one specific placement. Both ends of the joint already decided. */
  const commitPlacement = useCallback((placement) => {
    const component = components.get(placement.componentId);
    const selections = {};
    for (const opt of component.options) selections[opt.id] = opt.defaultValueId;

    const id = nextId();
    setAssembly((a) => attachAt(a, placement, id, selections));
    setSelectedId(id);
    setPendingPart(null);
    setPendingPoint(null);
    setPendingChoice(null);
    setStatus(`Added ${placement.componentId}.`);
  }, [components]);

  /** Re-hang a part on a placement whose both ends are already decided. */
  const applyMove = useCallback((instanceId, placement) => {
    setPendingChoice(null);
    try {
      setAssembly((a) => moveTo(a, instanceId, placement));
      setStatus('Moved.');
    } catch (err) {
      setStatus(err.message);
    }
  }, []);

  /**
   * Put a part at a point — asking HOW if there is more than one answer.
   *
   * This used to be `matrix.placements.find(...)`, which took whichever row came
   * first. That is the bug Matt hit: a second ladder offered at a shelf's free
   * end fits by any of its own rungs, and only one of those heights was ever
   * reachable. The other seven are the staggered layouts in Kesseböhmer's own
   * photography.
   *
   * One option still places immediately. A chooser that appears when there is
   * nothing to choose is just a click in the way.
   */
  const place = useCallback((componentId, key) => {
    const all = placementsAt(matrix, key, componentId);
    if (!all.length) { setStatus('That part does not fit there.'); return; }

    // Only the ones that look different. Mating a symmetric shelf by its far
    // plug is a legal second placement and an identical picture, and asking
    // about it would put a dialog in front of nearly every click.
    const options = distinctPlacements(assembly, components, all);

    if (options.length > 1) {
      setPendingChoice({ kind: 'place', componentId, key, placements: options });
      setStatus(`${options.length} ways it can sit there — pick one.`);
      return;
    }
    commitPlacement(options[0]);
  }, [matrix, assembly, components, commitPlacement]);

  /**
   * Add a part that joins nothing — currently the shoe rack, which screws
   * straight to the wall and touches no ladder.
   *
   * It goes in as a second anchor at a derived position, not by dragging: free
   * placement in 3D is what this interaction deliberately removed. The status
   * line says it is wall-fixed, because the picture cannot.
   */
  const placeWallFixed = useCallback((componentId) => {
    const component = components.get(componentId);
    const selections = {};
    for (const opt of component.options) selections[opt.id] = opt.defaultValueId;

    const id = nextId();
    const at = freePositionFor(assembly, components, transforms, component);
    setAssembly((a) => placeFree(a, id, componentId, at, selections));
    setSelectedId(id);
    setPendingPart(null);
    setPendingPoint(null);
    setStatus(`Added ${componentId} — fixed to the wall, not to the product.`);
  }, [assembly, components, transforms]);

  const choosePart = (componentId) => {
    // A wall-fixed part joins nothing, so neither flow applies: it does not
    // wait for a marker and it never becomes the anchor by accident.
    if (components.get(componentId)?.mounting === 'wall') {
      placeWallFixed(componentId);
      return;
    }

    // Nothing placed yet: the first choice becomes the product itself.
    if (!assembly.instances.length) {
      const id = nextId();
      const component = components.get(componentId);
      const selections = {};
      for (const opt of component.options) selections[opt.id] = opt.defaultValueId;
      setAssembly({
        instances: [{ instanceId: id, componentId, selections, position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true }],
        connections: [],
      });
      setSelectedId(id);
      setStatus('Click a marker to add a part.');
      return;
    }

    // Point already chosen: this completes it. Otherwise arm the part and let
    // the markers narrow to where it fits.
    if (pendingPoint) { place(componentId, pendingPoint); return; }

    setPendingPart((cur) => (cur === componentId ? null : componentId));
    setPendingPoint(null);
    const count = pointsForComponent(matrix, componentId).length;
    setStatus(count
      ? `${count} place${count === 1 ? '' : 's'} this can go. Click a green marker.`
      : 'Nowhere left for that part.');
  };

  const choosePoint = (key) => {
    if (pendingPart) { place(pendingPart, key); return; }
    setPendingPoint(key);
    const options = componentsForPoint(matrix, key);
    setStatus(options.length
      ? `${options.length} part${options.length === 1 ? '' : 's'} fit here.`
      : whyNothingFits(matrix, key) || 'Nothing fits here.');
  };

  const setOption = (optionId, valueId) => {
    setAssembly((a) => ({
      ...a,
      instances: a.instances.map((i) => (
        i.instanceId === selectedId
          ? { ...i, selections: { ...i.selections, [optionId]: valueId } }
          : i
      )),
    }));
  };

  const removeSelected = () => {
    if (!selectedId || selectedId === rootId) return;
    const result = detach(assembly, selectedId);
    setAssembly({ instances: result.instances, connections: result.connections });
    setSelectedId(null);
    setStatus(result.removed.length > 1
      ? `Removed ${result.removed.length} parts — the others were attached to it.`
      : 'Removed.');
  };

  const reset = () => {
    setAssembly(EMPTY);
    setSelectedId(null);
    setPendingPart(null);
    setPendingPoint(null);
    framedFor.current = '';
    setStatus('Choose something to start from.');
  };

  // ------------------------------------------------------------- picking
  //
  // One gesture, three outcomes, decided by what happened between pointerdown
  // and pointerup:
  //
  //   down on a marker            -> choose that point (add flow)
  //   down on a part, no movement -> select it
  //   down on a part, then moved  -> pick it up and drop it on another point
  //
  // Matt, 3 Sep: "it would be nice for me to be able to click and drag an object
  // to a different snap point (not to drag it anywhere in 3d space but only to
  // another snap point". So a drag has exactly as many destinations as there are
  // markers — it cannot end anywhere else, and that is the whole safety
  // property. The free-drag spike is not coming back.

  const DRAG_THRESHOLD_PX = 5;

  const castAt = (event) => {
    const ctx = three.current;
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    ctx.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera);
    return ctx;
  };

  const markerUnder = (ctx) => {
    const hits = ctx.raycaster.intersectObjects(ctx.markerRoot.children, false);
    return hits.length ? hits[0].object : null;
  };

  const instanceUnder = (ctx) => {
    const hits = ctx.raycaster.intersectObjects(ctx.productRoot.children, true)
      .filter((h) => h.object.visible && !h.object.name.startsWith('md-'));
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node && node.userData.instanceId == null) node = node.parent;
    return node ? node.userData.instanceId : null;
  };

  // Clear the drop preview.
  const clearGhost = (ctx) => {
    while (ctx.ghostRoot.children.length) {
      const child = ctx.ghostRoot.children.pop();
      child.traverse((o) => { if (o.isMesh) o.material?.dispose(); });
    }
  };

  /**
   * Show where the part would land, as a translucent copy.
   *
   * The part being dragged does NOT follow the cursor — it cannot, because the
   * only legal destinations are the markers, and a part sliding through open
   * space would be promising something the model refuses to deliver. A ghost at
   * the candidate point says the same thing honestly.
   *
   * The hypothetical transform is obtained by asking the engine: rewire the
   * connection, resolve, read the answer back. No second solver, so the preview
   * cannot disagree with the drop.
   */
  const showGhost = (ctx, instanceId, placement) => {
    clearGhost(ctx);
    const { assembly: current, components: loaded } = live.current;
    const instance = current.instances.find((i) => i.instanceId === instanceId);
    const component = instance && loaded.get(instance.componentId);
    if (!component?.template) return;

    let landed;
    try {
      const hypothetical = moveTo(current, instanceId, placement);
      landed = resolveTransforms(hypothetical, loaded).transforms.get(instanceId);
    } catch {
      return;
    }
    if (!landed) return;

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
    ghost.position.fromArray(landed.translation);
    ghost.quaternion.fromArray(landed.rotation);
    ctx.ghostRoot.add(ghost);
  };

  // Highlight whatever the cursor is over during a drag, by mutating the mesh
  // rather than by setting state: this runs on every pointermove.
  const hoverMarker = (ctx, mesh, instanceId) => {
    const previous = ctx.hovered;
    if (previous === mesh) return;
    if (previous?.parent) previous.scale.setScalar(previous.userData.baseRadius);
    if (mesh) mesh.scale.setScalar(mesh.userData.baseRadius * 1.8);
    ctx.hovered = mesh || null;

    if (!mesh || !instanceId) { clearGhost(ctx); return; }
    const placement = moveTargetAt(instanceId, mesh.userData.pointKey);
    if (placement) showGhost(ctx, instanceId, placement);
    else clearGhost(ctx);
  };

  /**
   * The placement for dropping a part on a point, computed FRESH.
   *
   * Deliberately not read out of the memoised move matrix: the drag can cross
   * the threshold and finish inside a single frame, before React has rendered
   * the state that would have filled that memo in. Asking the engine costs
   * nothing at this scale and removes the race entirely.
   */
  const moveTargetsAt = (instanceId, key) => {
    const { assembly: current, components: loaded, transforms: t } = live.current;
    if (!loaded?.size) return [];
    try {
      const targets = moveTargets(current, loaded, t, instanceId);
      // Every way it could sit there, not the first. A shelf dragged to the far
      // side of a ladder can mate by either end, and letting the engine pick is
      // what span the part round: the solver satisfies facing by yawing the
      // child 180 degrees, so the "wrong" end always fits, backwards.
      const here = targets.placements
        .filter((pl) => pl.pointKey === key)
        .sort((a, b) => mountHeightMm(a) - mountHeightMm(b));
      // Same rule as placing: distinct outcomes, not distinct wirings. The
      // probe is a fresh instance attached at each candidate, so the part's
      // existing copy sitting in `current` is irrelevant - only the probe's own
      // resolved pose is read.
      return distinctPlacements(current, loaded, here);
    } catch {
      return [];
    }
  };

  const onPointerDown = (event) => {
    const ctx = three.current;
    if (!ctx || event.button !== 0) return;

    const marker = markerUnder(castAt(event));
    if (marker) {
      // Markers are small and sit on top of the geometry they belong to, so
      // testing the product first would make them almost unclickable.
      drag.current = null;
      choosePoint(marker.userData.pointKey);
      return;
    }

    const instanceId = instanceUnder(ctx);
    drag.current = instanceId
      ? { instanceId, x: event.clientX, y: event.clientY, started: false }
      : null;

    if (!instanceId) {
      setSelectedId(null);
      setPendingPart(null);
      setPendingPoint(null);
    }
  };

  const onPointerMove = (event) => {
    const ctx = three.current;
    const d = drag.current;
    if (!ctx) return;

    if (d?.started) { hoverMarker(ctx, markerUnder(castAt(event)), d.instanceId); return; }
    if (!d) return;

    const moved = Math.hypot(event.clientX - d.x, event.clientY - d.y);
    if (moved < DRAG_THRESHOLD_PX) return;

    // Past the threshold: take the gesture off OrbitControls. The camera will
    // have orbited by those few pixels, which is a small price for keeping
    // "drag anywhere to orbit" working when the product fills the screen.
    const allowed = canMove(live.current.assembly, d.instanceId);
    if (!allowed.ok) {
      // Not movable — the anchor, usually. Let the orbit continue rather than
      // interrupting it with a message nobody asked for.
      drag.current = null;
      if (allowed.reason === 'is-anchor') {
        setStatus('That part is the anchor — the rest of the product hangs off it.');
      }
      return;
    }

    d.started = true;
    ctx.controls.enabled = false;
    setSelectedId(d.instanceId);
    setPendingPart(null);
    setPendingPoint(null);
    setMovingId(d.instanceId);
    setStatus('Drop it on a marker, or release anywhere else to leave it where it was.');
  };

  const endDrag = (event) => {
    const ctx = three.current;
    const d = drag.current;
    drag.current = null;
    if (!ctx) return;

    if (!d?.started) {
      // A click, not a drag.
      if (d) { setSelectedId(d.instanceId); setPendingPart(null); setPendingPoint(null); }
      return;
    }

    ctx.controls.enabled = true;
    const marker = event ? markerUnder(castAt(event)) : null;
    hoverMarker(ctx, null, null);
    setMovingId(null);

    if (!marker) { setStatus('Left where it was.'); return; }

    const options = moveTargetsAt(d.instanceId, marker.userData.pointKey);
    if (!options.length) { setStatus('It cannot go there.'); return; }

    if (options.length > 1) {
      setPendingChoice({
        kind: 'move',
        instanceId: d.instanceId,
        componentId: assembly.instances.find((i) => i.instanceId === d.instanceId)?.componentId,
        placements: options,
      });
      setStatus(`${options.length} ways it can sit there — pick one.`);
      return;
    }

    const [placement] = options;
    try {
      setAssembly((a) => moveTo(a, d.instanceId, placement));
      // The camera must NOT re-frame: the parts are the same, so the framing
      // signature is unchanged and this is a no-op by construction. Noted
      // because it is the kind of thing a later refactor quietly breaks.
      setStatus('Moved.');
    } catch (err) {
      setStatus(err.message);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      if (e.key === 'Escape') {
        setPendingPart(null);
        setPendingPoint(null);
        if (drag.current) { endDrag(null); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, assembly, rootId]);

  // ------------------------------------------------------------- render
  const catalogueForPanel = pendingPoint
    ? partsAtPendingPoint.map((p) => components.get(p.componentId))
    : [...components.values()];

  return (
    <div className="cfg">
      <aside className="cfg-panel">
        <h1>confgr modular</h1>
        <p className="cfg-note">
          Anchored product. Click a marker to add a part, or pick a part and see
          where it fits. Both orders work. Drag a part onto another marker to
          move it — it can only land on a marker, never in open space.
        </p>
        <p className="cfg-note cfg-dim">
          Drag the background to orbit · right-drag or two fingers to pan ·
          scroll to zoom
        </p>

        {/* The other end of the joint. Only ever shown when there is a real
            choice: one option places straight away, because a chooser with one
            item in it is a click in the way. */}
        {pendingChoice && (
          <>
            <h2>
              How should it sit?
              <button className="cfg-clear" onClick={() => { setPendingChoice(null); setStatus(''); }}>cancel</button>
            </h2>
            <p className="cfg-note cfg-dim">
              {labelFor({ id: pendingChoice.componentId })} can meet this point in{' '}
              {pendingChoice.placements.length} places.{' '}
              {pendingChoice.placements.some(isFlatMount)
                // A part laid on top has both its joints at the same height, so
                // the height cannot tell them apart — which end lands here can.
                ? 'This part is laid on top, so what you are choosing is which end of it sits here.'
                : 'The number is how far up the part its own joint sits, so a taller number hangs it lower.'}
            </p>
            <div className="cfg-palette cfg-choices">
              {pendingChoice.placements.map((p) => (
                <button
                  key={p.mountSnapId}
                  data-mount={p.mountSnapId}
                  onClick={() => (pendingChoice.kind === 'move'
                    ? applyMove(pendingChoice.instanceId, p)
                    : commitPlacement(p))}
                >
                  <strong>{mountLabel(p)}</strong>
                  <span className="cfg-meta">{p.mountSnap?.label || p.mountSnapId}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <h2>
          {pendingPoint ? 'Fits here' : assembly.instances.length ? 'Add a part' : 'Start from'}
          {pendingPoint && <button className="cfg-clear" onClick={() => { setPendingPoint(null); setStatus(''); }}>clear</button>}
        </h2>

        <div className="cfg-palette">
          {catalogueForPanel.filter(Boolean).map((c) => {
            // A wall-fixed part fits nowhere by definition, so the usual
            // "nowhere for this" greying-out would disable it permanently.
            const wallFixed = c.mounting === 'wall';
            const places = assembly.instances.length ? pointsForComponent(matrix, c.id).length : 1;
            const disabled = !wallFixed
              && assembly.instances.length > 0 && places === 0 && !pendingPoint;
            return (
              <button
                key={c.id}
                // The harness selects parts by this, not by the visible text, so
                // the label can change without breaking every probe.
                data-component={c.id}
                className={pendingPart === c.id ? 'active' : ''}
                disabled={disabled}
                onClick={() => choosePart(c.id)}
              >
                <strong>{labelFor(c)}</strong>
                <span>{c.dimsMm.widthMm} × {c.dimsMm.heightMm} × {c.dimsMm.depthMm} mm</span>
                <span className="cfg-meta">
                  {articleFor(c) ? `${articleFor(c)} · ` : ''}
                  {c.grids.length ? `${c.grids[0].cols}×${c.grids[0].rows} grid` : ''}
                  {c.snaps[0]?.span ? `span ${c.snaps[0].span.cols}×${c.snaps[0].span.rows}` : ''}
                  {wallFixed
                    ? 'fixes to the wall'
                    : (assembly.instances.length && !pendingPoint ? ` · ${places} place${places === 1 ? '' : 's'}` : '')}
                </span>
              </button>
            );
          })}
        </div>

        {selectedInstance && selectedComponent && (
          <>
            <h2>
              {selectedComponent.id}
              {selectedId === rootId && <span className="cfg-tag">anchor</span>}
            </h2>
            {selectedComponent.options.map((opt) => (
              <div key={opt.id} className="cfg-option">
                <label>{opt.label}</label>
                <div className="cfg-swatches">
                  {opt.values.map((v) => (
                    <button
                      key={v.id}
                      title={v.label}
                      className={(selectedInstance.selections?.[opt.id] || opt.defaultValueId) === v.id ? 'sw active' : 'sw'}
                      style={{ background: `#${v.hex}` }}
                      onClick={() => setOption(opt.id, v.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {selectedId !== rootId && (
              <button onClick={removeSelected}>Remove this part</button>
            )}
          </>
        )}

        <h2>Assembly</h2>
        <p className="cfg-note">
          {assembly.instances.length} part{assembly.instances.length === 1 ? '' : 's'},
          {' '}{assembly.connections.length} joint{assembly.connections.length === 1 ? '' : 's'},
          {' '}{markers.length} open point{markers.length === 1 ? '' : 's'}
        </p>
        {!validity.isValid && (
          <p className="cfg-invalid">
            Not ready to order — {validity.missingRequiredSnaps.length} required point
            {validity.missingRequiredSnaps.length === 1 ? '' : 's'} still empty.
          </p>
        )}
        {resolveError && <p className="cfg-invalid">{resolveError}</p>}

        <h2>Mounting</h2>
        <div className="cfg-option">
          {/* Three ground conditions, no height. Everything is wall-fixed in
              reality; what varies is what happens underneath. The height a
              floating product hangs at is chosen when the customer places it in
              AR, so asking for it here would be asking for a number nothing
              downstream reads. See src/engine/ar.js for why feet are not a
              third fixing method. */}
          <select className="cfg-mounting" value={mounting} onChange={(e) => setMounting(e.target.value)}>
            <option value={MOUNTING.FLOOR}>Floor standing</option>
            <option value={MOUNTING.WALL}>Floating</option>
            <option value={MOUNTING.FEET}>On feet</option>
          </select>
          {/* Choosing a foot is choosing a PART - there are two SKUs - not
              typing a height. That is why it is a second select rather than a
              number field, and why it only appears when feet are in play. */}
          {mounting === MOUNTING.FEET && (
            <select
              className="cfg-foot"
              value={footHeightMm}
              onChange={(e) => setFootHeightMm(Number(e.target.value))}
            >
              {FOOT.heightsMm.map((mm) => (
                <option key={mm} value={mm}>{mm} mm foot</option>
              ))}
            </select>
          )}
        </div>
        {mounting === MOUNTING.FEET && (
          <p className="cfg-note cfg-dim">
            One foot per ladder, at the front; the back stays fixed to the wall.
            Raises the base {groundClearanceMm(mounting, footHeightMm)} mm
            (±{FOOT.adjustmentMm} mm on the levelling nut) — usually to clear a
            skirting board.
          </p>
        )}
        {ar.parts > 0 && (
          <p className="cfg-note cfg-dim">
            {ar.triangles.toLocaleString()} triangles across {ar.parts} part
            {ar.parts === 1 ? '' : 's'} · in AR this goes on{' '}
            {ar.placement.vertical ? 'a wall' : 'the floor'}
          </p>
        )}
        {ar.warnings
          .filter((w) => w.code !== 'EMPTY')
          .map((w) => (
            <p key={w.code} className="cfg-invalid">{w.message}</p>
          ))}

        <h2>View</h2>
        <label><input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} /> Attach markers</label>
        <label><input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} /> Snap planes and boxes</label>
        <button style={{ marginTop: 10 }} onClick={reset}>Start again</button>

        {loadErrors.length > 0 && (
          <div className="cfg-errors">
            <h2>Rejected on import</h2>
            {loadErrors.map((e) => <p key={e.file}><strong>{e.file}</strong><br />{e.message}</p>)}
          </div>
        )}

        {/* The running total sticks to the bottom of the panel. A quoting tool
            whose total is below the fold is a quoting tool where somebody
            configures six parts and never sees what it costs - the palette is
            long enough that the total was off screen entirely. */}
        <div className="cfg-basket">
        <h2>
          Bill of materials
          <button className="cfg-clear" onClick={() => setShowQuote(!showQuote)}>
            {showQuote ? 'hide' : 'show'}
          </button>
        </h2>
        {priceBookError && <p className="cfg-invalid">No price list: {priceBookError}</p>}
        {showQuote && priced && (
          <>
            {priced.tier && (
              <div className="cfg-option">
                <label>Price for</label>
                <select value={tierId || ''} onChange={(e) => setTierId(e.target.value)}>
                  {priceBook.tiers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name || t.id}</option>
                  ))}
                </select>
              </div>
            )}

            {priced.lineCount === 0 && <p className="cfg-note cfg-dim">Nothing configured yet.</p>}

            {priced.lineCount > 0 && (
              <table className="cfg-bom">
                <tbody>
                  {priced.lines.map((l) => (
                    <tr key={l.componentId} className={l.lineTotal == null ? 'unpriced' : ''}>
                      <td className="qty">{l.qty}</td>
                      <td>
                        {l.description}
                        {l.article && <span className="cfg-meta"> {l.article}</span>}
                      </td>
                      {/* An unpriced line shows an em dash, never 0.00 - see
                          src/engine/quote.js for why that is the whole point. */}
                      <td className="num">{l.lineTotal == null ? '—' : l.lineTotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {priced.lineCount > 0 && (
              <p className="cfg-note">
                <strong>
                  {/* No priced line at all means no total - not zero. */}
                  {priced.net == null
                    ? 'No prices on file yet'
                    : `${priced.complete ? 'Net' : 'Net so far'}: ${priced.currency} ${priced.net.toFixed(2)}`}
                </strong>
                {priced.vat != null && (
                  <>
                    <br />VAT @ {priced.vatRatePercent}%: {priced.currency} {priced.vat.toFixed(2)}
                    <br />Gross: {priced.currency} {priced.gross.toFixed(2)}
                  </>
                )}
                {priced.margin != null && (
                  <><br /><span className="cfg-meta">
                    Margin {priced.currency} {priced.margin.toFixed(2)} ({priced.marginPercent}%)
                  </span></>
                )}
              </p>
            )}

            {priced.unpriced.length > 0 && (
              <p className="cfg-invalid">
                Not a quote yet — {priced.unpriced.length} line
                {priced.unpriced.length === 1 ? '' : 's'} with no price on file:
                {' '}{priced.unpriced.map((u) => u.description).join(', ')}.
              </p>
            )}
            {priced.priceList?.ref && (
              <p className="cfg-note cfg-dim">Price list: {priced.priceList.ref}</p>
            )}
          </>
        )}
        </div>
      </aside>

      <div className="cfg-stage">
        <div
          ref={mountRef}
          className="cfg-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={() => endDrag(null)}
          onPointerLeave={() => endDrag(null)}
        />
        <div className="cfg-status">{status}</div>
      </div>
    </div>
  );
}
