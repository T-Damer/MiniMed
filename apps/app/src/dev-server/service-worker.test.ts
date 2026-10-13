import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { injectServiceWorkerBuild, type ServiceWorkerBuild } from './service-worker-precache';

const SOURCE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://example.test/MiniMed/app/';
const url = (path: string): string => new URL(path, SCOPE).href;

function createBuild(id: string, overrides: Partial<ServiceWorkerBuild> = {}): ServiceWorkerBuild {
  return {
    id,
    version: '0.6.60',
    precache: ['index.html', 'manifest.webmanifest', `assets/main-${id}.js`, 'assets/shared-S1.js'],
    optional: ['assets/ort-wasm-X.wasm'],
    optionalPrefixes: ['pdfjs/'],
    precacheBytes: 0,
    ...overrides,
  };
}

type Listener = (event: never) => void;

class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(key: string | Request): Promise<Response | undefined> {
    const hit = this.entries.get(typeof key === 'string' ? key : key.url);
    if (!hit) return undefined;
    const copy = hit.clone();
    Object.defineProperty(copy, 'url', { value: hit.url });
    return copy;
  }
  async put(key: string | Request, response: Response): Promise<void> {
    // A stored response keeps the address it was fetched from, like the real Cache.
    const address = typeof key === 'string' ? key : key.url;
    Object.defineProperty(response, 'url', { value: address });
    this.entries.set(address, response);
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((key) => new Request(key));
  }
  async delete(key: string | Request): Promise<boolean> {
    return this.entries.delete(typeof key === 'string' ? key : key.url);
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}

interface Network {
  /** Absolute URL -> body; a missing URL answers 404, `offline` rejects every request. */
  readonly files: Map<string, string>;
  /** Extra response headers per absolute URL. */
  readonly headers: Map<string, Record<string, string>>;
  offline: boolean;
  readonly requests: Request[];
}

interface Harness {
  readonly caches: FakeCacheStorage;
  readonly network: Network;
  readonly claim: ReturnType<typeof vi.fn>;
  readonly skipWaiting: ReturnType<typeof vi.fn>;
  install(): Promise<void>;
  activate(): Promise<void>;
  /** Resolves with the response, or undefined when the worker left the request alone. */
  fetch(
    request: Partial<Request> & { url: string },
  ): Promise<{ response: Response | undefined; pending: Promise<unknown>[] }>;
  message(data: unknown): void;
}

