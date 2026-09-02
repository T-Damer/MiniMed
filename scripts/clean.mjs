import { rm } from 'node:fs/promises';

const paths = [
  'apps/app/dist',
  'apps/landing/dist',
  'coverage',
  'playwright-report',
  'test-results',
  'data/build/core.db',
  'data/build/core-report.json',
  'data/build/search-benchmark.json',
  'data/build/verification-report.md',
  'tools/benchmarks/tsconfig.tsbuildinfo',
];

await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })));
