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
import { createScene, fitBounds, frameProduct } from './scene.js';
import { syncProduct, setGround, describeLayout } from './product.js';
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
    ctx.start();
    return () => {
      ctx.dispose();
      ctxRef.current = null;
    };
  }, []);

  // --------------------------------------------------------------- the product
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !resolved || !components?.size) return;

    syncProduct(
      ctx,
      { instances: resolved.scene.assembly.instances, transforms: resolved.scene.transforms },
      components,
      // The whole difference, and it is this line.
      { selectable: false, showGuides: false },
    );
    setGround(ctx, resolved.mounting, resolved.footHeightMm);

    const bounds = fitBounds(ctx);
    // The runtime frames on load, every time. Someone arriving at a link must
    // see the whole product; the editor must never do this, because a camera
    // that jumps every time you add a shelf is unusable.
    frameProduct(ctx);
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
  }, [resolved, components]);

  const parts = resolved?.assembly.instances.length ?? 0;
  const implied = resolved?.implied?.connections?.length ?? 0;

  return (
    <div className="cfgv">
      <div className="cfgv-stage" ref={mountRef} />

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
          </div>
        </div>
      )}
    </div>
  );
}
