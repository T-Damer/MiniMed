// Diary page cache: keeps the page usable offline after the first visit. Scope: diary/ only.
const CACHE_NAME = 'minimed-diary-v3';
const STATIC_DESTINATIONS = new Set([
  'document',
  'script',
  'style',
  'font',
  'worker',
  'image',
  'manifest',
]);
// Resolve against the diary folder, where this worker lives.
const BASE = new URL('./', self.location.href);

/** Caches the page and everything it needs, so the very first visit is already enough for offline. */
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const page = await fetch(BASE, { cache: 'reload' });
  if (!page.ok) throw new Error('Diary page is not available.');
  const html = await page.clone().text();
  await cache.put(BASE, page);
  const urls = new Set([new URL('manifest.webmanifest', BASE).href]);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png|ico|webmanifest))"/gu)) {
    urls.add(new URL(match[1], BASE).href);
  }
  const styles = [...urls].filter((url) => url.endsWith('.css'));
  await Promise.all(
    [...urls].map((url) =>
      cache.add(url).catch(() => {
        // A missing optional asset must not stop the page itself from being cached.
      }),
    ),
  );
  // Fonts and images that the style sheets pull in.
  for (const sheet of styles) {
    const response = await cache.match(sheet);
    if (!response) continue;
    const css = await response.text();
    for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gu)) {
      if (match[1].startsWith('data:')) continue;
      await cache.add(new URL(match[1], sheet).href).catch(() => {});
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('minimed-diary-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

// Network first, so a new page version arrives when online; the cache answers offline.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (
    request.method !== 'GET' ||
    new URL(request.url).origin !== self.location.origin ||
    !STATIC_DESTINATIONS.has(request.destination)
  ) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request, { ignoreSearch: true, ignoreVary: true })
          .then(
            (cached) =>
              cached ?? (request.mode === 'navigate' ? caches.match(BASE.href) : Response.error()),
          ),
      ),
  );
});
