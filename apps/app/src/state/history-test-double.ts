/**
 * A small stand-in for the browser's session history, for the navigation unit tests: a list of
 * entries with their state and address, a cursor, `pushState` / `replaceState` / `back` /
 * `forward` / `go`, `location.hash`, and the `popstate` / `hashchange` events.
 *
 * Like the browser, a traversal is asynchronous (it lands on a later microtask): tests `await
 * settle()` after a step. `pushState` and `replaceState` raise no events; assigning
 * `location.hash` raises both, as a fragment navigation does.
 */
import { vi } from 'vitest';

interface FakeEntry {
  state: unknown;
  search: string;
  hash: string;
}

export interface FakeBrowserOptions {
  /** Whether the Navigation API exists (Chromium) or not (the length heuristic is then used). */
  readonly navigationApi?: boolean;
}

export interface FakeBrowser {
  readonly entries: FakeEntry[];
  readonly cursor: () => number;
  /** Lets queued traversals land (and their events run). */
  readonly settle: () => Promise<void>;
  readonly hashes: () => string[];
  readonly restore: () => void;
}

export function installFakeBrowser(
  initial = { hash: '', search: '' },
  options: FakeBrowserOptions = {},
): FakeBrowser {
  const navigationApi = options.navigationApi ?? true;
  const navigationListeners = new Map<string, Set<(event: Event) => void>>();
  const fireNavigation = (event: Event): void => {
    for (const listener of [...(navigationListeners.get(event.type) ?? [])]) listener(event);
  };
  const announce = (navigationType: string): void => {
    if (!navigationApi) return;
    fireNavigation(Object.assign(new Event('navigate'), { navigationType }));
  };
  /** The commit of a navigation, as the Navigation API reports it. */
  const committed = (): void => {
    if (navigationApi) fireNavigation(new Event('currententrychange'));
  };
  const entries: FakeEntry[] = [{ state: null, ...initial }];
  let index = 0;
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const emit = (name: string, event: Event = new Event(name)): void => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event);
  };
  const queue: Array<() => void> = [];
  const settle = async (): Promise<void> => {
    while (queue.length > 0) {
      queue.shift()?.();
      await Promise.resolve();
    }
    await Promise.resolve();
  };
  const current = (): FakeEntry => entries[index] as FakeEntry;
  const apply = (target: number): void => {
    if (target < 0 || target >= entries.length || target === index) return;
    const hashBefore = current().hash;
    announce('traverse');
    index = target;
    committed();
    emit('popstate');
    if (current().hash !== hashBefore) emit('hashchange');
  };
  const parse = (url: string): { search: string; hash: string } => {
    const parsed = new URL(url, 'http://127.0.0.1/app');
    return { search: parsed.search, hash: parsed.hash };
  };
  const location = {
    get hash(): string {
      return current().hash;
    },
    set hash(value: string) {
      announce(value === current().hash ? 'replace' : 'push');
      entries.splice(index + 1);
      entries.push({ state: null, search: current().search, hash: value });
      index += 1;
      committed();
      queue.push(() => {
        emit('popstate');
        emit('hashchange');
      });
    },
    get search(): string {
      return current().search;
    },
    get pathname(): string {
      return '/app';
    },
    get origin(): string {
      return 'http://127.0.0.1';
    },
    get href(): string {
      return `http://127.0.0.1/app${current().search}${current().hash}`;
    },
  };
  const history = {
    get state(): unknown {
      return current().state;
    },
    get length(): number {
      return entries.length;
    },
    scrollRestoration: 'auto',
    pushState(state: unknown, _title: string, url?: string | URL): void {
      const next = url === undefined ? parse(location.href) : parse(String(url));
      announce('push');
      entries.splice(index + 1);
      entries.push({ state, ...next });
      index += 1;
      committed();
    },
    replaceState(state: unknown, _title: string, url?: string | URL): void {
      announce('replace');
      const entry = current();
      entry.state = state;
      if (url !== undefined) Object.assign(entry, parse(String(url)));
      committed();
    },
    back(): void {
      const target = index - 1;
      queue.push(() => apply(target));
    },
    forward(): void {
      const target = index + 1;
      queue.push(() => apply(target));
    },
    go(delta: number): void {
      const target = index + delta;
      queue.push(() => apply(target));
    },
  };
  vi.stubGlobal('window', {
    location,
    history,
    ...(navigationApi
      ? {
          navigation: {
            addEventListener: (type: string, listener: (event: Event) => void) => {
              const set = navigationListeners.get(type) ?? new Set();
              set.add(listener);
              navigationListeners.set(type, set);
            },
            removeEventListener: (type: string, listener: (event: Event) => void) => {
              navigationListeners.get(type)?.delete(listener);
            },
          },
        }
      : {}),
    addEventListener: (name: string, listener: (event: Event) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
    },
    removeEventListener: (name: string, listener: (event: Event) => void) => {
      listeners.get(name)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      emit(event.type, event);
      return true;
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal(
    'HashChangeEvent',
    class extends Event {
      readonly oldURL: string;
      readonly newURL: string;
      constructor(type: string, init?: { oldURL?: string; newURL?: string }) {
        super(type);
        this.oldURL = init?.oldURL ?? '';
        this.newURL = init?.newURL ?? '';
      }
    },
  );
  return {
    entries,
    cursor: () => index,
    settle,
    hashes: () => entries.map((entry) => entry.hash),
    restore: () => vi.unstubAllGlobals(),
  };
}
