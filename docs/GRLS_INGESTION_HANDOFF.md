# GRLS ingestion handoff

The client package is text-only: source PDFs are build-machine inputs and must not be committed or
shipped. The current local GRLS catalog is ignored data and has edition `24.07.2026`.

## Implemented workflow

1. Build `grls-instructions-active-plan.json` from the catalog.
2. Canonicalize an EAEU registration only when trade name, INN, dosage form, and holder exactly match
   one current registration. Keep requested historical numbers as provenance; download only the current
   instruction.
3. Append checksum-backed PDF download results to the state ledger.
4. Generate a source registry only from successes with matching current plan target and checksum.
   No-text PDFs are emitted into an OCR candidate report, never silently omitted from provenance.
5. Extract to Markdown, lint, then build lexical-only SQLite packs. PDFs stay in ignored `data/raw/`.

## Current local corpus snapshot

- 19,335 current instruction targets; 2,205 deferred as legacy, ambiguous, or unmatched.
- 19 downloaded PDF files; 13 match the current plan.
- The sampled current PDFs are scan-only. The PDF importer now attempts local OCR when the text layer is
  empty, but this machine has no usable Tesseract executable and the `omlx` launcher is broken.
- The existing text-layer pilot remains valid: 8 instructions + 8 registry cards, 156 chunks, 2.7 MB.

## Next action

Repair/install one local OCR runtime, process a bounded batch, then build a text-only shard of about
100 current instructions and measure its SQLite size. Do not use an LLM to create medical claims; OCR and
structure detection must remain source-backed and review-marked.
