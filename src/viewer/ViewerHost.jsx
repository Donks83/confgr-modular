// Getting the parts to the runtime, which is the only thing the runtime cannot
// do for itself.
//
// `Viewer` takes a Map of components and knows nothing about where they came
// from — deliberately, because that is the piece which changes per deployment.
// There are two now and they are the two that matter:
//
//   the desktop app   parts off disk through the main process's IPC
//   an exported bundle  a manifest.json and some .glb files on a web server
//
// Same parser, same `extractComponent`, same rules about what a component is.
// Only the bytes arrive differently, and that is the whole reason the loading
// lives HERE rather than inside the viewer: a runtime that knew about
// `window.confgr` could never be handed to a client.
//
// The choice between them is one rule — `window.confgr` exists or it does not
// — because a bundle has no Electron in it by definition.

import React, { useEffect, useState } from 'react';
import Viewer from './Viewer.jsx';
import { loadComponentFromPath, loadComponentFromUrl } from '../three/loadGlb.js';
import { MANIFEST_NAME, parseManifest, modelUrl } from './manifest.js';

/** In the desktop app: everything in the models folder, because we can. */
async function partsFromDesktop() {
  const dir = await window.confgr.app.testAssetsDir();
  const listed = await window.confgr.fs.listModels(dir);
  if (!listed.ok) throw new Error(`Could not read ${dir}: ${listed.error}`);

  const components = new Map();
  for (const file of listed.files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { component, scene } = await loadComponentFromPath(file);
      components.set(component.id, { ...component, template: scene });
    } catch {
      // A part that will not load is not this screen's problem to explain:
      // `resolveConfiguration` NAMES the ones this particular configuration
      // needs and cannot have, which is the only list a person looking at one
      // product cares about.
    }
  }
  return { components, configuration: null, catalogue: null };
}

/**
 * In a bundle: exactly the parts the manifest lists, and no others.
 *
 * A missing model is FATAL here, unlike in the desktop app. The difference is
 * real: the app has eighty parts and this configuration wants four, so one bad
 * file is usually irrelevant. A bundle contains only the four, so a missing one
 * is a broken deliverable and saying so beats drawing three quarters of a
 * product.
 */
async function partsFromBundle(base) {
  const res = await fetch(`${base}${MANIFEST_NAME}`);
  if (!res.ok) throw new Error(`No ${MANIFEST_NAME} next to this page (${res.status}).`);
  const manifest = parseManifest(await res.json());

  const components = new Map();
  for (const file of manifest.models) {
    // eslint-disable-next-line no-await-in-loop
    const { component, scene } = await loadComponentFromUrl(modelUrl(base, file));
    components.set(component.id, { ...component, template: scene });
  }

  let catalogue = null;
  if (manifest.catalogue) {
    const book = await fetch(`${base}${manifest.catalogue}`);
    if (book.ok) catalogue = await book.json();
  }

  return { components, configuration: manifest.configuration, catalogue, manifest };
}

export default function ViewerHost({ configurationId = null }) {
  const [state, setState] = useState({ status: 'Loading the parts…' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const loaded = window.confgr
          ? await partsFromDesktop()
          // Relative to the page, so the folder works at any depth on any host
          // — including a subdirectory, which is where a client's IT will put it.
          : await partsFromBundle(new URL('./', window.location.href).href);

        if (cancelled) return;
        if (!loaded.components.size) { setState({ status: 'No parts are available.' }); return; }
        setState({ status: null, ...loaded });
      } catch (err) {
        if (!cancelled) setState({ status: err.message });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (state.status) {
    return (
      <div className="cfgv">
        <div className="cfgv-error" role="status">{state.status}</div>
      </div>
    );
  }

  // The URL wins over the manifest, so one bundle can still be pointed at a
  // different configuration by hand — useful for a client comparing two.
  const id = configurationId || state.configuration;

  return (
    <Viewer
      configurationId={id}
      components={state.components}
      catalogue={state.catalogue}
      title={state.manifest?.title}
      onReady={({ describe }) => {
        // ONE harness handle, and it is the whole point of the scenario that
        // uses it: build a bay in the EDITOR, take its configuration id, open
        // the RUNTIME on that id, and compare the resolved layouts. Two
        // programs, one product, and a difference between them would be the
        // exact bug this split was built to avoid.
        //
        // It is on `window` because the probe drives a whole window; it is not
        // state the viewer reads, so two viewers on one page still do not
        // interfere with each other's rendering. When the web component lands
        // this goes with it (§2).
        window.__viewerLayout = describe;
      }}
    />
  );
}
