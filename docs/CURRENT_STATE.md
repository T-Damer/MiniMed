# Current state and execution order

> Updated: 21 July 2026  
> Repository version: `0.3.0-alpha.6`

## Document role

`docs/TECHNICAL_PLAN.md` describes the target architecture and milestones. This file records the
implemented state and the order of the next repository tasks. Agents read it after `AGENTS.md` and
update it when a change affects runtime behavior, content coverage, trust boundaries, benchmark
composition, or execution priority. Benchmark composition and provenance details live in
`tools/benchmarks/CLINICAL_QUERIES.md`.

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

The semantic profile is an engineering baseline, not a neural Russian medical model.

### Content pipeline

- Deterministic preparation, Markdown parsing, chunking, stable IDs, provenance, and SQLite building.
- Cache-backed automated database rebuild from declared sources.
- Public and private source registries with rights metadata, checksums, and extraction diagnostics.
- The direct pilot build and automated cached rebuild now use the same declared 15-document source
  composition and knowledge modules.
- Public pilot: 15 source-linked documents and 58 searchable chunks:
  - seven Russian clinical-recommendation navigation cards;
  - eight official Russian medication-registry identity cards.

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

The current composition is 193 records:

- 120 deterministic Real-POCQi clinician queries with original language and jurisdiction retained;
- 23 Russian parser, intent, morphology, workflow, and safety edge cases;
- 50 Russian source-grounded retrieval scenarios:
  - 42 tied to exact sections and anchors in seven clinical recommendations;
  - eight tied to exact official medication-registry records.

Twelve representative Russian scenarios also have contract overlays for risk, required clarifications,
dangerous omissions, evidence classes, blocked calculations, graph trust, and review state.

Latest green source-grounded baseline on the real 15-document SQLite pack:

- Recall@1: `0.94`;
- Recall@5: `1.00`;
- MRR@5: `0.965`;
- section recall: `1.00`;
- top-section accuracy: `0.96`;
- exact context resolution: `1.00`;
- source metadata validation: `1.00`;
- zero-result rate: `0`;
- hybrid and semantic usage: `1.00`;
- latency p50: `14.59 ms`; p95: `24.29 ms`.

The eight medication-registry scenarios scored `1.00` on Recall@1, section recall, exact context, and
source metadata validation. Russian release checks verify document version, source class, authority
metadata, section type, stable chunk anchor, and exact context resolution. Foreign-query performance is
reported separately and cannot compensate for a Russian regression.

## Current gaps

- Seven clinical recommendations rather than the target 30–50.
- No first-class Russian regulatory-act content pack.
- No reviewed offline medication-card runtime.
- Contract overlays cover only a representative subset and are not clinician-reviewed.
- No neural Russian embedding or local generative model.
- No personal notes, draft overlays, or local protocol modules.
- Physical-device usability testing remains separate from CI builds.

## Execution order

### P0 — Russian evidence and quality foundation

1. **Complete benchmark contracts — #70**
   - The numerical target and first 12 contract overlays are implemented.
   - Expand coverage, add evidence-assembly checks, and obtain clinician review for consequential cases.

2. **Add a Russian regulatory pack — #75**
   - Preserve authority, version, status, effective dates, source spans, and stable anchors.
   - Add at least ten Russian administrative/regulatory scenarios.

3. **Scale the Russian clinical corpus — #76**
   - Grow to 30–50 current recommendations in a coherent initial specialty scope.
   - Add source-grounded section scenarios with every new document.

### P1 — reviewed structured knowledge and content lifecycle

4. **Reviewed offline medication cards — #77**
   - Define the runtime contract outside the UI.
   - Expose only reviewed claims as trusted structured knowledge.
   - Keep missing fields visible and trace displayed claims to evidence.

5. **Content-pack install/update/rollback hardening — #78**
   - Separate core, specialty, medication, and later regulatory packs.
   - Verify checksums, atomic update, rollback, enabled-pack filtering, and interrupted updates.

6. **One-window continuation and personal overlay — #79**
   - Distinguish continuation from a new local episode.
   - Keep notes and aliases in a separate local trust layer rather than editing source packs.

### P2 — models after corpus and evidence depth

7. Benchmark Russian neural embedding candidates against lexical and feature-hash baselines.
8. Add a local classifier or reranker only when the Russian suite improves within mobile budgets.
9. Add optional synthesis only after retrieval, provenance, omission, and citation gates are stable.

## Next useful alpha

The next alpha is defined by a larger current Russian corpus, a first regulatory pack, green Russian
clinical and medication source-grounded benchmarks, explicit review states, reproducible offline pack
updates, and unchanged source access with all model adapters disabled.

Do not prioritize a backend, accounts, sync, Postgres, a Rust rewrite, or a universal local model. The
current limiting factors are corpus coverage, reviewed evidence, Russian benchmark depth, and content
lifecycle reliability.
