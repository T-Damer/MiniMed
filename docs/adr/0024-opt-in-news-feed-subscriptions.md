# ADR-0024: Opt-in news feed subscriptions and the embedded site viewer

- Status: accepted; implemented as the «Лента» tab (STATE NEWS1).
- Decision: project owner, 2026-10-05 — a fourth bottom tab «Лента» (Поиск · Файлы · Лента ·
  Настройки) with an unread count; RSS/Atom feeds and websites opened in an embedded viewer.
- Related: [ADR-0020](0020-medical-news-and-research-feed.md) (the research-API layer, still
  proposed; this ADR is the user-subscription layer it deferred), [ADR-0004](0004-no-backend-before-1.0.md),
  [NATIVE_STICKY_CHROME.md](../NATIVE_STICKY_CHROME.md).

## Context

A doctor wants new medical news in one place: sources the doctor chooses, as feeds or as plain
websites. MiniMed is offline-first with no backend, no accounts and no telemetry, so the feed must
be an optional layer that costs nothing until used, keeps working from a local cache offline, and
never routes anything through a server of ours.

## Decision

### Network use and privacy

- **Opt-in, per source.** No request is made until the user adds a subscription (or pastes an
  address to inspect). The suggested sources are offered, never subscribed. Refresh happens when the
  tab is opened (only feeds older than 15 minutes) and on the refresh button; there is no
  background polling, no push and no scheduled work.
- **What leaves the device:** an HTTPS `GET` to the feed or site address the user chose, carrying no
  cookies, no `Referer`, no user data and, on Android, the `If-None-Match` / `If-Modified-Since`
  validators of the previous response. The source therefore sees the device's IP address and a
  generic client, and nothing else. No proxy, no relay, no analytics, no shared service.
- Feed hosts that the user adds are untrusted: their addresses are never logged, and no feed text
  reaches a log, a search index, the core or any model (ADR-0020's rule that the feed never enters
  ranking or answers stands).

### Fetching through a port

`news-transport.ts` is the only network door of the feature (`FeedTransport`).

- **Android (Capacitor):** `CapacitorHttp` from `@capacitor/core` — part of core, no new plugin and
  no change of `capacitor.config.ts` (the plugin works without `CapacitorHttp.enabled`, which would
  only patch `fetch`). There is no CORS in the native client, the body arrives as base64 and is
  decoded with the declared charset (windows-1251 feeds exist), redirects are followed by the app so
  an http→https hop works (`HttpURLConnection` refuses it).
- **Web build (GitHub Pages):** `fetch` with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`.
  A page can only read a response if the host sends CORS headers. A failed `fetch` is the same
  `TypeError` for «no network» and «CORS refused», so the transport tells them apart: a `no-cors`
  request that succeeds proves the host is reachable, hence the refusal is CORS. The UI then says
  «Этот источник не разрешает чтение из браузера — откройте в приложении для Android или как сайт»
  and offers the address as a website. **There is no CORS proxy**; the web tier is intentionally
  smaller (of the 14 suggested sources, 4 are readable from the browser).
- ETag / Last-Modified are used only where the adapter can read and send them (native). A page
  cannot send them without turning a readable feed into a blocked CORS preflight; the browser's own
  HTTP cache revalidates there.
- Limits: 15 s timeout, 6 MB of body, 4 M characters of feed text, 100 items per fetch.

### Parsing and sanitization

- RSS 2.0, RSS 1.0 (RDF — NEJM, The Lancet and Nature use it), Atom 1.0 and JSON Feed are parsed
  with a small tolerant tokenizer (`markup.ts`), **not** with `DOMParser`. Reasons: the same code
  runs in a browser, a worker and the unit tests (the unit runner has no DOM), real feeds are often
  not well-formed XML and `DOMParser` rejects the whole document at the first error, and entity
  declarations are never expanded (no entity-expansion attacks). Input is bounded by size, node
  count and depth; unmatched or unclosed tags are tolerated; unusable entries are counted, not
  guessed. Parse failures carry a code (`empty`, `too-large`, `not-a-feed`, `malformed`).
- All feed content is untrusted. HTML in items is reduced to a **tree** of allow-listed elements
  (`p`, `div`, `br`, `a`, `strong`, `em`, `ul`, `ol`, `li`, `blockquote`, `h4`, `pre`, `code`, `sup`,
  `sub`, `img`) where only a checked `href` (http, https, mailto), an https `src` and an `alt`
  survive. The tree is rendered with element creation — **never `innerHTML`** — so even a parser
  disagreement cannot produce script or an event handler. Scripts, styles, frames, forms, SVG and
  every attribute (`style`, `on*`, `class`, `id`) are dropped. DOMPurify (already a dependency)
  was not reused because it returns a string for `innerHTML` and is a no-op without a DOM.
- Remote images are fetched only when the user switches **«Изображения»** on for that source;
  otherwise nothing from the item's image hosts is requested. Links inside text open outside the
  app (`target="_blank"`, `rel="noopener noreferrer"`, no referrer).

### Storage

- Subscriptions (title, address, validators, last fetch, last error, unread counter) are a small
  JSON in `localStorage` (`minimed.news.subscriptions.v1`), validated at read. This lets the tab
  badge read the unread total without opening a database or constructing the feed service.
- Cached items live in IndexedDB (`minimed-news`, one record per feed): at most **200 items per
  feed and 30 days**; older items are neither kept nor re-added from the feed, so they cannot return
  as «new». Each item stores a title, a 320-character snippet and the sanitized tree (≤ 16 000
  characters of text). With IndexedDB unavailable the cache lives in memory for the session.
- The first fetch of a source marks as unread only items from the last 3 days (a new subscription
  must not light the badge with 100 old items). Read state survives refreshes; removing a source
  deletes its items.
- Subscriptions can be exported and imported as OPML 2.0 (titles and addresses only; no read
  state, no items). Import subscribes through the normal fetch path.

### Offline behaviour

The tab opens with cached items and shows when each source was last fetched. While offline a refresh
sends nothing and the banner says so. A source that fails keeps its items and shows its own error
on the list and on the sources page.

### The embedded viewer and its limits

The viewer (`#/news/item/<id>`, `#/news/site/<id>`) has two views of a feed item: the **feed's own
text** (offline, sanitized) and the **page** in an `<iframe>`; a website subscription has only the
page. It has a title, the address, back, and «Открыть в браузере» (`<a target="_blank"
rel="noopener noreferrer">`: the system browser on Android through Capacitor's navigation handler,
the same mechanism the app already uses for external links, no new plugin).

