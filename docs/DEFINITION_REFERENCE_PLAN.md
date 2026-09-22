# Definition reference: execution plan

## Definitions-only dictionary scope — 2026-09-22

Default DEV preparation now selects **8410 source-local definition candidates**
from **18357 authoring/reference records**. This is selection, not new acquisition.
Article titles, section excerpts, instrument-only descriptions, history and lexical glosses
do not inflate the medical-definition count. Full original inputs and every source block,
context, source descriptor and review/rights marker are retained unchanged.
The explicit `--scope reference` option builds the full authoring/reference view.
No automatic clinical approval, synonym merging, executable scale or treatment decision.
Verified 49 scoped tests, strict Python checks, a complete ordinary SQLite build,
exact selected identities, all 26685 source blocks and 20316 retained links.
Evidence: `research/definition-only-scope-2026-09-22.json`.
DEV version: `2026.09.22-definitions-only`. No APK, release, model or private-source upload.
Next acquisition targets actual definitions in guidelines, medical dictionaries and named
teaching sources, not article-count growth. User-provided scales remain a separate local intake.

## Specialist teaching source intake — final label selection, 2026-09-22

Same 37 complete specialist articles; **126** selected source records.
Active corpus **18357**; the earlier 18384/153 intermediate intake is superseded.
Includes 37 article cards, 83 definition candidates and 6 source-section cards.
All 1651 original blocks and 30 source tables are unchanged; 27 additional clause/subtype labels are context-only.
Incomplete stage names are not rewritten into diagnoses or counted as independent terms.
Author dates, classifications and licensing remain explicit; all records require review.
Actual SQLite: 122699776 bytes / 29944653 gzip bytes.
Passed 163 selected tests, strict checks, source replay, complete SQLite fidelity and actual-reader reconstruction.
Evidence: `research/specialist-teaching-quality-2026-09-22.json`.
Prepare DEV version `2026.09.22-specialist-teaching-d`. No Wikipedia, private source, model, release or APK added.


## Specialist lecture/review batch — 2026-09-22

Admitted 37 source articles; added 153 source-local records.
Active corpus: **18384**. Candidate window: offset 20, up to 12 issues per journal.
Excluded sentence/context labels: 49; pending articles: 35.
Exact author wording, publication dates, classification variants and source context are retained.
The recent-issue batch did not pass acquisition. Rights/language gates were not relaxed.
These archival sources are not current guideline or clinical approval. No Wikipedia/private inputs added.
Actual SQLite: 122834944 bytes; gzip: 29979245 bytes.
Passed 120 scoped tests, strict Python checks, source replay and complete SQLite fidelity.
Numeric bundles preserve all declared source/block/label-span references reversibly.
Actual reader reconstructs complete source cards. No Android/reverse-search gain inferred.
Evidence: `research/specialist-teaching-batch-2026-09-22.json`.
Prepare DEV version `2026.09.22-specialist-teaching-c`; no binary release or APK.
Content collection remains ahead of compatibility/installer/model work.


## Original specialist journal reference refresh — 2026-09-22

Active source/editorial records: **18231**, including
**98** newly selected records from **20**
original journal publications. Article overviews, definitions, section cards and
criterion lists are counted separately in `research/specialist-reference-delivery-2026-09-22.json`.
37 sentence/context labels are not indexed as standalone
terms; all original article blocks remain readable. 10 selected
articles are pending instead of bypassing unavailable full text or uncertain reuse rights.
Author dates, classifications, caveats and CC licensing including non-commercial restrictions
remain explicit. Source clinical review and public release eligibility are not promoted.

Real SQLite: 116154368 bytes; gzip transport: 28400266 bytes.
98 scoped tests passed. All selected source blocks/metadata were compared,
archived journal fragments replayed without networking, and complete new source cards were
reconstructed using the actual bounded reader. No private PDF, Wikipedia, model, APK or
published core was changed. Prepare DEV version `2026.09.22-specialist-journals`.
More substantive specialist sources remain ahead of compatibility/installer work.

## Source-policy override: specialist medicine, no Wikipedia — 2026-09-22

The user rejects Wikipedia as a medical reference source. Stop new Wikipedia collection;
the normal preparer now rejects direct Wikipedia inputs. Active selection contains
**18133 records** after excluding **7637 Wikipedia records**.
Original files and the preceding manifest are retained as audit evidence, not runtime inputs.
The retained **6939 Wiktionary senses** are a separate pre-existing
lexical collection, not professional clinical authority. No new specialist articles were
imported in this policy pass; other retained sources remain review-required.

