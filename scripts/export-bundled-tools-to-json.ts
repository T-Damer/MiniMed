#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const result = spawnSync(
  'bunx',
  ['vitest', 'run', 'apps/app/src/scripts/export-bundled-tools-to-json.test.ts'],
  { cwd: repoRoot, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
