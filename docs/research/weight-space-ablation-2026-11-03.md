# Weight-space edit of a local LLM: looping-direction ablation (2026-11-03)

Research only; no product code, catalog or model artifact changed. Prompted by
[Weight-Space Programming](https://rikiyat.github.io/blog/weight-space-programming/), experiment 8:
projecting one "looping" direction out of two MLP output matrices of Qwen3.5-0.8B raised MATH-500
7.9 % → 48.1 %; the same method did nothing on Gemma 3 270M, whose errors were not loops ("editing
removes an obstacle, it does not add an ability").

## Verdict

**No-go.** The edit removes most loops in our small Russian model and the effect transfers to held-out
prompts, but it does not produce a single valid contract answer and slightly damages language
modelling. Vikhr's looping is a symptom of not following the contract, not the obstacle in front of an
ability it has. Revisit only if a future model (SCRIBE1) mostly answers correctly and fails by looping.

## Which model loops

From the stored `packages/tester-box/reports/latest.json` (llama.cpp, Q4/Q8 GGUF, 384 tokens, greedy),
contract strategy, 20 cases:

- **Qwen3 0.6B**: its 16/20 failures are wrong content, not loops — inexact quotes, `conflicts` not
  an array, missing `exactQuotes`; repeated-6-gram share 0.00–0.23. Not a candidate.
- **Vikhr Qwen 2.5 0.5B**: 20/20 failures, 18 «Ответ не является JSON-объектом», heavy repetition.
  Chosen for the experiment.

## Setup

- `Vikhrmodels/Vikhr-Qwen-2.5-0.5b-Instruct` revision `9f827ac4…`, `model.safetensors` sha256
  `79c6fe7e…` (988 MB, Apache-2.0), fp32 PyTorch on MPS. Not the shipped Q4 GGUF: baseline and edit are
  both measured in fp32 so they compare like with like.
- Prompts, evidence, JSON extraction, validator and the one repair attempt are tester-box's own
  (`prompt_for`, `extract_json`, `validate_contract`), rebuilt from the stored report; greedy, 384 new
  tokens. Even-indexed 10 cases are the train split (direction + layer choice), odd 10 are held out.
- Direction: mean residual stream at generated positions that complete a verbatim repeat (an n-gram
  already produced) minus the mean at positions before the first repeat, per layer. Edit: rank-1
  projection `W ← W − r rᵀW` of the MLP `down_proj` of chosen layers.
- fp32 baseline reproduces the GGUF picture: 14/20 answers loop (≥ 20 % repeated 6-grams), 10/20 hit
  the token limit, 3/20 parse as JSON, 0/20 valid. Failure kinds seen: degenerate phrase loops
  («нет утверждений о том, что у пациента» ×30) and an array of repeated whole objects.
- Scripts: `tools/benchmarks/weight_space/` (`baseline.py`, `search.py`, `search2.py`,
  `evaluate.py`; `WSP_DIR` holds weights and outputs, default `.cache/weight-space/`).

## Layer search (train split, first attempt, 200 generations)

Round 1, 6-gram labels. The post's shape — direction removed from two adjacent MLPs, at every
depth 4–23 — changed nothing (mean repetition 0.29–0.37 vs 0.37 baseline). Removing it from all 24
MLPs: direction at layer 16 gave 0.37 → 0.16, limit hits 7 → 2, but JSON 3 → 1; outputs then held
`"status": "one"` (copied from «одна строка» in the instructions) and `//` comments inside JSON.

Round 2, labels from 16-token repeats only (6-grams also hit legitimate repeated JSON keys), scored by
the validator:

| Edit | Mean 16-gram rep | Limit hits | JSON | Valid |
| --- | ---: | ---: | ---: | ---: |
| none | 0.299 | 7 | 3 | 0 |
| dir@16 → all 24 MLPs | 0.114 | 4 | 1 | 0 |
| dir@16 → MLPs 8–19 | 0.154 | 6 | 2 | 0 |
| dir@12 → MLPs 4–15 | 0.083 | 5 | 0 | 0 |
| dir@20 → MLPs 12–23 | 0.234 | 3 | 2 | 0 |
| dir@16 → MLPs 14–15 | 0.322 | 5 | 3 | 0 |

## Full pipeline (first attempt + repair), dir@16 → all 24 MLPs

| | Held-out 10: baseline | Held-out 10: edited | All 20: baseline | All 20: edited |
| --- | ---: | ---: | ---: | ---: |
| Looping first answers (≥ 20 % 6-grams) | 8 | 4 | 14 | 9 |
| Mean repetition | 0.41 | 0.20 | 0.39 | 0.23 |
| Hit token limit | 3 | 5 | 10 | 9 |
| Final answer parses as JSON | 3 | 6 | 3 | 10 |
| Valid contract | 0 | 0 | 0 | 0 |
| Expected status | 0 | 0 | 0 | 1 |

- Error mix moved from «не является JSON-объектом» (17) to «missingFacts должен быть массивом
  непустых строк» (10) and «не является JSON-объектом» (10): parseable JSON of the wrong shape.
- Next-token loss on 120 source passages 2.256 → 2.312 nats (+2.5 %): measurable damage to Russian
  medical text.
- Change: one rank-1 update to each of 24 matrices (896 × 4 864) — 138 k free parameters, close to
  the post's 131 k changed weights, but every entry of those matrices moves.

## Limits

20 synthetic cases, one model, greedy decoding, fp32 not the shipped Q4 GGUF, a 14+6-setting grid
instead of the post's LLM-guided harness, no clinician review (none needed: no valid answer was
produced either way). The edited model was not converted to GGUF or tried in the app. Weights and run
outputs were deleted after this note.
