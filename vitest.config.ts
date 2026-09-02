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
    ],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
