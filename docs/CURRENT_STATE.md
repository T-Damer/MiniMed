# Current state and execution order

> Updated: 22 July 2026  
> Repository version: `0.3.1`

## Document role

`docs/TECHNICAL_PLAN.md` describes the target architecture and milestones. This file records the
implemented state and the order of the next repository tasks. Agents read it after `AGENTS.md` and
update it when a change affects runtime behavior, content coverage, trust boundaries, benchmark
composition, or execution priority. Benchmark details live in `tools/benchmarks/CLINICAL_QUERIES.md`;
module boundaries and lifecycle rules live in `docs/CONTENT_MODULES.md`.

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
- An experimental optional local-model controller starts only after core search is ready, probes the
  device, ranks compatible artifacts, loads GGUF through a browser/Android-WebView wllama adapter, runs
  a short Russian structured-output viability check, caches results, and falls back safely.
- The local-model comparison catalog includes Russian-tuned Vikhr 0.5B and QVikhr 1.7B candidates,
  generic Qwen controls, Gemma 3 1B, and an experimental native-only Llama 3.2 3B candidate.
- A bottom toast reports model probing/download/load state; Settings exposes automatic selection,
  manual override, automatic loading, unload, and explicit licence acceptance.

The semantic profile is an engineering baseline, not a neural Russian medical model. The local-model
harness is also an engineering viability experiment; its output is not connected to clinical search or
answers.

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

The startup model benchmark currently checks only initialization and valid compact Russian JSON. It
does not establish clinical quality. The six candidates still require comparative query-planning,
negation, retrieval, omission, latency, memory, battery, and thermal benchmarks.

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
- No neural Russian embedding profile.
- The local generative harness has no native LiteRT-LM/Cactus adapter, persistent verified artifact
  installer, published MiniMed mirror assets, physical-device benchmark, or clinical retrieval role.
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

### P2 — measured local models

6. **Local-model runtime viability**
   - The optional startup controller, six-candidate catalog, browser/WebView GGUF adapter, toast,
     settings, cached viability benchmark, and deterministic fallback are implemented experimentally.
   - Next: publish verified mirror artifacts and add persistent streaming installation with SHA-256.
   - Add native LiteRT-LM and Cactus adapters before judging Android performance.

7. **Russian model quality and device benchmarks**
   - Compare Vikhr/QVikhr with their generic Qwen controls, Gemma, and later high-memory candidates.
   - Measure structured query extraction, negation, clarification selection, retrieval gains, dangerous
     omissions, unsupported fields, valid JSON, latency, memory, battery, and thermals.
   - Do not route model output into retrieval or answers unless it beats deterministic baselines and
     passes the safety contracts.

8. **Optional grounded model roles**
   - Start with query planning or reranking over retrieved candidate chunks.
   - Add synthesis only after retrieval, provenance, omission, and citation gates are stable.

## Next useful alpha

The next alpha is defined by a small bundled core, immutable downloadable module artifacts, atomic
module installation, one full-text pediatric module with structured tables and exact source
navigation, and an optional model harness that degrades cleanly without delaying search. Already
installed modules must remain usable during download or a failed update.

Do not prioritize a backend, accounts, sync, Postgres, or a universal model that replaces deterministic
search. The current limiting factors remain full-source coverage, modular content lifecycle, reviewed
evidence, and Russian benchmark depth.
