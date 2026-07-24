# Full-text datasets

MiniMed keeps large medical documents out of Git and the application bundle.

## Source of truth

- Official medical systems are the upstream sources.
- An immutable GitHub Release is the reproducible MiniMed snapshot.
- `datasets-preview-1/catalog.preview.json` is only a mutable channel pointer to snapshot assets.
- Existing snapshot tags and assets must never be overwritten.

Each clinical recommendation is an independently installable SQLite asset. Categories are catalog
metadata and bulk-install selections, not duplicate databases. Source PDFs are retained in
category ZIP archives for recovery when an official endpoint is unavailable; the application does
not download those archives during normal installation.

## Pipeline

```text
official Ministry catalog and PDF endpoint
  → cache-backed HTTPS synchronization
  → source-preserving extraction and diagnostics
  → one verified SQLite database per recommendation
  → immutable snapshot release
  → mutable channel catalog
  → in-app checksum verification and activation
```

```bash
bun run content:catalog:clinical
bun run content:sync:clinical:all
bun run content:build:clinical:documents -- --all --allow-partial --force
bun run content:package:clinical:snapshot -- \
  --output-root release-clinical \
  --snapshot-id clinical-YYYY.MM.DD-CHECKSUM \
  --release-base-url https://github.com/OWNER/REPO/releases/download/SNAPSHOT \
  --allow-partial
```

The sync is resumable through `.cache/localmed/official-clinical-documents`. The manual
`publish-clinical-snapshot.yml` workflow runs the same commands with pinned Bun and uv versions,
rejects an existing snapshot tag, checks GitHub's asset limits, publishes the release, then updates
only the channel catalog. Prototype manifests retain each record's rights status even when it is
`unknown`; confirming redistribution terms is deferred to the production release gate.
PDFs without a searchable text layer remain in the source archives and are listed under
`unavailableRecommendations`; they are not advertised as searchable modules until OCR succeeds.

A module advertised as full text must pass all of these gates:

- every declared document was downloaded from its recorded endpoint;
- each one-document database matches its manifest;
- chunk count equals FTS row count;
- `PRAGMA quick_check` succeeds and foreign-key validation returns no violations;
- source, database, and source-set checksums are recorded.

## Application behavior

Downloaded databases are stored separately from the bundled core. MiniMed opens enabled modules
through the multi-store router without modifying them.

A failed download or validation never replaces an active dataset. The doctor can continue searching the bundled core while another module downloads or fails.

## Current limitations

- Browser and the current Android WebView use IndexedDB-backed module storage; a native private-file/WorkManager backend remains a later adapter.
- New modules become searchable after the user chooses `Подключить к поиску`, which reloads the local composition.
- PDF archives are release backups, not in-app source attachments.
- The local medication-instruction pack has seven text-layer PDFs; the selected oseltamivir PDF
  requires OCR before ingestion.
- The local prototype snapshot contains 723 searchable modules and records 21 scan-only
  recommendations for OCR; it has not been published yet.
