# Local LLM contract for MiniMed 0.3.3

## Release objective

MiniMed `0.3.3` must contain a working local inference path on Android. A placeholder chat screen,
remote-only provider, deterministic template presented as AI, or model catalog without successful
inference does not satisfy this milestone.

The first supported model is downloaded as a separate optional artifact. MiniMed chooses a compatible
model automatically from the catalog using runtime availability, memory, storage, download size,
Russian-language quality and previous load failures. The user can replace that choice in Settings.
The APK remains small and the deterministic search workflow remains fully usable without a model.

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
→ constrained local-model inference
→ deterministic output validation
→ cited UI response
```

The model may request another retrieval pass, but it cannot bypass the mandatory checks or query the
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

Inference output must be parsed through a versioned schema. The first schema should contain only:

- normalized case observations with references to original query spans;
- clarifying questions;
- retrieval requests;
- candidate topics or diagnoses with explicit uncertainty;
- evidence summaries linked to chunk IDs and document-version IDs;
- detected conflicts and missing evidence;
- a model/runtime diagnostics block.

Raw free-form model text is not rendered directly as trusted clinical guidance.

## UI requirements

- Search remains the default screen and never waits for model loading.
- No startup modal, promotional popup or automatic full-screen generated answer.
- Model download and status belong to Modules or Settings, with passive counters and progress.
- Deterministic results appear first; the model-enhanced block is additive and independently dismissible.
- Every answer exposes exact source fragments before surrounding context or the complete document.
- The user can disable the model without disabling local search.

## Acceptance gates for 0.3.3

A release candidate is accepted only when:

- at least one catalog model downloads, verifies, loads and performs inference on the Android target;
- automatic selection and manual override both work;
- interrupted download, failed verification, out-of-memory and unsupported-runtime cases fall back safely;
- structured output validation rejects malformed or unsupported claims;
- cited claims open the exact local source fragments;
- red flags and negative findings survive the model pass;
- a reviewed Russian scenario suite checks diagnosis, next diagnostics, differential diagnosis, treatment
  context, medication lookup, regulatory lookup and ambiguous neuroinfection input;
- memory, storage, first-token latency, total latency and battery-sensitive limits are recorded per model;
- the ordinary deterministic workflow remains green with no model installed.

## Non-goals for 0.3.3

- training a MiniMed model;
- a universal autonomous diagnostic agent;
- replacing the source reader with generated prose;
- cloud dependency for basic operation;
- unrestricted calculations or prescribing;
- internet search by the model;
- hiding uncertainty or conflicting sources.
