# Current state

> Updated: 24 July 2026
> Repository version: `0.5.0-alpha.1`
> Active target: `0.5.0-alpha.1`

This file records what exists now and the next ordered work. The target architecture and acceptance
gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

## Implemented

### Retrieval and UI

- SolidJS browser app behind the UI-independent `MedicalCore` contract.
- SQLite/FTS5 retrieval with SQLite WASM fallback and compatible native read-only storage adapters.
- Deterministic portable embeddings and hybrid lexical/vector fusion.
- Russian patient-case parsing, negative findings, query branches, word-boundary-safe medical
  abbreviations, and missing-field prompts.
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
- Official Ministry API inventory for 744 recommendations, a resumable PDF mirror plan, and one
  deterministic source registry per recommendation.
- All 744 source PDFs are mirrored locally; 723 text-layer documents build into verified individual
  search modules and 21 scan-only documents are explicitly recorded for OCR.
- Immutable clinical-snapshot packaging: one SQLite module per recommendation, source-PDF archives
  by category, checksums, and a channel-catalog fragment.
- The knowledge-base screen can search individual recommendations, filter them by the 21 clinical
  categories, install one recommendation, or install the selected category.
- Official GRLS inventory for 38,815 unique registration records from 140,274 status/version rows,
  with the source ZIP, edition, and checksums retained locally.
- Current official instruction synchronization for the eight pilot medications; seven text-layer
  PDFs build into a 130-chunk SQLite pack and the oseltamivir scan is explicitly blocked on OCR.
- Selected recommendation versions are checked against the active official catalog before rebuild;
  a replacement blocks the rebuild until explicitly reviewed.
- Public Russian pilot: seven clinical navigation cards and eight medication-registry identity cards.
- Structured knowledge tables with proposed facts, evidence links, and review tasks.
- Installable content-module catalog, registry, rollback metadata, and multi-store search routing.

## Verified baseline

On 24 July 2026 the public pilot rebuilt successfully:

- 15 documents, 58 sections, 58 chunks, and 28 clinical aliases;
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
- The 744-recommendation snapshot has not been published. Its local build contains 723 searchable
  modules; 21 scan-only recommendations remain explicitly unavailable until OCR.
- Medication cards contain identity, form, and strength, not verified dosing regimens.
- The full GRLS export has no confirmed ATC field, so most medication catalog records remain in the
  visible unclassified module.
- One selected current drug instruction (oseltamivir) has no text layer and requires OCR.
- Therefore the current installed corpus can suggest diagnostic sources but normally must abstain from
  dose output.
- Model prompts and structural validation are implemented; clinical quality has not been qualified on
  real local-model outputs or reviewed by clinicians.
- Proposed medication knowledge is not reviewed guidance.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- Native mobile lifecycle and inference are not current priorities.

## Ordered next work

1. Publish the first immutable 723-module prototype snapshot and update the preview channel.
2. Add OCR only for the 21 explicitly blocked documents.
3. Add full-corpus retrieval and unsupported-answer benchmark cases.
4. Evaluate the bundled small models on citation, extraction, latency, and memory.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve the current rights
state without blocking local or preview builds.
