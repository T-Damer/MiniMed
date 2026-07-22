# Current state and execution order

> Updated: 22 July 2026  
> Repository version: `0.3.2`

## Document role

`docs/TECHNICAL_PLAN.md` describes the target architecture and milestones. This file records the
implemented state and the order of the next repository tasks. Agents read it after `AGENTS.md` and
update it when a change affects runtime behavior, content coverage, trust boundaries, benchmark
composition, or execution priority. Benchmark details live in `tools/benchmarks/CLINICAL_QUERIES.md`;
module boundaries and lifecycle rules live in `docs/CONTENT_MODULES.md`; clinical interaction rules
live in `docs/CLINICAL_UX.md`. Local-model runtime and selection details are developed in PR #91 and
its `docs/LOCAL_MODELS.md` plus ADR-0011; do not create a parallel model catalog or controller.

## Product invariant

MiniMed is an offline-first navigator over Russian medical source material. Retrieval and exact source
navigation remain useful without a network, model, or hosted backend. Derived data never replaces the
source text and does not become trusted without an explicit review state. Search is the primary
clinical workflow and must never be interrupted by update dialogs; module availability is shown only
through a passive counter and the Modules page.

## Implemented

### Runtime

- SolidJS application with Capacitor mobile shells and web development mode.
- `MedicalCore` boundary with UI-independent search and document contracts.
- Local SQLite/FTS5 retrieval, native read-only SQLite where supported, and SQLite WASM fallback.
- Deterministic feature-hash embeddings and hybrid retrieval.
- Russian long-query parsing, negative findings, weighted query branches, and missing-field hints.
- A versioned Russian symptom-expression lexicon for colloquial abdominal, respiratory, urinary, and
  neuroinfection wording.
- Dedicated diagnostic-next-step and differential branches plus non-blocking clarifications for
  ambiguous neuroinfection queries; results remain visible while the clinician refines the case.
- Current medication remains an observable patient fact but is excluded from diagnostic retrieval
  evidence unless the query explicitly asks about treatment or a medicine.
- Search starts after 500 ms of inactivity, cancels stale responses, and preserves explicit history.
- Results are grouped by document and section type with ranking diagnostics and progressive disclosure:
  one best fragment first, additional matches on expansion, exact source fragment next, then surrounding
  context or the complete document.
- Searchable document archive with direct opening, readable medical-domain map, sticky reader header,
  in-document search, medical glyphs, and scroll-to-top navigation.
- Exact document, section, chunk, stable-anchor, and neighboring-context navigation.
- Local history and bookmarks.
- Validated content-module catalog/lifecycle contracts and a read-only module-map page.
- Module catalogs fail closed on duplicate IDs, missing dependencies, absent required core modules,
  mismatched source sets, or incomplete published artifacts.
- Multi-store routing composes a required core and enabled read-only module stores without merging their
  SQLite files; cross-store lexical results use reciprocal-rank fusion.
- An in-memory installed-module registry preserves full validated rollback records and protects required
  modules from disable/remove operations.
- The canonical module catalog is bundled as JSON and can refresh from GitHub with ETag/Last-Modified,
  validated local cache, and bundled fallback; invalid remote content never replaces valid local data.
- A portable foreground installer returns an asynchronous task immediately, verifies compatibility,
  dependencies, size, SHA-256 and index validation, activates only after staging, and restores the file
  pointer when registry activation fails.

The semantic profile is an engineering baseline, not a neural Russian medical model.

### Content pipeline

- Deterministic preparation, Markdown parsing, chunking, stable IDs, provenance, and SQLite building.
- Cache-backed automated database rebuild from declared sources.
- Public and private source registries with rights metadata, checksums, and extraction diagnostics.
- The direct pilot build and automated cached rebuild use the same declared 15-document source
  composition and knowledge modules.
- Public clinical/medication pilot: seven Russian clinical-recommendation cards and eight official
  medication-registry identity cards.
- Separate regulatory pilot: two active pediatric Minzdrav orders plus one superseded predecessor,
  with official publication metadata, effective dates, source-linked clauses, and replacement links.
- Target module map: required Russian core, seven pediatric clinical domains, medication, regulatory,
  and pediatric reference modules; every module supports a required index and optional source assets.

### Knowledge foundation

- Entities, names, medication profiles, facts, relations, evidence, document links, review tasks, and
  rebuildable search projections.
- Public medication pilot: nine entities, eight medication profiles, eight proposed registry facts,
  one proposed relation, nine evidence links, and three review tasks.
- Import rejects unknown entities, invalid evidence substrings, duplicate tasks, and malformed weights.
- Human approval is required before proposed facts or relations become reviewed.

No proposed medication fact is currently exposed as reviewed guidance. Registry identity does not by
itself establish broader clinical applicability.

### Benchmarks

The clinical/query composition is 193 records:

- 120 deterministic Real-POCQi clinician queries with original language and jurisdiction retained;
- 23 Russian parser, intent, morphology, workflow, and safety edge cases;
- 50 Russian source-grounded clinical/medication retrieval scenarios.

Twelve representative Russian scenarios have validated contract overlays for risk, required
clarifications, dangerous omissions, evidence classes, blocked calculations, graph trust, and review
state. The separate regulatory pack adds 12 administrative/versioning retrieval scenarios. The
clinical-case suite also verifies patient facts, negative findings, observable branches, warnings, and
top-ranked documents for respiratory, abdominal, urinary, uncertain-history, and therapy contexts.

Latest green clinical/medication source-grounded baseline on the real 15-document SQLite pack:

- Recall@1: `0.94`;
- Recall@5: `1.00`;
- MRR@5: `0.965`;
- section recall: `1.00`;
- exact context and source metadata: `1.00`;
- zero-result rate: `0`.

