import type { MedicalStore, StorageHealth } from '@localmed/storage';

import type { ShelfFacts, ShelfFactsStore } from '@/composition/module-shelf-facts';

/**
 * A large module (a drug set: its own OPFS pool and worker) mounted without being opened. The 13
 * large sets were opened and initialised at every start — 5–7 s of opening and as much again of
 * initialising on a phone (performance log 0.6.109) — although a module file never changes: its
 * pool name carries the version and the checksum. What the search core asks of every mounted store
 * while it starts (health, whole-pack listings) is kept per file and per app build, the same way
 * the module shelf keeps it for the small sets; the file itself is opened by the first call that
 * needs it, or in the background a little after the start ({@link warmDeferredModuleStores}).
 */
const KEPT_LISTINGS = [
  'listDocumentIdentities',
  'listAliases',
  'listNavigationDocuments',
  'listSearchDocuments',
  'listCoreIdentityNames',
  'listEmbeddingProfiles',
] as const;
type KeptListing = (typeof KEPT_LISTINGS)[number];

function isKeptListing(property: string | symbol): property is KeptListing {
  return typeof property === 'string' && (KEPT_LISTINGS as readonly string[]).includes(property);
}

export interface DeferredModuleStoreOptions {
  /** The file's name in the facts store: unique per module version and checksum. */
  readonly key: string;
  readonly facts: ShelfFactsStore;
  /** What an earlier start kept about this file, if anything. */
  readonly kept: ShelfFacts | undefined;
  /** Opens the real store; called once. */
  readonly open: () => Promise<MedicalStore>;
  /**
   * The methods the real store has. Callers probe optional store methods by truthiness
   * (`store.scoreVectors && …`), so only these are offered.
   */
  readonly methods: ReadonlySet<string>;
}

/** Stores mounted from kept facts whose file is not open yet, in mount order. */
const waiting = new Set<() => Promise<unknown>>();

/**
 * Opens the files mounted from kept facts, a few at a time, so the first search or document does
 * not wait for a cold file. Called once the start has settled.
 */
export async function warmDeferredModuleStores(concurrency = 2): Promise<void> {
  const queue = [...waiting];
  const next = async (): Promise<void> => {
    for (let open = queue.shift(); open; open = queue.shift()) {
      // A file that does not open is reported by the call that needs it; warming goes on.
      await open().catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, next));
}

export function createDeferredModuleStore(options: DeferredModuleStoreOptions): MedicalStore {
  const kept: { health?: StorageHealth | undefined; listings: Record<string, unknown> } = {
    ...(options.kept?.health ? { health: options.kept.health } : {}),
    listings: { ...options.kept?.listings },
  };
  let opened: Promise<MedicalStore> | undefined;
  let closed = false;

  const remember = (): void => {
    options.facts.save(options.key, {
      ...(kept.health ? { health: kept.health } : {}),
      listings: kept.listings,
    });
  };
  /** The real store, opened and initialised once. */
  const real = (): Promise<MedicalStore> => {
    if (closed) return Promise.reject(new Error('The module store is closed.'));
    if (!opened) {
      waiting.delete(real);
      const pending = options.open().then(async (store) => {
        try {
          const health = await store.initialize();
          if (!kept.health) {
            kept.health = health;
            remember();
          }
          return store;
        } catch (cause) {
          await store.close();
          throw cause;
        }
      });
      opened = pending;
      pending.catch(() => {
        // The file did not open: what was kept about it is not trusted at the next start.
        options.facts.save(options.key, {});
        if (opened === pending) opened = undefined;
      });
    }
    return opened;
  };
  if (kept.health) waiting.add(real);

  const target = {} as MedicalStore;
  return new Proxy(target, {
    get(_target, property) {
      if (typeof property !== 'string' || !options.methods.has(property)) return undefined;
      if (property === 'initialize') {
        return async (seed?: unknown): Promise<StorageHealth> => {
          if (seed !== undefined) {
            kept.health = undefined;
            kept.listings = {};
            const store = await real();
            const health = await store.initialize(seed as never);
            kept.health = health;
            remember();
            return health;
          }
          if (kept.health && !closed) return kept.health;
          await real();
          if (!kept.health) throw new Error('The module store reported no health.');
          return kept.health;
        };
      }
      if (property === 'getHealth') {
        return async (): Promise<StorageHealth> => {
          if (kept.health && !closed) return kept.health;
          const health = await (await real()).getHealth();
          kept.health = health;
          remember();
          return health;
        };
      }
      if (property === 'close') {
        return async (): Promise<void> => {
          if (closed) return;
          closed = true;
          waiting.delete(real);
          const pending = opened;
          opened = undefined;
          if (pending) await (await pending).close();
        };
      }
      if (isKeptListing(property)) {
        return async (): Promise<unknown> => {
          if (property in kept.listings && !closed) return kept.listings[property];
          const store = await real();
          const method = store[property] as (() => Promise<unknown>) | undefined;
          // An optional listing the store does not have: the caller's own fallback applies.
          if (typeof method !== 'function') throw new Error(`The store has no ${property}.`);
          const answer = await method.call(store);
          kept.listings[property] = answer;
          remember();
          return answer;
        };
      }
      return async (...args: unknown[]): Promise<unknown> => {
        const store = await real();
        const method = (store as unknown as Record<string, unknown>)[property];
        if (typeof method !== 'function') {
          throw new Error(`The module store has no method ${property}.`);
        }
        return (method as (...values: unknown[]) => unknown).apply(store, args);
      };
    },
    has(_target, property) {
      return typeof property === 'string' && options.methods.has(property);
    },
  });
}

export function resetDeferredModuleStoresForTests(): void {
  waiting.clear();
}
