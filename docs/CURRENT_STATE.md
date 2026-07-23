# Current state and execution order

> Updated: 24 July 2026
> Repository version: `0.3.3`

## Document role

`docs/TECHNICAL_PLAN.md` describes the target architecture and milestones. This file records the
implemented state and the order of the next repository tasks. Agents read it after `AGENTS.md` and
update it when a change affects runtime behavior, content coverage, trust boundaries, benchmark
composition, or execution priority. Benchmark details live in `tools/benchmarks/CLINICAL_QUERIES.md`;
module boundaries and lifecycle rules live in `docs/CONTENT_MODULES.md`; clinical interaction rules
live in `docs/CLINICAL_UX.md`. Local-model runtime and selection details live in
`docs/LOCAL_MODELS.md` and ADR-0011; do not create a parallel model catalog or controller.

## Product invariant

MiniMed is an offline-first navigator over Russian medical source material. Retrieval and exact source
navigation remain useful without a network, model, or hosted backend. Derived data never replaces the
source text and does not become trusted without an explicit review state. Search is the primary
clinical workflow and must never be interrupted by update dialogs or local-model initialization;
module availability is shown only through a passive counter and the Modules page.

## Implemented

### Runtime

- JavaScript workspaces, bootstrap scripts, and GitHub Actions use the repository-pinned Bun 1.2.3
  runtime and frozen `bun.lock` installs.
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
- Validated content-module catalog/lifecycle contracts and a functional knowledge-base page.
- Module catalogs fail closed on duplicate IDs, missing dependencies, absent required core modules,
  mismatched source sets, or incomplete published artifacts.
- Multi-store routing composes a required core and enabled read-only module stores without merging their
  SQLite files; cross-store lexical results use reciprocal-rank fusion.
- A persistent installed-module registry stores validated active versions, rollback history, enabled and
  update state, immutable source-set identity, and transactional recovery across application restarts.
- Browser/Android-WebView module storage removes active pointers and version bytes atomically; failed
  physical rollback or removal restores the previous persistent registry snapshot instead of leaving
  metadata and SQLite artifacts inconsistent.
- After installation, removal, or rollback, MiniMed initializes a replacement multi-store `MedicalCore`
  in process and switches the UI only after it is ready; the previous search core remains active if the
  replacement cannot be initialized.
- The canonical module catalog is bundled as JSON and can refresh from GitHub with ETag/Last-Modified,
  validated local cache, and bundled fallback; invalid remote content never replaces valid local data.
- A portable foreground installer returns an asynchronous task immediately, verifies compatibility,
  dependencies, size, SHA-256 and index validation, activates only after staging, and restores the file
  pointer when registry activation fails.
- An optional local-model controller starts only after deterministic search is ready, loads a validated
  remote/cache/bundled catalog, probes the device, selects a compatible model, reports progress through a
  passive bottom toast, runs a short Russian structured-output viability check, caches success/failure,
  and falls back once to a genuinely smaller model.
- The initial model catalog contains Russian-tuned Vikhr/QVikhr candidates and Qwen, Gemma, and Llama
  comparison candidates. Manual override, unload, automatic-loading, and licence controls live on the
  System page.
- Browser and current Android WebView inference use a CPU/WebAssembly wllama adapter. Native GPU/NPU
  execution is not implemented and requires a later LiteRT-LM adapter and physical-device qualification.

The semantic profile is an engineering baseline. The optional local model is an experimental query-
planning runtime and is not a source of trusted medical facts or clinical advice.

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

A scheduled/manual hosted smoke workflow downloads and verifies the compact Vikhr and Qwen GGUF files
and requires valid structured Russian output through the CPU/WebAssembly runtime. It checks artifact and
runtime viability, not clinical quality or mobile GPU/NPU performance.

## Released 0.3.3 — local-model runtime foundation

Version 0.3.3 ships the model catalog, device probe, automatic and manual selection, status UI,
CPU/WebAssembly GGUF runtime, structured Russian warm-up probe, cached viability results, failure
cooldown, and a genuinely smaller fallback. It also persists installed-module registry metadata across
restarts.

