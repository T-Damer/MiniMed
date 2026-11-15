import type { MedicalStore } from '@localmed/storage';

/**
 * Whole-pack listings of a database that does not change while the page lives (the core, keyed by
 * its checksum). A core rebuilt after a module install opens a new store on the same database and
 * asked for every listing again — on a phone 20 000 documents crossed the native bridge and were
 * decoded on the main thread each time (seconds per rebuild, performance log 0.6.104).
 */
const LISTINGS = [
  'listDocumentIdentities',
  'listAliases',
  'listNavigationDocuments',
  'listSearchDocuments',
  'listCoreIdentityNames',
] as const;
type Listing = (typeof LISTINGS)[number];

const kept = new Map<string, Map<Listing, Promise<unknown>>>();

function isListing(property: string | symbol): property is Listing {
  return typeof property === 'string' && (LISTINGS as readonly string[]).includes(property);
}

/**
 * `store` with its listings answered once per `key` in this page. Everything else goes to the
 * store itself; `initialize(seed)` (new content) forgets what was kept.
 */
export function withKeptListings<S extends MedicalStore>(store: S, key: string): S {
  let listings = kept.get(key);
  if (!listings) {
    listings = new Map();
    kept.set(key, listings);
  }
  const answers = listings;
  return new Proxy(store, {
    get(target, property) {
      // Read on the store itself, so its own accessors see the store, not this wrapper.
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      const method = value as (...args: unknown[]) => unknown;
      if (property === 'initialize') {
        return (...args: unknown[]) => {
          if (args[0] !== undefined) answers.clear();
          return method.apply(target, args);
        };
      }
      if (!isListing(property)) return method.bind(target);
      return () => {
        let answer = answers.get(property);
        if (!answer) {
          const pending = method.call(target) as Promise<unknown>;
          answer = pending;
          answers.set(property, pending);
          // A failed read is not kept: the next caller asks the store again.
          pending.catch(() => {
            if (answers.get(property) === pending) answers.delete(property);
          });
        }
        return answer;
      };
    },
  });
}

export function resetKeptListingsForTests(): void {
  kept.clear();
}
