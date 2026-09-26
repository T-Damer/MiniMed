# Definitions and a real offline CPU classifier — 2026-09-20

This work stays on `experiment/system-one-search-benchmark`, draft PR #180 over #174.
It does not merge, publish an APK, silently enable a model in the application, or upload Actions artifacts.

## What is implemented

`content/definition-pilot` contains eight source-linked definition drafts and one explicit naming-disambiguation card. The ordinary Python ingester builds them into an optional SQLite pack, without a schema change or a replacement ontology. `source_linked_paraphrase` means original editorial wording based on a cited public source, not a verbatim extract. The authoring file checksum must not be confused with a downloaded original source checksum.

Every card is visibly marked as requiring clinical editing, with `definitionStatus: proposed`, `clinicalReviewStatus: not-clinician-reviewed` and `releaseEligible: false`. The pack manifest is `local-dev`; no approved knowledge facts, equivalence edges, released core database or published catalog are changed. These definitions can be searched in the local demo now that the pack is built, but they are not yet in a shipped APK.

Included subjects: capillary refill/white-spot sign (including the user's `симтом` spelling), Kandinsky–Clerambault, Kocher–Volkovich pain migration, Volkovich–Dyakonov operative access, shirt/sliding sign, the different Voskresensky sign in pancreatitis, childhood masturbation, and transient neonatal adaptation.

The Sechenov teaching manual calls Volkovich–Dyakonov an **operative access**, whereas pain migration is Kocher–Volkovich. The original query therefore opens an explicit clarification, not a fabricated sign or an unreviewed same-as link. The two Voskresensky meanings remain separate and a bare eponym query must retrieve both. The broad phrase about transient states in children is routed to a card that explicitly limits its definition to newborns.

Sources are recorded in each card: MedlinePlus capillary refill test; Tiganov's General Psychiatry hosted by NCPZ; Alekberzade and Lipnitsky's 2017 Sechenov appendicitis manual (printed pages 11–13, 21, 27); American Academy of Pediatrics' Masturbation page; Ivanovo maternity hospital No. 4's neonatal adaptation page. Older sources are used for definitions, not silently imported as current treatment recommendations.

## Search tests

37 cases are kept separate from the 33-query clinical challenge: 30 named/spelling/navigation queries, one ambiguous eponym query requiring two targets, and six authored description probes. The runner uses actual SQLite stores and MedicalCore, can mount the existing bundled corpus plus the optional definition pack, and checks definition-body readability, source metadata, review status, and exact stored chunk/section/version/anchor identity. A matching title or incidental mention alone does not satisfy the primary definition checks.

The description probes are reported separately and do not silently become exact-identity successes. These are user-requested regressions and transparent authored probes, not a private independent clinical test set and not reranker training examples. They must never be combined with the old 81.82% clinical figure to claim an overall quality increase.

## Local classifier demo

`tools/benchmarks/local_reranker.py` uses a scalar ModernBERT sequence-classification head, not a generative LLM. Explicit setup downloads only five pinned public model/tokenizer/card assets from `ARGA100/ru-reranker-modernbert-small` revision `8d4ea05d7c793bc812879ca18e7e310ac4cb228f`, then records local SHA-256/size checks. No weights or credentials are committed. A GitHub mirror and a quantized mobile package are not provided by this prototype.

Inference is a persistent CPU process over JSONL stdin/stdout, not an HTTP backend. It uses `local_files_only=True`, `trust_remote_code=False`, safetensors, offline environment flags and a Python audit hook blocking socket connections/address resolution. The hook is a regression guard for this Python process, not an operating-system sandbox. Lookup and strict identities bypass the model entirely. At most 40 unique candidate IDs are accepted; only query and bounded natural-language evidence enter the classifier. No gold labels or internal IDs become model tokens.

Observe mode is the default: the baseline remains selected and the experimental order is shown alongside it. Explicit `--experimental-apply` is research-only. Missing/corrupt assets, non-finite/incomplete scores, unknown/duplicate/removed IDs, process failures and a 30-second transport deadline preserve the original source order. The deadline includes cold startup and is not a latency goal. No clinical query telemetry is added.

### Run in a normal checkout

```bash
git switch experiment/system-one-search-benchmark
bash scripts/prepare-local-search-demo.sh
bun tools/benchmarks/src/local-search-demo.ts
```

Type one query per line; EOF ends the process. Setup needs internet, Bun 1.2.3, uv and a supported CPU PyTorch/Python environment. After setup, disconnect the network before running the demo. Both result lists contain existing source titles, snippets and anchors rather than model-generated explanations.

To use the bundled corpus as well:

```bash
bun run content:restore:core
bun tools/benchmarks/src/local-search-demo.ts \
  --core=apps/app/public/content/core.db --pack=data/build/definitions.db
```

To test without weights:

```bash
python3 -m unittest discover -s tools/benchmarks -p test_local_reranker.py -v
bunx vitest run tools/benchmarks/src/local-reranker-contract.test.ts
bun tools/benchmarks/src/run-definition-quality.ts \
  --core=apps/app/public/content/core.db --pack=data/build/definitions.db
```

## Existing real neural measurement — not a claimed improvement

Actions run 35533037167, job 106137017045, checked merge tree `145e9d66d96146c5dea946eea9e6cd45db902385` (head `fa5424b7f00bdaa0a9417a507643d94d2fbc8aff`, base `6a256067de960321605736f00f3cbc0991f42a61`). Its existing cross-encoder harness really loaded the pinned Russian model on CPU. On the same frozen 33-query/495-pair test file, SHA-256 `cc0f9f9d06f935c85d3f32203f41f3a5be38281659d5640b400b9bff003a6583`:

| Order | Maximum-grade Top-1 | NDCG@5 |
| --- | ---: | ---: |
| Existing deterministic/hybrid | 27/33 (81.82%) | 0.913731 |
| Raw zero-shot cross-encoder | 19/33 (57.58%) | 0.759084 |
| Training-calibrated gated cross-encoder | 27/33 (81.82%) | 0.913731 |

Raw neural ordering fixed four Top-1 cases but regressed twelve. The training-calibrated gate applied **zero** Top-1 changes on this test; it did not improve quality. Model size: 34,539,649 parameters, 138,158,596 loaded parameter bytes; process peak RSS 766,038,016 bytes. Batch scoring averaged 25.14 ms/pair over 1,125 training+test pairs. This is runner batch throughput, not per-query p95 and not Android performance. The old benchmark did not block network calls; the new offline CLI smoke is a separate execution check with different input packaging.

A working local model is therefore available as an experiment, not a justified replacement for the current ranker. Further improvements require useful domain adaptation and a larger independent Russian evaluation set, including coverage failures, ambiguity and out-of-scope queries; model presence by itself is not progress.

## Validation boundary at authoring

Sixteen Python unittest methods (including parameterized subcases) passed in the isolated local environment without model dependencies. The new Actions workflow builds and checks the actual pack and runs the real MedicalCore-to-offline-CPU path with separate contract tests, without artifact uploads. Read the resulting commit's checks before claiming those new integration steps passed. No Android/WebView inference or UI integration is claimed.