Regulatory baseline:

- Recall@1: `0.83`; Recall@5: `1.00`; MRR@5: `0.917`;
- required current/historical top-1: `1.00`;
- section, exact context, and official metadata: `1.00`.

## Planned 0.3.3 — complete the working local LLM path

The implementation baseline already exists in draft PR #91. It provides a validated model catalog,
device probing, deterministic automatic selection, manual override, model status UI, a wllama GGUF
runtime for browser and Android WebView, a structured Russian warm-up probe, failure cooldown and one
smaller-model fallback. After `0.3.2` is released, #91 should be rebased onto `main`; its catalog,
controller, selection logic and `docs/LOCAL_MODELS.md` remain authoritative.

`0.3.3` is complete only when that existing runtime is connected to MiniMed's clinical retrieval rather
than merely loading a model. The model remains a secondary reasoning layer over local evidence:

1. deterministic parsing and mandatory safety checks run first;
2. MiniMed retrieves exact local chunks and document metadata;
3. the model may structure the case, propose clarifying questions, plan further retrieval and summarise
   only the supplied evidence;
4. every consequential statement retains links to exact source fragments;
5. unsupported doses, contraindications, diagnoses or routing claims are omitted or explicitly marked as
   unsupported;
6. red-flag, source-coverage, applicability, contradiction and uncertainty checks run outside the model;
7. model failure, insufficient memory or no installed model falls back to deterministic search without
   blocking the clinician.

The search-first UX remains mandatory: no startup modal and no generated answer covering search results.
Model download/status stays in the existing #91 Settings/System surfaces and passive status UI. The
`0.3.3` gate must extend #91's runtime tests with source-citation completeness, unsupported-claim
rejection, red-flag preservation, structured-output validation and reviewed Russian clinical scenarios.

## Current gaps

- Current clinical documents are concise navigation cards rather than complete extracted sources.
- No persistent installed registry, immutable published module artifacts, platform filesystem backend, or
  background native downloader yet; the module page remains read-only.
- The application composition still mounts the monolithic `0.3.2` pilot rather than the multi-store
  router and foreground installer.
- Seven clinical recommendations rather than the target 30–50.
- Regulatory coverage remains a small pediatric pilot; it needs broader administrative acts and a real
  amendment chain beyond one superseded predecessor.
- No reviewed offline medication-card runtime.
- Contract overlays cover only a representative subset and are not clinician-reviewed.
- PR #91 loads and probes local models but does not yet use generated output in clinical retrieval or
  answers, prove clinical improvement, stream-verify model SHA-256, publish mirrored assets or support
  native LiteRT-LM/Cactus and iOS inference.
- No personal notes, draft overlays, or local protocol modules.
- Physical-device usability testing remains separate from CI builds.

## Execution order

### P0 — Russian evidence and modular content foundation

1. **Complete benchmark contracts — #70**
   - The numerical target and first 12 validated contract overlays are implemented.
   - Expand coverage and obtain clinician review for consequential cases.

2. **Installable modules and full clinical sources — #78 + #76**
   - Module map/contracts/page, GitHub catalog refresh, multi-store routing, rollback semantics, and the
     portable foreground installation state machine are implemented.
   - Next: publish immutable module manifests/artifacts, persist registry/files on each platform, and wire
     application composition to enabled stores and task progress.
   - Build the first full-text module from the seven already validated recommendations.
   - Full extracted text and structured tables belong in the index artifact; original PDFs/images are an
     optional matching source-assets artifact.

3. **Russian regulatory pack — #75**
   - Three-document, 12-query pilot and current-versus-superseded gate are implemented.
   - Next: publish it as a separately installable module and add broader administrative coverage.

### P1 — 0.3.3 local LLM and reviewed workflow

4. **Rebase and complete PR #91**
   - Preserve its catalog, device probe, selection algorithm, wllama adapter, UI and license handling.
   - Publish or freeze verified model assets/checksums without committing weights to Git.
   - Add a typed clinical orchestrator that can ask for another local retrieval pass and emit constrained
     source-linked structured output.
   - Keep deterministic safety checks outside the model and require exact source citations.
   - Benchmark the selected default and fallback candidates on Russian clinical contracts, memory,
     storage, latency and unsupported-claim rates before exposing generated clinical text.

5. **Reviewed offline medication cards — #77**
   - Define the runtime contract outside the UI.
   - Expose only reviewed claims as trusted structured knowledge.
   - Keep missing fields visible and trace displayed claims to evidence.

6. **One-window continuation and personal overlay — #79**
   - Distinguish continuation from a new local episode.
   - Keep notes and aliases in a separate local trust layer rather than editing source packs.

### P2 — model and corpus quality after the first working runtime

7. Benchmark Russian neural embedding and reranker candidates against lexical and feature-hash baselines.
8. Add native LiteRT-LM/Cactus adapters only through #91's existing runtime/selection contracts.
9. Add broader synthesis only after full-source coverage, reviewed medication knowledge and citation gates
   are stable.

## Next useful alpha

The next release is `0.3.3`: rebase and complete PR #91 so its already working model catalog, automatic
selection and wllama loading become a source-grounded clinical assistant with deterministic safety gates
and graceful no-model fallback. It should ship alongside continued module persistence work and at least
one deeper full-text clinical source slice so model quality is not evaluated only on short navigation
cards.

Do not prioritize a backend, accounts, sync, Postgres, a Rust rewrite, or a second local-model harness.
The limiting factors remain full-source coverage, modular content lifecycle, reviewed evidence, Russian
benchmark depth and safe clinical integration of the runtime already implemented in #91.
