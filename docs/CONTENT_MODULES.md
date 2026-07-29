# Content modules

## Product decision

This document describes source and distribution modules. The target runtime no longer mounts each
enabled module as a separate searchable SQLite store. Per [ADR 0012](adr/0012-curated-core-edition-before-sharding.md),
approved modules compile into one immutable curated `core.db` edition; the edition activates and
rolls back as a whole. Modules remain useful for collection, rights review, provenance, category
coverage, and build selection.

The current per-module runtime and monolithic pilot are transitional implementations. The compiler
must preserve stable document, section, chunk, entity, and relation IDs while producing an edition.

## Initial module map

| Module | Purpose |
|---|---|
| `minimed.core.ru` | Required topic catalog, short reviewed summaries, aliases, coarse global relations, and routing to modules. |
| `minimed.clinical.pediatrics.general` | Common outpatient pediatrics, growth/development, syndromes, prevention, and primary routing. |
| `minimed.clinical.pediatrics.infectious` | Pediatric infectious diseases, isolation, epidemiology, treatment, and red flags. |
| `minimed.clinical.pediatrics.respiratory-allergy` | Respiratory disease, pulmonology, obstruction, and allergy/immunology. |
| `minimed.clinical.pediatrics.gastro-nutrition` | Gastroenterology, hepatology, feeding, hydration, and nutrition. |
| `minimed.clinical.pediatrics.nephro-urology` | Kidney, urinary, electrolyte, and pediatric urology material. |
| `minimed.clinical.pediatrics.neuro-emergency` | Neurology, seizures, altered consciousness, emergency and intensive care. |
| `minimed.clinical.pediatrics.surgery-trauma` | Pediatric surgery, congenital anomalies, trauma, and postoperative care. |
| `minimed.medications.ru` | Official Russian medicine instructions and reviewed structured medication facts. |
| `minimed.regulatory.pediatrics.ru` | Current and historical Russian pediatric regulatory acts. |
| `minimed.reference.pediatrics.ru` | Laboratory ranges, growth standards, scales, rules, and deterministic calculators. |

New populations or specialties use the same pattern, for example `minimed.clinical.psychiatry.ru`.
The UI groups modules by collection and does not require the module ID hierarchy to define search
ranking.

## Source categories and unavailable coverage

The required core edition contains the selected canonical source chunks, aliases, and reader payload.
It must label corpus gaps rather than imply that an unselected source is unavailable in medicine.

Detailed treatment claims, tables, doses, and exceptions remain tied to their source document version.
An edition may advertise a later curated edition, but it never fabricates detail from an absent source.

## Source-build artifacts

Every source-build module version has an immutable manifest and two possible artifacts:

1. **Index artifact — required**
   - one read-only SQLite database;
   - complete extracted document text;
   - headings, chunks, stable anchors, page references, aliases, FTS, vectors, entities, relations, and
     structured tables;
   - compiler input for an edition; never a separate active runtime store.
2. **Source-assets artifact — optional**
   - original PDFs where redistribution or user-side download is allowed;
   - extracted figures and table/page fallback images;
   - opened by the in-app PDF/source reader at the page linked by the index.

Original assets are never required for ordinary search. A curated edition includes the complete
extracted text and structured tables of its selected source-build modules.

Official Ministry clinical-recommendation modules use only the index artifact. Their structured JSON
tables and embedded figures are validated and stored inside the same SQLite database; neither the JSON
payload nor the original PDF is downloaded to the device.

## GitHub distribution

Until a dedicated server exists, `catalog.preview.json` on `main` is a mutable preview-channel endpoint
for later edition downloads. The app bundles a validated catalog as an offline fallback; checking for a
new edition is an explicit update action, never an ordinary offline-search dependency.

Source-build artifacts and edition manifests are immutable GitHub Release assets. The channel catalog
may point to a new edition, but every edition URL is paired with exact size, SHA-256, document-version
list, rights state, and `sourceSetDigest`. Updating the channel catalog does not modify an installed
edition.

## Version coupling

An edition identifies one exact selected source set. Its manifest records:

- edition ID/version and schema version;
- compatible app-version range;
- `sourceSetDigest` over the exact document-version list;
- every document ID, document-version ID, source checksum, and status;
- edition, source-build index, and optional source-assets checksums and sizes.

The edition and every selected source-build artifact must carry the same source-version mapping.
MiniMed rejects a new PDF paired with an old index, an old PDF paired with a new index, or an edition
incompatible with the current app/schema.

A document update produces a new source-build version and, when selected, a new immutable edition. The
previous validated edition stays available for rollback; historical document versions may remain
searchable only when the active edition marks them `superseded` or `historical`.

## Installation lifecycle

The target lifecycle is:

```text
catalog → update requested → downloading → verifying → activating edition
                                              ↓
                                      failed (old edition remains active)
```

The edition download goes to staging. Activation occurs only after size/checksum, compatibility,
SQLite `quick_check`, foreign-key, source-set, and rights validation. One active-edition pointer changes
atomically; search never reads a partial or mixed-version corpus. A transient network failure retries
the staged edition; checksum, compatibility, and validation failures require an explicit retry.

Android uses WorkManager plus a notification channel; iOS uses background URLSession; web uses a
foreground downloader. Search and reading from the active edition continue during an update.

## Storage and search architecture

The runtime opens one read-only `core.db` corpus edition. Web gives its SQLite-WASM instance to the
search worker, which also supplies reader/context RPC; qualified mobile builds open the same edition
natively. A result always resolves within the active edition. The former multi-store router is a
transitional implementation, not the 1.0 target.

Personal notes, owner-provided literature, and local hospital protocols remain separately labelled
local overlays and never modify or satisfy claims in the official edition.

## Full-document reading

The edition stores the complete extracted text and structured tables. Results open directly at the
stable section/chunk anchor. Table blocks retain cell structure and available provenance; official
clinical JSON figures are embedded in validated chunk metadata.

When source assets are installed, the reader can open the original PDF at the linked page with text
selection and search. PDF.js is the preferred first cross-platform reader inside the Capacitor WebView;
a native reader remains an adapter option if physical-device measurements require it.

## Implementation order

1. Source manifests, rights validation, and build selection.
2. Immutable whole-edition artifact plus atomic foreground activation/rollback.
3. One-owner Web worker and one native mobile edition path.
4. Real-corpus golden retrieval and physical-device validation.
5. Structured table blocks and optional original-PDF assets.
6. Evaluate runtime sharding only if the edition fails its measured budget.
