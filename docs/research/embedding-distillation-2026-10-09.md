# Strong build-time embedding model, small on-device query encoder, 2026-10-09

STATE KD1, search roadmap item 8a; owner request 2026-10-09: «strong preparation model, small on target
device». Adopted 2026-10-11 with student v3: modules republished, app switched (see «App path»).

Verdict: **adopted.** Giga-Embeddings-instruct 480M encodes the КР passages on the build
machine; a query encoder of exactly e5-small's size, trained to place a query where Giga places it,
runs on the phone. On the Q1 real-language queries the student (v2) nearly matches its teacher and
beats the shipped e5-small on both measures that matter: a relevant recommendation in the top 5 0.458 →
0.576 (95 % CI of the gain +0.070…+0.167), first 0.282 → 0.358 (+0.027…+0.124). Complaints, the weakest
kind of query, gain most (top 5 0.261 → 0.448). The int8 ONNX export is the same 119 MB download and the
same speed as today (3.7 ms p50 on one CPU thread through the app's tokenizer and onnxruntime; e5 4.3 ms)
and keeps the gain (top 5 0.585, first 0.345).

## Idea

A query and a passage only meet as vectors. The passage side is encoded once, at build time, so its
model can be as large as the build machine allows. Only the query encoder runs on the device. The
student does not learn relevance labels: it learns the teacher's *query function* — for any Russian
medical text, output the vector the teacher would output for it as a query. That needs no labelled
pairs and no benchmark text:

```text
build machine                                   phone
  КР chunk ─► Giga 480M ─► 1024 d ─► P (1024→384) ─► int8 ─► module
                                                            │ cosine
  query  ─────────────────────────► student (e5-small size) ─► 384 d
```

- **Projection P:** the leading 384 uncentred principal directions of Giga's passage vectors (89.5 %
  of the energy), so a chunk still stores 384 int8 bytes, as today.
- **Student:** `intfloat/multilingual-e5-small` (118 M parameters, `query: ` prefix kept) plus a
  384×384 linear head, initialised by least squares on 20 000 texts.
- **Loss:** cosine to the teacher's projected query vector, plus a ranking term: KL divergence between
  the teacher's and the student's softmax scores (τ = 0.05) over the teacher's 16 nearest passages of
  every text in the batch (≈2 000 passages per batch).
- **Training text** (169 317 after deduplication, every Q1 query and benchmark text excluded by
  normalised form): RuMedPrime complaints and histories of events outside the RuMedTop3 dev/test ids
  Q1 samples from (7 281), RuCCoD *train* conclusions and annotated phrases (7 091), МКБ names from
  RuCCoD's `mkb2descr.yaml` (17 150), КР titles, section names, leading sentences and random 3–14-word
  spans (137 795). The forum set (licence unknown) is not used: the student's weights ship.
- **Tool:** `tools/benchmarks/embedding_distill.py` (`texts`, `targets`, `project`, `train`,
  `evaluate`); teachers through `tools/benchmarks/embedding_eval.py`.

## Teacher choice

Corpus: the 774 published single-КР modules as of 2026-10-09 (KR5 headings), 96 095 chunks, passage
text as in E1/E2 (title, section path, chunk; 1 200 characters, 256 tokens). Queries: Q1, the 330 with a
relevant КР (165 RuMedPrime complaints, 165 RuCCoD diagnosis phrases). Semantic retrieval only, int8,
exact cosine, grouped by document.

| Model | R@1 | R@5 | strict R@5 | MRR@10 | complaints R@5 | diagnoses R@5 | query, 1 CPU thread |
|---|---:|---:|---:|---:|---:|---:|---:|
| e5-small (shipped) | 0.282 | 0.458 | 0.415 | 0.360 | 0.261 | 0.655 | 10 ms |
| EmbeddingGemma 2 (2026-10-07, previous corpus) | 0.270 | 0.497 | 0.430 | 0.364 | 0.303 | 0.691 | 284 ms (ONNX) |
| **Giga-Embeddings-instruct 480M** | **0.355** | **0.591** | **0.509** | **0.461** | **0.461** | **0.721** | 1 016 ms (PyTorch) |

Giga 480M (`ai-sage/Giga-Embeddings-instruct-480M-0826`, revision `1763d603`, MIT; best model under
500 M parameters on MTEB(rus) per `docs/GIGA_EMBEDDINGS_EVALUATION.md`) ships its own 116-line
modelling file — Qwen3 with bidirectional attention, no I/O — which was read before loading it with
`trust_remote_code` at that pinned revision. Corpus encoding on the M2 Max (MPS, batch 16): 59 min.
A first run at batch 32 alongside another GPU job raised macOS «Impacting Interactivity» command-buffer
aborts, which can leave vectors unwritten; every stored vector set is therefore spot-checked against a
CPU recompute (300 passages: cosine ≥ 0.996; 300 query targets: ≥ 0.996).
`multilingual-e5-large-instruct` was queued as a second teacher and stopped to free the GPU once Giga
showed a clear gain; it is not measured.

