# Local LLM contract for MiniMed 0.3.3

## Existing implementation baseline

Development continues from PR #91, `feat(models): auto-select and load local models`. Do not create a
parallel model catalog, selection algorithm, download UI, wllama adapter, or separate startup lifecycle.
The 0.3.3 work must reuse and extend the contracts and code already introduced there.

PR #91 already provides the intended first infrastructure slice:

- a validated remote/cache/bundled model catalog;
- Russian-prioritised model candidates and multilingual controls;
- device/runtime probing for memory, storage, CPU, WebGPU, network constraints and recent failures;
- automatic compatible-model recommendation and a manual Settings override;
- GGUF loading through the existing wllama browser/Android-WebView adapter;
- structured Russian JSON warm-up validation and a smaller-model fallback;
- explicit licence handling and immutable external model artifacts;
- deterministic search availability while model loading fails or remains incomplete.

That PR deliberately does not connect generated output to diagnosis, treatment, retrieval ranking or
clinical answers. The remaining 0.3.3 milestone is to turn the existing working local-model runtime into
a source-grounded clinical reasoning layer without weakening its current trust boundaries.

## Release objective

MiniMed `0.3.3` must contain a working local inference path on Android. A placeholder chat screen,
remote-only provider, deterministic template presented as AI, or model catalog without successful
inference does not satisfy this milestone.

The model remains a separately downloadable artifact. Automatic selection, manual override, download,
load, failure cooldown and smaller-model fallback should use PR #91 rather than being reimplemented.
The APK remains small and deterministic search remains fully usable without a model.

## Role of the model

The model may:

- decompose a free-form clinical case into structured observations;
- identify missing information and propose concise clarifying questions;
- choose which local indexes and document sections should be searched next;
- compare retrieved differential-diagnosis evidence;
- summarise retrieved fragments for the current question;
- explain why a result may or may not apply to the described patient.

The model must not be treated as a source of medical facts. It cannot introduce an unsupported dose,
contraindication, diagnosis, route, urgency class, legal requirement or document version. Claims without
matching local evidence are omitted or shown as unsupported.

## Mandatory execution order

```text
clinical query
→ deterministic parsing
→ mandatory red-flag and uncertainty pass
→ local retrieval
→ source/applicability filtering
→ constrained local-model inference from PR #91 runtime
→ deterministic output validation
→ cited UI response
```

The model may request another retrieval pass, but it cannot bypass mandatory checks or query the
internet. Original documents, stable anchors and exact fragments remain accessible from every answer.

## Always-on deterministic gates

The following gates run outside the model and cannot be disabled by model output:

1. red flags and urgent-routing signals;
2. source coverage and missing-evidence detection;
3. patient applicability, including age and other explicit restrictions;
4. contradictions between retrieved sources or document versions;
5. uncertainty and ambiguous-input detection;
6. citation completeness for consequential statements;
7. unsupported medication, dose and calculation rejection.

When a gate fails, MiniMed either narrows the answer, asks for clarification, shows conflicting evidence,
or falls back to ordinary search. It must not silently invent a completion.

## Structured output boundary

Inference output must be parsed through a versioned schema. The first clinical schema should contain:

- normalized case observations with references to original query spans;
- clarifying questions;
- retrieval requests;
- candidate topics or diagnoses with explicit uncertainty;
- evidence summaries linked to chunk IDs and document-version IDs;
- detected conflicts and missing evidence;
- model/runtime diagnostics compatible with PR #91 selection and failure records.

Raw free-form model text is not rendered directly as trusted clinical guidance.

## UI requirements

- Search remains the default screen and never waits for model loading.
- No startup modal or automatic generated answer covering deterministic results.
- Reuse PR #91 model status, progress and Settings controls; do not add a second model manager.
- Deterministic results appear first; the model-enhanced block is additive and independently dismissible.
- Every answer exposes exact source fragments before surrounding context or the complete document.
- The user can disable or unload the model without disabling local search.

## Acceptance gates for 0.3.3

A release candidate is accepted only when:

- PR #91 model catalog, selection, loading and fallback behavior remain green;
- at least one supported model performs real local inference on the Android target;
- the clinical structured-output adapter consumes the existing loaded-model runtime;
- malformed output and unsupported claims are rejected;
- cited claims open exact local source fragments;
- red flags, negations and uncertainty survive the model pass;
- a reviewed Russian scenario suite covers diagnosis, next diagnostics, differential diagnosis, treatment
  context, medication lookup, regulatory lookup and ambiguous neuroinfection input;
- memory, storage, TTFT, throughput and failure data are recorded through the existing model diagnostics;
- the deterministic workflow remains green with no model installed.

## Non-goals for 0.3.3

- replacing or duplicating PR #91 model infrastructure;
- training a MiniMed model;
- a universal autonomous diagnostic agent;
- replacing the source reader with generated prose;
- cloud dependency for basic operation;
- unrestricted calculations or prescribing;
- internet search by the model;
- hiding uncertainty or conflicting sources.
