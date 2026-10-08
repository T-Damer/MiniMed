# Unsloth and training MiniMed's own small model (2026-10-08)

Research only; no repo file other than this note was changed, nothing was trained or installed.
Labels: **[fact]** read in a primary source on 2026-10-08 (link given); **[repo]** read in this
repository; **[estimate]** my arithmetic or judgement, not measured. Web sources were read through a
fetch-and-summarise tool, so figures are as summarised there; vendor speed claims are the vendor's.

## 0. Verdict in five lines

1. The idea is sound, but **Unsloth is the wrong tool for the models MiniMed can ship**. Its value is
   memory/speed for 0.3B–70B models on NVIDIA GPUs; MiniMed's on-device budget is a ~120 MB encoder
   that trains in minutes on the owner's M2 Max with `sentence-transformers`, which the repo already
   uses (`tools/benchmarks/embedding_eval.py`, MPS).
2. The best-value experiment is a **Russian-medical fine-tune of the e5-small query side** (complaint to
   КР, the weakest measured area: R@5 about 0.26 with e5 on Q1 complaints), starting with a linear
   adapter and a query-tower-only fine-tune against the *existing* passage vectors (no re-publish of
   688 MB of КР modules).
3. A cheap classifier/specialty head on the already-computed e5 query vector costs ~0 MB and is second.
4. A fine-tuned cross-encoder is third (zero-shot one already regressed Top-1 81.8 % to 57.6 %), a small
   generative model (Unsloth's real home) fourth, ASR last.
5. Go on "train our own small retrieval model", no-go on "adopt Unsloth now"; revisit Unsloth only for a
   >=0.6B teacher or LLM SFT on a rented NVIDIA GPU.

## 1. What the repo says (context)

- Invariant [repo, `AGENTS.md`]: retrieval before generation; works with no network/LLM; no Rust/Tauri/
  backend/telemetry; no model weights committed; generated text never replaces source text.
- JEV/Laya/SemIf [repo]: SemIf = frozen causal-LM answer-token logits (candidate, no MiniMed result);
  Laya = 322M multilingual encoder with typed decision heads (laya-multilingual): on 18 authored probes
  1/8 definition-matching correct, 4/8 flipped by option order, a negated symptom marked present
  (`laya-source-smoke-results-2026-09-23.md`); "Jev" is only named as the undisclosed-training
  reference. Decision recorded: research candidates, not adopted.
- Zero-shot cross-encoder `ARGA100/ru-reranker-modernbert-small` on the frozen 33-case candidates:
  Top-1 81.8 % to 57.6 %, 12 regressed / 1 improved (`system-one-search-benchmark-2026-09.md`). That
  doc's rule: collect a held-out clinician set before training anything domain-specific.
- Shipped [repo]: `multilingual-e5-small` (MIT, 117.65 M params per HF API), passages embedded at build
  time (fp32 PyTorch, 95,827 chunks over 774 КР modules, int8 vectors), query encoded on device by the
  q8 ONNX export in a worker (129 MB download), `auto` fallback to lexical. Q1 test R@5 0.123 (lexical)
  to 0.497 (hybrid); by source: RuMedPrime complaints 0.038 to 0.278, RuCCoD diagnosis phrases 0.202
  to 0.702 (`SEMANTIC_RETRIEVAL.md`). Phone latency of the e5 query model is "not yet measured" (STATE E2).
- Rejected so far [repo, `SEARCH_ROADMAP.md`]: rubert-tiny2, USER-base (lower R@5 on КР), per-clause
  complaint vectors, EmbeddingGemma 2 (R@5 0.452 to 0.497, CI -0.003..+0.094, 66x slower, 2.7x larger),
  e5 on МКБ cards. Roadmap item 8 ("Complaints, second attempt") already lists "small on-device
  cross-encoder reranker over the top 20 (size and latency first)" and "larger embedding model if a
  phone measurement allows". This note's proposal is a new item 8a: *fine-tune the model we already
  ship*. It replaces nothing; exact-name lookup stays lexical.
- Parser POC [repo, `query-parser-llm-ner-poc-2026-09.md`]: generative parsers need 4.7-12 s CPU p50
  per query on 4 threads and flip negation without guards; the note itself sets the target as "a
  fine-tuned small NER plus deterministic normalizers".

## 2. What Unsloth is (as of 2026-10-08)

| Topic | Finding | Source |
|---|---|---|
| Version | PyPI `unsloth` 2026.10.2, released 2026-10-07; Python >=3.9,<3.15 (Studio training: 3.11-3.13) | [PyPI](https://pypi.org/project/unsloth/), [requirements](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements) |
| What it trains | LLM LoRA/QLoRA/full FT, pretraining, DPO, GRPO/RL, FP8, vision, diffusion, TTS, STT (Whisper-Large-V3 notebook), embedding / classifier / BERT / reranker models | [README](https://github.com/unslothai/unsloth), [embedding guide](https://unsloth.ai/docs/new/embedding-finetuning), [notebooks](https://unsloth.ai/docs/get-started/unsloth-notebooks) |
| Embedding path | `FastSentenceTransformer` on top of sentence-transformers; claims 1.8-3.3x faster, 20 % less memory vs FA2; EmbeddingGemma-300M QLoRA in ~3 GB VRAM. Best support for encoder models with `modules.json`; others get default pooling ("limited support"); cross-encoders "train properly even under the fallback path". Notebooks: EmbeddingGemma, Qwen3-Embedding 0.6B/4B, BGE-M3, ModernBERT, MiniLM; no reranker notebook listed | same |
| Hardware | Core: NVIDIA CUDA capability >=7.0 (T4 and newer), needs torch/xformers/bitsandbytes/triton; AMD and Intel via separate guides; Studio also CPU (chat/data recipes only). **Mac:** the same requirements page says both "Training, MLX and GGUF inference are ALL supported" (Studio) and, for Core, "Apple/Silicon/MLX is in the works" - the docs contradict themselves. A search summary of a third-party review (not opened) reports Studio on an M3 Pro showing no GPU and asking for NVIDIA/ROCm for training. Community wrappers `unsloth-mlx` / `mlx-tune` give an Unsloth-style API on MLX; unofficial | [requirements](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements), [unsloth-mlx](https://github.com/luongnv89/unsloth-mlx), [mlx-tune](https://www.sourcepulse.org/projects/22169346) |
| Export | GGUF (llama.cpp), NVFP4/FP8, merged 16-bit/LoRA adapters to the HF Hub; embedding models usable with transformers, vLLM, llama.cpp, TEI, etc. **No ONNX export is documented** (README and embedding guide never mention ONNX). ONNX would come from sentence-transformers' `backend="onnx"` export / Optimum, which exports only the Transformer (pooling/normalisation applied outside) | [README](https://github.com/unslothai/unsloth), [sbert efficiency](https://sbert.net/docs/sentence_transformer/usage/efficiency.html) |
| Licence | Core Apache-2.0; optional components such as the Studio UI AGPL-3.0. A tool-only dev dependency; weights are not affected by the tool's licence (my reading, not legal advice) | [README](https://github.com/unslothai/unsloth) |

Consequences for MiniMed:

- **Local Mac:** not a dependable official path. Python 3.14.7 on this machine is outside Unsloth's range
  (uv could provide 3.13). Realistic Unsloth use = Colab / a rented NVIDIA box.
- **Fit:** Unsloth's savings matter for 0.3B-70B models. Models that fit a WebView (<=~130 MB q8) are
  encoders of 30-120 M parameters; there plain sentence-transformers is fast enough (E1/E2 already encode
  95,827 passages with e5-small on this MPS in about 4 minutes [repo]).
- **Exports:** GGUF only helps the llama.cpp/wllama LLM path (LOCAL_MODELS), not an encoder in
  transformers.js. The ONNX int8 step stays outside Unsloth in any case.

## 3. Candidate models, ranked by expected value

Ranking is [estimate]; "tool" says what to train with.

| # | Model | Expected value | Cost / risk | Tool |
|---|---|---|---|---|
| 1 | **e5-small fine-tuned on Russian medical query to КР** (query side first) | Targets the weakest measured area: complaints R@5 0.255-0.278 vs diagnoses 0.65-0.70 (Q1). Same architecture, so same 129 MB, same ONNX q8 / transformers.js worker, same latency. I would expect a few points of R@5 on complaints and a smaller gain on diagnoses; the range is wide and the labels are noisy (final diagnosis, not "best document"). Roadmap item 8 had no cheaper option | Low compute; label noise; shared query model also serves E3 drug-indication search (hit@5 0.91) and must not regress | sentence-transformers (MPS) |
| 2 | **Query-intent / specialty / ICD-chapter classifier** as a linear (or tiny MLP) head on the e5 query vector | ~0 MB and ~0 ms: the vector is already computed. Can feed scope hints, doctor-profile boosting and definition-sense preference. Value depends on a product use being chosen first | Cheap; labels from ICD block of RuMedPrime/RuCCoD give a chapter/block, not a clinical specialty (mapping needed) | scikit-learn / PyTorch; SetFit unnecessary |
| 3 | **Fine-tuned cross-encoder reranker** over the top 10-20 | Zero-shot version lost 24 points of Top-1, so only a trained one is worth testing. Cost is the problem: a 34M-parameter ModernBERT-small (about 15M transformer params) at 256 tokens is ~8 GFLOP per pair [arithmetic]; 20 pairs on a phone WASM runtime is plausibly several seconds, ~100x the query-embedding cost | Latency, candidate-recall ceiling, hard-negative false negatives | sentence-transformers `CrossEncoderTrainer` (Unsloth fallback path possible but unnecessary) |
| 4 | **Definition sense disambiguation** (pairwise context-vs-sense) | Real but small slice; no labelled contexts exist. Distant supervision from КР "Список сокращений" + usage contexts is possible but leak-prone and unvalidated. Laya probe on description-to-definition: 1/8 | Data build is the main cost | cross-encoder as in #3, after #1-3 |
| 5 | **Small generative model** (Qwen3-0.6B / Gemma-3-270M SFT) for grounded summaries or query parsing | Unsloth's real home (SFT/GRPO, GGUF export). But: grounded assistant was retired 2026-09-04 with no Recall@20 gain; a summary replaces nothing and breaks "source text never replaced" unless quote-only; 0.6B GGUF is 400-640 MB; CPU latency 5-12 s [repo POC]. The parser POC points to a small encoder NER, not a generator | High: second model lifecycle, negation errors, clinical risk | Unsloth / TRL, if ever |
| 6 | **ASR** | GigaAM v3 (sherpa-onnx) and Whisper are already integrated [repo]. Gains would need Russian clinical speech with transcripts, which we do not have; Unsloth's Whisper notebook is a TTS/STT convenience, not a GigaAM path | No data | not now |

### Which tool, per task

- Encoders (1-4): sentence-transformers v6 (`SentenceTransformerTrainer`, `CrossEncoderTrainer`,
  `MultipleNegativesRankingLoss`) + Optimum/ORT int8. Unsloth adds a CUDA-only dependency stack for no
  size/speed need at 30-120 M parameters. Revisit only if we train a Qwen3-Embedding-0.6B/BGE-M3-class
  *teacher* (on a rented GPU) and distil into e5-small.
- Generative (5): Unsloth is a good tool (or plain TRL on a rented GPU); not on the near-term path.
- Classifier (2): no deep-learning framework needed.

## 4. Training data

**Have** [repo `query-datasets-2026-10.md`, `retrieval-icd-queries.json`]:

- RuMedPrimeData (Zenodo, CC-BY-3.0): 7,625 outpatient events with complaints and ICD-10 code. Official
  RuMedTop3 dev/test ids are 848 + 822 lines in `data/raw/query-datasets/rumedprime/`, so about 5.9k
  events are outside both [arithmetic, assumes all ids are in the TSV]. Q1 dev/test were sampled from
  the official dev/test.
- RuCCoD (CC BY 4.0 per the paper only): 5,914 unique phrase+code pairs over train+test files. **Q1 dev
  is sampled from RuCCoD train**, so training on RuCCoD train needs the Q1 dev rows and their
  records removed, and tuning must use a fresh record-disjoint hold-out. Q1 test must stay untouched.
- Code to document map: ICD codes of each КР in the Ministry registry snapshot and the МКБ cards, which is
  how Q1 grades relevance (grade 3 same/parent/child, grade 1 same block). Only rows whose code is
  covered by a КР are usable as КР supervision; the usable share of the full train population was not
  measured here (Q1 itself capped it at 70 %).
- Blinoff forum data: licence unknown, "do not distribute" [repo]. Keep it out of any training set whose
  weights ship.
- Passage side: 95,827 chunk vectors from the base model already exist (`clinical-e5` build output).

**Can build, with leakage care:**

- Synthetic queries from КР sections (LLM-written colloquial, noisy, case-style variants). Controls:
  split by КР *document* for the hold-out; drop queries containing the title or ICD name (the
  `leakageTerms` rule of `search-quality-v2.json`); dedupe against Q1/benchmark text; use a different
  generator from any judge; label them `synthetic` and never report them as evidence. The generator is
  a dev tool, but sending КР text to a hosted LLM leaves the machine - a local llama-server (as in the
  parser POC) avoids that question. Needs an owner call.
- Hard negatives: from the base e5 candidates at ranks ~20-100 (the ru-en-RoSBERTa recipe mined mE5-small
  ranks 20-100; skipping top ranks reduces false negatives), plus same-ICD-block КР for "close but wrong".
  One enterprise-search paper found plain (query, positive) pairs worked best, so run "no hard negatives"
  as an arm.
- Missing and necessary before any ship decision: the clinician-written 200-300 query set with
  multi-relevance judgments (system-one note; roadmap item 7 owner queries, 54 so far).

## 5. Evaluation plan

Gates and sets that already exist [repo]: `bun run benchmark:all`, `benchmark:real:release`
(lookup R@1 0.803 / R@5 0.934), `benchmark:doctor-lookup`, `benchmark:owner-queries`,
`benchmark:clinical-quality` (33 cases, visible - regression only), Q1 via
`tools/benchmarks/src/run-semantic-kr.ts` / `embedding_eval.py evaluate-docs` (330 КР-relevant queries),
`drug-indication-queries.json` (E3), `reverse-term-queries.json`, `typo-correction-queries.json`.

Protocol:

1. Freeze the base: e5-small through the *app's* ONNX int8 query path (Q1 test R@5 0.452; complaints 0.261;
   diagnoses 0.642 in the EG2 run).
2. New split: record-disjoint train / tune hold-out from the non-Q1 population; Q1 test is read once per
   arm, paired bootstrap CIs. n=330 gives a CI of about +/-0.05, so a gain below ~+0.06 R@5 is not
   distinguishable (EG2's +0.045 was not).
3. Report two test views: all test, and test rows whose ICD codes never occur in training (generalisation
   to unseen diseases).
4. Non-regression: E3 drug-indication hit@5 >= 0.91 and top-1 drug names 1.00; reverse-term lexical path
   untouched; exact-lookup gates unchanged (the model is not in that scope); forbidden-result rate.
5. Parity: PyTorch fp32 vs the exported q8 ONNX query vectors, cosine >= 0.99 (the existing E2 bar).
6. Ship only after the clinician set confirms; the Q1 proxy alone meets the ADR criterion "by proxy"
   only.

## 6. On-device delivery

- **Format [fact/repo]:** `Xenova/multilingual-e5-small` already ships `model_quantized.onnx`, `model_int8`,
  `model_q4`, `model_fp16`; the app runs q8 via transformers.js in `e5.worker.ts` with pinned, SHA-256
  verified files in IndexedDB. A fine-tune of the same architecture exports through the same path
  (sentence-transformers ONNX export gives the Transformer only; pooling/L2 stay in app code, as now).
- **Size/latency [estimate]:** unchanged: ~129 MB, query encode on the host measured 4.3 ms (one CPU
  thread) [repo]; phone WASM is unmeasured - that measurement is the prerequisite for any model work.
  Optional later shrink: e5-small's weights are mostly its 250k-token embedding table (~96 M of 118 M
  params); pruning the vocabulary to Russian+Latin+digits (say 50k tokens) would save about 77 MB at int8
  [arithmetic: 200k x 384 x 1 B], at the cost of a custom tokenizer and a parity re-check.
- **Port/adapter:** already exists: `QueryEmbedder` port + `E5_SMALL_PROFILE` (`localmed.e5-small.384.int8.v1`)
  and an immutable profile descriptor; the runtime refuses mixed generators. Two shapes:
  (a) *query-side only*: passage vectors stay, so the profile needs a "query model revision" field
  compatible with the existing passage profile - a small amendment to ADR 0008 semantics; no КР
  re-download, but the same query model also scores drug-indication vectors (E3), so the E3 gate decides
  or a replay mix is needed; (b) *both towers*: new profile id, re-embed (~4 min on MPS [repo]), rebuild
  and re-publish the 774 КР modules and drug modules (whole КР download is 688 MB [repo]); every installed
  user re-downloads. (b) only after (a) shows a clear gain.
- **Weights:** never committed; published as a mirrored release asset like the e5 files, with checksums
  and a model card stating base model (MIT), training data and licences (CC-BY attribution).
- **Adapter variant:** a 384x384 linear query adapter (~0.6 MB fp32) can be applied in TypeScript after
  the existing model with no ONNX change - the cheapest possible shipping form if it helps.

## 7. First experiment (smallest useful)

**Question:** does supervised Russian-medical training of the e5 query side beat the shipped e5-small on
Q1 complaints without hurting drug-indication search?

| Item | Plan |
|---|---|
| Base | `intfloat/multilingual-e5-small` (shipped), passage vectors frozen |
| Data | RuMedPrime train-side events + RuCCoD train records minus Q1 dev records; positives = КР with grade-3 ICD match; doc-level loss over all frozen chunk vectors (log-sum-exp over a document's chunks), in-batch/global negatives; optional arm with synthetic КР queries |
| Arms | A0 linear adapter on frozen query vectors (minutes, CPU); A1 query-tower fine-tune (LR ~1e-5, 1-3 epochs); A1+replay of E3 indication queries; A2 two-tower with re-embed only if A1 wins |
| Compute | Owner's M2 Max, no rented GPU. A0: minutes; A1: well under an hour; A2: 1-3 h + 4 min re-embed [all estimates] |
| Money | $0 locally. If Unsloth/Colab were used anyway: free T4 quota or a few dollars of rented GPU time (check current prices) - not needed |
| Success | Q1 test (330 КР-relevant) R@5 up by >= +0.06 with paired-bootstrap lower bound > 0, complaints R@5 >= 0.33 from 0.26, diagnoses not worse by more than 0.02, E3 hit@5 >= 0.91 and top-1 1.00, q8 parity cosine >= 0.99, no change in exact-lookup gates |
| Stop | A0 and A1 both < +0.03 R@5: record in the "measured and rejected" table and move to a hybrid/fusion or reranker study |
| Code | `tools/` Python (Ruff/Pyright/pytest rules), no app change; outputs (checkpoints, vectors) deleted when the result is written down, per disk rules; weights not committed |

## 8. Risks

- **Label noise / ceiling:** complaint labels are the physician's final diagnosis; complaints often list
  unrelated symptoms (E4 finding). Supervised signal may mostly teach the dataset's SibGMU prior.
- **Distribution shift:** SibGMU outpatient notes and RuCCoD phrases are not the owner's phrasing; Q1 is a proxy.
- **Leakage:** Q1 dev overlaps RuCCoD train; ICD-code overlap between train and test; synthetic queries
  derived from the same КР text as the targets. Mitigations in sections 4-5.
- **Shared query model:** a fine-tune shifts the query space used by E3 and any future scope; the E3
  gate and replay are mandatory.
- **Packaging cost** if the passage tower changes (688 MB re-publish) and ADR 0008 profile semantics.
- **Rights/privacy:** RuCCoD licence is only the paper's statement; forum data licence unknown;
  uploading corpus text to Colab/rented GPUs or a hosted LLM is a data-egress decision for the owner.
- **Tool risk (Unsloth):** CUDA-centric; contradictory Mac docs; no documented ONNX path; AGPL on Studio
  (avoid bundling); rapid release cadence (a pinned version/receipt is needed for reproducibility).
- **Over-claiming:** a gain on Q1 is a retrieval-proxy gain, not medical-quality evidence; the clinician set
  stays the shipping gate (system-one note).

## 9. Not verified here

No Unsloth install or run; Mac training claims are from docs and search summaries only; no phone
measurements of any model; the e5-small HF model card text itself was not read (size/licence come from
the HF API and the repo docs); Unsloth speed claims are vendor claims; cost figures and gain ranges are
estimates; no clinician review of any label.

## Sources (accessed 2026-10-08)

- Unsloth README and licence: <https://github.com/unslothai/unsloth> (raw `README.md`, main)
- PyPI: <https://pypi.org/project/unsloth/> (2026.10.2, 2026-10-07)
- Requirements: <https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements>
- Embedding guide: <https://unsloth.ai/docs/new/embedding-finetuning>; notebooks:
  <https://unsloth.ai/docs/get-started/unsloth-notebooks>
- Sentence Transformers + Unsloth: <https://sbert.net/examples/sentence_transformer/training/unsloth/>;
  ONNX backend: <https://sbert.net/docs/sentence_transformer/usage/efficiency.html>
- Mac wrappers (unofficial): <https://github.com/luongnv89/unsloth-mlx>, <https://www.sourcepulse.org/projects/22169346>
- Models (HF API/cards): <https://huggingface.co/intfloat/multilingual-e5-small>,
  <https://huggingface.co/Xenova/multilingual-e5-small>, <https://huggingface.co/deepvk/USER2-small>
  (34 M, 384-d, Apache-2.0, MTEB-rus retrieval 61.87; no ONNX in the repo),
  <https://huggingface.co/deepvk/USER2-base> (149 M, has ONNX), <https://huggingface.co/deepvk/RuModernBERT-small>
- Recipe context: GigaEmbeddings <https://arxiv.org/pdf/2510.22369>; EnterpriseEM <https://arxiv.org/pdf/2406.00010>
- Repo: `AGENTS.md`, `STATE.md` (E1-E5, Q1), `docs/SEARCH_ROADMAP.md`, `docs/SEMANTIC_RETRIEVAL.md`,
  `docs/LOCAL_MODELS.md`, `docs/GROUNDED_LOCAL_ASSISTANT.md`, `docs/research/{system-one-search-benchmark-2026-09,
  laya-russian-search-candidate-2026-09-23, laya-source-smoke-results-2026-09-23, semif-candidate-2026-09-21,
  embeddings-kr-2026-10-02, embeddinggemma-2-2026-10-07, query-datasets-2026-10, query-parser-llm-ner-poc-2026-09}.md`
