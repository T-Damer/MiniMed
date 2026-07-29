# Tester box

CLI experiment for full-corpus retrieval and grounded local-model answers. It compares a direct RAG
prompt with the product contract: atomic claims, exact quotes, known citation IDs, explicit missing
facts and conflicts, deterministic validation, and one repair attempt.

Corpus and model files stay under `.cache/tester-box/` and are not committed. Build the combined
tester-only FTS index after downloading the current clinical snapshot and the published regulatory
pilot:

```bash
uv run --project tools/ingest python packages/tester-box/tester_box.py index \
  .cache/tester-box/corpus/clinical \
  .cache/tester-box/corpus/published-modules/minimed-regulatory-pediatrics-0.3.4-preview.1.db
```

Run the synthetic cases with the model files named as in
`apps/app/src/features/models/catalog.preview.json`:

```bash
uv run --project tools/ingest python packages/tester-box/tester_box.py run
```

The Markdown report and machine-readable JSON are written to `packages/tester-box/reports/`.
Do not use the tool with real patient text: reports intentionally persist the query and model output.

The current GitHub releases contain all 744 structured clinical recommendations, but only pilot
regulatory and medication content. Missing evidence in those source families is therefore reported as
a corpus gap rather than filled from model memory.
