// The runtime. A configuration id in, a product on screen, nothing to edit.
//
// This is Phase 2 item 2, and the whole of what makes it different from the
// editor is stated in three places rather than spread through a second program:
//
//   1. `selectable: false` in `syncProduct` — no group carries an instanceId,
//      so nothing can be picked, moved or deleted. One line.
//   2. no marker root, no ghost, no palette, no attach flows. They are not
//      disabled here; they were never imported.
//   3. `frameProduct` on load — the editor must never move the camera by
//      itself, the runtime must, and that is a real difference rather than an
//      oversight.
//
// Everything else — lights, ground, finishes, the pan leash, which nodes are
// product — comes from the same two files the editor uses. See the note at the
// top of `scene.js` for why that matters more than it looks.
//
// ALL STATE IS PER INSTANCE. No `window.__cfg*`, no module-level mutable
// anything: two of these on one page must not fight, and §2 says that is a
// quality bar rather than a feature. The editor's harness globals are fine
// where they are — an editor is one instance by definition — and they are
// exactly what must not come along.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import './viewer.css';
import {
  createScene, fitBounds, frameProduct, followProduct,
} from './scene.js';
import {
  syncProduct, setGround, describeLayout, pickInstance,
} from './product.js';
import {
  createMarkerLayer, drawMarkers, markerAt, hoverMarker,
  clearGhost, showGhostAt, createGesture, MARKER_MODE,
  isCoarsePointer, DRAG_THRESHOLD_PX,
} from './interact.js';
import { arAvailability, AR_MODE } from './ar-link.js';
import ArButton from './ArButton.jsx';
import { resolveConfiguration } from '../engine/configuration.js';
import { formatQuote } from '../engine/quote.js';

const mmOf = (bounds) => (bounds ? {
  w: Math.round((bounds.max.x - bounds.min.x) * 1000),
  h: Math.round((bounds.max.y - bounds.min.y) * 1000),
  d: Math.round((bounds.max.z - bounds.min.z) * 1000),
} : null);

