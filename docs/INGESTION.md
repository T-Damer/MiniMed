# Corpus ingestion

## Two-stage design

LocalMed separates **source preparation** from **runtime pack compilation**:

```text
private PDF / OCR TXT / Markdown
  → medbase prepare
  → source-preserving Markdown + diagnostics + provenance
  → medbase lint / build
  → relational SQLite + FTS5 content pack
```

The app never parses PDFs. Raw sources and intermediate files remain outside the mobile runtime.

## Private source registry

Copy [`examples/private-sources.yaml`](examples/private-sources.yaml) to the ignored raw workspace:

```bash
cp docs/examples/private-sources.yaml data/raw/sources.yaml
```

Each entry fixes a stable document ID, edition metadata, specialty filters, and extraction options.
Paths are resolved relative to `--source-root`; traversal outside that directory is rejected.

```yaml
pack:
  id: localmed.private-pilot
  version: 2026.07.1
  schemaVersion: 2
  title: Private pilot
  builtAt: "2026-07-17T00:00:00Z"

sources:
  - id: kr.private.pneumonia.children
    path: pneumonia-children.pdf
    title: Внебольничная пневмония у детей
    versionLabel: "2026"
    sourceType: clinical_recommendation
    status: draft
    specialties: [pediatrics, pulmonology]
    ageGroups: [children]
```

## Preparation command

```bash
uv run --project tools/ingest medbase prepare \
  --registry data/raw/sources.yaml \
  --source-root data/raw \
  --output data/intermediate/private-pilot \
  --force
```

Output:

```text
data/intermediate/private-pilot/
├── manifest.yaml
├── aliases.yaml
├── kr.private.*.md
├── prepare-report.json
└── .localmed/
    ├── extractions/*.json
    └── diagnostics/*.json
```

`--force` replaces the output atomically through a temporary directory and backup. It does not
modify raw documents.

## PDF extraction

The 0.2.2 importer reads an existing text layer through PyMuPDF. It records:

- page number and dimensions;
- source block ID and reading order;
- bounding box;
- dominant font/size and bold signal;
- heading/list/table-candidate classification;
- repeated marginalia that was removed;
- low-text pages and extraction quality warnings.

Repeated headers and footers are detected across pages. Page numbers are removed. Numbered section
headings near the top margin are protected from false removal. Likely line-break hyphenation can be
joined, but source paragraphs are otherwise not rewritten.

A scan with no text layer is not OCRed automatically. It is reported as low-text and should first be
processed by the user's OCR workflow.

## TXT and Markdown extraction

UTF-8 TXT is useful for existing OCR output. Markdown preserves explicit `#` headings. For plain
text, the importer recognizes numbered and common clinical-recommendation headings. These inputs
retain line ranges rather than physical page coordinates.

## Hidden provenance markers

Generated Markdown remains readable while carrying machine provenance:

```md
<!-- localmed:source {"bbox":[50.0,120.0,545.0,180.0],"block":"p12-b4","kind":"paragraph","page":12} -->
Original source paragraph.
```

The Markdown compiler removes the marker from visible text and stores it in `chunks.metadata_json`.
`page_start/page_end` are filled when page data exists. The source file checksum, not the generated
Markdown checksum, becomes the document-version checksum.

## Extraction diagnostics

`prepare-report.json` gives a corpus summary. Every source also has a diagnostic file with:

- total/included blocks and characters;
- low-text pages;
- repeated blocks removed;
- heading and table candidates;
- estimated body font size;
- a heuristic quality score;
- explicit reasons for spot review.

These checks target parsing errors. They do not claim to validate the medical content of an official
source.

## Pack compilation

```bash
uv run --project tools/ingest medbase lint \
  --input data/intermediate/private-pilot

uv run --project tools/ingest medbase build \
  --input data/intermediate/private-pilot \
  --output data/build/private-pilot.db \
  --report data/build/private-pilot-report.json
```

Builder stages:

1. validate front matter and registry-derived metadata;
2. parse ordered heading hierarchy;
3. preserve original paragraphs and source spans;
4. normalize a separate search representation;
5. create deterministic document/version/section/chunk IDs;
6. create previous/next links and stable anchors;
7. insert relational rows transactionally;
8. populate FTS5;
9. run SQLite integrity and foreign-key checks;
10. emit counts, warnings, and checksums.

## LLM/tooling role

A future agent may propose aliases, categories, or conflict candidates, but the source-preparation
path is deterministic. An agent should operate on the generated extraction JSON/Markdown through a
constrained tool and must not destroy page/block provenance.
