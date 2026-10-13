import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const appSrc = fileURLToPath(new URL('./apps/app/src', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@': appSrc,
    },
  },
  test: {
    environment: 'node',
    // Hang guards, not performance budgets: a case that imports a large module graph needs a
    // transform first, and 570 files run in parallel on a shared machine. Speed is checked by
    // `bun run benchmark:all`, never by a unit-test clock.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: [
      'packages/**/tests/**/*.test.ts',
      'packages/**/src/**/*.test.ts',
      'apps/app/src/**/*.test.ts',
      'apps/landing/src/**/*.test.ts',
      'tools/benchmarks/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
