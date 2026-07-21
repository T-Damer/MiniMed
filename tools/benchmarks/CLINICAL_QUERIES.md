# Clinical query benchmark

MiniMed keeps benchmark questions outside the medical knowledge pack. A clinician query can test
retrieval and workflow behavior, but it is not itself an authoritative medical fact or an approved
answer.

## Real-POCQi import

Real-POCQi contains 620 deidentified questions submitted by practicing US physicians across 30
specialties. MiniMed imports only the `questions` split; model answers and ratings are not treated as
ground truth.

```bash
pnpm benchmark:queries:import

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

A live integration check should assert 620 source questions, 30 source specialties, 120 selected rows,
and complete provenance/review/licence fields. It remains separate from normal CI so an external
service outage cannot block unrelated application changes.

## Russian-first decision annotation

Imported wording remains immutable. A separate rebuildable projection classifies clinical queries:

```bash
pnpm benchmark:queries:annotate

# Import and annotate in one command:
pnpm benchmark:queries
```

`rule-based-ru-first-v1` uses Russian clinical language as the primary profile. It recognises Russian
patient descriptions, diagnostic and treatment questions, dose calculations, follow-up, routing, and
Russian administrative or regulatory wording. English rules are an explicit fallback for attributed
foreign datasets such as Real-POCQi; the original query remains `language: en`, `jurisdiction: US`.

The projection records:

- source and detected language plus source jurisdiction;
- primary and secondary clinical decision kinds;
- language-prefixed lexical signals and confidence;
- whether manual review is required;
- `brief-reference`, `focused-clinical`, or `long-case` complexity;
- patient-context signals, word count, and clause count.

The initial taxonomy covers urgency/routing, diagnosis/cause, diagnostic confirmation, test selection,
result interpretation, treatment selection or adjustment, dosing, medication safety, monitoring and
follow-up, prevention, prognosis, administrative questions, and educational reference.

## Russian coverage gate

`tools/benchmarks/russian-query-coverage.json` is a committed `synthetic_edge_case`-style baseline for
the Russian parser and classifier. It currently covers 23 Russian queries across all decision classes,
including patient descriptions, doses by age and mass, treatment failure, interactions, follow-up,
vaccination, prognosis, military-fitness and regulatory wording, misspellings, colloquial phrasing, and
mixed-script laboratory notation such as `Hb`.

The coverage set verifies language detection, primary decision, explicit patient context, and review
behavior. It is a software regression set, not a source of medical recommendations. Russian
source-grounded expectations will be added separately as `ru_source_reconstructed` scenarios linked to
exact current Russian documents and anchors.

This projection is a baseline, not ground truth. Future local Russian classifiers and local model
adapters must be compared against the same records. Russian translation is a separate derived artifact;
changing drugs, workflows, regulatory assumptions, or recommended actions creates a distinct
`ru_source_reconstructed` scenario and never overwrites the original foreign query.

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
