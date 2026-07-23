# Private pilot corpus

Version 0.2.2 adds a reproducible authoring boundary for the first private clinical-recommendation
corpus. Raw documents remain outside Git; only generated Markdown, diagnostic JSON, and the final
SQLite pack are produced by tooling.

## Workspace

```text
data/raw/                         # ignored by Git
├── sources.yaml                  # private registry
├── recommendation-a.pdf
├── recommendation-b.pdf
└── ocr-export.txt

data/intermediate/private-pilot/ # ignored by Git
├── manifest.yaml
├── aliases.yaml
├── kr.*.md                       # build-ready, source-preserving Markdown
├── prepare-report.json
└── .localmed/
    ├── extractions/*.json        # every extracted block and coordinate
    └── diagnostics/*.json        # quality warnings and review queue

data/build/private-pilot.db       # ignored by Git unless explicitly released
```

Copy the registry template and put source files next to it:

```bash
cp docs/examples/private-sources.yaml data/raw/sources.yaml
```

Edit IDs and metadata, then prepare the workspace:

```bash
uv run --project tools/ingest medbase prepare \
  --registry data/raw/sources.yaml \
  --source-root data/raw \
  --output data/intermediate/private-pilot \
  --force
```

Validate and build:

```bash
uv run --project tools/ingest medbase lint \
  --input data/intermediate/private-pilot

uv run --project tools/ingest medbase build \
  --input data/intermediate/private-pilot \
  --output data/build/private-pilot.db \
  --report data/build/private-pilot-report.json
```

The root package exposes equivalent shortcuts:

```bash
bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

## Supported input

- text-layer PDF through PyMuPDF;
- UTF-8 TXT/OCR exports;
- Markdown with existing heading structure.

Scanned PDFs without a text layer are deliberately not OCRed by this command. They are reported as
low-text pages and should be OCRed before ingestion.

## What the importer changes

The importer may:

- remove repeated headers, footers, and page numbers;
- join likely line-break hyphenation;
- classify heading/list/table candidates;
- normalize heading depth for Markdown;
- add hidden source markers.

It does **not** summarize, translate, medically reconcile, or rewrite source claims.

A generated paragraph looks like this:

```md
<!-- localmed:source {"bbox":[50.0,120.0,545.0,180.0],"block":"p12-b4","kind":"paragraph","page":12} -->
Original source paragraph.
```

During pack compilation this marker becomes chunk metadata and `page_start/page_end`; it is not
shown as article text and is not inserted into FTS.

## Review queue

`prepare-report.json` and per-source diagnostics identify extraction risks rather than attempting a
full medical review. Review is requested for cases such as:

- pages with little or no text;
- no detectable headings;
- table-like layouts;
- very short documents;
- removed repeated marginalia.

The goal is spot-checking parser failures, not manually rewriting every recommendation.
