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

## Russian lookup gate on the full corpus

The doctor-phrased query sets are committed as three files; each query names the documents of the
**full released databases** that answer it (any of them counts):

- `tools/benchmarks/clinical-guideline-queries.json`: 42 scenarios, six for each of seven pediatric
  recommendations, expecting `kr.rf.<official id>` (`714_2` pneumonia, `281_3` urinary tract infection,
  `360_3` bronchiolitis, `381_3` bronchitis, `563_2` measles, `58_2` meningococcal infection, `755_1`
  rotavirus gastroenteritis);
- `tools/benchmarks/medication-lookup-queries.json`: nine brand/form/clinical-phrasing medication
  lookups asked on the «Лекарства» scope, expecting the ЕСКЛП МНН record (`esklp.mnn.*`) or the Allmed
  instruction (`drug.allmed.*`) of the same active substance;
- `tools/benchmarks/doctor-workflow-queries.json`: ten deliberately messy real-world phrasings (typos,
  abbreviations, brand names), same target scheme.

`run-real-corpus.ts` runs them (`bun run benchmark:all` over `core.db`, `bun run
benchmark:real:release` over the app path with every companion pack and the recommendation modules the
queries target) and gates recall@1, recall@5, MRR@5 and the Top-1 rate of marked cases against
`real-corpus-baseline.json`. Section and anchor expectations were dropped on 2026-10-02: they
named sections of the retired pilot cards, and a section of the real recommendation text exists only
once its module is installed, so section-level navigation belongs to a gate that mounts the module text
rather than to these document-level lookups. Expected ids are checked against the mounted corpus: a
catalog pointer stands for the document it points to.

These checks validate retrieval and source navigation. They do not turn a registry identity or a title
into a dose, indication, contraindication, interaction, or patient-specific recommendation.

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
