# LocalMed ingest

Deterministic authoring tooling for synthetic fixtures and private Russian clinical-recommendation
corpora. It preserves source wording, adds provenance and structure, and compiles SQLite/FTS5
content packs. No LLM is required.

## Fixture build

```bash
uv sync --all-groups
uv run medbase lint --input ../../content/fixtures
uv run medbase build \
  --input ../../content/fixtures \
  --output ../../data/build/core-demo.db \
  --json-output ../../packages/test-fixtures/src/generated/core-demo.json \
  --report ../../data/build/core-demo-report.json
```

## Private PDF/TXT preparation

```bash
uv run medbase prepare \
  --registry ../../data/raw/sources.yaml \
  --source-root ../../data/raw \
  --output ../../data/intermediate/private-pilot \
  --force
```

The registry describes IDs and metadata. The preparer:

- validates paths stay under `source-root`;
- extracts text-layer PDF blocks with page/bounding-box provenance;
- supports UTF-8 TXT/OCR exports and Markdown;
- detects repeated headers, footers, page numbers, headings, lists, and table candidates;
- writes build-ready Markdown plus extraction/diagnostic JSON;
- never summarizes or medically rewrites source text.

Then lint and build the prepared directory with the same `medbase build` command.
