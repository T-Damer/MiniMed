# Current state

> Updated: 25 July 2026
> Repository version: `0.6.0`
> Active target: `0.6.0` release candidate toward `1.0`

This file records what exists now and the next ordered work. The target architecture and acceptance
gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

## Implemented

### Product and retrieval

- SolidJS browser app behind the UI-independent `MedicalCore` contract.
- SQLite/FTS5 retrieval with SQLite WASM fallback and compatible native read-only storage adapters.
- Deterministic portable embeddings and hybrid lexical/vector fusion.
- Russian patient-case parsing, negative findings, bounded query branches, medical abbreviations, and
  missing-field prompts.
- Search after 500 ms of inactivity with stale-response cancellation.
- Results grouped by document with exact fragment, surrounding context, and full-document navigation.
- Search-result context remaps stale pilot-summary chunks to installed full-text siblings and falls back
  to the readable document when an exact chunk cannot be resolved.
- Initial results are limited to five documents with an accessible control to reveal the rest.
- Explicit search scopes: diagnosis support, clinical recommendations, medications, legal documents,
  and deterministic search across all installed sources.
- Only diagnosis scope may call the optional grounded local-model wrapper; the other scopes constrain
  deterministic retrieval by installed source type.
- A realistic pediatric workflow query — `Цефтриаксон ребенку 3 лет вес 20 кг при пневмонии как
  второй антибиотик` — is part of the retrieval benchmark.

### Browser workspace

- Three primary sections: search, knowledge base/documents, and settings.
- First-run search asks the clinician to choose the task before unlocking the query field.
- Recent device-local search history appears beside the active search instead of as a separate page.
- The paper/archive design remains, with materially smaller gutters, cards, controls, result rows,
  module tiles, model tiles, and responsive mobile spacing.
- Settings distinguish always-available offline search from the optional local model and expose model
  size, requirements, advantages, limitations, and automatic-load preference.
- Diagnosis mode includes a visible explanation that local model output can be wrong, must remain
  source-grounded, and does not replace clinical responsibility.
- The landing page and browser app are built together for GitHub Pages; the application is published
  below the site at `/app/`.
- WebExtensions-style localization uses `_locales/<lang>/messages.json` with a bundled
  `browser.i18n.getMessage` shim; the default UI locale is Russian.

### Local model

- Validated remote/cache/bundled model catalog and device selection.
- Browser CPU/WebAssembly GGUF runtime with a structured-output viability probe.
- Optional compact query planning and reranking over at most six retrieved chunks.
- Exact-source diagnostic candidate extraction.
- Exact-source dose extraction only from a treatment chunk containing both a numeric dose and regimen.
- Candidate-ID, text-length, exact-substring, category, and dose-pattern validation.
- One cited chunk must independently support the label, exact excerpt, and treatment classification;
  evidence cannot be assembled across unrelated citations.
- The default browser path uses the catalog's immutable upstream model asset rather than an unavailable
  release mirror.

The model cannot open the network, change the corpus, create a citation, calculate a dose, or hide the
ordinary search response when validation fails.

### Content and downloads

- Deterministic preparation, Markdown validation, stable IDs, provenance, and SQLite building.
- Public/private source registries with rights metadata and extraction diagnostics.
- Official Ministry API inventory for 744 recommendations, a resumable PDF mirror plan, and one
  deterministic source registry per recommendation.
- All 744 source PDFs are mirrored locally; 723 text-layer documents build into verified individual
  search modules and 21 scan-only documents are explicitly recorded for OCR.
- PDF import detects broken Cyrillic font encodings and retries with Tesseract `rus+eng` when available.
- Corpus lint now also rejects English-dominant output for a source expected to remain Russian, so OCR
  or a model cannot silently replace the original wording with an English translation.
- Immutable clinical-snapshot packaging creates one SQLite module per recommendation, source-PDF
  archives by category, checksums, and a channel-catalog fragment.
- The knowledge base lists individual recommendations under 21 visible medical sections and supports
  individual or section-level installation.
- Official GRLS inventory contains 38,815 unique registration records from 140,274 status/version rows,
  with the source ZIP, edition, and checksums retained locally.
- Current official instruction synchronization covers eight pilot medications; seven text-layer PDFs
  build into a 130-chunk SQLite pack and the oseltamivir scan remains explicitly blocked on OCR.
- Public Russian starter pack: seven clinical navigation cards and eight medication-registry identity
  cards.
- Structured knowledge tables support proposed facts, exact evidence links, relations, and review tasks.
- Interrupted module downloads persist partial bytes in IndexedDB. Failed/interrupted installs remain in
  a durable local queue, recover after restart or catalog refresh, and expose an explicit retry action.
- The runtime fingerprints actual module versions, digests, URLs, checksums, and sizes rather than only
  comparing catalog counts.

## Verified baseline

The 0.6.0 public starter pack rebuild contains:

- 15 documents, 58 sections, 58 chunks, and 28 clinical aliases;
- SQLite integrity `ok`;
- zero foreign-key violations;
- 58 deterministic embeddings.

The current benchmark contains 58 Russian clinical and medication retrieval cases:

- every expected document is found in the first five results;
- 57 of 58 expected documents are ranked first in all-source mode;
- the pediatric ceftriaxone workflow ranks the pneumonia recommendation first and the ceftriaxone
  registry card second in all-source mode; medication scope removes the unrelated clinical document;
- exact context, section, and source-metadata resolution remain release gates.

Chromium coverage includes search onboarding, source scopes, integrated history, mounted-route state,
document reading, source-context expansion, module lifecycle, and responsive application navigation.
The complete release candidate still requires the final CI/E2E/Android run on the release head.

A cents-scale Replicate knowledge-extraction pilot is configured for four public starter-pack excerpts.
It has a hard estimated cost cap of `$0.25`, persists no raw model prose, accepts only proposed records,
and records schema validity plus exact-evidence-quote rate. Its measured result must be recorded before
scaling remote processing.

## Known limits

- Clinical starter documents are concise source-linked cards; the separately installable snapshot
  contains the complete extracted text-layer recommendations.
- Twenty-one scan-only recommendations and the selected oseltamivir instruction still require verified
  OCR before they can be advertised as searchable full text.
- Medication registry cards establish identity, form, strength, and registration status; they do not
  establish a verified regimen.
- The full GRLS export has no confirmed ATC field, so most catalog records remain visibly unclassified.
- The installed corpus must abstain from dose output when no supplied source contains the exact regimen.
- Local-model clinical quality has not yet been qualified on a sufficiently broad reviewed Russian set.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- Physical Android interruption, memory-pressure, and local-model inference qualification remain release
  follow-up checks even when the debug APK and browser automation are green.
- Personal patient notes, nested records, and local Russian transcription are not implemented in 0.6.0.

## Ordered next work toward 1.0

1. Finish the 0.6.0 release gates: CI, Chromium E2E, Android artifact verification, Pages `/app/`, and
   the measured Replicate pilot decision.
2. Rebuild and publish the immutable clinical snapshot with the Russian OCR/encoding gates enabled.
3. Add verified OCR for the 21 scan-only recommendations and the blocked drug instruction.
4. Expand real Russian clinician-query, unsupported-answer, and source-scope benchmark coverage.
5. Add a local-only personal patient overlay with nested notes, explicit export/delete, and a separate
   trust layer; then evaluate an optional downloadable Russian on-device transcriber.
6. Qualify bundled local models on citation fidelity, abstention, latency, storage, and memory before
   presenting diagnostic assistance as a 1.0 capability.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.
