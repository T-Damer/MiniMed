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

## Private pilot workspace

```text
data/raw/                         ignored
  sources.yaml + PDF/TXT files

data/intermediate/private-pilot/ ignored
  generated Markdown + diagnostics

data/build/private-pilot.db       ignored unless intentionally released
```

See [`PILOT_CORPUS.md`](PILOT_CORPUS.md) for commands and the registry template.

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

The publish step refuses to replace `apps/app/public/content/core-demo.db` when the committed pack
(built by CI from the pilot corpus) contains more documents than the local fixtures build. Run
`bun scripts/publish-demo-pack.mjs --force` to overwrite it deliberately.

Private pilot:

```bash
bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

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
- `PRAGMA integrity_check` returns `ok`;
- `PRAGMA foreign_key_check` returns no rows;
- a non-synthetic imported document should carry a source file, checksum, and span metadata;
- extraction warnings remain visible in build reports.
