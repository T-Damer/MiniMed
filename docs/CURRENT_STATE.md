# Current state and execution order

> Updated: 22 July 2026  
> Repository version: `0.3.1`

## Document role

`docs/TECHNICAL_PLAN.md` describes the target architecture and milestones. This file records the
implemented state and the order of the next repository tasks. Agents read it after `AGENTS.md` and
update it when a change affects runtime behavior, content coverage, trust boundaries, benchmark
composition, or execution priority. Benchmark details live in `tools/benchmarks/CLINICAL_QUERIES.md`;
module boundaries and lifecycle rules live in `docs/CONTENT_MODULES.md`; the experimental model
lifecycle lives in `docs/LOCAL_MODELS.md`.

## Product invariant

MiniMed is an offline-first navigator over Russian medical source material. Retrieval and exact source
navigation remain useful without a network, model, or hosted backend. Derived data never replaces the
source text and does not become trusted without an explicit review state.

## Implemented

### Runtime

- SolidJS application with Capacitor mobile shells and web development mode.
- `MedicalCore` boundary with UI-independent search and document contracts.
- Local SQLite/FTS5 retrieval, native read-only SQLite where supported, and SQLite WASM fallback.
- Deterministic feature-hash embeddings and hybrid retrieval.
- Russian long-query parsing, negative findings, weighted query branches, and missing-field hints.
- Results grouped by document and section type with ranking diagnostics.
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
- Experimental optional local-model harness: validated four-model catalog, startup device probe,
  deterministic automatic recommendation, browser/Android-WebView GGUF loading, cached Russian JSON
  warm-up benchmark, smaller-model fallback, bottom status toast, and System-page override/unload.

The semantic profile is an engineering baseline, not a neural Russian medical model. The local-model
harness currently proves loading and structured output only; no model output participates in medical
search or answers.

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
state. The separate regulatory pack adds 12 administrative/versioning retrieval scenarios.

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

## Current gaps

- Current clinical documents are concise navigation cards rather than complete extracted sources.
- No persistent installed registry, immutable published module artifacts, atomic filesystem installer, or
  background downloader yet; the module page remains read-only.
- The application composition still mounts the monolithic `0.3.1` pilot rather than the multi-store
  router.
- Seven clinical recommendations rather than the target 30–50.
- Regulatory coverage remains a small pediatric pilot; it needs broader administrative acts and a real
  amendment chain beyond one superseded predecessor.
- No reviewed offline medication-card runtime.
- Contract overlays cover only a representative subset and are not clinician-reviewed.
- No neural Russian embedding.
- The local model is experimental: no native LiteRT-LM/Cactus adapter, iOS runtime, streaming artifact
  hash verification, mirrored GitHub Release weights, physical-device measurements, or proven gain on
  Russian clinical retrieval.
- No personal notes, draft overlays, or local protocol modules.
- Physical-device usability testing remains separate from CI builds.

## Execution order

### P0 — Russian evidence and modular content foundation

1. **Complete benchmark contracts — #70**
   - The numerical target and first 12 validated contract overlays are implemented.
   - Expand coverage and obtain clinician review for consequential cases.

2. **Installable modules and full clinical sources — #78 + #76**
   - Module map/contracts/page, GitHub catalog refresh, multi-store routing, and rollback-state semantics
     are implemented.
   - Next: publish immutable module manifests/artifacts, persist the installed registry, implement
     foreground atomic install/update/rollback, and wire application composition to enabled stores.
   - Build the first full-text module from the seven already validated recommendations.
   - Full extracted text and structured tables belong in the index artifact; original PDFs/images are an
     optional matching source-assets artifact.

3. **Russian regulatory pack — #75**
   - Three-document, 12-query pilot and current-versus-superseded gate are implemented.
   - Next: publish it as a separately installable module and add broader administrative coverage.

### P1 — reviewed structured knowledge and local workflow

4. **Reviewed offline medication cards — #77**
   - Define the runtime contract outside the UI.
   - Expose only reviewed claims as trusted structured knowledge.
   - Keep missing fields visible and trace displayed claims to evidence.

5. **One-window continuation and personal overlay — #79**
   - Distinguish continuation from a new local episode.
   - Keep notes and aliases in a separate local trust layer rather than editing source packs.

### P2 — models after corpus and evidence depth

6. Benchmark Russian neural embedding candidates against lexical and feature-hash baselines.
7. Complete the experimental local-model path:
   - publish immutable model artifacts and checksums;
   - add native LiteRT-LM/Cactus adapters;
   - measure load, memory, latency, heat, and failure behavior on real devices;
   - evaluate all candidates on the Russian clinical contract suite.
8. Allow local classification or reranking to influence retrieval only when it improves the Russian suite
   within mobile budgets and preserves deterministic safety checks.
9. Add optional synthesis only after retrieval, provenance, omission, and citation gates are stable.

## Next useful alpha

The next alpha is defined by a small bundled core, immutable downloadable module artifacts, atomic
module installation, and one full-text pediatric module with structured tables and exact source
navigation. Already installed modules must remain usable during download or a failed update.

The model harness is an experimental parallel capability and must not displace full-source coverage,
reviewed evidence, or modular content lifecycle work. Do not prioritize a backend, accounts, sync,
Postgres, a Rust rewrite, or a universal local model.