## Student

| Variant | R@1 | R@5 | strict R@5 | MRR@10 | complaints R@5 | diagnoses R@5 | ΔR@5 vs e5 (95 % CI) | ΔR@1 vs e5 (95 % CI) |
|---|---:|---:|---:|---:|---:|---:|---|---|
| e5-small (shipped) | 0.282 | 0.458 | 0.415 | 0.360 | 0.261 | 0.655 | — | — |
| teacher, projected to 384 | 0.336 | 0.582 | 0.500 | 0.449 | 0.455 | 0.709 | +0.124 (+0.073…+0.176) | +0.055 (+0.006…+0.103) |
| student v1 (2 epochs, encoder lr 4e-5) | 0.318 | 0.542 | 0.473 | 0.412 | 0.400 | 0.685 | +0.085 (+0.036…+0.133) | +0.036 (−0.009…+0.082) |
| student v2 (4 epochs, encoder lr 1e-4) | 0.358 | 0.576 | 0.494 | 0.457 | 0.448 | 0.703 | +0.118 (+0.070…+0.167) | +0.076 (+0.027…+0.124) |
| **student v3** (v2 + drug indication texts) | **0.376** | **0.585** | **0.491** | **0.467** | **0.467** | **0.703** | **+0.127 (+0.079…+0.179)** | **+0.094 (+0.048…+0.139)** |

Paired bootstrap, 10 000 resamples. v2 was chosen over v1 on dev (R@5 0.557 → 0.581, MRR 0.399 →
0.458); test is reported, not tuned on:

| Split | e5-small | teacher@384 | v1 | v2 | v3 |
|---|---:|---:|---:|---:|---:|
| dev R@1 / R@5 | 0.263 / 0.425 | 0.317 / 0.587 | 0.287 / 0.557 | 0.341 / 0.581 | 0.353 / 0.617 |
| test R@1 / R@5 | 0.301 / 0.491 | 0.356 / 0.577 | 0.350 / 0.528 | 0.374 / 0.571 | 0.399 / 0.552 |

Training: batch 128, head learning rate 5e-4, linear warm-up 5 % and decay; v1 2 646 steps (30 min on
MPS), v2 5 292 steps (62 min). Cosine of the student to the teacher's projected query vector ends at
0.68 (v1) and 0.74 (v2) — far from a copy, yet the ranking term makes it order passages like the
teacher; v2's R@1 even exceeds the teacher's. v3 adds 35 225 drug names and indication fragments of
the ГРЛС and Allmed modules to the training texts (204 500 in total) and excludes every `query` of
every benchmark file under `tools/benchmarks` (1 880 texts), 6 391 steps, 74 min; the teacher targets
of the earlier texts are reused by text. Three variants were trained in total; v3 was chosen on dev
(R@5 0.581 → 0.617).

## On-device export

The head is folded into the ONNX graph: mean pooling is linear, so applying the 384×384 head to every
token before pooling gives the same vector, and the graph keeps e5's interface (`input_ids`,
`attention_mask`, `token_type_ids` → `last_hidden_state`). The app's worker, tokenizer and pooling stay
as they are; only the model files, the passage vectors and the profile change.

Quantisation settings, measured on v1 (query cosine to PyTorch over 60 Q1 queries):

| v1 export | Size | Cosine min / mean | R@1 | R@5 |
|---|---:|---|---:|---:|
| fp32 | 471 MB | 1.000 | 0.318 | 0.542 |
| int8 dynamic, whole graph | 118.3 MB | −0.02 | — | — |
| int8, head MatMul fp32, per-tensor QInt8 / QUInt8 | 118.7 MB | 0.942 / 0.964, 0.959 / 0.980 | — | — |
| **int8, head MatMul fp32, per-channel QUInt8** | **119.0 MB** | 0.982 / 0.990 | 0.300 | 0.548 |

Plain dynamic quantisation of the whole graph broke the vectors: the head reads the final LayerNorm
output, whose outlier channels do not survive 8-bit activations. The e5 export ends at that LayerNorm
and never meets this. The bold setting is the `export` subcommand's.

