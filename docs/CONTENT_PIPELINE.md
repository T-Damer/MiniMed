# Content pipeline

## Goal

The corpus pipeline treats source text as immutable evidence and SQLite as a compiled runtime
artifact. Version 0.2.2 supports both synthetic Markdown fixtures and a private PDF/TXT preparation
workspace.

```text
raw source or official structured JSON
  → extraction blocks
  → source-preserving Markdown
  → deterministic sections/chunks
  → original_text + normalized_text
  → SQLite relations + FTS5
```

## Public demo fixtures

```text
content/fixtures/
├── manifest.yaml
├── aliases.yaml
├── appendicitis.md
├── pneumonia.md
└── urinary-tract-infection.md
```

These files are intentionally synthetic and declare `synthetic_fixture: true`.

## Private workspace

```text
data/raw/                         ignored
  sources.yaml + PDF/TXT files

data/intermediate/private-pilot/ ignored
  generated Markdown + diagnostics

data/build/private-pilot.db       ignored unless intentionally released
```

See [`PRIVATE_CORPUS.md`](PRIVATE_CORPUS.md) for commands and the registry template.

## Stable structure

Pack compilation performs:

```text
front matter validation
  → heading tree
  → paragraphs with optional source spans
  → chunks (target 1800 chars, hard split 3200 chars)
  → deterministic IDs
  → stable anchors
  → page_start/page_end from provenance
  → original text + normalized search text
  → SQLite rows
  → FTS5 rows
  → integrity_check + foreign_key_check
  → build report
```

Model tokens are never used as anchors. IDs depend on document/version/path/content. Rebuilding
unchanged input produces the same ordering, IDs, SQLite bytes, and JSON bytes when `builtAt` is
fixed.

## Source markers

Preparation inserts hidden JSON comments before extracted paragraphs. The Markdown parser converts
them into `sourceSpans` metadata. Markers do not enter `original_text` or `normalized_text`.

For PDF input a span can contain page, block ID, and bounding box. For TXT input it contains source
line ranges. This allows future UI navigation and parser debugging without exposing citations by
default.

For official clinical JSON, the marker keeps the Ministry section ID/order and an optional validated
render block. Table rows, cell spans, and embedded image data remain chunk metadata; base64 image bytes
never enter visible text, FTS, or embeddings.

## Commands

Demo pack:

```bash
bun run content:build
```

The publish step refuses to replace `apps/app/public/content/core.db` when the committed pack
(the released discovery core) contains more documents than the local fixtures build. Run
`bun scripts/publish-demo-pack.mjs --force` to overwrite it deliberately.

Private pilot:

