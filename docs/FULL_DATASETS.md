# Full-text datasets

MiniMed keeps the APK small and distributes complete medical documents as independently verified SQLite modules.

## First preview channel

The `datasets-preview-1` GitHub prerelease contains:

- `minimed.regulatory.pediatrics.ru` — the Russian pediatric regulatory pilot;
- `minimed.clinical.pediatrics.respiratory-allergy` — complete source text for the declared pneumonia, bronchitis and bronchiolitis recommendations.

The mutable channel catalog is published as `catalog.preview.json`. Every referenced database remains an immutable release asset with an exact byte count, SHA-256 digest and source-set digest.

## Full clinical document pipeline

```text
declared official Ministry PDF endpoint
  → cache-backed HTTPS synchronization
  → deterministic PDF text-layer extraction
  → source-preserving Markdown and diagnostics
  → lint and SQLite build
  → integrity, foreign-key and FTS checks
  → immutable GitHub Release asset
  → in-app staging, checksum verification and activation
```

The PDF extractor keeps page/block coordinates, headings, paragraphs, lists and table candidates. The
downloaded PDF checksum becomes the document-version checksum. Extraction warnings stay visible and
are not silently repaired.

Run `bun run content:rebuild:clinical` to refresh the catalog, reject superseded selected versions,
synchronize PDFs, prepare them, lint them, and rebuild the local SQLite pack.

Remote synchronization uses a bounded three-minute request timeout and a persistent cache. A
transiently slow endpoint cannot cause an unbounded build, while an already validated cached source
remains usable for reproducible offline rebuilds.

A module advertised as full text must pass all of these gates:

- every declared document was downloaded from its recorded official endpoint;
- each document contains substantial clinical text and several section headings;
- the SQLite document count matches the immutable manifest;
- chunk count equals FTS row count;
- `PRAGMA quick_check` succeeds and foreign-key validation returns no violations;
- source checksums and the source-set digest are included in the release catalog.

## Application behavior

Downloaded databases are stored separately from the bundled core. MiniMed opens enabled modules through the multi-store router and fuses their search results without merging or modifying the source databases.

A failed download or validation never replaces an active dataset. The doctor can continue searching the bundled core while another module downloads or fails.

## Current limitations

- Browser and the current Android WebView use IndexedDB-backed module storage; a native private-file/WorkManager backend remains a later adapter.
- New modules become searchable after the user chooses `Подключить к поиску`, which reloads the local composition.
- Original PDFs are not included yet; they remain optional source-assets artifacts where redistribution permits.
- A public mirror can change or disappear. CI therefore rebuilds and validates the complete module before publishing a new immutable version; an existing installed version remains unchanged.