v2 with that setting (`onnx/model_quantized.onnx`, 119.0 MB): R@1 0.345, R@5 0.585 (complaints 0.473,
diagnoses 0.697; dev 0.581, test 0.589). Through the app's stack — transformers.js tokenizer,
onnxruntime-node, mean pooling (`query-encoder-latency.ts`) — 1 thread p50 3.7 ms, p90 12.1 ms (e5 export
on the same host 2026-10-07: 4.3 / 14.1 ms); query cosine to PyTorch over all 400 Q1 queries min 0.984,
p1 0.986, mean 0.993. That is below the e5 export's minimum (0.993) and the 0.99 tolerance used for e5,
but retrieval through the int8 vectors is not worse than through PyTorch, so the tolerance for this
profile should be stated on retrieval (R@5 within 0.01 of PyTorch) rather than on the minimum cosine.

v3 (shipped): `onnx/model_quantized.onnx` 118 972 175 bytes, SHA-256 `14019498…`, cosine to PyTorch
min 0.991 on the export check; published in two parts on `datasets/kd1-query-encoder-2026.10.11`.

## App path (MedicalCore), 2026-10-11

`run-semantic-kr.ts` and `run-semantic-drugs.ts` over the same modules (published 2026-10-09; e5 vectors
as published, KD1 vectors from `embed_modules.py`, cross-checked against the research vectors: cosine
≥ 0.9989 on 1 986 sampled chunks), queries through the int8 ONNX exports and transformers.js.

**Fusion.** With e5's constants (band 0.1, lexical weight 0.5) clinical hybrid fell below KD1's own
semantic ranking on dev (R@5 0.461 vs 0.551): student cosines spread wider than e5's 0.8–0.9, so a
0.1 band keeps only a few vector hits and lexical candidates dominate. Grid on dev (band 0.05–1,
lexical weight 0.1–0.7): a plateau at band 0.3–0.5 and lexical weight 0.1–0.3 (R@5 0.551, MRR
0.41); `KD1_FUSION` is band 0.5, lexical weight 0.3 (the plateau's most lexical point, which keeps
exact names safest). The two dev grid runs give «lookup semantic» R@5 0.551 and 0.563 for the same
model and modules (two queries), so differences below ~0.015 on dev are noise.

| Q1 КР, clinical hybrid | R@1 | R@5 | strict R@5 | MRR@10 | complaints R@5 | diagnoses R@5 |
|---|---:|---:|---:|---:|---:|---:|
| e5, test (163) | 0.301 | 0.497 | 0.448 | 0.383 | 0.278 | 0.702 |
| **KD1 v3, test (163)** | **0.344** | **0.564** | **0.485** | **0.441** | **0.430** | 0.690 |
| e5, all (330) | 0.267 | 0.473 | 0.415 | 0.356 | 0.285 | 0.661 |
| KD1 v2, all | 0.309 | 0.545 | 0.464 | 0.418 | 0.418 | 0.673 |
| **KD1 v3, all** | **0.318** | **0.561** | **0.482** | **0.426** | **0.430** | **0.691** |

Median search time is unchanged (clinical hybrid p50 184–189 ms over 774 modules in Bun).

**Drugs** (medications scope, 45 colloquial indication queries, 100 trade names):

| | indication hit@1 | hit@5 | precision@5 | name top-1 |
|---|---:|---:|---:|---:|
| e5, hybrid | 0.600 | 0.911 | 0.573 | 1.00 |
| KD1 v2, e5 fusion | 0.467 | 0.733 | 0.400 | 1.00 |
| KD1 v2, `KD1_FUSION` | 0.644 | 0.844 | 0.556 | 1.00 |
| **KD1 v3, `KD1_FUSION`** | **0.600** | **0.844** | **0.569** | **1.00** |

Per query (e5 → v3, hybrid, top 5): 5 lost, 2 gained. Four of the lost ones were a single weak hit
at rank 3–5 in a list that was otherwise wrong for both models («таблетки от головы»: e5 Низорал,
Комбитропил, **Эксенза**, Ксамиол, Бетаксолол; v3 caffeine, Папазол, vinpocetine; «антибиотик при
ангине», «для разжижения крови», «мочегонное от отеков»). One is a real loss: «от молочницы» — e5
5/5 fluconazole; v3 semantic puts fluconazole first, but in hybrid lexical matches of «молоч-»
(lactation products) take the top five. Gained: «при повышенном давлении» (e5 had glaucoma drops
only), «от укачивания». Adding the indication texts to the student (v3) did not move hit@5, so the
gap is not the student's training mix. Not significant on 45 queries; recorded, not hidden.

## Left

1. Phone measurement of the student through the WebView (WASM), as for e5 (the export has the same
   architecture and graph size plus one 384×384 MatMul).
2. «от молочницы»-type lexical false friends in the medications scope: a stem match inside an
   unrelated word outranks the vector ranking at lexical weight 0.3.
3. Release gates (`benchmark:real:release`) run on core.db without vectors and are unaffected; the
   semantic sets above are the measurement of this change.
