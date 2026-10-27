// MiniMed app service worker (browser build only). The Capacitor shells load their assets from the
// device and never register it (state/app-update.ts).
//
// What it does: precaches the app shell and every script, style, font and small wasm of ONE build
// (the list is injected at build time by dev-server/service-worker-precache.ts), so the whole UI
// opens offline after the first visit, offline reloads included. Content packs, modules and models
// are never cached here: they live in OPFS/IndexedDB and `content/` bypasses this worker.
//
// Update flow: a new build is a new, byte-different sw.js with its own cache. It installs in the
// background and waits; the page shows «Доступно обновление» and only then posts SKIP_WAITING. Old
// caches are deleted on activation.
//
// The placeholder below becomes a JSON object in dist/sw.js. In `vite dev` it stays null and the
// worker stays out of the way.
const BUILD = /*__MINIMED_BUILD__*/ null;

const SHELL_PREFIX = 'minimed-shell-';
const LEGACY_SHELL_PREFIXES = ['localmed-shell-'];
const RUNTIME_CACHE = 'minimed-runtime-v1';
const INSTALL_CONCURRENCY = 8;
// A lazily loaded asset above this size (models, ONNX) is used from the network and not kept.
const RUNTIME_MAX_BYTES = 40 * 1024 * 1024;

const scope = self.registration.scope;
const shellCacheName = BUILD ? `${SHELL_PREFIX}${BUILD.id}` : '';

function absolute(path) {
  return new URL(path, scope).href;
}

// Hashed files (`assets/*`) never change under one name, so a new build may reuse the old copy.
function isImmutable(path) {
  return path.startsWith('assets/');
}

const precacheUrls = new Map();
const optionalUrls = new Set();
const optionalPrefixes = [];
if (BUILD) {
  for (const path of BUILD.precache) precacheUrls.set(absolute(path), path);
  for (const path of BUILD.optional) optionalUrls.add(absolute(path));
  for (const prefix of BUILD.optionalPrefixes) optionalPrefixes.push(absolute(prefix));
}

function isOptional(url) {
  return optionalUrls.has(url) || optionalPrefixes.some((prefix) => url.startsWith(prefix));
}
const indexUrl = absolute('index.html');

async function copyOrFetch(cache, url, path, previous) {
  if (await cache.match(url)) return;
  if (isImmutable(path)) {
    for (const old of previous) {
      const hit = await old.match(url);
      if (hit) {
        await cache.put(url, hit);
        return;
      }
    }
  }
  const response = await fetch(
    new Request(url, { cache: isImmutable(path) ? 'default' : 'reload' }),
  );
  if (!response.ok) throw new Error(`Precache failed (${response.status}): ${path}`);
  await cache.put(url, response);
}

async function precacheBuild() {
  const cache = await caches.open(shellCacheName);
  const previous = [];
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== shellCacheName)
      previous.push(await caches.open(name));
  }
  const queue = [...precacheUrls];
  // One failed file fails the install: the browser retries it, and a half-cached build would
  // break offline in ways nobody can see. Files cached by an earlier attempt are kept.
  const run = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await copyOrFetch(cache, next[0], next[1], previous);
    }
  };
  await Promise.all(Array.from({ length: INSTALL_CONCURRENCY }, run));
}

async function removeStaleCaches() {
  for (const name of await caches.keys()) {
    const legacy = LEGACY_SHELL_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (legacy || (name.startsWith(SHELL_PREFIX) && name !== shellCacheName))
      await caches.delete(name);
  }
  const runtime = await caches.open(RUNTIME_CACHE);
  for (const request of await runtime.keys()) {
    const url = request.url;
    if (!precacheUrls.has(url) && !isOptional(url)) await runtime.delete(request);
  }
}

self.addEventListener('install', (event) => {
  if (BUILD) event.waitUntil(precacheBuild());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (BUILD) await removeStaleCaches();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isShellNavigation(url) {
  // `diary/` is its own page with its own worker; every other path is the hash-routed app.
  return url.origin + url.pathname === scope || url.href.split(/[?#]/u)[0] === indexUrl;
}

async function serveShell(request) {
  const cache = await caches.open(shellCacheName);
  const cached = await cache.match(indexUrl);
  return cached ?? fetch(request);
}

async function serveFromShell(url, request) {
  const cache = await caches.open(shellCacheName);
  const cached = await cache.match(url);
  if (!cached) return fetch(request);
  if (request.url === cached.url) return cached;
  // A file is stored under its path, but scripts may be asked for with a query (the SQLite OPFS
  // worker reads `?vfs=` from its own address). A response without an address of its own takes
  // the address of the request, which keeps `location` and `import.meta.url` as asked.
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

async function serveRuntime(event, url, request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(url);
  if (cached) return cached;
  const response = await fetch(request);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (response.ok && response.status === 200 && length <= RUNTIME_MAX_BYTES) {
    event.waitUntil(cache.put(url, response.clone()));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (!BUILD) return;
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (isShellNavigation(url)) event.respondWith(serveShell(request));
    return;
  }
  const key = url.origin + url.pathname;
  if (precacheUrls.has(key)) event.respondWith(serveFromShell(key, request));
  else if (isOptional(key)) event.respondWith(serveRuntime(event, key, request));
});

// Connected diary (ADR-0026): pushes carry no content; the text is fixed here so nothing about a
// patient passes through the push service. A tap opens the doctor's diaries.
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Дневники пациентов', {
      body: 'Срочная отметка или новое приглашение. Откройте, чтобы посмотреть.',
      tag: 'minimed-diary',
      renotify: true,
      icon: 'apple-touch-icon.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('./#/notes/diaries', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (open) {
        open.navigate(target);
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