This release establishes runtime viability only. Model output is not connected to clinical retrieval,
ranking, diagnosis, treatment, or generated answers. Before model output can influence the
physician-facing flow, it must use typed source-linked output, preserve deterministic red-flag and
negation handling, reject unsupported claims, and improve the reviewed Russian clinical benchmark.

## Current gaps

- Current clinical documents are concise navigation cards rather than complete extracted sources.
- Browser/Android-WebView artifact persistence and live multi-store recomposition are implemented, but
  native platform filesystem storage, a background downloader, source-assets, and physical-device
  lifecycle validation remain incomplete.
- Preview publishing workflows exist, but immutable release promotion and broader full-text module
  coverage still need end-to-end validation on installed devices.
- Seven clinical recommendations rather than the target 30–50.
- Regulatory coverage remains a small pediatric pilot; it needs broader administrative acts and a real
  amendment chain beyond one superseded predecessor.
- No reviewed offline medication-card runtime.
- Contract overlays cover only a representative subset and are not clinician-reviewed.
- The local-model runtime does not yet use generated output in clinical retrieval or answers, prove
  clinical improvement, stream-install artifacts with SHA-256, publish mirrored assets, or support
  native LiteRT-LM/Cactus and iOS inference.
- No personal notes, draft overlays, or local protocol modules.
- Physical-device usability and model-performance testing remain separate from hosted CI builds.

## Execution order

### P0 — Russian evidence and modular content foundation

1. **Complete benchmark contracts — #70**
   - The numerical target and first 12 validated contract overlays are implemented.
   - Expand coverage and obtain clinician review for consequential cases.

2. **Installable modules and full clinical sources — #78 + #76**
   - Module map/contracts/page, GitHub catalog refresh, multi-store routing, rollback semantics, the
     portable foreground installer, persistent registry metadata, browser artifact storage, and live
     in-process core recomposition are implemented.
   - Next: promote immutable module manifests/artifacts, add native filesystem/background download
     adapters, and validate install/update/remove/rollback on physical devices.
   - Build the first full-text module from the already validated recommendations.
   - Full extracted text and structured tables belong in the index artifact; original PDFs/images are an
     optional matching source-assets artifact.

3. **Russian regulatory pack — #75**
   - Three-document, 12-query pilot and current-versus-superseded gate are implemented.
   - Next: publish it as a separately installable module and add broader administrative coverage.

### P1 — 0.3.4 grounded local model and reviewed workflow

4. **Connect the local-model runtime to grounded retrieval**
   - Publish or freeze verified model assets/checksums without committing weights to Git.
   - Add a typed clinical orchestrator that can ask for another local retrieval pass and emit constrained
     source-linked structured output.
   - Keep deterministic safety checks outside the model and require exact source citations.
   - Benchmark default and fallback candidates on Russian clinical contracts, memory, storage, latency,
     and unsupported-claim rates before exposing generated clinical text.

5. **Reviewed offline medication cards — #77**
   - Define the runtime contract outside the UI.
   - Expose only reviewed claims as trusted structured knowledge.
   - Keep missing fields visible and trace displayed claims to evidence.

6. **One-window continuation and personal overlay — #79**
   - Distinguish continuation from a new local episode.
   - Keep notes and aliases in a separate local trust layer rather than editing source packs.

### P2 — model and corpus quality after the first working runtime

7. Benchmark Russian neural embedding and reranker candidates against lexical and feature-hash baselines.
8. Add native LiteRT-LM/Cactus adapters only through the existing runtime/selection contracts.
9. Add broader synthesis only after full-source coverage, reviewed medication knowledge and citation gates
   are stable.

## Next useful alpha

The next release is `0.3.4`: connect the 0.3.3 model runtime to exact retrieved evidence through typed
structured output and deterministic safety gates, while continuing module persistence and deeper
full-text clinical source work. The no-model path must remain complete and immediately usable.

Do not prioritize a backend, accounts, sync, Postgres, a Rust rewrite, or a second local-model harness.
The limiting factors remain full-source coverage, modular content lifecycle, reviewed evidence, Russian
benchmark depth and safe clinical integration of the existing runtime.
