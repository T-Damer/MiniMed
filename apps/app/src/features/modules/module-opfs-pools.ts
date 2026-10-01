/**
 * Lifecycle of the OPFS pools that hold large module indexes (one pool per module version).
 *
 * A pool is a directory in the origin's private file system with exclusive sync-access handles,
 * owned by the worker that opened it. Its Web Lock `minimed-opfs:<pool>` (taken by
 * `opfs-pack.worker.ts`) lives as long as that worker, so a lock that is free proves that nobody
 * has the pool open and its directory may be removed.
 */

export const MODULE_POOL_PREFIX = 'minimed-module-';
/** Held (shared) by every installation between importing an index and committing its row. */
export const MODULE_STAGING_LOCK = 'minimed-module-staging';
const POOL_LOCK_PREFIX = 'minimed-opfs:';

export interface ModulePoolEnvironment {
  readonly locks: Pick<LockManager, 'request'>;
  readonly getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

function browserEnvironment(): ModulePoolEnvironment | null {
  if (typeof navigator === 'undefined' || !navigator.locks || !navigator.storage?.getDirectory) {
    return null;
  }
  return {
    locks: navigator.locks,
    getDirectory: () => navigator.storage.getDirectory(),
  };
}

export function moduleVersionKey(moduleId: string, version: string): string {
  return `${moduleId}@${version}`;
}

/** Pool name of a module index: the version, plus the index checksum when the catalog has one. */
export function moduleOpfsPoolName(
  moduleId: string,
  version: string,
  indexSha256?: string,
): string {
  const identity = indexSha256 ? `${version}:${indexSha256}` : version;
  return `${MODULE_POOL_PREFIX}${encodeURIComponent(moduleVersionKey(moduleId, identity))}`;
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'NotFoundError';
}

export type ModulePoolRemoval = 'removed' | 'absent' | 'busy';

/** Removes one pool directory unless a worker still has it open. */
export async function removeModulePool(
  poolName: string,
  environment: ModulePoolEnvironment | null = browserEnvironment(),
): Promise<ModulePoolRemoval> {
  if (!poolName.startsWith(MODULE_POOL_PREFIX)) {
    throw new Error('Only module pools may be removed.');
  }
  if (!environment) return 'absent';
  return environment.locks.request(
    `${POOL_LOCK_PREFIX}${poolName}`,
    { ifAvailable: true },
    async (lock): Promise<ModulePoolRemoval> => {
      if (!lock) return 'busy';
      const root = await environment.getDirectory();
      try {
        await root.removeEntry(`.${poolName}`, { recursive: true });
        return 'removed';
      } catch (cause) {
        if (isNotFound(cause)) return 'absent';
        throw cause;
      }
    },
  );
}

/**
 * A closed store's worker releases its pool lock a moment after `close()` resolves, so a pool that
 * is "busy" right after its owner closed is usually free a few hundred milliseconds later.
 */
export async function removeModulePoolWhenFree(
  poolName: string,
  options: { readonly attempts?: number; readonly delayMs?: number } = {},
  environment: ModulePoolEnvironment | null = browserEnvironment(),
): Promise<ModulePoolRemoval> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 300;
  let result: ModulePoolRemoval = 'busy';
  for (let attempt = 0; attempt < attempts && result === 'busy'; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await removeModulePool(poolName, environment);
  }
  return result;
}

/** Pool names present in OPFS (without the leading dot of the directory). */
export async function listModulePools(
  environment: ModulePoolEnvironment | null = browserEnvironment(),
): Promise<readonly string[]> {
  if (!environment) return [];
  const root = await environment.getDirectory();
  const names: string[] = [];
  const entries = (root as unknown as { keys(): AsyncIterable<string> }).keys();
  for await (const name of entries) {
    if (name.startsWith(`.${MODULE_POOL_PREFIX}`)) names.push(name.slice(1));
  }
  return names;
}

export interface ModulePoolSweep {
  readonly removed: readonly string[];
  readonly busy: readonly string[];
  /** True when an installation was in progress, so nothing was touched. */
  readonly deferred: boolean;
}

/**
 * Removes every module pool that no stored version refers to (a removed module, a failed or
 * abandoned installation, copies orphaned by older app versions). Pools another worker still holds
 * are reported as busy and left for a later sweep; an installation in progress defers the sweep,
 * because its freshly imported pool has no row yet.
 */
export async function sweepModulePools(
  referenced: ReadonlySet<string>,
  environment: ModulePoolEnvironment | null = browserEnvironment(),
): Promise<ModulePoolSweep> {
  if (!environment) return { removed: [], busy: [], deferred: false };
  return environment.locks.request(
    MODULE_STAGING_LOCK,
    { mode: 'exclusive', ifAvailable: true },
    async (lock): Promise<ModulePoolSweep> => {
      if (!lock) return { removed: [], busy: [], deferred: true };
      const removed: string[] = [];
      const busy: string[] = [];
      for (const name of await listModulePools(environment)) {
        if (referenced.has(name)) continue;
        const result = await removeModulePool(name, environment);
        if (result === 'removed') removed.push(name);
        else if (result === 'busy') busy.push(name);
      }
      return { removed, busy, deferred: false };
    },
  );
}

/**
 * Holds the shared staging lock until the returned function is called. Installations take it when
 * they put an index into OPFS, so a concurrent sweep cannot mistake it for an orphan.
 */
export async function holdModuleStagingLock(
  environment: ModulePoolEnvironment | null = browserEnvironment(),
): Promise<() => void> {
  if (!environment) return () => undefined;
  let release: () => void = () => undefined;
  await new Promise<void>((acquired, failed) => {
    environment.locks
      .request(MODULE_STAGING_LOCK, { mode: 'shared' }, () => {
        acquired();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(failed);
  });
  return () => release();
}
