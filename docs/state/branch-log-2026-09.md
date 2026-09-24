# Branch log — PR #174 and stacked PR #180 (September 2026)

> Moved verbatim from `docs/CURRENT_STATE.md` on 2026-09-24 so the mandatory state file stays short.
> Newest entries first; later entries supersede earlier ones.

## RapidFuzz medication experiment — 2026-09-24

Isolated RapidFuzz 3.14.6 OSA candidate experiment on the unchanged medication vocabulary: 929 deterministic existing/corpus-mutated spelling cases, 300 exact-name controls, and 10 negative non-medication controls. Current MiniMed matcher: Top-1 872/929, Top-8 906/929. RapidFuzz OSA with the same source-backed one-letter marker projection at cutoff 0.65–0.70: Top-1 889/929, Top-8 929/929, with 0/10 negative controls producing candidates. Candidate-loop timing on this CI host was about 1.69 ms/query for RapidFuzz versus 6.78 ms/query for the TypeScript matcher, but this is cross-runtime host evidence, not browser/Android qualification. The previous 162-case spelling set still has stronger Top-1 under the current matcher (162/162 vs RapidFuzz 160/162), so the measured direction is **current matcher first, permissive OSA fallback when the bounded matcher has no useful candidate**, not wholesale replacement. RapidFuzz remains experiment-only and is not an app dependency. Evidence: `research/rapidfuzz-medication-experiment-2026-09-24.md` and JSON receipt.

## Medication suffixes and selected definitions — 2026.09.23-suffix-1

Ordinary medication lookup now handles omitted one-letter source suffixes without deleting full source identities or editing explicit product markers. User Kanephron variants Top-1: 4 → 10/10; prior 162 regressions retained; 203 exact queries unchanged. Broader marked-name misses remain in `research/medication-suffix-2026.09.23-suffix-1.json`; these are developer tests, not independent clinician logs or device timing. Independently refetched 4 source definitions; ordinary offline reference has 8474 definition records and 7595 pending across 16069 retained identities. Source outcomes and SQLite/reader evidence: `research/selected-completions-2026.09.23-suffix-1.json`, `research/selected-completion-build-2026.09.23-suffix-1.json`. All new content stays local-dev/requires-review. No model, APK, public release, merge or automatic medical rules.

## Medication spelling lookup — 2026-09-23

Main ordinary lookup now adds bounded, labelled medication spelling candidates from the installed alias vocabulary: adjacent swaps, missing/extra letters and weighted Russian letter confusions. Exact known names remain unchanged; no dosage correction, medication substitution, clinical parser expansion or model dependency. Full corpus developer Top-1: 117 → 162/162; 113 exact-name result arrays unchanged. Passed 669 scoped JS tests, package/app typechecks, changed-file Biome, source-context and SQLite checks. These are mechanical and authored tests, not independent clinician error logs or device latency qualification. Corpus, timing and remaining boundaries: `research/medication-spelling-2026-09-23.json`. No content acquisition, APK, merge or release in this pass.

## Reverse definition handler — 2026-09-23

Added 4 selected MSD definitions and a bounded description-to-term path. Exact identity lookup remains first. Same-corpus developer Top-20: 10 → 30 / 32. All 12644 exact-name outputs are unchanged. This is not independent clinical search qualification. Full bounds, source limits and remaining misses: `research/definition-description-delivery-2026-09-23.md` and its JSON. No model, APK or release.


## Combined medical definitions and name completions — 2026-09-23

This combined measurement supersedes the separate selected-excerpt and clinic-completion
totals below. Ordinary preparer: **8433 definition records** and
**7632 still-empty discovered names**, **16065 searchable records**.
All 7637 discovery identities are preserved; 5
now contain sourced definitions. The separate medical-reference batch added
18 new source-definition records, without overwriting those completions.
No canonical same-as/base relationships or executable medical rules were inferred.
Passed 106 scoped Python tests. Compared all 34345 blocks,
27976 links and the exact identity/coverage set in ordinary SQLite.
Actual reader: 23 new/completed definitions readable with
intact source/discovery links; 23 Top-1 title results.
Files: 129769472 SQLite bytes / 26914582 gzip bytes.
Medical review, full concept reconciliation and independent reverse-search remain open.
Evidence: `research/combined-definition-content-2026-09-23.json`.
DEV version: `2026.09.23-combined-definitions-1`. No model, APK, release or merge.

