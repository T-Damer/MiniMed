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
- 122 downloaded PDF files; 116 have a checksum-valid success matching the current plan. All 116 are
  currently classified as OCR candidates and remain build inputs, not client assets. Six older or
  non-current files are excluded by the registry builder.
- OCR preparation of all 116 current PDFs completed sequentially in 501.97 seconds. A preserved
  four-worker v2 run completed in about 237 seconds (2.1x faster) and recognizes exact standard
  instruction headings without relying on font emphasis. All documents remain marked for source review.
  The v2 pack contains 116 instructions plus 116 GRLS registration cards, 1,989 sections, 1,662 chunks,
  480 source-exact proposed facts, and 26,632,192 bytes. The original 22,282,240-byte pack remains
  available; raw-PDF staging is not part of either client pack.
- Exact registration + trade-name matching against the full ESKLP pack links 99 registrations,
  leaves 17 unmatched, and produces zero ambiguous links. Linked cards expose `mnnDocumentId`, all
  `smnnCodes`, `klpCodes`, and the exact `instructionDocumentId` to the runtime model.
- Targeted exact-registration downloads expanded the preserved corpus to 123 instructions. The latest
  v2 SQLite has 246 documents, 2,193 sections, 1,889 chunks, 632 entities, 176 presentations,
  548 proposed exact-source facts, 881 relations, and 761 document links. ESKLP links 106 registrations,
  with zero ambiguous and 17 unmatched. `--reuse-from` reused 121 prior extractions when the final two
  PDFs were added, so only those two were parsed. Three legacy Nurofen numbers still fail exact GRLS
  resolution and remain explicit gaps.
- A source-exact dose projection over the already prepared 123 documents adds 199 proposed dosage
  paragraphs with structured amount/range, frequency, interval, age, weight, and same-paragraph route
  values where explicitly present. It runs after OCR: normalization took about 19.5 seconds and the
  SQLite build about 4.5 seconds. The new
  `grls-instructions-current-123-dose-candidates-v2.db` is preserved next to the older v2 database; no
  source extraction was repeated. Exact-evidence, integrity, and foreign key checks pass. These
  candidates are searchable review data, not calculator-ready regimens.
- Failed batch items are capped by `--max-attempts` (default 3), so exhausted interactive-search
  misses no longer starve later registrations. A real 8-worker verification skipped 21 exhausted
  items and downloaded 8/8 new checksum-valid PDFs in 8.0 seconds. The additive 131-source registry
  was prepared with 123 reused extractions and only eight new OCR jobs in 25.0 seconds. The separate
  131-instruction v2 database has 262 documents, 2,336 sections, 2,020 chunks, 775 proposed facts,
  114 exact ESKLP matches, zero ambiguous matches, and 17 unmatched registrations. Older 116/123
  workspaces and databases were not replaced.
- The next bounded 8-worker batch attempted 32 registrations and added 29 checksum-valid PDFs in
  22.0 seconds; three failures remain retryable. The 160-source registry has 155 OCR candidates.
  Preparation reused all 131 previous extractions and processed only the 29 additions in about
  55.5 seconds. The preserved `grls-instructions-current-160-v2.db` contains 160 instructions plus
  160 registration cards, 2,870 sections, 2,486 chunks, 790 entities, 931 proposed facts, 1,123
  relations, 993 document links, and 193 review tasks. Exact ESKLP crosswalk coverage is 141 matched,
  zero ambiguous, and 19 unmatched. The 45,293,568-byte database has SHA-256
  `e40665735a04f7c17474e047a5d406ca3c67057b27e818f1562ca11e8837a04b`, integrity `ok`, and zero
  foreign-key violations. The 116/123/131 databases remain unchanged.
- The previous 24-instruction OCR sample remains available as a smaller fixture
  (284 sections, 279 chunks, 3,993,600 bytes).
- The PDF importer uses local macOS Vision OCR when the text layer is empty. Tesseract and the `omlx`
  launcher remain unavailable on this machine.
- The existing text-layer pilot remains valid: 8 instructions + 8 registry cards, 156 chunks, 2.7 MB.

## Next action

Continue the repaired current-site resolver in bounded eight-worker batches. Use
`medbase prepare --workers 8`; output remains deterministic and memory is bounded to eight in-flight
extractions. Use `--reuse-from <previous-workspace>` when extending a checksum-compatible snapshot so
successful OCR is not repeated. Exact instruction sections may be stored as proposed official-label
facts. Run automated structural and applicability review over the proposed dosage candidates before
promoting any regimen to calculator-ready support; do not infer missing medical claims or join a dose
to a population across ambiguous paragraphs.
