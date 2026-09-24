# Laya multilingual: first actual source probe

23 September 2026. Research only; content/search work remains primary. No app dependency or
runtime switch. The complete result is [laya-source-smoke-2026-09-23.json](laya-source-smoke-2026-09-23.json).
Execution: https://github.com/T-Damer/MiniMed/actions/runs/35788375944

## Exact execution

- Model: `convaiinnovations/laya-multilingual`, revision `052592a15d198d9ad47da779604259b10b47b7aa`.
- Laya SDK: `c7527708f9f5220c669d8aa385077cd28d04708a` (0.3.6).
- Downloaded files: 678,201,614 bytes; LFS hashes checked where provided, all file hashes recorded.
- CPU, two threads, PyTorch 2.8.0+cpu, Transformers 4.57.1. This is NOT the 440 MB English ONNX build.
- 321,908,995 parameters. Model load 11.315 s. Whole-process peak RSS 2,441,176 KiB, including
  PyTorch, model construction/loading and inference. Neither incremental model memory nor Android RAM.
- The SDK applies a tokenizer-config compatibility normalization. Before/after hashes disclose
  that change; model weights and vocabulary hashes are unchanged.
- Inference followed asset download with network access prohibited by an audit hook: zero attempts.

## Measured outcomes

There were 18 authored probes, each also executed with the option order reversed (36 executions).
Questions and source descriptions were not tuned after observing these outputs.

| Family | Correct, original order | Answer changed after reversing options |
| --- | ---: | ---: |
| Match a short Russian description to one of four definitions | 1 / 8 | 4 / 8 |
| Explicit support / contradiction / missing information in a source sentence | 6 / 6 | 0 / 6 |
| Negation, who has the symptom, and present versus past episode | 2 / 4 | 1 / 4 |

Every actual question/state/option sequence fit the model's token budgets; no source text was
silently truncated. The definitions are the existing publicly committed editorial drafts in
`content/definition-drafts/catalog.json`, not a newly clinically validated source set. The source
IDs, input checksum, dataset checksum, predictions and scores are preserved. No real patient data.

The successful evidence checks are deliberately simple sentence-level cases and do not establish
reliable citation selection. The case-language failures included a negated symptom being marked
present and information about a relative being mishandled. These are observed probe failures,
not a diagnosis or a universal conclusion about every use/fine-tuning of the model.

## Decision

Do not enable this choice-based recipe for MiniMed search or clinical decisions. No improvement
over existing retrieval has been demonstrated: this was a small fixed-pool execution probe, not a
same-pool baseline/reranker comparison, held-out clinical evaluation or full-corpus reverse search.
The apparent 6/6 evidence result is too small and simple to qualify an automatic citation checker.

Keep Laya as a research candidate. If revisited, evaluate a separately specified pairwise
query–passage task on the frozen search corpus and untouched validation cases. Do not salvage this
probe by rewriting its gold answers, copying failed queries into aliases or tuning and then calling
these cases held-out. Report Russian negation/subject/time handling, abstention, option sensitivity,
quantization and target-device resource use separately. Exact quotations and locators remain code.

## Reproduce without application changes

Use a separate Python 3.12 environment. Install the CPU PyTorch build and these pinned packages:
`torch==2.8.0`, `transformers==4.57.1`, `huggingface-hub==0.35.3`, `safetensors==0.6.2`, `numpy==2.2.6`;
install Laya from the exact SDK commit above without changing MiniMed's dependency files.
Run from the repository root in a sanitized environment:

```bash
python tools/benchmarks/laya_source_smoke.py \
  --model-dir /path/to/research-assets/laya-multilingual \
  --revision 052592a15d198d9ad47da779604259b10b47b7aa \
  --catalog content/definition-drafts/catalog.json \
  --report /path/to/new-laya-result.json
```

Asset setup uses the network; inference is local afterward. Do not upload weights, model cache,
private sources or clinical queries to CI artifacts. No source acquisition, GPU/mobile run, APK,
release, merge or model integration is implied by the successful execution of this experiment.