## Targeted medical definitions — 2026-09-23

Added **18** short source definitions after inspecting 25
candidates; 7 already-indexed names were deferred, not merged or erased.
The ordinary edition now includes **8428 definition candidates** plus
**7637 preserved discovery-name records** (16065 total).
Source sentences, available authors/reviewers/dates and locators are retained. These are
inspected excerpts, not archived full HTML; source medical review/release review remain open.
All 26703 source blocks and 70 source
descriptors match the prepared projection. 85 scoped Python tests and strict
Python checks passed. Actual reader: 18/18
new title queries rank first. The source-derived phrase diagnostic is only
3/4 Top-20, with misses retained.
This is not independent clinical/reverse-search quality or Android qualification.
Actual files: 129712128 SQLite bytes / 26913162 gzip bytes.
Evidence: `research/selected-medical-definitions-delivery-2026-09-23.md` and its JSON.
DEV version: `2026.09.23-medical-definitions-1`. No model/UI/native changes, APK or release.
Next: continue named medical definition gaps and explicit base/differences authoring;
do not inflate the definition count with article headings or restored names.

## Clinical-site definition completions — 2026-09-23

Filled **5** existing empty source-local name records with one exact,
concise medical definition each. No duplicate term cards or encyclopedia prose were added.
Original identities, names, aliases and discovery-source annotation links remain unchanged.
Actual definitions: **8415**; searchable records: **16047**;
discovered names still needing content: **7632**.
Existing definitions and ambiguous/missing titles were left untouched. Source acquisition
inspected actual visible paragraphs under source robots policies; short excerpts only,
with author where available, dates, page/paragraph/quote hashes and Unicode offsets.
No medical approval, merged classification, executable scale or treatment rule.
Passed 79 scoped Python tests and strict checks, ordinary offline SQLite
build, exact identity/alias preservation and 34322 unchanged blocks.
Actual reader: 5 completed cards with matching source text;
named ID Top-20: 5/5.
Descriptive-query failures remain in the report; no independent search-quality gain claimed.
Evidence: `research/clinic-definition-completion-2026-09-23.json` and
`research/clinic-definition-acquisition-2026-09-23.json`.
DEV build: `2026.09.23-clinic-gaps`. No source book, model, APK or binary release uploaded.
Next: fill remaining actual definition gaps and source-backed classification differences;
resolve inverse-search coverage without discarding source names or padding aliases.

## Shared supplied-reference build — 2026-09-23

The ordinary reference preparer accepts an explicit `--supplied-root` and relative
`--supplied-manifest`. The registered PDF and prepared-excerpt receipts are validated before
the existing SQLite projection/compaction. Supplied definitions, abbreviation expansions and
other source reference records are counted separately; all share the normal source registry,
dictionary reader and module ID. Source hashes identify inputs, not clinical or textual approval.
No separate personal viewer or storage owner was introduced. No supplied text is committed.
CI used only synthetic receipts with the actual builders; evidence:
`research/supplied-reference-ci-2026-09-23.json`. Real supplied-source replay and the full combined
local edition are a separate companion measurement, not a claim about this CI runner.
Search and medical definition gaps remain primary; base-definition/differences reconciliation
and genuine reverse-search evaluation remain open. No model/UI migration, APK or release.

## Name coverage restored — 2026-09-23

The ordinary knowledge edition now contains **8410 definition candidates** plus
**7637 source-local discovered names** (16047 searchable records).
This restores vocabulary, not Wikipedia medical prose. Name-only entries have `needs-definition`,
only a source annotation link, and no definition-body FTS contribution. Existing source IDs,
texts and clinical review state remain unchanged. Names with the same title are not auto-merged.
Actual reader: 7637 recovered identities readable; 7637
name queries have a matching title in Top-20. Source-name variants are not unique concepts.
Verified 58 Python tests, reader unit tests, strict checks, app typecheck,
ordinary SQLite build and 26685 unchanged source blocks.
Installed file: 128147456 bytes; gzip: 26877059 bytes.
No new clinical definitions were acquired by this recovery, and no APK/model was integrated.
Base-definition + compact differences policy and located `Med/` inventory:
`research/reference-base-differences-and-library-2026-09-23.md`.
Research model output is separate; its success must not be inferred from this content run.

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

## Content-first dictionary expansion — 2026-09-22