Actual offline rebuild: 112111616 SQLite bytes / 27408604 gzip bytes.
Selected identities match exactly, excluded Wikipedia identities are absent, all input files
retain their preceding hashes, and numeric-projection round-trip/integrity checks pass.
This changes future DEV builds, not already installed editions or published APKs.
Source policy and candidate families: `REFERENCE_SOURCE_POLICY.md`; measured evidence:
`research/definition-specialist-policy-2026-09-22.json`. New build version:
`2026.09.22-specialist-policy`. Subsequent work is specialist textbook/reference chapters,
journals and original guideline/instrument documents, not wiki growth, models or installers.

Updated: 2026-09-22. Owner: draft PR #180, `experiment/system-one-search-benchmark`, stacked on #174. This plan refines `TECHNICAL_PLAN.md`; it does not authorize a merge, release, model download or architecture replacement.

## Earlier Wikipedia-inclusive selection (superseded) — 2026-09-22

Active corpus: **25770 source/editorial records**, including
**2957 additional page identities** from the new specialty batch.
Existing page IDs were not counted twice. 61 scale/classification
cards now contain 371 source sections and
49 reference tables. Unsupported layouts retain their old whole cards
and are listed for review. These are not clinically approved or executable instruments.

Actual SQLite: 165785600 installed bytes; 41734815 gzip bytes.
82 selected tests passed. Every projected source block was compared with SQLite,
revision-render records were replayed offline, and full enriched cards were reconstructed
through the bounded reader. Raw HTML/API evidence is excluded from runtime downloads.
No private source, released core, APK or model was changed. More collection and substantive
source sections remain ahead of compatibility/installer work. Evidence:
`research/definition-specialties-2026-09-22.json`. Prepare DEV version
`2026.09.22-specialties-2` through the existing preparer.

## Product outcome

An optional offline reference inside MiniMed: find a term by name or remembered description, open the source definition and complete criterion/context blocks, compare source variants, and inspect origin/history where supported. The phone must not load the entire JSON corpus into JavaScript to perform a lookup. Continue broad source collection, but count meaningful coverage and preserve unresolved records instead of padding the count.

## Starting evidence

Starting code: `4ec354452750bda59b2cab6cce3447ffabe6e1bb`.
The development catalog has 18,133 source/editorial records, not 18,133 reviewed canonical concepts. The separately returned owner-only psychiatry module has 450 records and is not public repository content. The previous full JSON-index audit took 5,597.5 ms to construct; current process RSS was 1,033,625,600 bytes. This includes the runtime and audit, not incremental Android memory. See `research/mass-definitions-delivery-2026-09-21.md`.

The original `definition-draft-lookup.ts` imported every JSON collection; R2 removes that preview from the mounted application. The reviewed `knowledge_discovery_pack.py` gate must NOT be bypassed by promoting unreviewed extractions. Existing content/knowledge tables, installer, MedicalCore and native/WASM storage ownership remain the integration target.

## Current user priority — content first (2026-09-22)

The user explicitly permits breaking DEV code/file formats; backward-compatibility engineering
is not a requirement for this development stage. Current execution order is **R3/R5 content
collection, source-fidelity QA and database rebuilds**, then content-driven search improvements.
R2 streaming/device/lifecycle work is deferred, not falsely marked complete. Personal data,
source traceability, clinical-review and publication-rights boundaries remain unchanged.
See [the dated scope override](research/definition-content-priority-2026-09-22.md).

## Execution order and acceptance

### R1 — SQLite projection and bounded storage access (implemented; host checks passed)

- [x] Implement an offline adapter for V1/V2/V3 definition inputs using the ordinary content-pack builder and schema. Retain original source-local identities until explicit canonical mapping exists.
- [x] Preserve source descriptors, input receipts, original names, exact block text/order, definition-versus-context roles, source locators, review/rights state and mention-only status. Namespace module-local numeric references and reject collisions/broken references.
- [x] Share source metadata and blocks. Create no approved knowledge facts, synonym relations, scale scoring or eponym authorship.
- [x] Provide a typed asynchronous storage port and a reader using an already-owned executor, not another native connection or OPFS worker. Search returns at most 20 headers. Detail is paged and read on demand.
- [x] Perform exact-name lookup before broader FTS, including short names/abbreviations. Parameterize values, enforce limits and avoid logging queries or source text.
- [x] Run integrity/foreign-key checks, source fidelity and malformed-input tests, ambiguity/mention regressions, complete-corpus conversion and fresh-process host measurements.

