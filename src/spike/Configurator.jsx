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
import { loadComponentFromPath } from '../three/loadGlb.js';
// THE SCENE AND THE PRODUCT COME FROM THE VIEWER, not from here.
//
// The editor is the viewer plus markers, a ghost and a picker — it is not a
// different program that happens to draw the same thing. Everything a customer
// sees (lights, ground, finishes, which nodes are visible, the pan leash) is
// defined once, in src/viewer, and imported by both. See the note at the top of
// viewer/scene.js for the three separate bugs this session that were all the
// same shape: two implementations of one idea, drifting.
import { createScene, fitBounds } from '../viewer/scene.js';
import { syncProduct, setGround, describeLayout } from '../viewer/product.js';
// AND SO DOES THE POINTER LAYER, as of §5.25. The dots, the ghost and the one
// gesture that tells select/add/move apart used to be four hundred lines right
// here. Matt asked for them in the CUSTOMER's runtime - "it needs to be the
// drag and drop we had at the start with the snap dots" - and copying them
// across would have been the fifth time this project made two implementations
// of one idea and watched them drift. So they moved down into src/viewer and
// the editor imports them, which is the same call §5.21 made for the scene.
import {
  createMarkerLayer, drawMarkers, markerAt, pickInstance,
  clearGhost, showGhostAt, previewMove, dropTargets, hoverMarker,
  createGesture, MARKER_MODE,
} from '../viewer/interact.js';
import { resolveTransforms, validateAssembly } from '../engine/assembly.js';
import {
  attachMatrix, pointsForComponent, componentsForPoint, livePoints,
  whyNothingFits, whyComponentFitsNowhere, attachAt, detach, pointKey,
  canMove, moveTargets, moveTo,
  placementsAt, mountHeightMm, mountLabel, isFlatMount, distinctPlacements,
  placeFree, freePositionFor,
} from '../engine/attach.js';
import { quote, formatQuote } from '../engine/quote.js';
import {
  MOUNTING, FOOT, arReadiness, groundClearanceMm,
} from '../engine/ar.js';
import {
  impliedParts, impliedBom, withImplied, impliedComponentIds,
} from '../engine/implied.js';
import { overlaps, formatOverlaps } from '../engine/collision.js';
import {
  encodeConfiguration, decodeConfiguration, configurationDigest,
} from '../engine/configuration.js';

let counter = 0;
const nextId = () => { counter += 1; return `i${counter}`; };

const EMPTY = { instances: [], connections: [] };