- `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` — **never**
  `allow-same-origin` together with scripts, no forms, no top navigation —, `referrerpolicy=
  "no-referrer"`, `allow=""` (no powerful features). The framed site runs in an opaque origin: it
  cannot read the app's storage, cookies or DOM, and sites that need their own storage may render
  partially.
- `http:` addresses are tried as `https:` (an https app cannot frame mixed content); the external
  link keeps the original address.
- **Many sites forbid framing** (`X-Frame-Options`, CSP `frame-ancestors`). The embedding page cannot
  observe a refused frame (the browser fires `load` for its error page). So: (1) a `HEAD` probe
  reads the site's own headers where the client may read them (Android, and CORS-open hosts) and, if
  framing is refused, the viewer shows «Этот сайт не разрешает показ внутри приложения» with
  «Открыть в браузере» instead of a blank frame; (2) otherwise a frame that has not loaded within
  12 s gets the same fallback; (3) a standing line «Пустая страница? …открыть в браузере» stays above
  every frame because a refused frame in the browser build is silent.
- The in-frame navigation is not tracked: the address bar shows the page that was opened.
- The Vite dev and preview servers are cross-origin isolated (COEP `require-corp`), under which a
  frame needs `Cross-Origin-Resource-Policy`/COEP from the framed site; real sites do not send them,
  so the viewer cannot show real sites in `bun run dev`/`preview` (the production Pages build and
  the Android app are not isolated; the e2e fixtures send the headers).
- Not verified on a device: whether Android's `shouldOverrideUrlLoading` hands an external
  `<iframe src>` to the system browser instead of loading it in the frame (Capacitor's
  `Bridge.launchIntent` does not look at `isForMainFrame`). The fallback and the external link make
  the failure mode «opens in the browser», not a dead end.

### Suggested sources are data

`suggested-feeds.json` (id, title, description, address, language, group, `webReadable`) holds the
list; the interface renders whatever it contains. Every address was fetched and parsed by the app's
own parser on 2026-10-05 (see CURRENT_STATE). Sources that returned empty feeds, stale items,
bot challenges or an http-only redirect (BMJ) were left out; the Минздрав site does not publish a
feed and is not reachable with the system trust store (Russian root CA).

## Consequences

- The app gains one optional network path with a hard privacy statement; everything else is
  unchanged and the tab is inert until used.
- The browser build reads only CORS-open sources; Android reads everything it can reach over
  https. This asymmetry is stated in the interface instead of hidden by a proxy.
- A hand-written tokenizer and sanitizer are the price of testability and tolerance; they are small,
  covered by hostile-input tests, and cannot reach `innerHTML`.
- Items are text the publisher chose to put in the feed; teasers are shown as teasers, never
  completed by generated text.
