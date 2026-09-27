# ADR-0020: Medical news and research feed

- Status: proposed (research before implementation)
- Date: 2026-09-27

## Context

Clinicians want to follow new research and news in their specialty (for example an
ophthalmologist subscribing to glaucoma and retina topics), both international and Russian. MiniMed
is offline-first with no hosted backend, accounts or telemetry (TECHNICAL_PLAN «Non-goals»), so a
feed must be an optional online module that fetches directly from public sources and keeps a local
cache. Browser builds are limited by CORS; Android/iOS can fetch natively.

## Decision (proposed)

1. **Optional online module.** The feed is a separate, clearly labelled external layer. It never
   enters the official corpus, search ranking or answers, and the app stays fully useful offline;
   the last fetched feed is readable offline from a device-local cache.
2. **Sources, first wave** (free public APIs): PubMed E-utilities (MeSH-topic subscriptions,
   abstracts), Europe PMC (including medRxiv/bioRxiv preprints and open full texts), OpenAlex (topic
   subscriptions), ClinicalTrials.gov API v2, Crossref and Unpaywall (legal open-access copies).
   **Russian journals** through their own feeds and OAI-PMH endpoints (Elpub/OJS platforms) and
   official news (Минздрав, Росздравнадзор) where they publish RSS. CyberLeninka is not a primary
   source (selective coverage). eLibrary has no open API and is not scraped.
3. **User-provided API keys.** Where a key raises limits (e.g. NCBI: 10 requests/s instead of 3), the
   user registers and pastes their own key following an in-app instruction. Keys stay on the device
   (native secure storage; IndexedDB in the browser with a stated limitation), are never committed,
   logged, exported in backups or synced, and are sent only to their own provider.
4. **Article ingest on the device.** Beyond bare RSS, a feed item is enriched from the article page:
   `citation_*`/Highwire, OpenGraph and schema.org metadata (title, authors, journal, DOI, date,
   image, description) and a readable-text extraction (Readability-style) for preview. This runs on
   the client: fully on Android/iOS; on the web only for CORS-enabled sources. Adding an extraction
   library needs a size/licence justification per AGENTS.md.
5. **Presentation.** A post-style feed: image, title, a meaningful description (abstract or
   publisher description, never model-generated in place of the original), source, date, study-type
   badge (RCT, meta-analysis, guideline, preprint, news), topics, «новое с прошлого визита», filters
   by type/language/journal, open original. Model summaries or translations, if ever added, are
   labelled drafts shown next to the original.
6. **Tiers.** Android/iOS get the extended feed (all sources, full ingest, own RSS subscriptions,
   scheduled background refresh within platform limits). The web gets a lighter feed limited to
   CORS-enabled APIs, refreshed when the app is open. Custom user RSS feeds come later, native first.
7. **No push server.** Notifications are local only (native scheduled refresh); no push backend.

## Research before implementation

Measure on real queries and record in `docs/research/`: per-source coverage for sample specialties,
rate limits with and without keys, CORS headers per endpoint, freshness, abstract/image
availability, licence/terms for display and caching, which Russian journals expose OAI-PMH or RSS,
and page-metadata quality for ingest. Only then choose the first vertical slice.

## Consequences

- Network-dependent by nature; offline shows cached items only.
- Feature parity differs by platform (CORS); the web tier is intentionally smaller.
- Terms of each source govern caching and display; the feed links to originals rather than
  republishing full paywalled text.
