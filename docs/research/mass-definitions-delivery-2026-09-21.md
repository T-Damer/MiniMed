# Mass definitions: delivered scope and boundaries

Date: 2026-09-21. Same draft PR #180, stacked on #174. Data/integration commit:
`ed1c28736e3e347d74b06935bfe028baae977b12`.
Successful verification and fast-forward delivery:
https://github.com/T-Damer/MiniMed/actions/runs/35625853154

## What is now in the branch

The complete pass scanned all **744 clinical detail packs** from existing dataset commit
`77fe143a31608a925c608fff3a5de28163cc77a4`, tree `5234e93faeeef01c364df182b84399536a4213ab`.
It examined 33,459 sections and 92,303 chunks and produced **11,082 source-excerpt records**.
A separate exhaustive bundled-core/tool pass added **76** summary/existing-tool-description
records. Together with the previous 6,975 Russian dictionary/editorial entries, the combined
opt-in development lookup contains **18,133 records**.

Clinical extraction categories: 8,784 term-labelled records, 976 classifications, 818 scale-labelled
source records, 141 criterion sets, 248 syndromes, 114 symptoms and one law-labelled record.
There are 6,459 distinct clinical titles, not 11,082 disjoint canonical medical concepts.
Repeated source definitions, versions and same-name instruments retain their own identity.
These counts must not be advertised as 818 new executable or clinically reviewed scales.

Coverage: 8,224 explicit-definition records, 541 definition-section records and 2,317 section
excerpts. Another **987 instrument mentions** remain in a separate review queue, outside the
record count above. The 76 bundled extras contain seven summary terms and 69 descriptions of
existing tools (51 tool / 18 scale labels); no new questionnaire, scoring algorithm or cutoff
was invented from a name. Exact source text, document/version/section/chunk/anchor locators
and source-snapshot checksums are retained. Extraction types and clinical content require review.

Normal reproducible tools remain in `scripts/extract_prepared_definitions.py`,
`scripts/extract_clinical_dataset_definitions.py`, `scripts/extract_pdf_definition_profile.py`
and the associated tests. The four completed temporary extraction/finalization/delivery workflows
and one-time fixture/browser recovery script were removed after successful delivery. There was
no Actions artifact upload, new dataset release, APK or merge.

## Actual repository checks

The successful run used locked Bun 1.2.3, executed 10 Python exporter tests and **91 Vitest cases**
(65 glossary, 10 V3 excerpt-boundary, 16 retained-identity tests), and passed the core TypeScript
check. Nine older identity fixtures now obtain request defaults through `SearchRequestSchema`;
production request validation, ranking and gold labels were not relaxed.

The exact newly extracted record ID was first in **6,480 / 11,158** source-name queries and present
in Top-20 in **9,842 / 11,158**. Same-title source variants retain separate IDs; this is not a
unique-concept relevance metric. All 1,316 missing IDs remain in
`prepared-definition-lookup-2026-09-21.json`. Independent reverse-definition qualification is
still open. The earlier tiny 19/20 reverse-lookup pilot is not evidence for the expanded corpus.

The **actual Solid `DefinitionDraftMatches` component**, real loader and core were browser-tested
in isolation at 430×920: explicit opt-in source loading, local owner JSON import, local citations,
malformed import preserving the previous lookup, no remote requests and no browser exceptions.
The passed report is `definition-component-browser-2026-09-21.json`. Earlier delivery attempts
failed in temporary browser-launcher/config code after extraction; those failures are not erased.
This is not a whole-application build, production-bundle audit or physical Android validation.

## User-provided psychiatry PDF: private deliverable, not public repository text

Source: D. V. Semenov and A. V. Bersenev, *Psychopathological Symptoms and Syndromes*, Vladimir State
University, 2006, ISBN 5-89368-671-3. The supplied PDF has 89 pages and SHA-256
`f176f3e07025930387d83a3f9baa260ae48c5db89b15c4e812b4957840a1b651`.

