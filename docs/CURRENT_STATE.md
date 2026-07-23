# Current state

> Updated: 24 July 2026
> Repository version: `0.4.0-alpha.1`
> Active target: `0.5.0-alpha.1`

This file records what exists now and the next ordered work. The target architecture and acceptance
gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

## Implemented

### Retrieval and UI

- SolidJS browser app behind the UI-independent `MedicalCore` contract.
- SQLite/FTS5 retrieval with SQLite WASM fallback and compatible native read-only storage adapters.
- Deterministic portable embeddings and hybrid lexical/vector fusion.
- Russian patient-case parsing, negative findings, query branches, aliases, and missing-field prompts.
- Search after 500 ms of inactivity with stale-response cancellation.
- Results grouped by document with exact fragment, surrounding context, and full-document navigation.
- Initial results limited to five documents with an accessible control to reveal the rest.
- Document library, history, bookmarks, knowledge-base catalog, and mounted-route state preservation.
- App-local `@/` import alias for source modules.

### Local model

- Validated remote/cache/bundled model catalog and device selection.
- Browser CPU/WebAssembly GGUF runtime with a structured-output viability probe.
- Optional compact query planning and reranking over at most six retrieved chunks.
- Exact-source diagnostic candidate extraction.
- Exact-source dose extraction only from a treatment chunk containing both a numeric dose and regimen.
- Candidate-ID, text-length, exact-substring, category, and dose-pattern validation.
- One cited chunk must independently support the label, exact excerpt, and treatment classification;
  evidence cannot be assembled across unrelated citations.
- Clickable citations, missing-information display, and deterministic fallback.

The model cannot open the network, change the corpus, create a citation, calculate a dose, or hide the
ordinary search response when validation fails.

### Content

- Deterministic preparation, Markdown validation, stable IDs, provenance, and SQLite building.
- Public/private source registries with rights metadata and extraction diagnostics.
- Public Russian pilot: seven clinical navigation cards and eight medication-registry identity cards.
- Structured knowledge tables with proposed facts, evidence links, and review tasks.
- Installable content-module catalog, registry, rollback metadata, and multi-store search routing.

## Verified baseline

On 24 July 2026 the public pilot rebuilt successfully:

- 15 documents, 58 sections, 58 chunks, and 18 clinical aliases;
- SQLite integrity `ok`;
- zero foreign-key violations;
- 58 deterministic embeddings.

The 50-query public-pilot benchmark after the current ranking fixes:

- Recall@1: `1.00`;
- Recall@5: `1.00`;
- MRR@5: `1.00`;
- section recall: `1.00`;
- top-section accuracy: `1.00`;
- context and source-metadata resolution: `1.00`;
- zero-result rate: `0`.

The browser suite passes the nine search, document, history, and navigation scenarios. The separate
module-lifecycle scenario requires generated regulatory E2E artifacts and does not run from a bare
checkout until those artifacts are built.

## Known limits

- Clinical documents are concise source-linked cards, not complete extracted recommendations.
- Medication cards contain identity, form, and strength, not verified dosing regimens.
- Therefore the current installed corpus can suggest diagnostic sources but normally must abstain from
  dose output.
- Model prompts and structural validation are implemented; clinical quality has not been qualified on
  real local-model outputs or reviewed by clinicians.
- Proposed medication knowledge is not reviewed guidance.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- Native mobile lifecycle and inference are not current priorities.

## Ordered next work

1. Ingest complete owner-provided clinical documents with page/block provenance.
2. Add benchmark cases for the supplied corpus, including unsupported-answer and dosing abstention
   checks.
3. Evaluate the bundled small models on exact citation, extraction, unsupported-claim, latency, and
   memory metrics.
4. Refine the browser clinical-answer layout using real source excerpts.
5. Add a selected-source update tracker only after local ingestion and versioning are stable.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