```bash
bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

Discovery core (`apps/app/public/content/core.db`), reproducible and incremental:

```bash
bun run content:core:build
```

Wires three independent pointer tracks (krasotaimedicina+mkb "reference", "clinical", "medication" —
the clinical track covers every current registry edition plus earlier editions the registry replaced, which
stay as `superseded` pointers linked to their successor (`--previous-source`); the 15 retired pilot
documents are no longer composed; see `docs/research/core-build-reconstruction-2026-09-27.md` for how
this was reconstructed and verified against the released core.db's exact per-track document
counts) through `medbase compose`/`build-core-reference-pointers`/`build-core-catalog-pointers`
into a candidate `data/build/core.<version>.db`. Every stage is hash-keyed and skipped when
unchanged. Never copies over the released `core.db`/`content/bundled/core.db.gz` itself — that
publish step, plus the benchmark suite, stays manual and separate. Publishing a core: build with
`CORE_BUILD_VERSION=<v> CORE_BUILT_AT=<date>T00:00:00Z`, `gzip -9 -n` the file, write the report with
`bun scripts/write-core-report.mjs --db … --version … --gzip … --release-tag core-<v> --output core-report.json`,
upload `core.db.gz`, `MiniMed-<v>-core.db`, `core-report.json` and `core.manifest.json` to the `core-<v>`
prerelease, then update `content/bundled/core.db.gz`, `apps/app/public/content/core-report.json` and
`ANDROID_CORE_DOWNLOAD` in `apps/app/src/composition/core-download.ts` (see [RELEASES.md](RELEASES.md)).

Local ICD-10 reference pack:

```bash
bun run content:rebuild:mkb
```

The importer stores the complete RLS classification index and only explicitly requested detail
pages (the cerebrovascular example is the default). Repeat `--detail-url` for additional code pages.
For an explicit full detail crawl, use `bun run content:scrape:mkb:all`; `--detail-limit N` is available
for a bounded smoke test. The full index itself does not need this crawl.
The detail-page trade-name cards are enriched through the public `POST /api/table-change-packings`
endpoint. Its rows are stored as one grouped trade-name card with MNN, form, dosage, package, and
manufacturer fields; repeated desktop/mobile renderings are deduplicated. Trade-name aliases expand
to MNN in search, and each detail document carries its MKB code in `icd10Codes`, so installed
clinical recommendations can be found by the same code. The private RLS API is not required for
this local-dev path. Full HTML is not retained; the compiled pack contains parsed text, tables,
source URLs, checksums, and relations only. Detail cards use the dedicated `rls_mkb_reference`
source type, so medication search includes only RLS cards that actually mention medicines, not every
generic medical reference. Each detail and packing request gets three attempts. Failed detail URLs
are written to `data/raw/rls-mkb/rls-mkb-failures.json`; successful intermediate detail state is
retained, and `bun run content:retry:mkb` repeats only those failed URLs and rebuilds the pack. For
an interrupted full crawl, use `bun run content:resume:mkb`: it skips completed detail state and
continues the remaining index nodes.

Official clinical snapshot:

```bash
bun run content:catalog:clinical
bun run content:sync:clinical -- --all
bun run content:build:clinical:documents -- --all --force
bun run content:package:clinical:snapshot -- \
  --snapshot-id clinical-json-YYYY-MM-DD-CHECKSUM \
  --release-base-url https://github.com/T-Damer/MiniMed/releases/download/TAG \
  --force
```

Each recommendation is distributed as one SQLite file containing searchable text, navigable headings,
structured tables, and safe embedded images. The JSON payload and original PDF are preparation inputs,
not user downloads.

Incremental clinical refresh (registry changed after a snapshot, e.g. `clinical-json-2026.10.02-*`).
A new edition (`CodeVersion`) is a new module; the modules already listed are never rebuilt, so
installed copies and checksums stay valid. Raw `GetClinrec2` JSON is stored byte-exact in
`data/raw/official-clinical-documents/<id>.json` with checksums in
`data/raw/official-clinical-registry/<date>/raw-json-checksums.json`.

```bash
D=data/raw/official-clinical-registry/YYYY-MM-DD; B=data/build/official-clinical-YYYY-MM-DD
uv run --project tools/ingest medbase-clinical-catalog official-sync --output $D/catalog.json --raw-output $D/api-pages.json --report $D/registry-report.json
uv run --project tools/ingest medbase-clinical-catalog official-sync --status all --page-size 1000 --output $D/catalog-all-statuses.json --raw-output $D/api-pages-all-statuses.json --report $D/registry-report-all-statuses.json
uv run --project tools/ingest medbase-clinical-catalog delta --catalog $D/catalog.json --module-catalog apps/app/src/features/modules/catalog.preview.json --output $B/catalog-delta.json
# then, as above, on the delta: build (ledger) -> plan-sources -> medbase sync (GetClinrec2) -> build-documents --all -> package-snapshot (new --snapshot-id)
uv run --project tools/ingest medbase compact-module-search --input $B/documents/databases --output $B/documents/compacted --report $B/documents/compaction-report.json
bun scripts/repack-module-indexes-zstd.ts --family clinical --compacted --source-dir <compacted files renamed to the snapshot's clinical-<id>-<snapshot>.db> --out-dir $B/zst --catalog-in <catalog with the fragment added> --catalog-out <candidate>
bun scripts/add-clinical-delta-modules.ts CATALOG FRAGMENT OUTPUT --min-app-version X --published-at T --superseded <replaced CodeVersion> ...
bun scripts/build-clinical-editions.ts --registry $D/catalog-all-statuses.json --raw-dir data/raw/official-clinical-documents
bun run catalog:shell
scripts/publish-module-zstd-mirror.sh --family clinical --tag <snapshot id> --source-dir $B/zst --create
```

`add-clinical-delta-modules.ts` appends the new modules, marks every replaced edition `superseded` in
its document table (its artifact and source-set digest stay untouched, so an installed copy remains
valid and nothing is removed from a device), recounts the category counters and moves `publishedAt`
forward (a remote catalog replaces the bundled one only when it is newer). The module catalog schema
cannot link two modules, so old ↔ new editions live in the sidecar
`apps/app/src/features/modules/catalog.clinical-editions.json` (checked against the catalog by
`catalog.clinical-editions.test.ts`).

Optional one-file Replicate OCR pilot:

```bash
bun run content:ocr:replicate:pilot -- \
  --input data/raw/example.pdf \
  --source-root data/raw \
  --dry-run

