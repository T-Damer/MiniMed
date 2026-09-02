import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const contractsEntry = fileURLToPath(
  new URL('../../packages/contracts/src/index.ts', import.meta.url),
);

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: {
      '@localmed/contracts': contractsEntry,
    },
  },
  test: {
    environment: 'node',
    include: ['tools/benchmarks/src/**/*.test.ts'],
  },
});