function createWorker(
  build: ServiceWorkerBuild | null,
  caches = new FakeCacheStorage(),
  network: Network = { files: new Map(), headers: new Map(), offline: false, requests: [] },
): Harness {
  const listeners = new Map<string, Listener>();
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn();
  const self = {
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin },
    clients: { claim },
    skipWaiting,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  const fetchStub = async (input: string | Request): Promise<Response> => {
    const request = typeof input === 'string' ? new Request(input) : input;
    network.requests.push(request);
    if (network.offline) throw new TypeError('Failed to fetch');
    const body = network.files.get(request.url);
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body, { headers: network.headers.get(request.url) ?? {} });
  };
  const source = build ? injectServiceWorkerBuild(SOURCE, build) : SOURCE;
  runInNewContext(source, { self, caches, fetch: fetchStub, Request, Response, URL, Number });
  const dispatchLifecycle = async (type: 'install' | 'activate'): Promise<void> => {
    const pending: Promise<unknown>[] = [];
    (listeners.get(type) as (event: unknown) => void)({
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  };
  return {
    caches,
    network,
    claim,
    skipWaiting,
    install: () => dispatchLifecycle('install'),
    activate: () => dispatchLifecycle('activate'),
    async fetch(request) {
      const pending: Promise<unknown>[] = [];
      let answer: Promise<Response> | undefined;
      (listeners.get('fetch') as (event: unknown) => void)({
        request: { method: 'GET', mode: 'cors', headers: new Headers(), ...request },
        respondWith: (promise: Promise<Response>) => {
          answer = promise;
        },
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });
      const response = await answer;
      await Promise.all(pending);
      return { response, pending };
    },
    message: (data) => (listeners.get('message') as (event: unknown) => void)({ data }),
  };
}

function publish(network: Network, build: ServiceWorkerBuild, bodySuffix = ''): void {
  for (const path of [...build.precache, ...build.optional, 'pdfjs/wasm/openjpeg.wasm']) {
    network.files.set(url(path), `${path}${bodySuffix}`);
  }
}

async function installed(build = createBuild('a1')): Promise<Harness> {
  const worker = createWorker(build);
  publish(worker.network, build);
  await worker.install();
  await worker.activate();
  return worker;
}

describe('service worker install', () => {
  it('stores every file of the build in the cache of that build', async () => {
    const worker = await installed(createBuild('a1'));
    const cache = worker.caches.stores.get('minimed-shell-a1');
    expect([...(cache?.entries.keys() ?? [])].sort()).toEqual(
      createBuild('a1').precache.map(url).sort(),
    );
    // Optional files (ONNX, pdf.js) are not fetched at install.
    expect(worker.network.requests.map((request) => request.url)).not.toContain(
      url('assets/ort-wasm-X.wasm'),
    );
  });

  it('loads the page and the manifest past the HTTP cache, hashed chunks through it', async () => {
    const worker = await installed(createBuild('a1'));
    const cacheModeOf = (path: string) =>
      worker.network.requests.find((request) => request.url === url(path))?.cache;
    expect(cacheModeOf('index.html')).toBe('reload');
    expect(cacheModeOf('assets/main-a1.js')).toBe('default');
  });

  it('fails when one file is missing, so a half-cached build never becomes the active one', async () => {
    const build = createBuild('a1');
    const worker = createWorker(build);
    publish(worker.network, build);
    worker.network.files.delete(url('assets/shared-S1.js'));
    await expect(worker.install()).rejects.toThrow(/assets\/shared-S1\.js/u);
  });

  it('reuses unchanged hashed chunks of the previous build instead of downloading them again', async () => {
    const caches = new FakeCacheStorage();
    const first = createWorker(createBuild('a1'), caches);
    publish(first.network, createBuild('a1'));
    await first.install();

    const next = createBuild('b2');
    const second = createWorker(next, caches);
    publish(second.network, next);
    await second.install();

    const downloaded = second.network.requests.map((request) => request.url);
    expect(downloaded).not.toContain(url('assets/shared-S1.js'));
    expect(downloaded).toContain(url('assets/main-b2.js'));
    expect(downloaded).toContain(url('index.html'));
    expect(caches.stores.get('minimed-shell-b2')?.entries.has(url('assets/shared-S1.js'))).toBe(
      true,
    );
  });

  it('does nothing in development, where the build list is not injected', async () => {
    const worker = createWorker(null);
    await worker.install();
    await worker.activate();
    expect(worker.network.requests).toHaveLength(0);
    expect(worker.caches.stores.size).toBe(0);
    const { response } = await worker.fetch({ url: url('assets/main-a1.js') });
    expect(response).toBeUndefined();
  });
});

describe('service worker activation', () => {
  it('removes caches of other builds and the former shell cache, keeps the diary cache', async () => {
    const caches = new FakeCacheStorage();
    for (const name of [
      'minimed-shell-old',
      'localmed-shell-0.6.40',
      'minimed-diary-v3',
      'unrelated',
    ]) {
      await caches.open(name);
    }
    const build = createBuild('a1');
    const worker = createWorker(build, caches);
    publish(worker.network, build);
    await worker.install();
    await worker.activate();
    expect([...caches.stores.keys()].sort()).toEqual([
      'minimed-diary-v3',
      'minimed-runtime-v1',
      'minimed-shell-a1',
      'unrelated',
    ]);
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });

  it('drops runtime files that the new build no longer ships', async () => {
    const caches = new FakeCacheStorage();
    const runtime = await caches.open('minimed-runtime-v1');
    await runtime.put(url('assets/ort-wasm-OLD.wasm'), new Response('old'));
    await runtime.put(url('assets/ort-wasm-X.wasm'), new Response('current'));
    const build = createBuild('a1');
    const worker = createWorker(build, caches);
    publish(worker.network, build);
    await worker.install();
    await worker.activate();
    expect([...runtime.entries.keys()]).toEqual([url('assets/ort-wasm-X.wasm')]);
  });

  it('waits for the page before replacing the running worker', async () => {
    const worker = await installed();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.message({ type: 'UNRELATED' });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.message({ type: 'SKIP_WAITING' });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('service worker requests while offline', () => {
  it('opens the app page for the scope root, index.html and a query string', async () => {
    const worker = await installed();
    worker.network.offline = true;
    for (const address of [SCOPE, url('index.html'), `${SCOPE}?utm=1`]) {
      const { response } = await worker.fetch({ url: address, mode: 'navigate' });
      expect(await response?.text(), address).toBe('index.html');
    }
  });

  it('leaves the patient diary and foreign paths to their own worker', async () => {
    const worker = await installed();
    for (const address of [url('diary/'), url('diary/index.html'), url('other/page')]) {
      const { response } = await worker.fetch({ url: address, mode: 'navigate' });
      expect(response, address).toBeUndefined();
    }
  });

  it('serves lazy chunks from the cache of the build', async () => {
    const worker = await installed();
    worker.network.offline = true;
    const { response } = await worker.fetch({ url: url('assets/shared-S1.js') });
    expect(await response?.text()).toBe('assets/shared-S1.js');
  });

  it('keeps an optional file after its first use and serves it offline from then on', async () => {
    const worker = await installed();
    const address = url('assets/ort-wasm-X.wasm');
    const first = await worker.fetch({ url: address });
    expect(await first.response?.text()).toBe('assets/ort-wasm-X.wasm');
    worker.network.offline = true;
    const again = await worker.fetch({ url: address });
    expect(await again.response?.text()).toBe('assets/ort-wasm-X.wasm');
    // A file of an optional kind that was never opened is not there offline.
    await expect(worker.fetch({ url: url('pdfjs/wasm/openjpeg.wasm') })).rejects.toThrow(
      /Failed to fetch/u,
    );
  });

  it('does not keep an optional file larger than the runtime limit', async () => {
    const worker = await installed();
    const address = url('assets/ort-wasm-X.wasm');
    worker.network.headers.set(address, { 'content-length': String(80 * 1024 * 1024) });
    const first = await worker.fetch({ url: address });
    expect(first.response?.ok).toBe(true);
    expect(worker.caches.stores.get('minimed-runtime-v1')?.entries.size).toBe(0);
    worker.network.offline = true;
    await expect(worker.fetch({ url: address })).rejects.toThrow(/Failed to fetch/u);
  });

  it('never answers for content packs, other origins, writes or range requests', async () => {
    const worker = await installed();
    const cases: Array<Partial<Request> & { url: string }> = [
      { url: url('content/core.db') },
      { url: url('content/modules/minimed-tools-1.db') },
      { url: 'https://cdn.example.test/assets/main-a1.js' },
      { url: url('assets/main-a1.js'), method: 'POST' },
      { url: url('assets/main-a1.js'), headers: new Headers({ range: 'bytes=0-9' }) },
      { url: url('assets/unlisted-chunk.js') },
    ];
    for (const request of cases) {
      const { response } = await worker.fetch(request);
      expect(response, `${request.method ?? 'GET'} ${request.url}`).toBeUndefined();
    }
  });

  it('keeps the asked-for query on a cached script, which workers read from their address', async () => {
    const worker = await installed();
    worker.network.offline = true;
    const exact = await worker.fetch({ url: url('assets/shared-S1.js') });
    expect(exact.response?.url).toBe(url('assets/shared-S1.js'));
    const asked = await worker.fetch({ url: `${url('assets/shared-S1.js')}?vfs=opfs` });
    expect(await asked.response?.text()).toBe('assets/shared-S1.js');
    // No address of its own: the browser gives the response the address of the request.
    expect(asked.response?.url).toBe('');
  });

  it('answers with the network when a listed file is somehow missing from the cache', async () => {
    const worker = await installed();
    worker.caches.stores.get('minimed-shell-a1')?.entries.delete(url('assets/shared-S1.js'));
    const { response } = await worker.fetch({ url: url('assets/shared-S1.js') });
    expect(await response?.text()).toBe('assets/shared-S1.js');
  });
});

describe('service worker update', () => {
  it('keeps serving the old build while the new one waits, then switches after activation', async () => {
    const caches = new FakeCacheStorage();
    const oldBuild = createBuild('a1');
    const oldWorker = createWorker(oldBuild, caches);
    publish(oldWorker.network, oldBuild);
    await oldWorker.install();
    await oldWorker.activate();

    const newBuild = createBuild('b2');
    const newWorker = createWorker(newBuild, caches, oldWorker.network);
    publish(newWorker.network, newBuild, '-new');
    await newWorker.install();

    // Both caches exist; the running (old) worker still answers from its own build.
    expect([...caches.stores.keys()]).toContain('minimed-shell-a1');
    expect([...caches.stores.keys()]).toContain('minimed-shell-b2');
    oldWorker.network.offline = true;
    const old = await oldWorker.fetch({ url: SCOPE, mode: 'navigate' });
    expect(await old.response?.text()).toBe('index.html');

    await newWorker.activate();
    expect([...caches.stores.keys()]).not.toContain('minimed-shell-a1');
    const current = await newWorker.fetch({ url: SCOPE, mode: 'navigate' });
    expect(await current.response?.text()).toBe('index.html-new');
  });
});