Breaking DEV code/file formats are permitted by the user. R3/R5 source collection,
source-fidelity QA and database refreshes now precede more compatibility/installer work.
Existing personal data, source wording and provenance remain protected.

Acquired introductions before medical scope intake: 5187.
Active admitted new source records: **4680**.
Quarantined acquired descriptions: 508; restored
over-filtered source records: 1. The scope pass excludes
irrelevant cultural/consumer branches, while preserving medical alternate paths.
A first-pass person-category prefix mistake was corrected: medical histology and
gastroenterology branches are retained. All raw snapshots/shards remain audit evidence,
excluded from runtime inputs. Earlier acquisition/first-pass reports are not current totals.

Combined source/editorial corpus: **22813 records**. The new source
adds **3703** previously absent normalized name surfaces and
**977** additional source descriptions for known names.
These are not proven disjoint canonical concepts or reviewed clinical recommendations.
Supplied origin notes are unchanged; scale descriptions do not become executable scoring.
The owner textbook's 450 private records are separate and were not publicly uploaded.

Final SQLite: **143761408 bytes installed / 35894554 bytes
gzip**. All 4680 new records matched exact text and source
locators. 65 selected Python cases passed, including actual policy
regressions, plus strict authoring checks and SQLite integrity/foreign keys.
No new app/browser/Android or independent reverse-search qualification is claimed.

Runtime inputs are pinned in `content/definition-drafts/source-inputs.json`. Prepare
version `2026.09.22-terms-final` with the existing script. Generated database/descriptor
files stay local; no release or APK was published. Evidence:
`research/definition-intake-build-2026-09-22.json`,
`research/definition-expansion-2026-09-22.json`, and the collection's `intake-report.json`.

## Module payload lifetime and late cancellation — 2026-09-22

New index records use immutable Blob values in the existing IndexedDB versions store; legacy ArrayBuffer records remain readable without forced migration/redownload. Large Blob mounts reuse the OPFS owner without main-thread arrayBuffer materialization. Artifact checksums qualify new OPFS cache identities; source/record identities are unchanged. Byte-view hashing and Blob construction avoid redundant full-buffer pre-copies. Decompression still requires the full output buffer; this is not a fully streaming installer. Backward reading of old records is tested, not downgrading to an old application that does not understand Blob records.

Installer cancellation is checked after awaited verification/staging and before registry activation. Late activation cancellation restores its previous pointer. A cancelled operation must finish cleanup before a same-module retry; distinct versions cannot race each other's activation/restore. Restore/cleanup failures are visible failures, not successful cancellation. Source text and clinical ranking are unchanged.

Same-run before/after actual App verification uses the full public local-dev dictionary and synthetic core; installation, sourced bounded cards and database-network-blocked restart passed. Numeric evidence and exact test counts: research/module-payload-lifecycle-2026-09-22.json. CDP main-page samples are not total RAM, Android PSS, worker memory or process/install peaks. Full update/crash/device matrices and owner-source annotations remain open. No binary, private source, model, release or merge was published.

## Definition reference R2 and package setup — 2026-09-22

The actual App offers a full-screen first-run package list. Required core is bold and starred; other real catalog packages are optional with per-package status/progress. Closing preserves downloads and dismissal. Core consent uses the existing OPFS owner and pauses its deadline during human choice. Reconnect uses the same session factory; dictionary lookup waits for active-core capability, not just registry completion. Offline core recovery only accepts an unambiguous checksum-qualified cache name when HEAD cannot supply a size.

The normal search screen has a dictionary entry. Numeric schema-7 reference requests use the existing installer, registry, MedicalStore/MedicalCore and OPFS owner; ordinary clinical projections exclude the reference-only mount. The unbounded JSON preview is no longer mounted. The local public draft has 18133 source records, not reviewed canonical concepts; transport/installed sizes are 27399431/110960640 bytes. It remains local-dev, not a public download or released APK.

Headless Chromium exercised actual App/core consent, closure, the complete reference installer and sourced bounded card, followed by reload with database network reads blocked. Development JS/core-report remained served. Existing metadata-only catalog refreshes were blocked, not removed. Evidence: research/definition-reference-app-browser-2026-09-22.json; input 358b2ec6605b697f18c03d50ac3e073d35078801, run 35666818734.

Android/native, production/offline bundle, process/install peak memory, complete corrupt/interrupted update matrix and owner-PDF annotations remain unqualified. No private PDF, model, binary, Actions artifact, release or merge was published.

