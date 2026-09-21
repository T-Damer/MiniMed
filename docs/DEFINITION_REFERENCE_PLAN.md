# Definition reference: execution plan

Updated: 2026-09-21. Owner: draft PR #180, `experiment/system-one-search-benchmark`, stacked on #174. This plan refines `TECHNICAL_PLAN.md`; it does not authorize a merge, release, model download or architecture replacement.

## Product outcome

An optional offline reference inside MiniMed: find a term by name or remembered description, open the source definition and complete criterion/context blocks, compare source variants, and inspect origin/history where supported. The phone must not load the entire JSON corpus into JavaScript to perform a lookup. Continue broad source collection, but count meaningful coverage and preserve unresolved records instead of padding the count.

## Starting evidence

Starting code: `4ec354452750bda59b2cab6cce3447ffabe6e1bb`.
The development catalog has 18,133 source/editorial records, not 18,133 reviewed canonical concepts. The separately returned owner-only psychiatry module has 450 records and is not public repository content. The previous full JSON-index audit took 5,597.5 ms to construct; current process RSS was 1,033,625,600 bytes. This includes the runtime and audit, not incremental Android memory. See `research/mass-definitions-delivery-2026-09-21.md`.

The app's `definition-draft-lookup.ts` still imports every JSON collection and rebuilds the combined index for an owner overlay. The reviewed `knowledge_discovery_pack.py` gate must NOT be bypassed by promoting unreviewed extractions. Existing content/knowledge tables, installer, MedicalCore and native/WASM storage ownership remain the integration target.

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

### R1b — Installed-size qualification (numeric-link pass verified; remaining gates open)

The original R1 projection was **159,125,504 bytes (151.75 MiB)**. The measured numeric-link pass is now **110,387,200 bytes**, preserving all 18,133 records and 40,625 logical links. Its same-run baseline with empty migration-007 structures was 159,154,176 bytes: **48,766,976 bytes saved, approximately 30.6%**. This is not yet a qualified small general phone download. Gzip comparison is 27,393,160 bytes; it is not installed size or RAM.

- [x] Profile actual table, index, repeated identifier/provenance and annotation allocation using read-only storage diagnostics; do not guess which structure dominates.
- [x] Implement and measure compact internal navigation references while retaining stable external source identities, edition binding and every locator. No new parallel canonical graph or storage owner.
- [x] Recheck FTS integrity after final physical database compaction, and run complete source-text/identity/logical-link round-trip comparison on the resulting edition.
- [x] Rebuild and report installed bytes, transport comparison, per-table costs and bounded reader measurements. No substantive definitions, context, provenance or alternative meanings were removed.
- [ ] Reduce further measured chunk/provenance overhead without changing source fidelity or requiring custom unsupported SQLite extensions. Record actual additional savings and reader costs rather than setting an unmeasured target.
- [ ] Preserve module-local mappings needed by optional etymology/history annotations and qualify them with synthetic cross-reference fixtures before owner-module integration. Raw annotation preservation alone does not resolve their local references.

Evidence and reproducible commands: [R1b verification](research/definition-reference-r1b-verification-2026-09-21.md), implementation `df1c402377bfe1db276aeb588dd87925c5ba85fa`, successful run https://github.com/T-Damer/MiniMed/actions/runs/35641414351. All original source rows and logical links were compared before/after; migration 007 changes physical reference storage only. New readers explicitly dispatch by layout; general clinical consumers are not silently redirected. The two temporary R1b workflows were removed after successful delivery.

R2 development may use this reference edition, but it must not be presented as a compact general phone download until the remaining size/annotation gates and actual app/device measurements pass. The current DEV UI has not yet switched from JSON.

### R2 — Existing installer, app composition and lifecycle (pending)

- [ ] Route install/open/update/removal through the existing content-module installer and database owner. Validate schema, manifest, edition and hash before activation; retain the working edition if an update fails.
- [ ] Replace the default all-JSON definition preview with the bounded SQLite path. Never silently fall back to the unbounded index on error.
- [ ] Expose reference operations through the existing core/ports direction. UI receives headers and loads full definition/context when a card opens; UI imports no SQL/native libraries.
- [ ] Keep owner-only imports local and separate. Do not upload the supplied PDF, its text/profile or owner-derived fixtures to public CI/GitHub. Validate optional source-annotation mappings rather than assuming structural conversion proves them usable.
- [ ] Test interrupted/corrupt updates, offline restart, disable/remove, search after each transition, cancellation and stale-response races. Prove that whole-corpus text does not cross into UI memory.
- [ ] Exercise actual browser/app composition and Android. Measure native and WASM fallback separately where both are supported: cold/warm latency, baseline/incremental memory, install/open peak and actual installed/transport bytes.

R2 exit: install the reference, restart offline, search and open a complete sourced card in the normal application. No APK publication or merge without authorization. The current DEV UI is still the older JSON preview; R1/R1b alone did not fix its memory consumption.

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
- 2026-09-21: R1b numeric navigation and empty-FTS cleanup verified in `df1c402377bfe1db276aeb588dd87925c5ba85fa`. Installed bytes 159154176 -> 110387200; gzip comparison 27393160 bytes. Complete logical source/link equality and post-VACUUM FTS checks passed. 34 Python and 91 selected Vitest cases, strict type/schema checks and 21 file-backed reader assertions per synthetic layout passed. Full-corpus name availability remained 13146/13146, not independent relevance or reverse-search quality. Details and compatibility/measurement boundaries are in the R1b verification note. Optional annotation mapping, further metadata/size work and R2 remain open.
