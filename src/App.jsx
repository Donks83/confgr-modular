// The editor, or the runtime, depending on the URL.
//
//   ?c=<configuration-id>     the runtime, showing that product
//   anything else             the editor
//
// One switch, and it is the seam the whole of Phase 2 is built on: `?c=` is
// what the hosted `/ar?c=<id>` route (§4.1a) and the bundle export will both
// hand a page. Putting it here now means the runtime is REACHABLE — exercised
// by the probe, seen in a window — rather than a folder of code nobody has run.
//
// The two are deliberately not composed: the runtime does not import the
// editor, and nothing in `src/viewer` reaches back into `src/spike`. That is
// what makes the bundle export possible later, because the runtime has to be
// shippable without the authoring tool attached to it.

import React from 'react';
import Configurator from './spike/Configurator.jsx';
import ViewerHost from './viewer/ViewerHost.jsx';

/**
 * Read once, at module load.
 *
 * Not React state: which of the two programs is running is not something that
 * changes while you are looking at it, and treating it as state invites a
 * re-render that swaps a WebGL context out from under itself.
 */
function configurationFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('c');
  } catch {
    return null;
  }
}

const CONFIGURATION = configurationFromUrl();

export default function App() {
  return CONFIGURATION ? <ViewerHost configurationId={CONFIGURATION} /> : <Configurator />;
}
