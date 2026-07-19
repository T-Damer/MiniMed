# Content pipeline

## Goal

The corpus pipeline treats source text as immutable evidence and SQLite as a compiled runtime
artifact. Version 0.2.2 supports both synthetic Markdown fixtures and a private PDF/TXT preparation
workspace.

```text
raw source
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

## Commands

Demo pack:

```bash
pnpm content:build
```

Private pilot:

```bash
pnpm content:prepare:private
pnpm content:lint:private
pnpm content:build:private
```

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