REPLICATE_API_TOKEN=... bun run content:ocr:replicate:pilot -- \
  --input data/raw/example.pdf \
  --source-root data/raw
```

The pilot accepts PDF or DOCX, forces OCR, and writes
`data/intermediate/replicate-ocr/*.ocr-draft.json`. The result is explicitly review-required and is
never promoted into prepared Markdown or a content pack automatically. `--use-llm` enables Marker's
optional LLM pass; `--force` replaces only an existing OCR draft.

Direct CLI:

```bash
uv run --project tools/ingest medbase import source.pdf \
  --output data/intermediate/source.json

uv run --project tools/ingest medbase inspect \
  --database data/build/private-pilot.db \
  kr.private.example
```

## Invariants

- generated SQLite/JSON is never hand-edited;
- raw sources remain outside Git by default;
- source wording is not summarized during preparation;
- each chunk belongs to one document version and one section;
- source spans never appear in visible chunk text;
- `chunks` and `chunks_fts` row counts match;
- a module pack that was search-compacted (`search_text_state = normalized-text-emptied`) is a final
  artifact only: it was verified against its source by a token-instance fingerprint of the index, the
  bm25 top-50 of a query set and a hash of every other chunk column, and it must never feed another
  index build;
- `PRAGMA integrity_check` returns `ok`;
- `PRAGMA foreign_key_check` returns no rows;
- a non-synthetic imported document should carry a source file, checksum, and span metadata;
- extraction warnings remain visible in build reports.

## Compacting module packs

A finished module pack loses about a quarter of its size, with the index unchanged, in one step:

```bash
# existing packs whose sources are not on this machine (ЕСКЛП, clinical recommendations, ...)
uv run --project tools/ingest medbase compact-module-search --input DIR_OR_DB --output DIR_OR_DB --report report.json
# a module build that has its sources
uv run --project tools/ingest medbase build --input ... --output ... --lexical-only --compact-search-text
```

The migration converts a self-contained `chunks_fts` to the external-content layout of migration 010
(keeping the pack's own tokenizer and prefix list), runs the rank-1 integrity check, empties
`chunks.normalized_text`, vacuums, and accepts the output only if the index fingerprint, the bm25
results of a deterministic query set and the hash of the remaining chunk columns equal the input's.
Compare real search behaviour of two directories with
`bun tools/benchmarks/src/compare-module-search.ts --before DIR --after DIR --kind esklp|clinical`.
A search-compacted pack has a new decoded checksum: publish it as an artifact of the same module
version only when no installed copy has to be replaced (the logical source set is unchanged), and
otherwise bump the version.