export default function Viewer({
  configurationId,
  components,
  catalogue = null,
  tierId = null,
  showPrice = true,
  title = null,
  ar = null,
  /**
   * Why there is no AR button, when the caller knows better than this file.
   *
   * The guided flow withholds AR the moment the product stops being the one the
   * bundle's `ar/` files were baked for, and the reason is worth saying out
   * loud rather than leaving a gap where a button was.
   */
  arWithheld = null,
  /**
   * Selection, off by default.
   *
   * `selectable: false` was described as "the whole difference" between the
   * runtime and the editor, and for a viewer it still is. A guided configurator
   * needs it back, because a customer has to be able to point at the part they
   * mean - but it stays a decision the caller makes rather than something the
   * runtime assumes.
   */
  selectable = false,
  selectedId = null,
  onPick = null,
  /**
   * The pointer layer, off unless a caller asks for it.
   *
   * Matt, after configuring a product with steppers alone: "it needs to be the
   * drag and drop we had at the start with the snap dots, click a dot add an
   * accessory to the dot and then you can click and drag to change its
   * location." That is the editor's interaction, and since §5.25 it lives in
   * `interact.js` where both programs can have it.
   *
   * A plain viewer of one configuration passes nothing and behaves exactly as
   * before: no dots, no drag, and a tap that only selects. Everything below is
   * gated on this object existing, so the runtime cannot grow the editor's
   * behaviour by accident.
   *
   * @type {null | {
   *   points: Array<object>,            the dots to draw, from the engine
   *   mode: 'add' | 'move',
   *   pendingKey: string|null,
   *   targeted: boolean,
   *   keyOf: (point) => string,
   *   onPoint: (key, point) => void,    a dot was clicked
   *   onMoved: (instanceId, key) => void,
   *   canDrag: (instanceId) => {ok: boolean, reason?: string},
   *   ghostFor: (instanceId, key) => {component, pose} | null,
   * }}
   */
  interaction = null,
  onReady = null,
}) {
  const mountRef = useRef(null);
  const ctxRef = useRef(null);
  // Held in a ref, not read from the closure. A caller passing an inline arrow
  // — which is the normal, obvious thing to write — would otherwise give the
  // draw effect a new dependency on every render and rebuild the product each
  // time. The callback should not be able to cost a caller frames for writing
  // idiomatic React.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Same trick, same reason: the gesture is built once and must never read a
  // render-old copy of the caller's callbacks.
  const actRef = useRef(interaction);
  actRef.current = interaction;
  // Whether this viewer has ever framed a product. Per instance rather than
  // per configuration id: in a guided flow the id changes on every tap, and
  // "have I shown this person a product yet" is the actual question.
  const framedRef = useRef(false);
  const [size, setSize] = useState(null);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Resolve FIRST, draw second. A configuration that cannot be resolved is not
  // a blank screen — it is a message naming what is wrong, because the most
  // likely failure in a runtime is a link to a product whose parts have since
  // been withdrawn, and `resolveConfiguration` already names those rather than
  // quietly dropping them.
  const resolved = useMemo(() => {
    if (!configurationId || !components?.size) return null;
    try {
      setError(null);
      return resolveConfiguration(configurationId, components, { catalogue, tierId });
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [configurationId, components, catalogue, tierId]);

  // ---------------------------------------------------------------- the scene
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const ctx = createScene(mount);
    ctxRef.current = ctx;
    // The marker layer is built whether or not it is used, and costs one
    // sphere geometry and two empty groups. Building it conditionally would
    // mean the scene effect had to re-run when a caller turned interaction on,
    // which would tear down and rebuild the whole renderer.
    const disposeMarkers = createMarkerLayer(ctx);
    ctx.start();
    return () => {
      disposeMarkers();
      ctx.dispose();
      ctxRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------------- the dots
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    drawMarkers(ctx, interaction?.points || [], {
      mode: interaction?.mode === 'move' ? MARKER_MODE.MOVE : MARKER_MODE.ADD,
      pendingKey: interaction?.pendingKey || null,
      targeted: !!interaction?.targeted,
      keyOf: interaction?.keyOf,
    });
    ctx.render();
  }, [interaction?.points, interaction?.mode, interaction?.pendingKey, interaction?.targeted]);

  // --------------------------------------------------------------- the product
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !resolved || !components?.size) return;

    syncProduct(
      ctx,
      { instances: resolved.scene.assembly.instances, transforms: resolved.scene.transforms },
      components,
      { selectable, selectedId, showGuides: false },
    );
    setGround(ctx, resolved.mounting, resolved.footHeightMm);

    const bounds = fitBounds(ctx);

    // ONCE, then follow. Someone arriving at a link must see the whole product,
    // so the first draw frames it. Every draw after that is a CHANGE the person
    // made, and re-framing throws away the angle and the zoom they just chose -
    // which in a guided configurator means every tap on a stepper resets the
    // view. `followProduct` keeps the camera and only pulls back if the product
    // has outgrown it.
    //
    // `scene.js` said the viewer framed "once, on load" from the day it was
    // written; the code framed on every rebuild. This is the line that makes
    // the comment true.
    if (framedRef.current) followProduct(ctx);
    else {
      frameProduct(ctx);
      framedRef.current = true;
    }
    ctx.render();
    setSize(mmOf(bounds));

    // Handed out only once the product is actually DRAWN, so `describe` reports
    // world positions rather than where things were before the sync.
    onReadyRef.current?.({
      resolved,
      describe: () => describeLayout(
        ctx,
        { instances: resolved.scene.assembly.instances, transforms: resolved.scene.transforms },
        resolved.assembly.connections || [],
      ),
    });
  }, [resolved, components, selectable, selectedId]);

  // ------------------------------------------------------------------ picking
  //
  // A TAP, not a click, and the distinction is the whole of this handler. The
  // same pointer gestures already orbit the camera, so a press that moved or
  // lingered belongs to OrbitControls and must not also select something. A
  // person who drags to look round the product and finds they have picked a
  // shelf will stop dragging.
  //
  // 8 px and 500 ms, on a canvas being touched with a thumb. Tighter than that
  // and a deliberate tap with a little wobble misses.
  const pressRef = useRef(null);

  const onTapDown = (e) => {
    pressRef.current = { x: e.clientX, y: e.clientY, at: Date.now() };
  };

  const onTapUp = (e) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || !selectable || !onPick) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) return;
    if (Date.now() - press.at > 500) return;

    const ctx = ctxRef.current;
    if (!ctx) return;
    // null is a real answer: tapping the background is how a person puts a
    // part down, and it has to clear the selection rather than do nothing.
    onPick(pickInstance(ctx, e.clientX, e.clientY));
  };

  // ---------------------------------------------------------------- the gesture
  //
  // With an interaction layer, the shared gesture takes the whole pointer over:
  // it is the thing that knows a dot beats a part, that a press which travels
  // is a drag, and that a drag can only end on a dot.
  //
  // WHY A DRAG NEEDS THE PART SELECTED FIRST, which the editor does not require.
  // In the editor, dragging a part is the main verb and the markers are always
  // up, so a press on a part is unambiguous. A customer's first instinct on a
  // 3D product is to swipe it round - and on a phone the product fills the
  // screen, so nearly every orbit starts on a part. Requiring a tap first makes
  // the intent explicit and costs one tap: `canDrag` refuses with
  // 'not-selected', the gesture lets go, and OrbitControls - which was never
  // disabled - carries on turning the camera. Nothing is said, because nothing
  // went wrong.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const gesture = useMemo(() => createGesture({
    // A THUMB WOBBLES. Five pixels is right for a mouse and wrong for a finger:
    // a deliberate tap on a shelf travels more than that, so on a touch screen
    // half the taps became drags and the part was never selected. Same root as
    // the dots being hard to hit.
    threshold: isCoarsePointer() ? 12 : DRAG_THRESHOLD_PX,
    hitMarker: (x, y) => markerAt(ctxRef.current, x, y),
    hitInstance: (x, y) => pickInstance(ctxRef.current, x, y),
    canDrag: (id) => (actRef.current?.canDrag?.(id) ?? { ok: false, reason: 'no-interaction' }),
    hooks: {
      onPoint: (key, marker) => actRef.current?.onPoint?.(key, marker),
      onSelect: (id) => onPickRef.current?.(id),
      onDragStart: () => { ctxRef.current.controls.enabled = false; },
      onDragOver: (key, mesh, id) => {
        const ctx = ctxRef.current;
        if (!hoverMarker(ctx, mesh)) return;
        const ghost = key ? actRef.current?.ghostFor?.(id, key) : null;
        if (ghost) showGhostAt(ctx, ghost.component, ghost.pose);
        else clearGhost(ctx);
        ctx.render();
      },
      onDragEnd: () => {
        const ctx = ctxRef.current;
        ctx.controls.enabled = true;
        hoverMarker(ctx, null);
        clearGhost(ctx);
        ctx.render();
      },
      onDrop: (id, key) => {
        if (key) actRef.current?.onMoved?.(id, key);
      },
    },
  }), []);

  // Escape, and unmounting mid-drag, both have to put the camera back.
  useEffect(() => () => gesture.cancel(), [gesture]);

  const parts = resolved?.assembly.instances.length ?? 0;
  const implied = resolved?.implied?.connections?.length ?? 0;

  // Decided from the manifest, the page's own URL and the browser's own
  // account of itself — never from a feature test, because there is nothing to
  // test: `rel="ar"` and an intent:// URL are both inert strings in a browser
  // that does not handle them, and neither reports back.
  const arLink = useMemo(() => arAvailability({
    ar,
    pageHref: typeof window === 'undefined' ? '' : window.location.href,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    maxTouchPoints: typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints || 0),
    mounting: resolved?.mounting || null,
    title: title || null,
  }), [ar, resolved, title]);

  // Is AR an ACTION here, or an explanation? The answer decides where it is
  // drawn, and getting it wrong is what hid the button: a link goes on the
  // stage, a sentence goes in the sheet.
  const arIsLink = !arWithheld && !!arLink && arLink.mode !== AR_MODE.NONE;

  return (
    <div className="cfgv">
      {/* One or the other, never both. With an interaction layer the shared
          gesture owns the pointer; without one, the tap rule is all a plain
          viewer needs and all it should have. */}
      <div
        className="cfgv-stage"
        ref={mountRef}
        onPointerDown={interaction ? gesture.onPointerDown : onTapDown}
        onPointerMove={interaction ? gesture.onPointerMove : undefined}
        onPointerUp={interaction ? gesture.onPointerUp : onTapUp}
        onPointerCancel={interaction ? gesture.cancel : undefined}
      />

      {/* AR ON THE STAGE, not at the bottom of the bill of materials.
       *
       * Matt: "how do i start the AR mode?" and then "i dont see the view in
       * your room anywhere". It was rendering perfectly - inside the collapsed
       * bottom sheet, below a twenty-line quote, and on a phone UNDERNEATH the
       * options panel, which covers the lower 46vh at a higher z-index. The DOM
       * said the link was at y 724-796; the panel owned 439-812. Present,
       * drawn, and unreachable.
       *
       * Two taps in a non-obvious order is not a way to offer the thing the
       * whole AR chain was built for, so the button is now a control on the
       * stage like Configure. The SENTENCE stays in the sheet: "AR needs a
       * phone" and "reset the options to see it in AR" are explanations, and
       * explanations belong next to what they qualify rather than floating over
       * a product. */}
      {arIsLink && (
        <div className="cfgv-arfloat">
          {/* Its own component because its DOM shape is a requirement iOS
              enforces silently, and a component can be rendered in jsdom and
              have its children counted. See ArButton.jsx. */}
          <ArButton availability={arLink} hasAr={!!ar} />
        </div>
      )}

      {error && (
        <div className="cfgv-error" role="alert">
          <strong>This product cannot be shown.</strong>
          <span>{error}</span>
        </div>
      )}

      {resolved && (
        <div className={`cfgv-sheet${sheetOpen ? ' cfgv-sheet-open' : ''}`}>
          {/* A handle, not a button, on purpose: on a phone this is a bottom
              sheet and the whole strip should be tappable, which is what
              everyone already expects a sheet to do. On a wide screen the
              CSS pins it open and this collapses to a heading. */}
          <button
            type="button"
            className="cfgv-handle"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((v) => !v)}
          >
            <span className="cfgv-grip" aria-hidden="true" />
            <span className="cfgv-summary">
              {parts} part{parts === 1 ? '' : 's'}
              {implied > 0 && <> · {implied} included</>}
              {size && <> · {size.w} × {size.h} × {size.d} mm</>}
            </span>
          </button>

          <div className="cfgv-body">
            {title && <h1 className="cfgv-title">{title}</h1>}
            {size && (
              <dl className="cfgv-dims">
                <div><dt>Width</dt><dd>{size.w} mm</dd></div>
                <div><dt>Height</dt><dd>{size.h} mm</dd></div>
                <div><dt>Depth</dt><dd>{size.d} mm</dd></div>
              </dl>
            )}

            {/* Validity is REPORTED, not hidden. A runtime that silently shows
                an unbuildable product is worse than one that says so — and the
                engine already knows, because the same check runs in the editor. */}
            {resolved.validity && !resolved.validity.isValid && (
              <p className="cfgv-warn">
                {resolved.validity.missingRequiredSnaps.length} part
                {resolved.validity.missingRequiredSnaps.length === 1 ? '' : 's'} in
                this configuration are not fully supported.
              </p>
            )}

            {showPrice && (
              <pre className="cfgv-quote">
                {resolved.quote ? formatQuote(resolved.quote) : 'No prices on file.'}
              </pre>
            )}

            {/* ONLY THE SENTENCE LIVES HERE. The BUTTON moved onto the stage -
                see `cfgv-arfloat` below and the note on `arIsLink`. An
                explanation belongs next to the numbers it qualifies; an action
                does not. */}
            {!arIsLink && (
              <ArButton availability={arLink} hasAr={!!ar} withheld={arWithheld} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