Implementation: `9f9a05f54f335be4de506b696b3c024a0dde7141`; successful run: https://github.com/T-Damer/MiniMed/actions/runs/35634470423. Migration `006_definition_reference.sql` adds the reference external-content FTS view/index; generated schema is synchronized. Ordinary clinical ranking and source texts are unchanged. The underlying storage fixture now compares every projected title by ID, because its existing query sorts by title rather than seed order; no ranking expectation was relaxed.

Measured full build: 18,133 entries, nine shared source records and 23,809 shared blocks. Reader replies contain at most 20 rows; block descriptors are paged in groups of eight and text in 4,096 Unicode-code-point slices. The synthetic real-SQLite run includes 21 assertions for lazy reads, context exclusion, membership checks, cursor bounds and supplementary-Unicode reconstruction.

The name audit found a nonempty result for all 13,146 indexed name surfaces. It checks source-name availability, not independent relevance, correct clinical interpretation, every homonym's position or reverse-search quality. Adapter creation was 0.634 ms **after the file was already opened**; exact-name lookup p50/p95 were 0.068/0.109 ms. Whole-process current RSS before open / after open / after audit was 57,942,016 / 60,227,584 / 115,838,976 bytes. These are host measurements with a 2 MiB SQLite page-cache setting, not Android PSS or a measured peak; the old JSON and new audits are not an identical end-to-end device comparison.

Evidence: `research/definition-reference-sqlite-build-2026-09-21.json`, `research/definition-reference-sqlite-runtime-2026-09-21.json`, `research/definition-reference-sqlite-fixture-2026-09-21.json`.

### R1b — Installed-size qualification (numeric and opt-in metadata passes verified; owner bindings open)

The original R1 projection was **159,125,504 bytes (151.75 MiB)**. The numeric-link pass produced **110,387,200 bytes**, preserving all 18,133 records and 40,625 logical links. Its same-run baseline with empty migration-007 structures was 159,154,176 bytes: **48,766,976 bytes saved, approximately 30.6%**. This is not yet a qualified general phone download. Gzip comparison was 27,393,160 bytes; it is not installed size or RAM.

The subsequent verbatim metadata pass is **opt-in, not the default**. On the same inputs/current schema it reduces SQLite from **110,395,392 to 105,783,296 bytes (4.18%)**, but gzip **increases from 27,393,572 to 28,112,736 bytes (2.63%)**. The baseline includes 8,192 bytes of empty migration-008 structures. Do not advertise a transport or memory improvement. Default R2 integration can use the numeric-only edition without this extra decoding layout.

- [x] Profile actual table, index, repeated identifier/provenance and annotation allocation using read-only storage diagnostics; do not guess which structure dominates.
- [x] Implement and measure compact internal navigation references while retaining stable external source identities, edition binding and every locator. No new parallel canonical graph or storage owner.
- [x] Recheck FTS integrity after final physical database compaction, and run complete source-text/identity/logical-link round-trip comparison on the resulting edition.
- [x] Rebuild and report installed bytes, transport comparison, per-table costs and bounded reader measurements. No substantive definitions, context, provenance or alternative meanings were removed.
- [x] Evaluate further measured chunk/provenance overhead without custom unsupported SQLite extensions. Implement and verify optional exact string-fragment metadata storage; retain its measured gzip regression and leave it disabled by default.
- [ ] Preserve module-local mappings needed by optional etymology/history annotations and qualify them with synthetic cross-reference fixtures before owner-module integration. Raw annotation preservation and metadata round-trip equality do not resolve their local references.

Numeric evidence: [R1b verification](research/definition-reference-r1b-verification-2026-09-21.md), implementation `df1c402377bfe1db276aeb588dd87925c5ba85fa`, run https://github.com/T-Damer/MiniMed/actions/runs/35641414351. Metadata evidence: [verbatim metadata verification](research/definition-reference-metadata-verification-2026-09-21.md), implementation `81f81f72731ba7af931b8f15d845cec2bf8df0c2`, run https://github.com/T-Damer/MiniMed/actions/runs/35651708320. All source rows and logical links were compared; decoded raw metadata matched exactly. The explicit layout-aware reader does not redirect generic clinical consumers. Completed temporary workflows were removed.