export default function Configurator() {
  const mountRef = useRef(null);
  const three = useRef(null);
  const framedFor = useRef('');
  // Drag state used to live in a ref here, for the reason `createGesture` now
  // documents: pointermove fires at screen rate and re-rendering the panel on
  // every one of them would make the drag feel heavy. The gesture keeps it in a
  // closure instead, and only its START and END touch React.
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

  // Everything loaded, MINUS the parts nobody chooses. The foot is loaded like
  // any other component - it has to be, or there would be nothing to draw - but
  // it must never appear in the palette or on a marker, because it arrives as a
  // consequence of the mounting option rather than as a decision. Filtered on
  // the engine's own list rather than on a name; see implied.js.
  const implicit = useMemo(() => new Set(impliedComponentIds()), []);
  const catalogue = useMemo(
    () => [...components.keys()].filter((id) => !implicit.has(id)),
    [components, implicit],
  );

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

  // ---- what the configuration IMPLIES -------------------------------------
  //
  // Derived, never stored: nothing below is written into `assembly`, so a
  // person cannot delete a foot while the bay is standing on feet, and asking
  // again after any change gives the right answer because there was never a
  // second copy of it. The same reason connected parts hold `position: null`.
  //
  // Kept OUT of `matrix` on purpose. The implied parts fill real sockets, and
  // resolving them into the attach matrix would put a marker on the foot's
  // spare fixing and offer a second foot underneath the first.
  const implied = useMemo(
    () => impliedParts(assembly, components, { mounting, footHeightMm }),
    [assembly, components, mounting, footHeightMm],
  );

  // The assembly AS DRAWN — the real one plus whatever it implies, resolved
  // through the same solver and the same joints. Falls back to the real one if
  // an implied joint cannot be solved, so a bad rule cannot black out the view.
  const scene = useMemo(() => {
    const bare = {
      instances: assembly.instances,
      connections: assembly.connections || [],
      transforms,
    };
    if (!components.size || !assembly.instances.length) return bare;
    try {
      const full = withImplied(assembly, components, { mounting, footHeightMm });
      return {
        instances: full.instances,
        // Carried because the collision survey needs to know which pairs are
        // JOINED, and an implied part's joint is as real as any other.
        connections: full.connections || [],
        transforms: resolveTransforms(full, components).transforms,
      };
    } catch {
      return bare;
    }
  }, [assembly, components, transforms, mounting, footHeightMm]);

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
    // The shape, in one place. Two hand-written copies of it is how the panel
    // came to call .map on an undefined `backToFront` the moment a third field
    // was added to the real result - a blank window, and the only reason it was
    // caught at all is that the probe reads the renderer's console.
    const fine = { isValid: true, missingRequiredSnaps: [], backToFront: [] };
    if (!components.size || !assembly.instances.length) return fine;
    try {
      return validateAssembly(assembly, components, transforms);
    } catch {
      return fine;
    }
  }, [assembly, components, transforms]);

  // The pointer handlers are attached once and must not close over a stale
  // assembly. A ref updated every render is the cheapest correct answer.
  live.current = { assembly, components, transforms };

  // ------------------------------------------------------------- three setup
  useEffect(() => {
    const mount = mountRef.current;
    // ONE scene builder, shared with the runtime. What used to be ninety lines
    // of lights, ground, controls and a pan leash right here is now `createScene`
    // — the editor adds only what a customer never sees.
    const ctx = createScene(mount);
    const { scene, camera, renderer, controls, productRoot } = ctx;



    // THE POINTER LAYER. Dots to attach to, a ghost to preview with, a
    // raycaster to pick with — no longer built here, because the runtime needs
    // exactly the same three things and a second copy of them would drift.
    const disposeMarkers = createMarkerLayer(ctx);
    const { markerRoot, ghostRoot } = ctx;
    three.current = ctx;

    // Force one frame, then read the buffer. Same reason as `settle` below: an
    // uncomposited window stops firing rAF, so the tick loop stalls and the
    // buffer still holds whatever was drawn before the clicks. Rendering on
    // demand means the capture shows the state the checks just built.
    window.__spikeRender = () => {
      ctx.render();
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

    // The leash itself is `ctx.clampPan`, in viewer/scene.js — the runtime
    // needs it for exactly the same reason the editor does.
    const clampPan = ctx.clampPan;

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

    ctx.start();

    return () => {
      // The pointer layer cleans up after itself; everything else is disposed
      // by the scene that made it.
      disposeMarkers();
      ctx.dispose();
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
    () => (priceBook
      ? quote(assembly, priceBook, {
        tierId,
        // The parts the mounting option implies, priced like any other, and the
        // fixings and packers that have no part number and stay out of the
        // total. A quote that omits the feet prices a bay that cannot stand up.
        implied: impliedBom(assembly, components, { mounting, footHeightMm }),
        notes: implied.notes,
      })
      : null),
    [assembly, components, priceBook, tierId, mounting, footHeightMm, implied],
  );

  // AR readiness is judged on the assembly WITH its implied parts, because that
  // is what gets exported and therefore what the phone has to download.
  //
  // It was judged on `assembly` alone until the GLB export made the two numbers
  // comparable and they disagreed: 19,010 triangles in the app against 34,106
  // in the file, for the same bay. The gap is two adjustable feet at 7,548
  // triangles each - a foot is very nearly as heavy as a ladder, being all
  // thread and radii - so the old count was not slightly low, it was 44% low,
  // and it got worse with every frame added. A budget check that measures
  // something other than the thing being sent is worse than no check.
  const ar = useMemo(
    () => arReadiness(scene, components, { mounting }),
    [scene, components, mounting],
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
  // The same, from an id rather than a component - for the messages that name a
  // part they cannot hand you the object for, like "this cabinet is only held
  // at one end".
  const describe = useCallback(
    (id) => priceBook?.items?.[id]?.description || id || 'A part',
    [priceBook],
  );

  // A floating product does not stand on anything. Drawing a grid and a cast
  // shadow under it says otherwise, and that is the one thing the view is for:
  // showing whether this thing reaches the floor. So the ground goes away when
  // the mounting says wall. The lights keep casting; only the catcher is gone,
  // which is what makes the shadow disappear rather than move.
  //
  // A FOOT moves the floor, not the product. Every measurement in this range is
  // quoted from the frame's own base — the plate hangs 298.5 below a rung, the
  // arm's holes are 83.5 and 183.5 up the plate — so lifting the parts to make
  // room for a foot would put every one of those numbers 100 mm out of step
  // with the drawings they were read off. The parts keep their coordinates and
  // the ground drops instead, which is also what the real thing does: the frame
  // is fixed to the wall and the foot carries the front of it.
  //
  // Kesseböhmer's own page 4 is the check. Three flat desk heights, 650, 750
  // and 750 — and the third is the 650 hole row with a 100 mm foot under it.
  // Same holes, same product, a floor 100 mm further down.
  useEffect(() => {
    const ctx = three.current;
    if (!ctx) return;
    setGround(ctx, mounting, footHeightMm);
    window.__spikeRender?.();
  }, [mounting, footHeightMm]);

  // For the harness. Reports the ground out of the SCENE, not out of React
  // state, so a `mount:wall` step that changed the dropdown and nothing else
  // reports the grid still visible rather than reporting success.
  useEffect(() => {
    window.__cfgGround = () => {
      const ctx = three.current;
      if (!ctx) return 'no scene';
      return `mounting=${mounting} grid=${ctx.grid.visible} floor=${ctx.floor.visible} `
        + `clearance=${groundClearanceMm(mounting, footHeightMm)}mm `
        // Read off the SCENE, like the visibility above: a clearance that is
        // computed and then not applied is exactly the kind of no-op this
        // harness exists to catch.
        + `floorY=${Math.round(ctx.floor.position.y * 1000)}mm `
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

  // THE CONFIGURATION AS A STRING, and back again.
  //
  // Exposed to the harness before it is exposed to a person, because the useful
  // test is the round trip and it needs both halves: build a bay by clicking,
  // take the id, load it back, and compare the RESOLVED LAYOUT. Two assemblies
  // can match field by field and still put a shelf somewhere else.
  //
  // `load` replaces the whole product rather than merging, which is what an id
  // means: it is a product, not a patch.
  useEffect(() => {
    window.__cfgId = () => {
      if (!assembly.instances.length) return 'nothing configured yet';
      try {
        const id = encodeConfiguration(assembly, { mounting, footHeightMm });
        return `${configurationDigest(id)} ${id}`;
      } catch (err) {
        return `cannot be written down: ${err.message}`;
      }
    };
    window.__cfgLoad = (id) => {
      try {
        const decoded = decodeConfiguration(id);
        setAssembly(decoded.assembly);
        setMounting(decoded.mounting);
        setFootHeightMm(decoded.footHeightMm);
        setSelectedId(null);
        setPendingPart(null);
        setPendingPoint(null);
        setPendingChoice(null);
        return `loaded ${decoded.assembly.instances.length} parts, `
          + `mounting ${decoded.mounting}`;
      } catch (err) {
        return `refused: ${err.message}`;
      }
    };
  }, [assembly, mounting, footHeightMm]);

  // ------------------------------------------- rebuild the product from state
  useEffect(() => {
    const ctx = three.current;
    if (!ctx || !components.size) return;

    // The scene is the assembly PLUS what it implies — the feet under the
    // ladders. Everything else in this file works from `assembly`; only the
    // drawing works from here, because an implied part is real geometry that
    // is not a real instance.
    //
    // The drawing itself is `syncProduct`, shared with the runtime. The editor
    // passes `selectable: true` and a selection; the viewer passes neither, and
    // that difference is the whole of "no editing affordances".
    syncProduct(ctx, scene, components, { showGuides, selectedId, selectable: true });

    // Where everything actually ENDED UP. A screenshot cannot answer this: one
    // perspective view of a run of frames cannot tell you whether they are
    // evenly spaced and colinear, and a chain that resolves slightly wrong
    // compounds down the run rather than looking obviously broken. So report
    // the resolved world positions and let the numbers say it.
    //
    // Registered here rather than beside the other harness globals because
    // this is the effect that holds the assembly and the resolved transforms.
    // It is re-assigned on every rebuild, which is what keeps it honest.
    // Implied parts are in here too, prefixed so they read as what they are.
    // They are the hardest thing in the scene to check by eye - a foot is
    // 100mm of grey under a 1500mm ladder - and the whole reason for measuring
    // their holes was so their position could be asserted.
    //
    // `describeLayout` is shared with the runtime, which needs exactly the same
    // answer for exactly the same reason.
    window.__cfgLayout = () => describeLayout(ctx, scene, assembly.connections || []);

    // DOES ANYTHING OCCUPY THE SAME SPACE AS ANYTHING ELSE?
    //
    // The question no probe scenario has ever asked, and its absence is what
    // let a desk resolve straight through a ladder while fourteen scenarios
    // agreed it was fine. It reports rather than refuses - see collision.js for
    // why a bounding box cannot carry a refusal in a range where half the
    // joints are two pieces of steel deliberately interpenetrating.
    //
    // Run over the SCENE, so the implied feet are in it too. A foot bolted
    // under a ladder overlaps it, which is a joint and reads as one.
    window.__cfgCollisions = () => formatOverlaps(overlaps(
      { instances: scene.instances, connections: scene.connections },
      components,
      scene.transforms,
    ));

    // ---- camera: the leash always, the framing only on a shape change -----
    //
    // Two different jobs that both need the product's bounds. The leash is
    // updated on EVERY rebuild, because adding a part to the end of a run has
    // to extend how far you may pan even though the camera should not jump —
    // and it is `fitBounds`, shared with the runtime, because a four-metre run
    // needs the same room to move in either.
    //
    // The FRAMING is not shared, and that is the one real behavioural
    // difference between the two. A runtime frames the product on load, every
    // time, because someone arriving at a link must see the whole thing. An
    // editor must not: a camera that jumps every time you add a shelf is
    // unusable, so it only reframes when the set of parts changes.
    const bounds = fitBounds(ctx);

    const signature = assembly.instances.map((i) => i.instanceId).join(',');
    if (signature && signature !== framedFor.current) {
      framedFor.current = signature;
      if (bounds) {
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
  }, [assembly, scene, components, transforms, selectedId, showGuides]);

  // ------------------------------------------------------- rebuild markers
  useEffect(() => {
    const ctx = three.current;
    if (!ctx) return;

    // One drawing routine, shared with the runtime. The colours, the sizes and
    // the lift off the surface are decided in `markerStyleFor`, which is pure
    // and has a test — the thirty lines of ternaries that used to be here did
    // not.
    drawMarkers(ctx, showMarkers ? markers : [], {
      mode: movingId ? MARKER_MODE.MOVE : MARKER_MODE.ADD,
      pendingKey: pendingPoint,
      targeted: !!pendingPart,
      keyOf: pointKey,
    });
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
  // One gesture, three outcomes — and as of §5.25 the gesture itself lives in
  // `src/viewer/interact.js`, because the customer's runtime needs exactly the
  // same one. What is left here is only the editor's ANSWERS to it: which
  // React state each outcome changes, and what the status line says.
  //
  // The hit tests are passed in, so the shared gesture touches no three.js and
  // can be driven by fake events in a unit test — which is the first coverage
  // this logic has ever had. It immediately found that `moveTargetAt` was
  // called and never defined: the drop preview threw a ReferenceError on every
  // pointermove and no ghost has ever appeared in this editor.

  // The callbacks a gesture outcome runs. Kept in a ref and rewritten every
  // render for the same reason `live` is: the gesture is built ONCE, and a
  // closure over this render's `matrix` would be answering with a product two
  // edits old.
  const acts = useRef({});
  acts.current = {
    choosePoint,
    place,
    applyMove,
    setPendingChoice,
    setPendingPart,
    setPendingPoint,
    setSelectedId,
    setMovingId,
    setStatus,
  };

  const gesture = useMemo(() => createGesture({
    hitMarker: (x, y) => markerAt(three.current, x, y),
    hitInstance: (x, y) => pickInstance(three.current, x, y),
    canDrag: (id) => canMove(live.current.assembly, id),
    hooks: {
      onPoint: (key) => acts.current.choosePoint(key),

      onSelect: (id) => {
        acts.current.setSelectedId(id);
        acts.current.setPendingPart(null);
        acts.current.setPendingPoint(null);
      },

      // Not movable — the anchor, usually. The orbit is allowed to continue
      // rather than being interrupted by a message nobody asked for, so only
      // the one reason worth explaining gets said.
      onBlocked: (reason) => {
        if (reason === 'is-anchor') {
          acts.current.setStatus('That part is the anchor — the rest of the product hangs off it.');
        }
      },

      onDragStart: (id) => {
        // Take the gesture off OrbitControls. The camera will have orbited by
        // those few pixels, which is a small price for keeping "drag anywhere
        // to orbit" working when the product fills the screen.
        three.current.controls.enabled = false;
        acts.current.setSelectedId(id);
        acts.current.setPendingPart(null);
        acts.current.setPendingPoint(null);
        acts.current.setMovingId(id);
        acts.current.setStatus('Drop it on a marker, or release anywhere else to leave it where it was.');
      },

      // Highlight what the cursor is over and preview where the part would
      // land. `hoverMarker` returns false when nothing changed, which keeps a
      // solve off every single pointermove.
      onDragOver: (key, mesh, id) => {
        const ctx = three.current;
        if (!hoverMarker(ctx, mesh)) return;
        if (!key) { clearGhost(ctx); return; }
        const { assembly: current, components: loaded, transforms: t } = live.current;
        const [placement] = dropTargets(current, loaded, t, id, key);
        if (!placement) { clearGhost(ctx); return; }
        const instance = current.instances.find((i) => i.instanceId === id);
        const component = instance && loaded.get(instance.componentId);
        showGhostAt(ctx, component, previewMove(current, loaded, id, placement));
      },

      onDragEnd: () => {
        const ctx = three.current;
        ctx.controls.enabled = true;
        hoverMarker(ctx, null);
        clearGhost(ctx);
        acts.current.setMovingId(null);
      },

      onDrop: (id, key) => {
        if (!key) { acts.current.setStatus('Left where it was.'); return; }
        const { assembly: current, components: loaded, transforms: t } = live.current;
        const options = dropTargets(current, loaded, t, id, key);
        if (!options.length) { acts.current.setStatus('It cannot go there.'); return; }

        if (options.length > 1) {
          acts.current.setPendingChoice({
            kind: 'move',
            instanceId: id,
            componentId: current.instances.find((i) => i.instanceId === id)?.componentId,
            placements: options,
          });
          acts.current.setStatus(`${options.length} ways it can sit there — pick one.`);
          return;
        }
        // The camera must NOT re-frame: the parts are the same, so the framing
        // signature is unchanged and this is a no-op by construction. Noted
        // because it is the kind of thing a later refactor quietly breaks.
        acts.current.applyMove(id, options[0]);
      },
    },
  }), []);

  const onPointerDown = gesture.onPointerDown;
  const onPointerMove = gesture.onPointerMove;
  const endDrag = gesture.onPointerUp;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      if (e.key === 'Escape') {
        setPendingPart(null);
        setPendingPoint(null);
        gesture.cancel();
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
            // Greying a part out without saying why is the same failure as
            // refusing a joint without saying why. A condition is the first
            // thing that can disable a part permanently rather than just for
            // now — the office arm on a 550 mm ladder can never go anywhere —
            // so the rule's own words go on the button.
            const why = disabled ? whyComponentFitsNowhere(matrix, c.id) : null;
            return (
              <button
                key={c.id}
                title={why || undefined}
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
                  {why ? ` · ${why}` : ''}
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
        {/* NAMED, not counted. "3 required points still empty" is a number, and
            a number is not something a person can act on; "this cabinet is
            carried at one end, nothing at x 1380, y 813" is. The part is what
            is wrong, and where it needs supporting is the thing that fixes it. */}
        {validity.missingRequiredSnaps.map((m) => (
          <p key={`${m.instanceId}::${m.snapId}`} className="cfg-invalid">
            {describe(assembly.instances.find((i) => i.instanceId === m.instanceId)?.componentId)}
            {' '}is not held at its {m.label.replace(/^rest-/, '')} end — nothing under
            {' '}x {m.atMm[0]}, y {m.atMm[1]}. It would cantilever.
          </p>
        ))}
        {validity.backToFront.map((b) => (
          <p key={b.instanceId} className="cfg-invalid">
            {describe(b.componentId)} is fitted back to front.
          </p>
        ))}
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
        {/* What the choice actually ADDED. Matt's question was whether the foot
            is an option that can be added or not, and the answer only becomes
            true if the option produces something you can see and something you
            can price. Saying how many is the cheapest way to show it did. */}
        {implied.connections.length > 0 && (
          <p className="cfg-note cfg-dim">
            Adds {implied.connections.length} part
            {implied.connections.length === 1 ? '' : 's'} to the quote.
          </p>
        )}
        {/* A refusal is not a warning. The 200 mm frames have no foot fixing, so
            this configuration cannot be built at all - said here, next to the
            control that caused it, rather than discovered at the total. */}
        {implied.refusals.map((r) => (
          <p key={r.code} className="cfg-invalid">{r.message}</p>
        ))}
        {implied.notes.map((n) => (
          <p key={n.code} className="cfg-note cfg-dim">{n.text}</p>
        ))}
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
