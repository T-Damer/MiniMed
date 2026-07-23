# Content modules

## Product decision

MiniMed ships as a small application plus an always-available Russian core catalog. Full clinical,
medication, regulatory, and reference data are separate installable modules. A module is a user-facing
clinical domain, not one PDF and not one disease.

The current `0.3.1` database is a transitional monolithic pilot. It will be split without changing
stable document, section, chunk, entity, or relation IDs.

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

## Core catalog and unavailable modules

The required core stays small. It contains global topic/entity IDs, aliases, one short source-backed
summary, coarse relations, and the IDs of modules that contain full evidence.

A core search hit for an uninstalled module must return:

- the minimal summary and its core evidence;
- `summary-only` availability;
- one or more required module IDs;
- the module version/size from the catalog;
- an explicit install action instead of fabricated detail.

Detailed treatment claims, tables, doses, exceptions, and document chunks remain in the owning module.
The core graph may know that two topics are related, but only an installed reviewed module may supply a
trusted detailed relation.

## Module artifacts

Every published module version has an immutable manifest and two possible artifacts:

1. **Index artifact — required**
   - one read-only SQLite database;
   - complete extracted document text;
   - headings, chunks, stable anchors, page references, aliases, FTS, vectors, entities, relations, and
     structured tables;
   - sufficient for offline search and reading without the original PDF.
2. **Source-assets artifact — optional**
   - original PDFs where redistribution or user-side download is allowed;
   - extracted figures and table/page fallback images;
   - opened by the in-app PDF/source reader at the page linked by the index.

This lets users install a smaller searchable module or additionally keep original documents for visual
fidelity. Original assets are never required for ordinary search.

## GitHub distribution

Until a dedicated server exists, `catalog.preview.json` on `main` is the mutable preview-channel
endpoint. The app embeds the same validated JSON as an offline fallback and refreshes it conditionally
with ETag/Last-Modified. Invalid remote JSON never replaces a valid cache or bundled catalog.

Module binaries and manifests are immutable GitHub Release assets. The channel catalog may point to a
new version, but every artifact URL is paired with exact size, SHA-256, module version, document-version
list, and `sourceSetDigest`. Updating the channel catalog does not modify an already installed module.

## Version coupling

A module version identifies one exact source set. Its manifest records:

- module ID/version and schema version;
- compatible app-version range and required core-catalog version;
- `sourceSetDigest` over the exact document-version list;
- every document ID, document-version ID, source checksum, and status;
- index and optional source-assets checksums and sizes.

The index and source-assets artifact must carry the same `sourceSetDigest`. MiniMed rejects a new PDF
paired with an old index, an old PDF paired with a new index, or a module incompatible with the current
app/schema/core catalog.

A document update always produces a new immutable module version. The previous validated module stays
available for rollback; historical document versions may remain searchable when the module manifest
marks them `superseded` or `historical`.

## Installation lifecycle

The target lifecycle is:

```text
catalog → queued → downloading → verifying → installing → installed
                                      ↓
                                    failed (old version remains active)
```

Downloads go to staging. Activation occurs only after size/checksum, compatibility, SQLite
`quick_check`, foreign-key, and source-set validation. A small active-version pointer changes atomically.
Search reads only enabled active module databases and never a partial download.

Android uses WorkManager plus a notification channel; iOS uses background URLSession; web uses a
foreground downloader. Search and reading from already installed modules continue during downloads.

## Storage and search architecture

Use one read-only SQLite database per module rather than merging every update into one database. A
multi-store router queries the core and enabled modules, normalizes scores per store, and fuses results.
This provides independent enable/disable, update, removal, and rollback while preserving stable global
IDs and local bookmarks/history.

Personal notes and local hospital protocols remain in a separate writable local module and never modify
source modules.

## Full-document reading

The module index stores the complete extracted text and structured tables. Results open directly at the
stable section/chunk anchor. Table blocks retain cell structure, page number, and an optional page-image
fallback.

When source assets are installed, the reader can open the original PDF at the linked page with text
selection and search. PDF.js is the preferred first cross-platform reader inside the Capacitor WebView;
a native reader remains an adapter option if physical-device measurements require it.

## Implementation order

1. Catalog/contracts and read-only module page.
2. Static GitHub channel catalog with validated cache/fallback.
3. Multi-store router and installed-module registry.
4. Immutable module manifests/artifacts and atomic foreground install/update/rollback.
5. Android background download and notification progress; iOS background adapter later.
6. First full-text module from the seven currently validated clinical recommendations.
7. Structured table blocks and optional original-PDF assets.
8. Core summary-only results that offer the required module.
