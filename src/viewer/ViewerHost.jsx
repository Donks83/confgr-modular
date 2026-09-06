// Getting the parts to the runtime, which is the only thing the runtime cannot
// do for itself.
//
// `Viewer` takes a Map of components and knows nothing about where they came
// from — deliberately, because that is the piece which changes per deployment:
// today it is the desktop app's IPC, in the bundle export it will be a manifest
// of files sitting next to index.html, and on a hosted route it will be a fetch.
// Keeping the loading OUT of the viewer is what makes those three the same
// viewer.
//
// It is also why this file, rather than `Viewer.jsx`, is the one that mentions
// `window.confgr`.

import React, { useEffect, useState } from 'react';
import Viewer from './Viewer.jsx';
import { loadComponentFromPath } from '../three/loadGlb.js';

export default function ViewerHost({ configurationId }) {
  const [components, setComponents] = useState(new Map());
  const [catalogue, setCatalogue] = useState(null);
  const [status, setStatus] = useState('Loading the parts…');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!window.confgr) {
        setStatus('Run this inside the desktop app.');
        return;
      }
      try {
        const dir = await window.confgr.app.testAssetsDir();
        const listed = await window.confgr.fs.listModels(dir);
        if (!listed.ok) { setStatus(`Could not read ${dir}: ${listed.error}`); return; }

        const loaded = new Map();
        for (const file of listed.files) {
          try {
            const { component, scene } = await loadComponentFromPath(file);
            loaded.set(component.id, { ...component, template: scene });
          } catch {
            // A part that will not load is not this screen's problem to
            // explain: `resolveConfiguration` NAMES the ones this particular
            // configuration needs and cannot have, which is the only list a
            // person looking at one product cares about.
          }
        }
        if (cancelled) return;

        setComponents(loaded);
        setStatus(loaded.size ? null : 'No parts are available.');
      } catch (err) {
        if (!cancelled) setStatus(`Could not load the parts: ${err.message}`);
      }
    })();

    (async () => {
      try {
        const book = await window.confgr?.app?.catalogue?.();
        if (!cancelled && book?.ok) setCatalogue(book.catalogue ?? book);
      } catch {
        // Prices are optional. The quote already degrades honestly without them.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (status) {
    return (
      <div className="cfgv">
        <div className="cfgv-error" role="status">{status}</div>
      </div>
    );
  }

  return (
    <Viewer
      configurationId={configurationId}
      components={components}
      catalogue={catalogue}
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
