import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Specs built on files under `data/` (local, ignored builds) cannot run in a fresh checkout or a
 * worktree. Returns a skip reason naming the missing files, or `undefined` when all exist; use it
 * as `test.skip(reason !== undefined, reason)` at the top of the spec.
 */
export function missingLocalData(...paths: readonly string[]): string | undefined {
  const missing = paths.filter((path) => !existsSync(resolve(ROOT, path)));
  return missing.length === 0
    ? undefined
    : `Needs local data that is not in this checkout: ${missing.join(', ')}`;
}
