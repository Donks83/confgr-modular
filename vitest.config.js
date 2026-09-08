import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The engine is deliberately renderer-free, so most tests need no DOM at
    // all — and node is the faster default by a wide margin. The one file that
    // does need a DOM asks for it in its own first line, with
    // `// @vitest-environment jsdom`, rather than through a glob here: the
    // reason a test needs a browser belongs in the test, and a glob would
    // quietly hand jsdom to every future .jsx whether it wanted one or not.
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
    reporters: 'default',
    // Pinned because this machine has NODE_ENV=production set globally, and
    // React picks its build from that variable at import time: the production
    // build has no `act`, so `@testing-library/react` fails with "act(...) is
    // not supported in production builds of React" on a machine that has never
    // been misconfigured for anything else. Found by the first component test.
    //
    // Set here rather than in a script so that `npx vitest`, an IDE runner and
    // CI all get the same answer. A test suite must not depend on the shape of
    // the shell it was started from.
    env: { NODE_ENV: 'test' },
  },
});
