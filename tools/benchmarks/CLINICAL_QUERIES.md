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
- records source ID, record ID, citation, URL, jurisdiction, and CC BY 4.0 licence on every row.

Use `--offline` to rebuild from the cache or `--snapshot path.json` to import a reviewed local JSON
snapshot in tests and controlled builds. Changing the count or seed intentionally creates a different
sample and therefore a different output checksum.

A live integration check should assert 620 source questions, 30 source specialties, 120 selected rows,
and complete provenance/review/licence fields. It remains separate from normal CI so an external
service outage cannot block unrelated application changes.

## Decision annotation projection

Imported wording remains immutable. A separate rebuildable projection classifies each English query:

```bash
pnpm benchmark:queries:annotate

# Import and annotate in one command:
pnpm benchmark:queries
```

`rule-based-en-v1` records:

- primary and secondary clinical decision kinds;
- matched lexical signals and confidence;
- whether manual review is required;
- `brief-reference`, `focused-clinical`, or `long-case` complexity;
- patient-context signals, word count, and clause count.

The initial decision taxonomy covers urgency/routing, diagnosis/cause, diagnostic confirmation, test
selection, result interpretation, treatment selection or adjustment, dosing, medication safety,
monitoring/follow-up, prevention, prognosis, administrative questions, and educational reference.
The annotation report shows coverage and the number of low-confidence or ambiguous rows.

This projection is a baseline, not ground truth. Future local classifiers and clinician annotations
must be compared against the same imported questions without modifying their text. Russian translation
or adaptation is another derived artifact and must not overwrite the original US query.

## Provenance rules

- `real_clinician_query`: observed clinician question from an attributed dataset;
- `ru_source_reconstructed`: a separate Russian scenario derived from current Russian sources;
- `synthetic_edge_case`: an explicit workflow or safety test.

Translation does not change provenance, but replacing US drugs, workflows, or regulatory assumptions
creates a new `ru_source_reconstructed` record. Imported questions start as `candidate`. They become
`source_validated` only after expected documents, entities, sections, and dangerous omissions are
fixed. `clinician_reviewed` requires an identified appropriate reviewer.

Real-POCQi attribution:

> Feng J, Patel V, Heagerty P, et al. Expert Evaluation of Clinical AI Tools on Real Point-of-Care
> Clinical Queries. 2026. arXiv:2606.28960. Dataset: `jjfenglab/Real-POCQi`, CC BY 4.0.
