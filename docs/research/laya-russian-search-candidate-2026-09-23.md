# Laya: candidate for Russian retrieval and evidence decisions

Date: 2026-09-23. Research/evaluation design, not an enabled dependency or a claimed
medical-quality improvement. No weights were downloaded and no Laya inference was run in
this pass. Keep current deterministic retrieval available without a model. The user asks
to explore this alongside the existing SemIf/JEV-like candidates, not to replace the app.

## Inspected primary material

- Browser port `vishalmysore/layaForWeb`, commit
  `1928ce8ce37b1a9d392532fa27597c8733ef3d36`:
  [README](https://github.com/vishalmysore/layaForWeb/blob/1928ce8ce37b1a9d392532fa27597c8733ef3d36/README.md),
  [sequence builder and inference](https://github.com/vishalmysore/layaForWeb/blob/1928ce8ce37b1a9d392532fa27597c8733ef3d36/web/laya-core.js),
  [live page](https://vishalmysore.github.io/layaForWeb/).
- Official SDK/reports `NandhaKishorM/laya`, commit
  `c7527708f9f5220c669d8aa385077cd28d04708a`:
  [BENCHMARKS.md](https://github.com/NandhaKishorM/laya/blob/c7527708f9f5220c669d8aa385077cd28d04708a/BENCHMARKS.md).
- Official model cards as observed on this date:
  [English/family](https://huggingface.co/convaiinnovations/laya),
  [multilingual](https://huggingface.co/convaiinnovations/laya-multilingual).
  Model-weight revisions/checksums still need pinning before an experiment; a pinned SDK
  commit is not a pinned checkpoint. Do not silently use an updated model under an old report.

## What Laya is, and which checkpoint matters

Laya is a non-autoregressive encoder plus learned decision heads, not a generative 4B model
whose last-token logits happen to be inspected. Options are represented by marker positions;
those positions receive scores, normalized within a question. Output schemas are supplied
per request. The available primitives are categorical `choice`, ordinal `score` and boolean
`noul`. This matches the user's desired dynamic classifier interface more directly than a
chat-completion-and-JSON-parser loop.

The English checkpoint has about 421M parameters (ModernBERT-large plus decision heads).
The separate multilingual checkpoint has about 322M parameters (mmBERT-base plus heads).
Parameter count, quantized download size, resident model memory and complete-process memory
are different measurements. No universal '400 MB of RAM' claim follows from the model size.

**For Russian MiniMed queries, the first candidate must be `laya-multilingual`, not the
English checkpoint used by the supplied browser demo.** The official author reports show
English-checkpoint failures outside English with high confidence; thresholding that confidence
is not a language-support fix. The multilingual family exists, but Russian medical validity
is not established by general multilingual pretraining or the language label on a model card.

The supplied browser port does not by itself establish a ready multilingual ONNX export.
A future experiment must either run the pinned official multilingual model offline first or
validate its own export/quantization against that precise reference, including tokenization
and marker locations. Do not simply substitute a different model file into an English graph.

## Browser implementation findings

The port README reports these English-model builds:

| Build | Approximate downloadable weights | Runtime note in that implementation |
| --- | --- | --- |
| q8e8 | 440 MB | default; WASM CPU |
| q4e8 | 290 MB | WASM or experimental WebGPU |
| qdq8 | 430 MB | optional dequantization variant |

The README states the inspected ONNX Runtime Web WebGPU kernel does not support its int8
MatMulNBits graph, so q8e8 falls back to WASM; q4e8 is the demonstrated WebGPU variant.
This is a property of that graph/runtime combination, not a timeless statement that WebGPU
can never run int8 models. Preserve runtime versions in a test receipt.

On the author's 48-question conversion comparison, q8e8 had 97.9% top-answer agreement with
PyTorch and a worst probability change of 0.081; q4e8 also had 97.9% agreement but a worst
probability change of 0.319. These measure conversion fidelity, not correctness on clinical
questions. The author's two-core WASM example takes roughly 2–5 seconds for three questions;
this is not our hardware or an Android benchmark.

The source code also reveals important input/output boundaries:

- `buildSequence` builds one sequence per question. The same state is copied into each sequence
  and the sequences are batched. A batched forward pass is not evidence that the state was
  encoded once and shared across all question heads.
- The English path defaults to **512 total tokens** and **192 question/option tokens**. Each
  option is first limited to 48 tokens; with many options it is shortened further. Remaining
  room is used for a prefix of the state. Truncation is not a clinical summary and may remove
  the sentence that negates a symptom or identifies a relative rather than the patient.
- The official multilingual defaults are **1024 total tokens / 256 question-option tokens**.
  Treat this as a joint budget; it does not accommodate a whole long clinical history plus
  dozens of full medical definitions. An encoder's architectural maximum is not qualification
  at that maximum length.
- Browser `choice`/`score` confidence is **1 minus normalized entropy**. For `noul` the port uses
  `max(p, 1-p)`. These are not the same statistic and neither is a calibrated probability that
  a medical conclusion is correct. One universal 0.90 auto-action threshold is inappropriate.
- `score` computes the expected ordinal level. This is not the arithmetic or validation of a
  named medical scale. Executable scale logic must remain a separate reviewed schema/code path.

A future integration must reject or explicitly record lost input/option tokens rather than
silently accepting clipping. Checking only that every option marker survives does not prove
that its medically meaningful description survived.

## Published capability: useful evidence, not a medical guarantee

The official pinned benchmark report is unusually useful because it reports weaknesses too:

- On the 51-language MASSIVE sweep with 20 options, Russian accuracy is 0.310 for the English
  checkpoint and 0.540 for multilingual. This supports checkpoint selection, not medical use.
- Its application report gives RAG passage relevance 0.625 / 0.657 for English / multilingual;
  that task family is marked as represented in training. It is not an unseen Russian medical
  reranking benchmark.
- On typed-decisions, the task-fine-tuned checkpoint reaches 0.766, but base multilingual is
  0.342 against a 0.461 majority baseline. The higher headline must not be attributed to the
  base multilingual checkpoint or interpreted as domain-independent zero-shot reasoning.
- The models are overconfident before local calibration. The author reports temperature
  refitting gains and option-order sensitivity. Fine-tuning/calibration, benchmark splits and
  task types must be kept separate.

The author's latency measurements use a Tesla T4, not a phone. Published comparisons to JEV
were not same-run calls to the JEV API. None of these metrics establishes improvement over
MiniMed's current frozen-candidate baseline.

## Proposed uses inside the existing retrieval-first architecture

These are hypotheses to test, not implemented capabilities:

### A. Definition reranking

Retrieve a bounded candidate set with the existing exact/lexical/semantic path. Exact,
unambiguous names bypass the model. Compare a remembered description with candidate source
excerpts using fixed answers such as direct match / partial match / contradiction / insufficient
information. Keep an explicit no-suitable-candidate outcome. Different meanings of the same
eponym remain separate; the model cannot manufacture a canonical identity link.

Do not feed the entire concept vocabulary as one choice question. Test pairwise relevance or
small candidate groups, with a fixed rubric. Probabilities from independently composed choice
sets are not automatically comparable ranking scores; evaluate any combination scheme.

### B. Clinical-case retrieval, not autonomous diagnosis

Pass the original case text alongside structured values and source excerpts. Ask about relevance,
presence/absence/uncertainty of a stated finding, whether it belongs to the patient/current
episode, or the usefulness of a prepared clarification question. Preserve explicit negation,
family history, past episodes, units, age and temporal order. Structured numbers stay available
to deterministic rules; do not ask the model to guess missing measurements.

The output may reorder sourced differential-search candidates or request clarification. It must
not be shown as a disease probability, treatment recommendation, validated triage action or
completed medical score. Failed or out-of-domain classification leaves the original retrieval
and sources usable. A confident model result must not override a source applicability constraint.

### C. Better evidence selection and citations

Separate relevance (about the topic) from support (actually supports the proposed statement).
A useful evaluation task is to label a supplied claim–passage pair as supported / contradicted /
not established. Source authenticity, edition, excerpt location and exact quotation are then
checked deterministically, not entrusted to a classifier.

The application supplies permitted evidence IDs. The model selects only those IDs; it does not
create URLs, authors, pages or quotes. A rendered quote must be an exact substring of the selected
stored block, with checked source hash and span. Missing support results in no citation/qualified
answer, not a newly invented passage. The classifier can still choose a wrong existing citation;
measure unsupported-citation rate rather than claiming that typed output eliminates hallucination.

## Bounded experiment plan

1. Prepare a versioned, diagnosis-free Russian development set and an independent holdout when
   available. Separate term lookup, clinical retrieval and claim–evidence support. Existing visible
   regression probes are not independent clinician gold. Include missing-concept cases.
2. Freeze the corpus and candidate IDs before comparing baseline / a conventional reranker /
   multilingual Laya / SemIf where feasible. Keep target labels out of model features. Report
   candidate recall separately: a reranker cannot recover an absent candidate.
3. Include adversarially close cases: negation, historical or family findings, changed units,
   conflicting input, unrelated but similar wording, source version/population mismatch, a copied
   instruction inside a source, option permutations and equivalent question formulations.
4. Record the exact tokenizer/weights/runtime, input and per-option lengths, truncation, cold/warm
   time, batch size and peak memory. On-device optional download and explicit offline execution
   are prerequisites for mobile adoption; do not enable both language checkpoints by default.
5. For reranking report recall@K, top-1 and graded NDCG, plus regressions of formerly correct
   cases. For evidence report support precision, unsupported citations and refusal/coverage.
   Calibrate thresholds on a different split, stratified by task and number of options.
6. First establish full-precision multilingual utility; then test that exact quantized export on
   CPU/WASM/WebGPU or native ONNX as supported. Similar file size does not establish parity.

No performance threshold is claimed as achieved by this note. No existing medical/source check
is relaxed to make a model score better. Model adoption is contingent on measured benefit; source
coverage and exact citations remain useful independently of the result.

## Decision recorded now

Register Laya multilingual as a research candidate alongside SemIf, with specific reverse-search,
clinical-retrieval and evidence-selection tasks. Do not install it, auto-download weights,
change the production/default search, migrate the UI, or add a second orchestration/storage
framework. The next implementation priority remains preserving the concept vocabulary and
feeding attributed medical material into the unified knowledge-base pipeline.
