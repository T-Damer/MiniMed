import { describe, expect, it } from 'vitest';
import {
  holdModuleStagingLock,
  listModulePools,
  MODULE_STAGING_LOCK,
  type ModulePoolEnvironment,
  moduleOpfsPoolName,
  removeModulePool,
  removeModulePoolWhenFree,
  sweepModulePools,
} from './module-opfs-pools';

/** An OPFS root and a Web Locks manager with just enough behaviour for the pool lifecycle. */
function fakeEnvironment(initialPools: readonly string[]) {
  const directories = new Set(initialPools.map((name) => `.${name}`));
  directories.add('.minimed-sah-core');
  directories.add('unrelated.txt');
  const exclusive = new Set<string>();
  const shared = new Map<string, number>();
  const removed: string[] = [];
  const environment: ModulePoolEnvironment = {
    locks: {
      request: (async (
        name: string,
        options: { mode?: string; ifAvailable?: boolean },
        callback: (lock: unknown) => Promise<unknown>,
      ) => {
        const mode = options.mode ?? 'exclusive';
        const free =
          mode === 'shared' ? !exclusive.has(name) : !exclusive.has(name) && !shared.get(name);
        if (!free) {
          if (options.ifAvailable) return callback(null);
          throw new Error('would block');
        }
        if (mode === 'shared') shared.set(name, (shared.get(name) ?? 0) + 1);
        else exclusive.add(name);
        try {
          return await callback({ name });
        } finally {
          if (mode === 'shared') shared.set(name, (shared.get(name) ?? 1) - 1);
          else exclusive.delete(name);
        }
      }) as unknown as LockManager['request'],
    },
    getDirectory: async () =>
      ({
        keys: async function* () {
          yield* directories;
        },
        removeEntry: async (name: string) => {
          if (!directories.delete(name)) throw new DOMException('absent', 'NotFoundError');
          removed.push(name);
        },
      }) as unknown as FileSystemDirectoryHandle,
  };
  return { environment, directories, exclusive, shared, removed };
}

const A = moduleOpfsPoolName('minimed.a', '1.0.0', `sha256:${'a'.repeat(64)}`);
const B = moduleOpfsPoolName('minimed.b', '2.0.0');
const C = moduleOpfsPoolName('minimed.c', '1.0.0');

describe('module OPFS pools', () => {
  it('names pools after the version and the decoded index checksum', () => {
    expect(A).toBe(`minimed-module-minimed.a%401.0.0%3Asha256%3A${'a'.repeat(64)}`);
    expect(B).toBe('minimed-module-minimed.b%402.0.0');
    expect(moduleOpfsPoolName('minimed.a', '1.0.0', `sha256:${'b'.repeat(64)}`)).not.toBe(A);
  });

  it('lists only module pools, never the core or companion pools', async () => {
    const { environment } = fakeEnvironment([A, B]);
    expect(await listModulePools(environment)).toEqual([A, B]);
  });

  it('removes a free pool, leaves one a worker holds and reports an absent one', async () => {
    const { environment, directories, exclusive } = fakeEnvironment([A, B]);
    exclusive.add(`minimed-opfs:${B}`);
    expect(await removeModulePool(A, environment)).toBe('removed');
    expect(await removeModulePool(B, environment)).toBe('busy');
    expect(await removeModulePool(C, environment)).toBe('absent');
    expect([...directories]).toContain(`.${B}`);
    expect([...directories]).not.toContain(`.${A}`);
    await expect(removeModulePool('minimed-sah-core', environment)).rejects.toThrow(
      'Only module pools',
    );
  });

  it('waits a moment for a just-closed worker to release its pool, then gives up', async () => {
    const { environment, exclusive, directories } = fakeEnvironment([A, B]);
    exclusive.add(`minimed-opfs:${A}`);
    exclusive.add(`minimed-opfs:${B}`);
    setTimeout(() => exclusive.delete(`minimed-opfs:${A}`), 20);
    expect(await removeModulePoolWhenFree(A, { attempts: 10, delayMs: 10 }, environment)).toBe(
      'removed',
    );
    expect(await removeModulePoolWhenFree(B, { attempts: 3, delayMs: 1 }, environment)).toBe(
      'busy',
    );
    expect(directories.has(`.${B}`)).toBe(true);
  });

  it('sweeps only unreferenced pools', async () => {
    const { environment, directories } = fakeEnvironment([A, B, C]);
    const result = await sweepModulePools(new Set([A]), environment);
    expect(result).toEqual({ removed: [B, C], busy: [], deferred: false });
    expect([...directories].sort()).toEqual(['.minimed-sah-core', `.${A}`, 'unrelated.txt'].sort());
  });

  it('reports a pool in use as busy and removes it on a later sweep', async () => {
    const { environment, exclusive } = fakeEnvironment([A, B]);
    exclusive.add(`minimed-opfs:${B}`);
    expect(await sweepModulePools(new Set([A]), environment)).toEqual({
      removed: [],
      busy: [B],
      deferred: false,
    });
    exclusive.delete(`minimed-opfs:${B}`);
    expect((await sweepModulePools(new Set([A]), environment)).removed).toEqual([B]);
  });

  it('defers the whole sweep while an installation holds the staging lock', async () => {
    const { environment, directories, removed } = fakeEnvironment([A, B]);
    const release = await holdModuleStagingLock(environment);
    expect(await sweepModulePools(new Set(), environment)).toEqual({
      removed: [],
      busy: [],
      deferred: true,
    });
    expect(removed).toEqual([]);
    expect(directories.has(`.${A}`)).toBe(true);
    release();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await sweepModulePools(new Set(), environment)).removed).toEqual([A, B]);
    expect(MODULE_STAGING_LOCK).toBe('minimed-module-staging');
  });

  it('does nothing where OPFS or Web Locks are unavailable', async () => {
    expect(await listModulePools(null)).toEqual([]);
    expect(await removeModulePool(A, null)).toBe('absent');
    expect(await sweepModulePools(new Set(), null)).toEqual({
      removed: [],
      busy: [],
      deferred: false,
    });
    await expect(holdModuleStagingLock(null)).resolves.toBeTypeOf('function');
  });
});
