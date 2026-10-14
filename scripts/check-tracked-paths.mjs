#!/usr/bin/env bun
// Fails when git tracks something that must stay local: a symlink (an agent worktree once committed
// `output -> /…/MiniMed/output`; a pull then replaced the ignored release copies with that link and
// git deleted them, 2026-10-14) or any path under the local data roots.
import { spawnSync } from 'node:child_process';

const LOCAL_ROOTS = ['output', 'data/raw/', 'data/build/', 'data/intermediate/', 'data/synced/'];
const ALLOWED = new Set([
  'data/raw/.gitkeep',
  'data/build/.gitkeep',
  'data/intermediate/.gitkeep',
  'data/synced/.gitkeep',
]);

const listed = spawnSync('git', ['ls-files', '-s', '-z'], { encoding: 'utf8' });
if (listed.status !== 0) {
  console.error(listed.stderr);
  process.exit(1);
}
const problems = [];
for (const entry of listed.stdout.split('\0').filter(Boolean)) {
  const [meta, path] = entry.split('\t');
  const mode = meta?.split(' ')[0];
  if (!path) continue;
  if (mode === '120000') problems.push(`symlink tracked: ${path}`);
  else if (!ALLOWED.has(path) && LOCAL_ROOTS.some((root) => path === root || path.startsWith(root)))
    problems.push(`local data tracked: ${path}`);
}
if (problems.length > 0) {
  console.error(
    `Tracked paths that must stay local (git rm --cached them):\n${problems.join('\n')}`,
  );
  process.exit(1);
}
console.log('tracked paths: no symlinks, no local data');