## Definition reference R1b — numeric link pass (2026-09-21)

Active plan: [DEFINITION_REFERENCE_PLAN.md](../DEFINITION_REFERENCE_PLAN.md). SemIf is registered
as an optional R4 research candidate, not downloaded or integrated. R1b/R2 remain the priority.

Read-only DBSTAT profiling established the baseline. A new compact builder keeps ordinary
content/knowledge identities and source text, but projects source-local navigation through
numeric entity/chunk keys (migration 007). The storage reader recognizes the explicit layout
and preserves schema-6 legacy behavior. It still uses the existing owner's executor.

Measured SQLite: 159154176 -> 110387200 bytes; gzip comparison
27393160 bytes. Every logical source table and all navigation links matched before/after,
including text, locators, order and annotations; FTS integrity was checked after VACUUM.
Source-name availability: 13146/13146. These are host
file-backed checks, not independent reverse-query quality or Android memory measurements.

The DEV UI is still the old JSON path. R2 installation/owner/core/UI integration is pending.
R1b still needs optional annotation-map qualification and further compact metadata work.
No model, private PDF, database binary, APK, release or merge was published. Numeric reports
are in research/definition-reference-r1b-*-2026-09-21.json.


## Definition reference execution — R1 (2026-09-21)

Active plan: [DEFINITION_REFERENCE_PLAN.md](../DEFINITION_REFERENCE_PLAN.md). R1 now projects
all 18133 public draft records into the existing content/knowledge tables, with
proposed source-local identities, shared source blocks, no approved facts/relations and an
external-content reference FTS index (numbered migration 006). It keeps the ordinary clinical
FTS/ranking untouched. The new storage adapter receives an already-owned executor; it does
not open another worker/connection. Searches return at most 20 headers; source text is read
only on request in 4,096-code-point pieces; block descriptors are paged in groups of eight.

Actual file-backed host measurements: SQLite 159125504 bytes; reader creation
0.634 ms; source names returning a result 13146/13146.
Fresh process RSS before open / after open / after audit:
57942016 / 60227584 / 115838976 bytes.
These are NOT Android PSS, a peak, or independent reverse-search quality. The audit reads
bounded batches of source names outside the reader. Reports: research/definition-reference-sqlite-*-2026-09-21.json.

R2 is next: wire this through the existing installer, database owner and MedicalCore/app,
then qualify offline restart/update/removal and actual mobile memory. The current DEV UI
still uses the older JSON preview until that integration is implemented; no silent switch,
no claim that the app memory issue is already fixed. No private PDF/text, SQLite binaries,
APK, model weights, release artifacts or merge are published by R1.


## Mass source definitions and owner-only overlays (2026-09-21)

The lightweight core contains mostly pointers, so its exhaustive scan added only 76
summary/tool-description records. A separate complete scan of 744
pinned clinical detail packs produced 11082 source-excerpt records, plus
987 separate mention-only review candidates. Original source
text, numbered criterion lists, source snapshots and exact chunk/anchor locators are retained.
These counts are source records, not disjoint canonical concepts or clinically qualified scales.
Combined DEV lookup has 18133 records. Source-name audit: 6480 Top-1
and 9842 Top-20 out of 11158 newly extracted records. All misses remain in
the report. Independent reverse-definition qualification is not established.

Owner PDF extraction is separate; this workflow does not measure or upload that source.

The actual Solid definition component was browser-tested in isolation with the real loader
and core: opt-in source loading, owner JSON import, local citations, invalid-file preservation
and no external network requests. Core typecheck and both definition unit suites passed.
No complete app build, production-bundle audit, physical-device or clinical validation is
claimed. Sources remain requires-review/local-dev; no APK, released data or merge occurred.
See the prepared/clinical extraction, lookup and component-browser reports under research/.

## Full Russian definition corpus — development preview (2026-09-21)

The optional definition preview now loads the complete released Russian Wiktionary medical
selection: **6939 senses / 6661 original names /
6940 supplied Russian glosses**, plus the 36 editorial starter
cards. These are source records, not a claim of that many disjoint canonical medical concepts.
Original `ruwikt.*` identities, source language, archive and record checksums, source line/sense
locators, attribution and CC-BY-SA-4.0 are retained. Source text is not labelled an editorial
paraphrase and neither source reputation nor corpus size promotes it to clinician-reviewed.