**Current priority: qualify the implemented R2 public-reference slice on target devices and remaining lifecycle failures**, not another speculative compression pass. This uses the already permitted R1/R1b baseline and does not waive phone, source-rights or lifecycle qualification. The unresolved annotation-mapping task must be completed before enabling owner-source annotations, while public-reference lifecycle work may proceed without loading an owner overlay. The current DEV UI uses the bounded reference capability.

### R2 — Existing installer, app composition and lifecycle (public browser slice implemented; device/lifecycle gates open)

- [ ] Route install/open/update/removal through the existing content-module installer and database owner. Validate schema, manifest, edition and hash before activation; retain the working edition if an update fails.
- [x] Expose bounded reference operations through the existing MedicalStore/MedicalCore/worker ports. Reuse the active store's executor and handle lifetime; do not reopen its OPFS pool or create a parallel registry. A backend lacking the capability must report unavailable, not silently load the JSON corpus.
- [x] Replace the default all-JSON definition preview with the bounded SQLite path. UI receives headers and loads full definition/context only when a card opens; UI imports no SQL/native libraries.
- [ ] Keep owner-only imports local and separate. Do not upload the supplied PDF, its text/profile or owner-derived fixtures to public CI/GitHub. Validate optional source-annotation mappings rather than assuming structural conversion proves them usable.
- [ ] Test interrupted/corrupt updates, offline restart, disable/remove, search after each transition, cancellation and stale-response races. Prove that whole-corpus text does not cross into UI memory.
- [ ] Exercise actual browser/app composition and Android. Measure native and WASM fallback separately where both are supported: cold/warm latency, baseline/incremental memory, install/open peak and actual installed/transport bytes. Include temporary binary-buffer copies during installation, not only warm SQL lookup.

R2 exit: install the reference, restart offline, search and open a complete sourced card in the normal application. No APK publication or merge without authorization. The full public DEV reference installs and opens through the actual App; Android/install-peak measurements and full update-failure matrix remain open. The public-reference slice must not implicitly enable unqualified owner annotations or the optional metadata layout on unsupported backends.

### R3 — Useful cards, extraction QA and conservative grouping (pending)

- [ ] Audit broken headings, sentence fragments, missing list items, contextual subtypes and tables needing review. Preserve originals and record issues instead of silently rewriting them.
- [ ] Group only source variants with an established shared concept identity. Identical titles do not prove equivalence; retain distinct senses and eponyms. Present alternate sources without filling the first page with duplicates.
- [ ] Separate source-fidelity review, clinical review, source authority and redistribution eligibility. A browsable review-required entry is not an approved clinical fact.
- [ ] Distinguish instrument mention, description, complete questionnaire and executable scoring. Never infer a “calculate” or “take test” action from a scale name.

R3 exit: understandable cards for confirmed concepts, explicit ambiguous alternatives and traceable source editions. No automatic harmonization of the 2006 textbook with modern guidance.

### R4 — Coverage and reverse-search work boundary (pending)

- [x] Register **SemIf** as a user-approved research candidate, not an installed dependency. Follow [the pinned candidate/evaluation note](research/semif-candidate-2026-09-21.md); no download, inference, adoption or diagnostic confidence is implied. R1b/R2 remain ahead of the experiment.
- [ ] Create approximately 200–300 varied development probes across terms, symptoms, syndromes, criteria and scales, with multi-target and corpus-absent/out-of-scope queries. This is a target, not completed independent clinician gold.
- [ ] Separate name availability, exact identity, candidate recall, concept ranking, source-variant visibility, no-answer behavior and latency. Source-text quotations are not independent paraphrases.
- [ ] Keep an independent clinician-authored holdout when available. Visible authored probes remain development tests, not clinical qualification.
- [ ] Coordinate with parallel general-search work: supply frozen corpus/IDs/probes and reproducible misses. Do not tune that ranking concurrently in this iteration or add every failing probe as an alias.
- [ ] Consider a local classifier only after candidate recall is measured. No current neural quality gain is established as shipped; exact names must not require a model.

### R5 — Continued expansion, etymology and history (pending)

- [ ] Expand by measured coverage gaps across verified and explicitly review-required source families. 20,000+ Russian source records is a target, not a ceiling or unique-concept count. Do not count empty cards, aliases or English MeSH text as Russian definitions.
- [ ] Report new concepts, fuller definitions, additional variants and unresolved mentions separately for each batch.
- [ ] Implement the sourced origin/root dictionary from `research/definition-catalog-and-etymology-2026-09-21.md`: original language/spelling, literal components, independent review and shared source/root references. Missing origins remain missing, not generated from word shape.
- [ ] Add historical reference through the same module/card architecture. Biography, naming history and discovery priority are separately sourced claims; a surname alone cannot establish authorship.

