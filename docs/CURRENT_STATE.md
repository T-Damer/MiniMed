# Current state and execution order

> Updated: 21 July 2026  
> Repository version: `0.3.1`

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
- The direct pilot build and automated cached rebuild use the same declared 15-document source
  composition and knowledge modules.
- Public clinical/medication pilot: seven Russian clinical-recommendation cards and eight official
  medication-registry identity cards.
- Separate regulatory pilot: two active pediatric Minzdrav orders plus one superseded predecessor,
  with official publication metadata, effective dates, source-linked clauses, and replacement links.

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

- Seven clinical recommendations rather than the target 30–50.
- Regulatory coverage remains a small pediatric pilot; it needs broader administrative acts and a real
  amendment chain beyond one superseded predecessor.
- No reviewed offline medication-card runtime.
- Contract overlays cover only a representative subset and are not clinician-reviewed.
- No neural Russian embedding or local generative model.
- No personal notes, draft overlays, or local protocol modules.
- Physical-device usability testing remains separate from CI builds.

## Execution order

### P0 — Russian evidence and quality foundation

1. **Complete benchmark contracts — #70**
   - The numerical target and first 12 validated contract overlays are implemented.
   - Expand coverage and obtain clinician review for consequential cases.

2. **Russian regulatory pack — #75**
   - Three-document, 12-query pilot and current-versus-superseded gate are implemented.
   - Next: broader administrative coverage and a longer amendment/version chain.

3. **Scale the Russian clinical corpus — #76**
   - Grow to 30–50 current recommendations in a coherent initial specialty scope.
   - Add source-grounded section scenarios with every new document.

### P1 — reviewed structured knowledge and content lifecycle

4. **Reviewed offline medication cards — #77**
   - Define the runtime contract outside the UI.
   - Expose only reviewed claims as trusted structured knowledge.
   - Keep missing fields visible and trace displayed claims to evidence.

5. **Content-pack install/update/rollback hardening — #78**
   - Separate core, specialty, medication, and regulatory packs.
   - Verify checksums, atomic update, rollback, enabled-pack filtering, and interrupted updates.

6. **One-window continuation and personal overlay — #79**
   - Distinguish continuation from a new local episode.
   - Keep notes and aliases in a separate local trust layer rather than editing source packs.

### P2 — models after corpus and evidence depth

7. Benchmark Russian neural embedding candidates against lexical and feature-hash baselines.
8. Add a local classifier or reranker only when the Russian suite improves within mobile budgets.
9. Add optional synthesis only after retrieval, provenance, omission, and citation gates are stable.

## Next useful alpha

The next alpha is defined by a larger current Russian corpus, expanded regulatory coverage, green
Russian clinical, medication, and regulatory benchmarks, explicit review states, reproducible offline
pack updates, and unchanged source access with all model adapters disabled.

Do not prioritize a backend, accounts, sync, Postgres, a Rust rewrite, or a universal local model. The
current limiting factors are corpus coverage, reviewed evidence, Russian benchmark depth, and content
lifecycle reliability.