A separately executed local source-bound profile extracted all three medical chapters, pages 6–86,
including all **42 numbered syndrome sections**, into **450 records / 442 distinct titles /
621 reusable paragraph blocks**. Contents, control questions and bibliography were not turned into
medical definitions. Native PDF text was extracted without OCR. Only whitespace normalization and
line-break dehyphenation were applied; original native text and coordinates remain in the audit.
Historical wording and clinical caveats were not silently modernized or harmonized.

Proposed categories: 365 symptoms/manifestations, 59 syndromes, six general terms, one law,
nine criterion-list records, nine classification records and one scale mention. Some descriptions
and subtype records are contextual rather than standalone full definitions. Full source section
context is retained separately from the shorter display block. The Stanford–Binet entry is
**mention-only**: no test form or executable scoring scheme was present to extract. The page-42
consciousness-obscuration list does not name Jaspers; that attribution was not invented.

The user received a ZIP with importable V3 `extracted/definitions.json`, a source-bound profile,
native-text audit, exact repository importer, verification script/reports, TSV, Russian README
and an autonomous HTML viewer. Neither the original PDF nor its extracted text/profile was
committed to this public repository. Redistribution rights for the uploaded textbook are not
established. The ZIP contains no original PDF, font files or model weights.

Actual local verification: **3,556 structural assertions** over all 621 paragraphs, source hashes,
42 syndrome sections, criterion lists, etymology spans and malformed inputs. The executed importer
matches Git blob `cd961e8e7e4cfc23aa2947cb42e231bb40f6f084`. This verifies source fidelity and
structure, not clinical correctness. The standalone HTML viewer passed nine browser checks in
installed Chromium via Playwright at 430×920, using `set_content`; this is not a `file://` deployment
or MiniMed application test. It had no external requests, browser exceptions or horizontal overflow.

## Etymology and historical reference

The manual supplied **seven explicit etymological statements**, preserved with exact source spans;
these are not a newly validated etymological dictionary. **Seventeen name/eponym indices** retain
unresolved identity and source links, not fabricated biographies or priority-of-discovery claims.
A name can denote a literary character or institution rather than a scientist.

`content/history-drafts/catalog.json` separately stages three short editorial history cards:
Karl Jaspers, Leo Kanner and John Hughlings Jackson, with shared numeric sources and exact locators
from Heidelberg University, Johns Hopkins Medicine and RCP Museum. These are external research,
not textbook text, and are not added to the 450 or 18,133 denominators. The local HTML viewer shows
them on a separate history tab. A full in-app historical-reference section and reviewed links to
canonical concepts remain a separate integration; a same-name string is not enough to establish
an author or discoverer. Each card still requires review.

## Size: compact payload is not yet a mobile memory qualification

The clinical collection stores 15,414 shared blocks in five bounded shards:
**34,391,562 JSON bytes / 5,666,456 bytes as the sum of separately gzipped payloads**.
The owner PDF module is **642,973 JSON bytes / 137,405 gzip bytes**. Shared source records and
paragraph IDs avoid repeated bibliography/context while preserving exact individual locators.
These are payload sizes, not installed SQLite, JavaScript heap or complete app footprint.

The current DEV loader still constructs the whole combined JavaScript index. The final audit
measured **5,597.5 ms construction time and 1,033,625,600 current process RSS bytes**. RSS includes
Bun, parsed inputs and audit bookkeeping; it is not incremental index memory, a measured peak or
Android memory. Nevertheless this is **not** mobile-memory qualification, and payload sharding
alone does not fix it. This preview must not be forced into every phone or presented as a finished
production download.

The next runtime priority is bounded retrieval through the existing optional-module installer
and SQLite owner, lazy detailed context, proper source/version binding and a measured device budget.
Do not add a competing storage owner or require full books/images merely to display a definition.
Corpus expansion, deduplication/review and independent reverse-query evaluation remain necessary.
The completed pass covers the exact input set stated above, not every medical definition in existence.
