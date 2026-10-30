// Diary page cache: keeps the page usable offline after the first visit. Scope: diary/ only.
const CACHE_NAME = 'minimed-diary-v6';
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

/** One request of the precache may take this long; a hung one must not keep the worker installing. */
const PRECACHE_TIMEOUT_MS = 15000;

/**
 * Caches one asset if it answers. A failed answer's body is cancelled: an unread body keeps its
 * connection busy, and a few of them exhaust the browser's connections to the host.
 */
async function addQuietly(cache, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(PRECACHE_TIMEOUT_MS) }).catch(
    () => undefined,
  );
  if (response?.ok) await cache.put(url, response);
  else await response?.body?.cancel();
}

/**
 * A file a style sheet pulls in, or nothing: `data:` URIs and the fragment references inside
 * inline SVG (`filter='url(%23n)'` of the paper grain) are not files, and other origins are not
 * ours to keep.
 */
function sheetAsset(reference, sheet) {
  if (/^(?:data:|#|%23)/iu.test(reference)) return undefined;
  const url = new URL(reference, sheet);
  return url.origin === self.location.origin ? url.href : undefined;
}

/** Caches the page and everything it needs, so the very first visit is already enough for offline. */
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const page = await fetch(BASE, {
    cache: 'reload',
    signal: AbortSignal.timeout(PRECACHE_TIMEOUT_MS),
  });
  if (!page.ok) throw new Error('Diary page is not available.');
  const html = await page.clone().text();
  await cache.put(BASE, page);
  const urls = new Set([new URL('manifest.webmanifest', BASE).href]);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png|ico|webmanifest))"/gu)) {
    urls.add(new URL(match[1], BASE).href);
  }
  // A missing optional asset must not stop the page itself from being cached.
  await Promise.all([...urls].map((url) => addQuietly(cache, url)));
  // Fonts and images that the style sheets pull in, each once.
  const assets = new Set();
  for (const sheet of [...urls].filter((url) => url.endsWith('.css'))) {
    const response = await cache.match(sheet);
    if (!response) continue;
    const css = await response.text();
    for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gu)) {
      const asset = sheetAsset(match[1], sheet);
      if (asset && !urls.has(asset)) assets.add(asset);
    }
  }
  await Promise.all([...assets].map((url) => addQuietly(cache, url)));
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

// Connected diary (ADR-0026). A push carries only what happened (`{ kind }`) or, for a reminder,
// its moment (`{ kind: 'reminder', at }`), encrypted for this browser; an old subscription sends
// an empty push. What a reminder is about is read from the notices the diary page keeps in
// Cache Storage (`src/features/diary/connected/reminder-cache.ts` describes the layout).
const REMINDER_CACHE = 'minimed-diary-reminders';
const REMINDERS = new URL('reminders/', BASE).href;
const ICON = new URL('../diaries/apple-touch-icon.png', BASE).href;
const DOCTOR_TEXT = {
  plan: 'Врач изменил план лечения. Откройте, чтобы посмотреть.',
  tip: 'Врач оставил рекомендацию. Откройте, чтобы прочитать.',
  correction: 'Врач поправил запись в дневнике.',
};

function payloadOf(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return null;
  }
}

/** The notices of every diary on this phone for one moment. */
async function noticesAt(at) {
  const cache = await caches.open(REMINDER_CACHE);
  const found = [];
  for (const request of await cache.keys()) {
    if (!request.url.startsWith(`${REMINDERS}notices/`)) continue;
    const response = await cache.match(request);
    const file = response ? await response.json().catch(() => null) : null;
    for (const notice of file?.notices ?? []) {
      if (notice.at === at) found.push({ diary: file.diary, ...notice });
    }
  }
  return found;
}

async function showReminder(at) {
  const notices = await noticesAt(at);
  // Everything due then was marked meanwhile (or the plan changed): nothing to remind of.
  if (!notices.length) return;
  const doses = notices.flatMap((notice) =>
    notice.doses.map((dose) => ({ diary: notice.diary, ...dose })),
  );
  const time = new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  await self.registration.showNotification(`${notices[0].title} · ${time}`, {
    body: notices.map((notice) => notice.body).join(' · '),
    tag: `minimed-diary-reminder-${at}`,
    icon: ICON,
    data: { kind: 'reminder', at, doses },
    // Android shows the buttons; an iPhone opens the diary on a tap.
    actions: doses.length
      ? [
          { action: 'taken', title: 'Принял' },
          { action: 'open', title: 'Открыть' },
        ]
      : [{ action: 'open', title: 'Отметить' }],
  });
}

self.addEventListener('push', (event) => {
  const payload = payloadOf(event);
  if (payload?.kind === 'reminder' && typeof payload.at === 'string') {
    event.waitUntil(showReminder(payload.at));
    return;
  }
  event.waitUntil(
    self.registration.showNotification('Дневник', {
      body: DOCTOR_TEXT[payload?.kind] ?? 'Врач обновил дневник. Откройте, чтобы посмотреть.',
      tag: 'minimed-diary-patient',
      icon: ICON,
    }),
  );
});

/** «Принял»: queued for the diary, which marks the intakes when it is next open. */
async function recordTaken(data) {
  const cache = await caches.open(REMINDER_CACHE);
  const takenAt = new Date().toISOString();
  const diaries = [...new Set(data.doses.map((dose) => dose.diary))];
  for (const diary of diaries) {
    const doses = data.doses
      .filter((dose) => dose.diary === diary)
      .map((dose) => ({ item: dose.item, slot: dose.slot }));
    const key = `${REMINDERS}actions/${diary}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    await cache.put(
      key,
      new Response(JSON.stringify({ diary, at: data.at, takenAt, doses }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'diary-reminder-action' });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  if (event.action === 'taken' && data?.kind === 'reminder' && Array.isArray(data.doses)) {
    event.waitUntil(recordTaken(data));
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(BASE.href));
      return open ? open.focus() : self.clients.openWindow(BASE.href);
    }),
  );
});
