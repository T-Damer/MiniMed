# ADR 0007: prepare private sources before pack compilation

Status: accepted in 0.2.2.

## Context

Real clinical recommendations arrive as heterogeneous PDF, OCR TXT, or partially structured
Markdown. Parsing them directly in the app would mix authoring failures with runtime search and
would make provenance difficult to inspect. Committing raw private material is also undesirable.

## Decision

Use a private source registry under the ignored raw workspace. `medbase prepare` resolves files
only under an explicit source root and generates an atomic, build-ready workspace containing:

- source-preserving Markdown;
- extraction block JSON;
- per-source diagnostics;
- hidden page/block or line provenance markers;
- the ordinary pack manifest and aliases file.

The existing deterministic builder remains the only component that writes runtime SQLite packs.
Source preparation does not summarize or medically rewrite claims.

## Consequences

- PDF parser changes can be reviewed independently of runtime code.
- Every imported chunk can retain a raw-file checksum and source span.
- Extraction failures form a targeted review queue rather than requiring wholesale manual editing.
- Raw files, generated intermediates, and private builds stay outside Git by default.
- Text-layer PDFs, TXT, and Markdown are supported; OCR and reliable table reconstruction remain
  separate future tools.