`scripts/build-definition-corpus.py` reuses the existing licensed prepared release; it does
not download the full multi-gigabyte dictionary onto a device. One source registry row with
numeric references replaces repeated source descriptions. Compact JSON: 4302994
bytes; deterministic gzip comparison: 999668 bytes. These figures exclude JS,
in-memory postings, SQLite and device overhead. The 16 MiB cap applies to an optional source
module, not a forced increase of the lightweight core.

Actual CI measurements: source-name Top-1 6637/6657;
reverse probes present in the combined corpus 36/40,
Top-5 16 of those present. Keep all misses in the JSON report; no
reverse-probe sentences were inserted into aliases. These are public authored development
probes, not independent clinician qualification. Original starter tests also ran separately.

The interface remains opt-in DEV-only. Browser rendering, production-bundle exclusion,
physical-device memory and a released optional-module delivery are not established by this
data/engine run. Existing APK and published SQLite packs are unchanged. Etymology remains
separately planned. See `bulk-definition-size-2026-09-21.json` and
`bulk-definition-quality-2026-09-21.json` in `docs/research` for actual evidence.

## Definition pilot and offline CPU demo (2026-09-20)

PR #180 adds an optional source-linked definition-draft pack and a research-only local CPU classifier demo. See `docs/research/local-definition-model-demo-2026-09-20.md` for the source/review boundary, commands and separate measurements. Definitions remain local-dev/proposed; no reviewed facts, same-as edges, released core or APK are replaced. The neural test was worse than deterministic ranking (19/33 versus 27/33); it is not enabled in the application. The new integration workflow uses the existing file-backed Bun SQLite adapter for the full corpus and checks CPU inference with networking blocked in the model process. Consult commit checks for execution status; authored tests are not automatically validated.

- MiniMed `0.6.39` ships optional Russian Wiktionary/Kaikki lexical downloads: seven gzip packages
  (index with source definitions plus six owner sections). Local selection: 6,939 senses, 6,940
  Russian glosses; no MeSH equivalence or clinical approval is inferred. Current-core + Russian-index
  reconstruction completed locally with 26,926 documents and 75,299 chunks, valid SQLite/FKs and
  unchanged source hashes. Published data remains `terminology-ru-2026.9.16`. See
  `RUSSIAN_TERMINOLOGY.md` for source rights, sizes and measurements. The discovery core is unchanged.

## Unreleased concept-first knowledge authoring — draft PR #174

- The existing `knowledge_entities/names/facts/relations/evidence` model is now treated as the
  canonical cross-domain identity layer rather than creating a second scale/term graph. A local-dev
  discovery builder can project selected reviewed entity types into compact ordinary MiniMed cards
  while retaining stable `conceptId`, aliases, tags, specialties and exact source locators.
- Clinical-recommendation SQLite can be scanned for review-only scales, questionnaires, criterion
  sets, classifications and severity/stage systems. Candidates remain `proposed`; quality-of-care
  criteria, methodology/evidence grading, TOC/reference noise and weak generic headings are filtered
  before review. The scanner can also use exact names/aliases from reviewed tool/knowledge SQLite as
  a separate inventory channel; inventory fingerprints are bound into the immutable workspace.
- On the same local respiratory verification slice of 3 clinical recommendations, the initial
  heuristic pass produced 47 proposed rows; context filtering plus the reviewed-name channel reduced
  the review queue to 23 (51.1% fewer rows). This is a candidate-quality smoke, not a claim of 23
  confirmed instruments; see `docs/research/knowledge-candidate-scan-respiratory-2026-09.md`.
- Explicit reviewer decisions can promote a candidate to a stable knowledge entity plus a reviewed
  source-document link. Promotion deliberately creates no definition, equivalence, scoring rule or
  cutoff. An existing assessment/calculator is linked only through an explicit reviewed tool ID plus
  matching local route; reference cards then expose a generic «Пройти»/«Рассчитать» action.
- Repeated stable entity IDs may be composed across knowledge modules: compatible aliases/list
  metadata merge, while conflicting types/external IDs/scalar metadata fail closed. Non-entity IDs
  remain strictly unique, and existing AI-enrichment merge semantics are unchanged.
- Discovery packs can optionally store one 384-byte int8 development vector per concept description
  chunk using the existing portable hash profile. This validates the current hybrid retrieval path;
  it is not a qualified neural semantic model.