## Resource and safety gates

No arbitrary final device budget is advertised before measurement. The invariant is bounded query replies and on-demand context, not whole-corpus JS hydration. Source rights and integration remain explicit release gates. Production pack text, diagnoses, general ranking gold, user data, credentials and existing download ownership are not opportunistic refactoring scope.

## Progress log

- 2026-09-21: executable subplan established from the mass-extraction baseline.
- 2026-09-21: R1 implemented and verified on all 18,133 public records; 20 Python tests, 83 selected Vitest checks, strict Python/storage TypeScript checks and real file-backed reader assertions passed. The temporary verification workflow was removed after delivery; normal builder, migration, reader, verifier and reports remain.
- 2026-09-21: added R1b because the measured 159 MB installed projection was not yet the requested small phone package. R1b and R2 remain the priority; R3–R5 are open. No APK, released database or merge was performed.
- 2026-09-21: SemIf registered as an R4 candidate; no model was downloaded or run. Read-only baseline profiling saved in `research/definition-reference-r1b-baseline-profile-2026-09-21.json` before selecting the physical optimization.
- 2026-09-21: R1b numeric navigation and empty-FTS cleanup verified in `df1c402377bfe1db276aeb588dd87925c5ba85fa`. Installed bytes 159154176 -> 110387200; gzip comparison 27393160 bytes. Complete logical source/link equality and post-VACUUM FTS checks passed. 34 Python and 91 selected Vitest cases, strict type/schema checks and 21 file-backed reader assertions per synthetic layout passed. Full-corpus name availability remained 13146/13146, not independent relevance or reverse-search quality. Details and compatibility/measurement boundaries are in the R1b verification note.
- 2026-09-21: optional verbatim metadata pass verified in `81f81f72731ba7af931b8f15d845cec2bf8df0c2`: 48 Python / 22 selected Vitest cases, strict type/schema checks, full logical/source comparison, 13146/13146 name availability and 128 decoded source-block comparisons. Installed bytes 110395392 -> 105783296, gzip 27393572 -> 28112736. The transport regression is retained; the option stays disabled by default. R2 public-reference integration is now the next implementation priority; owner-annotation bindings remain required before enabling that optional path. No full-app, Android, clinical or SemIf qualification is implied.

- 2026-09-22: R2 public browser slice and explicit full-screen core/optional package setup verified. See `research/definition-reference-app-browser-2026-09-22.json` for exact input/run, bounded-card checks, full 18133-record install and restricted-network restart. Not Android or complete lifecycle/clinical qualification. Owner overlays and schema-8/9 application capabilities remain disabled.

- 2026-09-22 acquisition (superseded for runtime by the scope QA below): collected 5187 Russian Wikipedia introduction records, with 4208 previously absent normalized name surfaces and 979 existing names receiving another source. Current combined corpus: 23320. Exact source-text/location comparison passed for every new record in a real SQLite rebuild. These are unreviewed source descriptions, not completed/executable scales. DEV source manifest replaces the fixed-count preparer. Source and build evidence are in `research/definition-expansion-2026-09-22.json` and `research/definition-expansion-build-2026-09-22.json`.

- 2026-09-22 first-pass source-scope QA (superseded by corrected discipline matching below): source subset 4425 records; 763 acquired nonmedical-path records quarantined and 1 over-filtered records restored. Active total 22558; final SQLite 142057472 bytes, gzip 35404721 bytes. Original text is never rewritten; raw acquisition remains audit evidence, not runtime inputs. See `research/definition-intake-build-2026-09-22.json`. Continue content collection and source-gap work; runtime compatibility/device work stays deferred by user instruction.

- 2026-09-22 final content edition: 4680 new source descriptions, 22813 total, 3703 previously absent normalized names. 508 acquired nonmedical-path descriptions stay outside runtime inputs. Corrected exact person-category matching restores 255 medical records compared with the first intake. Actual SQLite/gzip sizes are 143761408/35894554 bytes; every new record's text and provenance matched, 65 selected tests passed. See `research/definition-intake-build-2026-09-22.json`. Continue terminology/source coverage, not compatibility work.
