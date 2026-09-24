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
    include: [
      'packages/**/tests/**/*.test.ts',
      'packages/**/src/**/*.test.ts',
      'apps/app/src/**/*.test.ts',
      'tools/benchmarks/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      // The committed base64 parts (2026-07-30) fail gzip CRC: the fixture was truncated on upload
      // and must be regenerated from its source before this suite can run again.
      'tools/benchmarks/src/hard-query-dataset.test.ts',
    ],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
