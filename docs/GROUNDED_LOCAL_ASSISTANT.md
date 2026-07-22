# Source-grounded local assistant

MiniMed's local model is an optional search assistant, not an autonomous clinical decision system.
The deterministic `MedicalCore` remains authoritative and fully usable when no model is installed.

## Runtime sequence

```text
free-text query
  → deterministic query analysis
  → deterministic SQLite retrieval
  → bounded candidate fragment list
  → optional local query plan and reranking
  → schema and candidate-ID validation
  → reordered existing sources or untouched deterministic fallback
```

The model receives at most a small set of already retrieved source fragments. Every candidate has a
stable chunk ID, document ID, section path and bounded snippet. The model cannot request another
source, open the network, change the corpus or install content.

## Allowed model outputs

The first grounded feature permits only:

- a short search-intent description that is not presented as a diagnosis;
- search terms grounded in the user's query and deterministic analysis;
- clarifying questions that could improve a later source search;
- a preferred order for exact candidate chunk IDs;
- short explanations of source relevance.

These values are parsed from bounded JSON. They do not enter the medical corpus or become reviewed
knowledge.

## Prohibited outputs

The model is not allowed to add:

- a diagnosis or differential diagnosis;
- treatment or routing advice;
- drug doses, schedules or calculations;
- facts absent from the retrieved source candidates;
- citations or identifiers not included in the deterministic candidate list;
- changes to source text, document metadata or review state.

## Fail-closed behavior

MiniMed returns the original deterministic response when:

- no validated local model session is ready;
- model initialization or generation fails;
- the response is not valid JSON;
- required fields have the wrong type;
- an output string exceeds the configured bounds;
- the model invents or changes a candidate ID;
- a newer search supersedes the running model request.

The UI states whether the source order was changed or whether the ordinary deterministic order was
used. Model failure never blocks source search or document reading.

## Current limits

This feature uses the current CPU/WebAssembly model runtime in browsers and Android WebView. It does
not yet prove acceptable speed, memory use or thermal behavior on physical Android devices. The
0.3.6/0.4.0 gates additionally require:

- a checksum-verified MiniMed-hosted model artifact;
- physical-device qualification;
- Russian negation, age, pregnancy, allergy, renal, route, unit and dose-boundary tests;
- a native LiteRT-LM path with CPU/GPU/NPU measurements where supported;
- evidence-linked answer formatting and unsupported-claim rejection before any generated clinical
  statement is exposed.
