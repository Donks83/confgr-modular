// PHASE 0 SPIKE. Throwaway UI over a real engine.
//
// The engine underneath (src/engine) is meant to survive. This file is not: it
// exists to answer the one question no test can, which is whether dragging
// parts together FEELS right. If it does, Phase 1 rebuilds this properly with
// react-three-fiber. If it does not, this is where we find out cheaply, and
// Babylon.js gets a turn.
//
// Raw three.js rather than r3f on purpose — the drag loop is easier to follow
// imperatively, and a spike should not be the place we also learn a new
// abstraction.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadComponentFromPath } from '../three/loadGlb.js';
import { resolveTransforms, worldSnaps } from '../engine/assembly.js';
import { findBestConnection, mostRelevantRejection } from '../engine/snapMatch.js';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let instanceCounter = 0;

export default function SnapSpike() {
  const mountRef = useRef(null);
  const three = useRef(null);          // three.js objects, outside React state
  const live = useRef(null);           // latest assembly, readable from the render loop

  const [components, setComponents] = useState(new Map());
  const [assembly, setAssembly] = useState({ instances: [], connections: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [showSnaps, setShowSnaps] = useState(true);
  const [showBoxes, setShowBoxes] = useState(false);
  const [status, setStatus] = useState('Loading test components.');
  const [hint, setHint] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);

  // ------------------------------------------------------------- three setup
  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b1815');

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(2.6, 2.0, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.6, 0.35, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;   // never go under the floor

    scene.add(new THREE.HemisphereLight('#cfd6e4', '#3a3128', 1.1));
    const key = new THREE.DirectionalLight('#fff4e6', 1.5);
    key.position.set(3, 5, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const grid = new THREE.GridHelper(12, 24, '#4a4038', '#2e2822');
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Marks the joint the part would make if released now.
    const previewRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.012, 8, 32),
      new THREE.MeshBasicMaterial({ color: '#3ddc97' }),
    );
    previewRing.visible = false;
    scene.add(previewRing);

    const instanceRoot = new THREE.Group();
    scene.add(instanceRoot);

    three.current = {
      scene, camera, renderer, controls, previewRing, instanceRoot,
      groups: new Map(), raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
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

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      // A leaked WebGL context per remount will hit the browser's context cap
      // and the canvas silently stops rendering. confgr-studio hit exactly this
      // with panoramas; not repeating it.
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // ------------------------------------------------------------- load assets
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Everything here is wrapped, because an unhandled rejection in this
      // block renders as an empty panel with no message at all. That cost a
      // whole round trip on 3 Sep: three.js was mangling the snap node names,
      // the promise rejected, and the UI just sat there looking finished.
      // A failure must always be visible.
      try {
        if (!window.confgr) {
          setStatus('Run this inside the desktop app — it needs file access.');
          return;
        }

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
          // A component that fails validation is the interesting case, not a
          // crash — the whole point of the rules is that they reject things.
          errors.push({ file: file.split(/[\\/]/).pop(), message: err.message });
        }
      }

        if (cancelled) return;
        setComponents(loaded);
        setLoadErrors(errors);
        setStatus(
          loaded.size
            ? `${loaded.size} components ready. Click one to add it, then drag it near another.`
            : `No components loaded — all ${listed.files.length} files were rejected. See the list on the left.`,
        );
      } catch (err) {
        if (cancelled) return;
        setStatus(`Could not load components: ${err.message}`);
        setLoadErrors([{ file: 'startup', message: err.stack || err.message }]);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // --------------------------------------------------- rebuild three from state
  useEffect(() => {
    const ctx = three.current;
    if (!ctx || !components.size) return;

    live.current = { assembly, components };

    let resolved;
    try {
      resolved = resolveTransforms(assembly, components);
    } catch (err) {
      setStatus(`Could not resolve the assembly: ${err.message}`);
      return;
    }

    const { transforms } = resolved;
    const wanted = new Set(assembly.instances.map((i) => i.instanceId));

    for (const [id, group] of ctx.groups) {
      if (!wanted.has(id)) {
        ctx.instanceRoot.remove(group);
        ctx.groups.delete(id);
      }
    }

    for (const instance of assembly.instances) {
      let group = ctx.groups.get(instance.instanceId);

      if (!group) {
        const component = components.get(instance.componentId);
        group = new THREE.Group();
        group.add(component.template.clone(true));
        group.userData.instanceId = instance.instanceId;
        ctx.instanceRoot.add(group);
        ctx.groups.set(instance.instanceId, group);
      }

      const t = transforms.get(instance.instanceId);
      if (t) {
        group.position.fromArray(t.translation);
        group.quaternion.fromArray(t.rotation);
      }

      group.traverse((o) => {
        if (!o.isMesh) return;
        const isSnap = o.name.startsWith('md-snap');
        const isBox = o.name.startsWith('col-') || o.name === 'dim';

        o.visible = isSnap ? showSnaps : isBox ? showBoxes : true;
        if (!isSnap && !isBox) { o.castShadow = true; o.receiveShadow = true; }

        if (!isSnap && !isBox && o.material) {
          // Selection reads as a warm rim rather than a colour change, so the
          // finish being judged is never the thing the highlight altered.
          const selected = instance.instanceId === selectedId;
          if (!o.userData.baseColour) o.userData.baseColour = o.material.color.clone();
          o.material = o.material.clone();
          o.material.color.copy(o.userData.baseColour);
          o.material.emissive = new THREE.Color(selected ? '#5a3a12' : '#000000');
        }
      });
    }
  }, [assembly, components, selectedId, showSnaps, showBoxes]);

  // ------------------------------------------------------------- interaction
  const pointerToGround = useCallback((event) => {
    const ctx = three.current;
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    ctx.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera);
    const hit = new THREE.Vector3();
    return ctx.raycaster.ray.intersectPlane(GROUND, hit) ? hit : null;
  }, []);

  const addComponent = (componentId) => {
    instanceCounter += 1;
    const instanceId = `i${instanceCounter}`;
    // A new part arrives free-standing, in front of the camera, so it is
    // visible and grabbable rather than buried inside the existing run.
    setAssembly((a) => ({
      ...a,
      instances: [...a.instances, {
        instanceId, componentId, position: [0, 0, 1.4], rotation: [0, 0, 0, 1], freeMove: true,
      }],
    }));
    setSelectedId(instanceId);
    setHint(null);
  };

  const drag = useRef(null);

  const onPointerDown = (event) => {
    const ctx = three.current;
    if (!ctx || event.button !== 0) return;

    const rect = ctx.renderer.domElement.getBoundingClientRect();
    ctx.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera);

    const hits = ctx.raycaster.intersectObjects(ctx.instanceRoot.children, true)
      .filter((h) => h.object.visible && !h.object.name.startsWith('md-snap'));

    if (!hits.length) { setSelectedId(null); return; }

    let node = hits[0].object;
    while (node && node.userData.instanceId == null) node = node.parent;
    if (!node) return;

    const instanceId = node.userData.instanceId;
    setSelectedId(instanceId);

    const ground = pointerToGround(event);
    if (!ground) return;

    drag.current = {
      instanceId,
      grabOffset: new THREE.Vector3().subVectors(node.position, ground),
    };
    ctx.controls.enabled = false;
  };

  const onPointerMove = (event) => {
    const ctx = three.current;
    if (!ctx || !drag.current) return;

    const ground = pointerToGround(event);
    if (!ground) return;

    const next = ground.clone().add(drag.current.grabOffset);
    next.y = 0;   // parts stay on the floor; nothing here stacks yet

    const { instanceId } = drag.current;
    const group = ctx.groups.get(instanceId);
    if (!group) return;

    // Move the three.js object directly during the drag rather than round-
    // tripping through React on every mouse move. State is reconciled on release.
    group.position.copy(next);

    // --- live snap preview -------------------------------------------------
    const { assembly: current, components: loaded } = live.current;
    const movingInstance = current.instances.find((i) => i.instanceId === instanceId);
    if (!movingInstance) return;

    const probe = {
      instances: [{ ...movingInstance, position: next.toArray(), freeMove: true }],
      connections: [],
    };
    const rest = {
      instances: current.instances.filter((i) => i.instanceId !== instanceId),
      connections: current.connections.filter(
        (c) => c.fromInstanceId !== instanceId && c.toInstanceId !== instanceId,
      ),
    };

    try {
      const movingSnaps = worldSnaps(probe, loaded, resolveTransforms(probe, loaded).transforms);
      const placedSnaps = rest.instances.length
        ? worldSnaps(rest, loaded, resolveTransforms(rest, loaded).transforms)
        : [];

      const { best, rejections } = findBestConnection(movingSnaps, placedSnaps);

      if (best) {
        ctx.previewRing.position.fromArray(best.placed.worldPosition);
        ctx.previewRing.lookAt(
          new THREE.Vector3().fromArray(best.placed.worldPosition)
            .add(new THREE.Vector3().fromArray(best.placed.worldFacing)),
        );
        ctx.previewRing.visible = true;
        drag.current.candidate = best;
        setHint({ ok: true, message: `Snaps to ${best.placed.instanceId} ${best.placed.label}.` });
      } else {
        ctx.previewRing.visible = false;
        drag.current.candidate = null;
        const why = mostRelevantRejection(rejections);
        setHint(why ? { ok: false, message: why.message } : null);
      }
    } catch {
      // A transient unresolvable state mid-drag is not worth reporting.
      ctx.previewRing.visible = false;
      drag.current.candidate = null;
    }
  };

  const onPointerUp = () => {
    const ctx = three.current;
    if (!ctx || !drag.current) return;

    const { instanceId, candidate } = drag.current;
    const group = ctx.groups.get(instanceId);
    const dropped = group ? group.position.toArray() : [0, 0, 0];

    ctx.previewRing.visible = false;
    ctx.controls.enabled = true;
    drag.current = null;

    setAssembly((a) => {
      const withoutOld = a.connections.filter(
        (c) => c.fromInstanceId !== instanceId && c.toInstanceId !== instanceId,
      );

      if (!candidate) {
        // No joint: the part keeps an explicit position and stays free.
        return {
          instances: a.instances.map((i) => (
            i.instanceId === instanceId ? { ...i, position: dropped, freeMove: true } : i
          )),
          connections: withoutOld,
        };
      }

      // Connected: the part gives up its coordinates entirely. Position is now
      // derived from the graph — the whole reason this holds together.
      return {
        instances: a.instances.map((i) => (
          i.instanceId === instanceId
            ? { ...i, position: null, rotation: null, freeMove: false }
            : i
        )),
        connections: [...withoutOld, {
          fromInstanceId: candidate.placed.instanceId,
          fromSnapId: candidate.placed.snapId,
          toInstanceId: candidate.moving.instanceId,
          toSnapId: candidate.moving.snapId,
        }],
      };
    });

    setHint(null);
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    setAssembly((a) => ({
      ...a,
      instances: a.instances.map((i) => {
        if (i.instanceId !== selectedId) return i;
        const q = new THREE.Quaternion().fromArray(i.rotation || [0, 0, 0, 1]);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
        // Rotating a connected part detaches it — its orientation is otherwise
        // owned by the joint, and honouring both is not possible.
        return { ...i, rotation: q.toArray(), position: i.position || [0, 0, 1.4], freeMove: true };
      }),
      connections: a.connections.filter(
        (c) => c.fromInstanceId !== selectedId && c.toInstanceId !== selectedId,
      ),
    }));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setAssembly((a) => ({
      instances: a.instances.filter((i) => i.instanceId !== selectedId),
      connections: a.connections.filter(
        (c) => c.fromInstanceId !== selectedId && c.toInstanceId !== selectedId,
      ),
    }));
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'r' || e.key === 'R') rotateSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  return (
    <div className="spike">
      <aside className="spike-panel">
        <h1>Snap spike</h1>
        <p className="spike-note">
          Phase 0. Proving that parts click together, hold when the run moves, and
          refuse joints that should not exist.
        </p>

        <h2>Components</h2>
        <div className="spike-palette">
          {[...components.values()].map((c) => (
            <button key={c.id} onClick={() => addComponent(c.id)} title={`${c.snaps.length} snaps`}>
              <strong>{c.id}</strong>
              <span>{c.dimsMm.widthMm} x {c.dimsMm.heightMm} x {c.dimsMm.depthMm} mm</span>
              <span className="spike-masks">{[...new Set(c.snaps.map((s) => s.mask))].join(', ')}</span>
            </button>
          ))}
        </div>

        {loadErrors.length > 0 && (
          <div className="spike-errors">
            <h2>Rejected on import</h2>
            {loadErrors.map((e) => (
              <p key={e.file}><strong>{e.file}</strong><br />{e.message}</p>
            ))}
          </div>
        )}

        <h2>View</h2>
        <label><input type="checkbox" checked={showSnaps} onChange={(e) => setShowSnaps(e.target.checked)} /> Snap planes</label>
        <label><input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> Collision and dimension boxes</label>

        <h2>Selected</h2>
        {selectedId ? (
          <>
            <p className="spike-note">{selectedId}</p>
            <div className="spike-row">
              <button onClick={rotateSelected}>Rotate 90&deg; (R)</button>
              <button onClick={deleteSelected}>Delete</button>
            </div>
          </>
        ) : <p className="spike-note">Nothing selected.</p>}

        <h2>Assembly</h2>
        <p className="spike-note">
          {assembly.instances.length} part{assembly.instances.length === 1 ? '' : 's'},
          {' '}{assembly.connections.length} joint{assembly.connections.length === 1 ? '' : 's'}
        </p>
        <pre className="spike-json">{JSON.stringify(assembly, null, 1)}</pre>
      </aside>

      <div className="spike-stage">
        <div
          ref={mountRef}
          className="spike-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        <div className="spike-status">
          <span>{status}</span>
          {hint && <span className={hint.ok ? 'ok' : 'no'}>{hint.message}</span>}
        </div>
      </div>
    </div>
  );
}
