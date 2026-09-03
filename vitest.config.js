import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The engine is deliberately renderer-free, so most tests need no DOM at
    // all. Component tests that do get jsdom via an environmentMatchGlob later.
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
    reporters: 'default',
  },
});
