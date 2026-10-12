# Content modules

## Product decision

This document describes source and distribution modules. Per
[ADR 0017](adr/0017-lightweight-core-index-and-domain-packs.md), `core.db` is the always-installed
discovery index and large reader payloads live in independently versioned domain packs such as
`medications.db`. Modules remain useful for collection, rights review, provenance, category coverage,
download selection, and rollback. Stable document, section, chunk, entity, relation, and module IDs
join core pointers to installed payloads.

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

The catalog files (`catalog.preview.json`, `catalog.terminology.json`) are written minified and
store each module's membership as a compact `documentTable`: one shared `indexArtifactId` and rows
`[documentId, versionId, sourceChecksumHex, title, overrides?]`, where a version id starting with
`@` is appended to the document id and `overrides` carries a different status, index or
source-assets artifact. The schema expands the table into `documents` in the same order, so readers
never see the compact form. Scripts write catalogs only through `serializeContentModuleCatalog`
(contracts), which refuses output whose membership does not parse back exactly. App versions up to
0.6.44 ignore `documentTable` and read the remote catalog as having no membership, so they need the
next release for pointer downloads from a refreshed catalog.

A compressed index is gzip or zstd and always declares `decodedSha256`/`decodedSizeBytes`. zstd
indexes are packed with `zstd -19 --long=26` (`scripts/repack-module-index-zstd.ts`): the app's
decoder (fzstd) corrupts 128 MiB windows, so larger windows are refused before decoding.

Source-build artifacts and edition manifests are immutable GitHub Release assets. The channel catalog
may point to a new edition, but every edition URL is paired with exact size, SHA-256, document-version
list, rights state, and `sourceSetDigest`. Updating the channel catalog does not modify an installed
edition.

## Modules installed from a file

Reference data kept for personal use (drug monographs, lab reference ranges, staging systems under a
personal licence) is never published: not in the repository, not as a release asset, not in a
catalog. The owner builds such a module locally, copies **one file** to the device and installs it
from Settings → «Загрузки и разделы» → «Модули из файла» (icon button, aria-label «Установить модуль
из файла»).

Bundle `<stem>.minimed-module.zip`, a ZIP whose entries are STORED (no compression, no ZIP64):

| Entry | Content |
| --- | --- |
| `module.json` | one complete catalog entry (`ContentModuleCatalogEntrySchema`), exactly what `package_module` writes to `<stem>.catalog-entry.json`; `releaseState` is `published` or `preview`, never `core`/`required` |
| `artifacts/<file>` | every artifact, bytes untouched, at the path its `artifacts[].url` names |

Artifact URLs read `minimed-local:<path-in-zip>` (relative, no `..`, no leading `/`). The entry
schema accepts the scheme so `module.json` validates like any entry; a remote or cached catalog that
contains it is rejected (`hasLocalModuleArtifacts` in `loadContentModuleCatalog`). Index artifacts
are `none`, `gzip` or `zstd`, source assets `zip`, with the same `sha256`/`sizeBytes`/`decodedSha256`
as in a public module.

Build one from a packaged module (`package_module` / `package-icd11`: the `.catalog-entry.json` and
its artifact files side by side):

```bash
uv run --project tools/ingest medbase bundle-local-module \
  --entry output/<module>/<stem>.catalog-entry.json \
  --output output/local-modules/<stem>.minimed-module.zip
```

The writer (`local_module_bundle.py`) verifies size and SHA-256 of every artifact (and the gzip
round trip), rewrites the URLs, and writes a deterministic ZIP (sorted entries, fixed timestamps).
**Personal-use bundles go to the gitignored `output/local-modules/` only; they are never committed,
uploaded, attached to a release or mirrored.**

In the app the file goes through the ordinary install path (checksum → decode → OPFS/IndexedDB →
registry → mount) with the bytes read from the chosen file instead of a download. The ZIP directory
is read first and each artifact is sliced out of the file on demand, so a 100 MB module is held in
memory once. The file is rejected, with a short Russian message, when it is not a module bundle, is
compressed, has an invalid entry, points outside itself, lacks an artifact or has another size, when
its id belongs to a public catalog module, or when the checksum, the app/schema version or the
database integrity check fails. The entry is kept in its own IndexedDB database
(`minimed-local-modules`, `features/modules/local-module-entries.ts`) and merged into the runtime's
catalog, so the module survives restarts and catalog refreshes. It is listed with an «Из файла»
badge, can be deleted, is never offered as a download and is never updated from the remote catalog;
a newer file with the same id replaces it, and the previous version stays available for rollback.

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
