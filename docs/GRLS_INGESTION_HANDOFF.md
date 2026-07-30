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
   No-text PDFs are marked in an OCR candidate report and passed to the local OCR fallback.
5. Extract to Markdown, lint, then build lexical-only SQLite packs. PDFs stay in ignored `data/raw/`.

## Current local corpus snapshot

- 19,335 current instruction targets; 2,205 deferred as legacy, ambiguous, or unmatched.
- 19 downloaded PDF files; 13 match the current plan.
- The first 13 scan-only instructions build into a text-only SQLite sample with 168 sections and 178
  chunks (2.6 MB). The 26 MB raw-PDF staging directory is not part of the client pack.
- The PDF importer uses local macOS Vision OCR when the text layer is empty. Tesseract and the `omlx`
  launcher remain unavailable on this machine.
- The existing text-layer pilot remains valid: 8 instructions + 8 registry cards, 156 chunks, 2.7 MB.

## Next action

Repair/install one local OCR runtime, process a bounded batch, then build a text-only shard of about
100 current instructions and measure its SQLite size. Do not use an LLM to create medical claims; OCR and
structure detection must remain source-backed and review-marked.