- Search results/groups now carry optional canonical `conceptId` metadata. SQLite-WASM and
  Capacitor/native compact projections preserve the same field plus explicit `interactiveRoute`;
  document grouping/navigation is otherwise unchanged.
- GitHub Actions remain unused. The original discovery/candidate isolated harness passed 5 cases; the
  new review-promotion logic was executed separately against a reconstructed compatible SQLite
  harness and preserved the reviewed-vs-proposed boundary. Repository-pinned Ruff/Pyright/Vitest,
  full build and device checks remain required before the draft PR can be considered merge-ready.

## Unreleased search-quality evaluation — stacked draft PR #180

- Search quality is now split into two measured contracts instead of treating one hybrid benchmark as
  representative of every search surface. Ordinary lookup stays deterministic; free-form clinical
  retrieval is evaluated separately before any local decision model is considered.
- A corpus-derived lookup runner enumerates active document titles, editorial navigation aliases and
  declared search-expansion aliases from the evaluated `core.db` plus optional installed packs.
  Surface collisions are grouped rather than assigned an arbitrary single gold document. Titles and
  navigation aliases define strict identity Top-1; broad `declaredAliases` are recall surfaces rather
  than forced identities. The runner reports Top-1, Recall@20, body-only intrusions and
  alias-over-title inversions.
- Runtime ranking now treats an exact document title as a hard ordering invariant ahead of aliases,
  source phrases and numeric relevance score. This addresses the observed case where a directly named
  document could appear below a document that merely mentioned the term.
- The clinical challenge set uses diagnosis-free Russian formulations with answer-leakage validation,
  graded multi-document relevance, deliberate ambiguity and separate lexical/hybrid runs. Reports
  include Recall@20/@40, NDCG, MRR, section hit rate and corpus coverage so a missing pack is not
  misreported as a ranking failure.
- The existing Real-POCQi importer remains useful for natural clinician-query distribution, but its
  English/US questions are not treated as Russian MiniMed relevance labels. A production reranker
  decision still requires a private 200–300-query Russian clinician set outside the tuning context.
- A separate observed-coverage diagnostic records real/coverage-audit terms that corpus-derived
  tests cannot generate when the content is absent. It starts with the user-reported `Ясперс` miss
  plus PANSS/MMSE coverage probes and reports first-visible rank and propagated `conceptId` without
  conflating a missing concept with a reranking error.
- A measured GitHub-run benchmark now exists for the stacked search-quality work. On 500
  corpus-derived bundled-core surfaces, strict identity Top-1 was 99.68% and exact-surface Recall@20
  was 99.8%; one exact D32.0 title disappeared before Top-20, proving that candidate generation still
  needs an exact-identity retention path in addition to final ranking priority.
- On 33 diagnosis-free public-pilot clinical challenges, both lexical and real hybrid retrieval had
  100% relevant Recall@20/@40 but only 75.76% maximum-grade Top-1. Hybrid raised NDCG@5 only from
  0.891 to 0.896 and did not improve Top-1 while increasing median runner latency from about 53 ms to
  93 ms. Treatment Top-1 was 25% and respiratory Top-1 60%, making bounded reranking the next
  evidence-backed experiment rather than broader candidate expansion on this small set.
- Coverage probes confirm separate data gaps: `Ясперс` and PANSS are absent from bundled-core Top-20;
  MMSE is Top-1 with canonical concept identity propagated.
- No Laya/Jev-like model is added by this PR. GitHub Actions remain intentionally undispatched while
  repository artifact/storage quota is exhausted; the new runners and regression tests still require
  execution in a normal checkout before the draft can be considered validated.

## Retired one-shot workflows — 2026-09-24

Twelve self-triggering acquisition/verification workflows were removed after their outputs had been
committed: `clinic-definition-verify`, `definition-reliability-batch`, `msd-catalog-check`,
`msd-catalog-retry`, `msd-topic-intake-check`, `reference-annotation-check`,
`specialist-journal-{collect,inspect,intake,reference-build,shape}` and
`specialist-teaching-collect`. They ran on pushes to this branch that edited the workflow file
and wrote results back with `contents: write`. Research notes that cite them describe historical
runs; the definitions are in git history (parent of the retiring commit) if a rerun is needed.
The PR-triggered gates `search-quality-v2-benchmark`, `search-definition-local-model` and
`search-reranker-cross-encoder-poc` remain.
