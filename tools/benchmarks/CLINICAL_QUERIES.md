# Clinical query benchmark

MiniMed keeps benchmark questions outside the medical knowledge pack. A clinician query can test
retrieval and workflow behavior, but it is not itself an authoritative medical fact or an approved
answer.

The current committed benchmark contains 193 records: 120 natural-distribution clinician queries, 23
Russian synthetic edge cases, and 50 Russian source-grounded retrieval scenarios.

## Real-POCQi import

Real-POCQi contains 620 deidentified questions submitted by practicing US physicians across 30
specialties. MiniMed imports only the `questions` split; model answers and ratings are not treated as
ground truth.

```bash
bun run benchmark:queries:import

# Explicit reproducible parameters:
uv run --project tools/ingest medbase benchmark-import-real-pocqi \
  --count 120 \
  --seed minimed-real-pocqi-v1 \
  --output data/intermediate/clinical-benchmark/real-pocqi.jsonl \
  --report data/build/real-pocqi-import-report.json
```

The command:

- retrieves paginated JSON through the Hugging Face dataset server;
- caches each validated page below `.cache/localmed/clinical-queries/`;
- rejects duplicate IDs and duplicate normalized question text;
- creates a deterministic specialty-stratified sample of 120 questions;
- writes JSONL to the ignored `data/intermediate/clinical-benchmark/` workspace;
- writes a checksum and coverage report to `data/build/`;
- records source ID, record ID, citation, URL, language, jurisdiction, and CC BY 4.0 licence.

Use `--offline` to rebuild from the cache or `--snapshot path.json` to import a reviewed local JSON
snapshot in tests and controlled builds. Changing the count or seed intentionally creates a different
sample and therefore a different output checksum.

A live integration check asserts 620 source questions, 30 source specialties, 120 selected rows, and
complete provenance/review/licence fields. It remains separate from normal CI so an external service
outage cannot block unrelated application changes.

## Russian-first decision annotation

Imported wording remains immutable. A separate rebuildable projection classifies clinical queries:

```bash
bun run benchmark:queries:annotate

# Import and annotate in one command:
bun run benchmark:queries
```

`rule-based-ru-first-v1` uses Russian clinical language as the primary profile. It recognises Russian
patient descriptions, diagnostic and treatment questions, dose calculations, follow-up, routing, and
Russian administrative or regulatory wording. English rules are an explicit fallback for attributed
foreign datasets such as Real-POCQi; the original query remains `language: en`, `jurisdiction: US`.

The projection records source/detected language, jurisdiction, primary and secondary decision kinds,
lexical signals, confidence, review requirement, complexity, patient-context signals, word count, and
clause count.

The taxonomy covers urgency/routing, diagnosis/cause, diagnostic confirmation, test selection, result
interpretation, treatment selection or adjustment, dosing, medication safety, monitoring and follow-up,
prevention, prognosis, administrative questions, and educational reference.

## Russian coverage gate

`tools/benchmarks/russian-query-coverage.json` contains 23 explicit `synthetic_edge_case`-style Russian
queries across the decision classes. It covers patient descriptions, dose wording, treatment failure,
interactions, follow-up, vaccination, prognosis, military-fitness and regulatory language, misspellings,
colloquial phrasing, and mixed-script laboratory notation such as `Hb`.

The coverage set verifies language detection, primary decision, explicit patient context, and review
behavior. It runs in the strict Python test suite. Run `bun run benchmark:queries:coverage` for the focused
suite or `bun run python:check` for all Python gates. It is a software regression set, not a source of
medical recommendations.

## Russian source-grounded retrieval gate

The public-pilot benchmark loads two committed fixture files:

- `tools/benchmarks/pilot-rf-queries.json`: 42 scenarios grounded in exact sections and anchors of the
  seven current Russian clinical-recommendation cards;
- `tools/benchmarks/pilot-rf-drug-queries.json`: eight scenarios grounded in exact official Russian
  medication-registry records.

Every scenario fixes an expected document, version, source class, section type, and section-anchor
prefix. Clinical scenarios additionally fix the official recommendation ID. Medication scenarios fix
the registry record ID, registration number, authority tier, and `source_linked_summary` mode.

The benchmark verifies that retrieval:

- keeps the expected document within top five;
- finds a chunk in the expected section;
- resolves the exact stable chunk anchor through `getContext`;
- preserves active version and source-authority metadata;
- continues to use the hybrid and semantic paths.

The enforced gates require at least 0.90 document Recall@5, 0.90 section recall, and 0.70 top-section
accuracy. Context resolution and source metadata must remain 1.00.

Latest green 50-scenario baseline:

- Recall@1: `0.94`;
- Recall@5: `1.00`;
- MRR@5: `0.965`;
- section recall: `1.00`;
- top-section accuracy: `0.96`;
- exact context and source metadata: `1.00`;
- zero-result rate: `0`;
- latency p50: `14.59 ms`; p95: `24.29 ms`.

The medication-registry category scored `1.00` for Recall@1, section recall, exact context, and metadata.
These checks validate retrieval and source navigation. They do not turn registry identity into a dose,
indication, contraindication, interaction, or patient-specific recommendation.

## Scenario contract overlay

`tools/benchmarks/russian-scenario-contracts.json` enriches 12 representative Russian cases without
copying retrieval metadata. It records risk, required clarifications, dangerous omissions, evidence
classes, calculation boundaries, graph trust, and review state. Run:

```bash
bun run benchmark:queries:contracts
```

The command writes `data/build/russian-scenario-contract-report.json` with deterministic coverage counts.
The validator rejects unknown retrieval references, high-risk cases without omission checks, blocked
calculations without a reason, and proposed graph relations that are allowed to drive trusted guidance.
The contracts are workflow and safety expectations, not independent treatment recommendations.

Every scenario also resolves an automatic check profile without requiring authors to enumerate model
"wake-up" rules. Red-flag screening, source-coverage, applicability, contradiction, and uncertainty
checks apply to every contract. Medication safety, calculation safety, graph trust, and regulatory
temporal validity are added from the scenario evidence classes and capabilities. The report publishes
these inferred check counts so future runtime planners can be measured against the same always-on
contract.

## Provenance rules

- `real_clinician_query`: observed clinician question from an attributed dataset;
- `ru_source_reconstructed`: a separate Russian scenario derived from current Russian sources;
- `synthetic_edge_case`: an explicit workflow or safety test.

Translation does not change provenance, but replacing foreign drugs, workflows, or regulatory
assumptions creates a new `ru_source_reconstructed` record. Imported questions start as `candidate`.
They become `source_validated` only after expected Russian documents, entities, sections, and dangerous
omissions are fixed. `clinician_reviewed` requires an identified appropriate reviewer.

Real-POCQi attribution:

> Feng J, Patel V, Heagerty P, et al. Expert Evaluation of Clinical AI Tools on Real Point-of-Care
> Clinical Queries. 2026. arXiv:2606.28960. Dataset: `jjfenglab/Real-POCQi`, CC BY 4.0.
