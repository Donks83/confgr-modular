// The runtime's own entry point, and the reason it has one.
//
// `src/main.jsx` boots `App`, which chooses between the editor and the runtime.
// That is right inside the desktop app and WRONG in a deliverable: `App`
// statically imports `Configurator`, so vite pulls the whole authoring tool into
// the bundle — the palette, the attach flows, the drag handling, the harness
// globals. The first bundle this project produced had the editor's own status
// line in it, and `tests/bundle.test.js` now fails on exactly that string.
//
// A client's folder containing the tool we author with is not a disaster, but
// it is not something to ship on purpose either: it is dead weight in a file
// measured against an AR budget, and it is a description of how the product is
// built sitting in a customer's browser cache.
//
// So the runtime gets its own entry and its own build. Nothing here can reach
// `src/spike`, and that is enforced by the module graph rather than by care.

import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerHost from './ViewerHost.jsx';

/**
 * `?c=<id>` overrides the manifest.
 *
 * The manifest is what a bundle normally shows; the URL is how one bundle gets
 * pointed at a different configuration by hand, which is what a client does
 * when comparing two options.
 */
const configurationId = (() => {
  try {
    return new URLSearchParams(window.location.search).get('c');
  } catch {
    return null;
  }
})();

createRoot(document.getElementById('root')).render(
  <ViewerHost configurationId={configurationId} />,
);
