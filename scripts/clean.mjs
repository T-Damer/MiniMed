import { rm } from 'node:fs/promises';

const paths = [
  'apps/app/dist',
  'apps/landing/dist',
  'coverage',
  'playwright-report',
  'test-results',
  'data/build/core-demo.db',
  'data/build/core-demo-report.json',
  'data/build/search-benchmark.json',
  'data/build/verification-report.md',
  'tools/benchmarks/tsconfig.tsbuildinfo',
];

await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })));
