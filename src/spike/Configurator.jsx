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
} from '../engine/attach.js';

let counter = 0;
const nextId = () => { counter += 1; return `i${counter}`; };

const EMPTY = { instances: [], connections: [] };

export default function Configurator() {
  const mountRef = useRef(null);
  const three = useRef(null);
  const framedFor = useRef('');

  const [components, setComponents] = useState(new Map());
  const [assembly, setAssembly] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [pendingPart, setPendingPart] = useState(null);    // part-first
  const [pendingPoint, setPendingPoint] = useState(null);  // point-first
  const [showMarkers, setShowMarkers] = useState(true);
  const [showGuides, setShowGuides] = useState(false);
  const [status, setStatus] = useState('Loading components.');
  const [loadErrors, setLoadErrors] = useState([]);

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

  const markers = useMemo(() => {
    const live = livePoints(matrix);
    if (!pendingPart) return live;
    // Part-first: show only where THIS part can go. A 3x2 pouch legitimately
    // offers fewer markers than a 1x1 one, which is the useful behaviour.
    const allowed = new Set(pointsForComponent(matrix, pendingPart).map((p) => p.pointKey));
    return live.filter((p) => allowed.has(pointKey(p)));
  }, [matrix, pendingPart]);

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
    // The product is anchored, so panning is the one control that could lose it
    // off screen. Orbit and zoom only.
    controls.enablePan = false;

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

    scene.add(new THREE.GridHelper(4, 40, '#463c33', '#2c2721'));

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const productRoot = new THREE.Group();
    const markerRoot = new THREE.Group();
    scene.add(productRoot, markerRoot);

    three.current = {
      scene, camera, renderer, controls, productRoot, markerRoot,
      groups: new Map(),
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      markerGeo: new THREE.SphereGeometry(1, 12, 10),
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

    window.__spikeCapture = () => renderer.domElement.toDataURL('image/png');

    // Spike-only handle so an automated check can drive a REAL click: project a
    // marker's world position to screen coordinates and dispatch on the canvas.
    // Unit tests cover the engine; only this covers the raycast-to-attach
    // wiring, which is exactly where the last two "it doesn't work" rounds came
    // from.
    window.__cfgClickMarker = (index = 0) => {
      const marker = markerRoot.children[index];
      if (!marker) return `no marker at ${index} (have ${markerRoot.children.length})`;

      const v = marker.position.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;

      renderer.domElement.dispatchEvent(new MouseEvent('click', {
        clientX: x, clientY: y, bubbles: true,
      }));
      return `clicked marker ${index} of ${markerRoot.children.length} at ${Math.round(x)},${Math.round(y)}`;
    };

    let raf = 0;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      three.current.markerGeo.dispose();
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

    // ---- camera: frame the product, only when its shape changes -----------
    const signature = assembly.instances.map((i) => i.instanceId).join(',');
    if (signature && signature !== framedFor.current) {
      framedFor.current = signature;
      const bounds = new THREE.Box3().setFromObject(ctx.productRoot);
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
    if (!showMarkers) return;

    for (const point of markers) {
      const key = pointKey(point);
      const isPending = key === pendingPoint;
      const isTargeted = !!pendingPart;

      const mesh = new THREE.Mesh(ctx.markerGeo, new THREE.MeshBasicMaterial({
        color: isPending ? '#e0a03c' : isTargeted ? '#3ddc97' : '#4fc3d9',
        transparent: true,
        opacity: isPending ? 1 : isTargeted ? 0.9 : 0.55,
      }));

      // Grid cells are dense — a MOLLE panel has 84 of them — so their markers
      // are smaller than an authored point's or the panel disappears under dots.
      const r = (point.isGridCell ? 0.006 : 0.014) * (isPending ? 1.7 : isTargeted ? 1.35 : 1);
      mesh.scale.setScalar(r);
      mesh.position.fromArray(point.worldPosition);
      // Lift off the surface so a marker is never buried in the geometry.
      mesh.position.addScaledVector(new THREE.Vector3().fromArray(point.worldFacing), r * 0.9);
      mesh.userData.pointKey = key;
      mesh.renderOrder = 2;
      ctx.markerRoot.add(mesh);
    }
  }, [markers, pendingPoint, pendingPart, showMarkers]);

  // ------------------------------------------------------------- attach flows
  const place = useCallback((componentId, key) => {
    const placement = matrix.placements.find(
      (p) => p.componentId === componentId && p.pointKey === key,
    );
    if (!placement) { setStatus('That part does not fit there.'); return; }

    const component = components.get(componentId);
    const selections = {};
    for (const opt of component.options) selections[opt.id] = opt.defaultValueId;

    const id = nextId();
    setAssembly((a) => attachAt(a, placement, id, selections));
    setSelectedId(id);
    setPendingPart(null);
    setPendingPoint(null);
    setStatus(`Added ${componentId}.`);
  }, [matrix, components]);

  const choosePart = (componentId) => {
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
  const onClick = (event) => {
    const ctx = three.current;
    if (!ctx) return;

    const rect = ctx.renderer.domElement.getBoundingClientRect();
    ctx.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera);

    // Markers first: they are small and sit on top of the geometry they belong
    // to, so testing the product first would make them almost unclickable.
    const onMarker = ctx.raycaster.intersectObjects(ctx.markerRoot.children, false);
    if (onMarker.length) { choosePoint(onMarker[0].object.userData.pointKey); return; }

    const onProduct = ctx.raycaster.intersectObjects(ctx.productRoot.children, true)
      .filter((h) => h.object.visible && !h.object.name.startsWith('md-'));
    if (onProduct.length) {
      let node = onProduct[0].object;
      while (node && node.userData.instanceId == null) node = node.parent;
      if (node) {
        setSelectedId(node.userData.instanceId);
        setPendingPart(null);
        setPendingPoint(null);
      }
      return;
    }

    setSelectedId(null);
    setPendingPart(null);
    setPendingPoint(null);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      if (e.key === 'Escape') { setPendingPart(null); setPendingPoint(null); }
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
          where it fits. Both orders work.
        </p>

        <h2>
          {pendingPoint ? 'Fits here' : assembly.instances.length ? 'Add a part' : 'Start from'}
          {pendingPoint && <button className="cfg-clear" onClick={() => { setPendingPoint(null); setStatus(''); }}>clear</button>}
        </h2>

        <div className="cfg-palette">
          {catalogueForPanel.filter(Boolean).map((c) => {
            const places = assembly.instances.length ? pointsForComponent(matrix, c.id).length : 1;
            const disabled = assembly.instances.length > 0 && places === 0 && !pendingPoint;
            return (
              <button
                key={c.id}
                className={pendingPart === c.id ? 'active' : ''}
                disabled={disabled}
                onClick={() => choosePart(c.id)}
              >
                <strong>{c.id}</strong>
                <span>{c.dimsMm.widthMm} × {c.dimsMm.heightMm} × {c.dimsMm.depthMm} mm</span>
                <span className="cfg-meta">
                  {c.grids.length ? `${c.grids[0].cols}×${c.grids[0].rows} grid` : ''}
                  {c.snaps[0]?.span ? `span ${c.snaps[0].span.cols}×${c.snaps[0].span.rows}` : ''}
                  {assembly.instances.length && !pendingPoint ? ` · ${places} place${places === 1 ? '' : 's'}` : ''}
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
      </aside>

      <div className="cfg-stage">
        <div ref={mountRef} className="cfg-canvas" onClick={onClick} />
        <div className="cfg-status">{status}</div>
      </div>
    </div>
  );
}
