# ADR-0024: Opt-in news feed subscriptions and the embedded site viewer

- Status: accepted; implemented as the «Лента» tab (STATE NEWS1). Amended 2026-10-07 (STATE UX10):
  suggested sources as the first view, item pictures, and PubMed search (see «PubMed searches»).
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

- **Opt-in, per source.** No request is made until the user adds a subscription (pastes an address
  to inspect, or presses «Найти» in the PubMed search). The suggested sources are offered, never
  subscribed, and are drawn from bundled visuals only: showing them requests nothing. Refresh happens when the
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
- Remote images are fetched only when **«Изображения»** is on for that source; otherwise nothing
  from the item's image hosts is requested. The switch starts **off** for every source except a
  suggested one whose `carriesImages` flag says its items were measured to carry pictures (2026-10-07:
  Фармвестник, ДокторПитер, MedPage Today, STAT, Medical Xpress): subscribing to such a card is an
  explicit tap on a card that says «С картинками», and the picture hosts see the same minimum as the
  feed host (IP address, no cookies, no referrer). The switch stays per source in «Источники», and
  from an article of a source with the switch off a one-line button turns it on. Sources the user
  adds by address start off. Links inside text open outside the app (`target="_blank"`,
  `rel="noopener noreferrer"`, no referrer).
- An item's picture is parsed into `NewsItem.imageUrl`: `media:thumbnail`, `media:content`
  (`medium="image"`, an `image/*` type, or an image extension when neither is declared), an RSS
  `enclosure`, an Atom `<link rel="enclosure">` of an image type, JSON Feed `image` /
  `banner_image` / an image attachment, and finally the first `<img>` of the sanitized text. Only
  `https:` addresses survive (an https app cannot show mixed content, and the sanitizer already
  refuses everything else). The list row shows a fixed 4.5 rem square thumbnail and the article a
  16:9 hero box (`aspect-ratio`, `loading="lazy"`, `referrerpolicy="no-referrer"`), so nothing jumps
  when a picture arrives.

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

`suggested-feeds.json` (id, title, description, address, language, group, `webReadable`, `topic`,
`carriesImages` and `visual`) holds the list; the interface renders whatever it contains. `visual`
is the logo stand-in: a monogram (`mark`, up to four characters), a `hue` (0–360, lightness and the
theme stay in the stylesheet) and the `glyph` of the topic from a fixed allow-list. No logo files
are bundled or fetched (no trademark artwork, and no request before the user subscribes). The
first view of an empty «Лента» is these cards with a one-tap «Подписаться»; once the user has
sources, the ones not yet subscribed to stay in a compact one-row rail under the list. Adding an
address of one's own is a small round «+» in the header (and on «Источники»), not a banner. Every address was fetched and parsed by the app's
own parser on 2026-10-05 (see CURRENT_STATE). Sources that returned empty feeds, stale items,
bot challenges or an http-only redirect (BMJ) were left out; the Минздрав site does not publish a
feed and is not reachable with the system trust store (Russian root CA).

### PubMed searches (amendment 2026-10-07)

A search of PubMed is a third subscription kind, `pubmed`, next to `feed` and `site`.

- **Entry points.** A search icon in the «Лента» header, a card on the empty first view and a link on
  «Источники» open `#/news/pubmed`. The page is user-initiated: nothing is sent until the user
  presses «Найти», and a one-line notice above the button says «Текст запроса отправляется в NCBI
  (PubMed) — только когда вы нажимаете «Найти»». The search text is the user's own wording: it is
  checked locally (2–300 characters), never logged and never part of any address the app logs.
- **Requests.** NCBI E-utilities over HTTPS, both CORS-enabled, through the same `FeedTransport` as
  everything else (so Android uses `CapacitorHttp`, the web build `fetch`): `esearch.fcgi?db=pubmed&
  retmode=json&retmax=25&tool=minimed&term=…` for the newest PMIDs, then
  `esummary.fcgi?db=pubmed&retmode=json&tool=minimed&id=…` for their records. No API key, no `email`,
  nothing else is sent. There is no `sort` parameter on purpose: the default order is newest-added
  first, while `sort=date` (the web page's «Most recent») is not an E-utilities value and is ignored
  with a warning; `pub_date` would order by the issue date, which can lie in the future (measured
  against the live API on 2026-10-07, which also confirmed `Access-Control-Allow-Origin: *`). Both documents are validated at the boundary (`pubmed.ts`: PMIDs are digits
  only, anything off-shape is a `malformed` failure; unusable records are dropped, not repaired).
  `esummary` carries no abstract, so a record is title, journal, date and authors; no MeSH, no
  `efetch`.
- **Rate limit.** NCBI asks for at most three requests a second without a key. One spacer
  (`createRequestSpacer`, 400 ms = 2.5 a second) is shared by every search and refresh, so the two
  requests of a search and the three parallel refresh workers queue instead of bursting. A refused
  answer (HTTP 429/5xx) is recorded on that source like any other failure.
- **Results.** Title, journal · date, the first three authors; each opens
  `https://pubmed.ncbi.nlm.nih.gov/<pmid>/` as an external link (`target="_blank"`,
  `rel="noopener noreferrer"`, no referrer: the system browser on Android). PubMed refuses framing
  (`X-Frame-Options`, measured 2026-10-05), so there is no in-app page mode for it.
- **Subscribing.** «Подписаться на этот поиск» stores `{kind: 'pubmed', query, url, title:
  'PubMed: <query>'}` in the same localStorage list; `url` is the PubMed web page of the same search
  (it keeps the id stable and is what «Открыть» uses), while `query` is what is sent. A saved search
  refreshes with the other sources (tab open when stale, the refresh button, never in the
  background): the newest 25 PMIDs become items with guid `pmid:<pmid>`, merged like feed items,
  counted in the unread badge and filterable as a chip. An item is dated by when its record entered
  PubMed (the `entrez` history date; the publication date is only the label), because a
  late-indexed article can carry a print date months old. Because the hits of a narrow search are
  often old, a PubMed source keeps items for 365 days (feeds: 30) and marks as unread on the first
  fetch only those from the last 14 days (feeds: 3). The notice on the page states that the
  query goes to NCBI on every refresh; removing the source stops it.
- **Not exported.** OPML export leaves saved searches out (no feed address, and the text is the
  user's own); import does not create them.
- Not done: abstracts and MeSH topics, Europe PMC, user-provided NCBI keys (ADR-0020 items 2–3).

## Consequences

- The app gains one optional network path with a hard privacy statement; everything else is
  unchanged and the tab is inert until used.
- The browser build reads only CORS-open sources; Android reads everything it can reach over
  https. This asymmetry is stated in the interface instead of hidden by a proxy.
- A hand-written tokenizer and sanitizer are the price of testability and tolerance; they are small,
  covered by hostile-input tests, and cannot reach `innerHTML`.
- Items are text the publisher chose to put in the feed; teasers are shown as teasers, never
  completed by generated text.
