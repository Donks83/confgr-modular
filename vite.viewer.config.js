// Building the RUNTIME on its own, with no editor anywhere in the graph.
//
// The main config builds `index.html`, which boots `App`, which imports both
// the editor and the runtime — correct for the desktop app, wrong for a
// deliverable. This one builds `viewer.html` instead, whose only import is
// `src/viewer/main.jsx`.
//
// The guarantee is structural rather than careful: nothing reachable from this
// entry can reach `src/spike`, so no amount of future editing can quietly put
// the authoring tool back into a client's folder. `tests/bundle.test.js` checks
// the built output for the editor's own strings anyway, because a guarantee
// nobody verifies is a comment.
//
// `base: './'` matters more here than anywhere else: a client's IT will put
// this folder in a subdirectory, and absolute asset paths would 404 there while
// working perfectly on the machine it was tested on.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-viewer',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'viewer.html'),
    },
  },
});
