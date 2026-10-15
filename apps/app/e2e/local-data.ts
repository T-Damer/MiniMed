import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

/**
 * The checkout that holds the local, ignored data (`data/`, `output/` release copies). An agent
 * worktree (`<main>/.claude/worktrees/<name>`) reads them from the main checkout by absolute path;
 * never detect it by the presence of `output/`, which a test run creates (screenshots) and so would
 * flip the root to the worktree in the middle of a run.
 */
export const LOCAL_DATA_ROOT = ROOT.includes(`${sep}.claude${sep}worktrees${sep}`)
  ? resolve(ROOT, '../../..')
  : ROOT;

/**
 * Specs built on files under `data/` (local, ignored builds) cannot run in a fresh checkout or a
 * worktree. Returns a skip reason naming the missing files, or `undefined` when all exist; use it
 * as `test.skip(reason !== undefined, reason)` at the top of the spec.
 */
export function missingLocalData(...paths: readonly string[]): string | undefined {
  const missing = paths.filter((path) => !existsSync(resolve(LOCAL_DATA_ROOT, path)));
  return missing.length === 0
    ? undefined
    : `Needs local data that is not in this checkout: ${missing.join(', ')}`;
}
