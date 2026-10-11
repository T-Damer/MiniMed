# Strong build-time embedding model, small on-device query encoder, 2026-10-09

STATE KD1, search roadmap item 8a; owner request 2026-10-09: «strong preparation model, small on target
device». Adopted 2026-10-11: modules republished, app switched with student v3, then the query side
replaced by student v4c (supervised term, see «Supervised query side»).

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
5/5 fluconazole; for KD1 every top hit is a vector match (lexical score 0) and the model ranks
mastopathy and lactation products above fluconazole (cosine 0.28–0.23 vs 0.17: «молочница» read as
«молочная железа»); semantic mode happens to list the fluconazole leaflet first through group
ordering, hybrid follows the cosines. Gained: «при повышенном давлении» (e5 had glaucoma drops
only), «от укачивания». Adding the indication texts to the student (v3) did not move hit@5, so the
gap is not the student's training mix. Not significant on 45 queries; recorded, not hidden.

## Supervised query side (student v4), 2026-10-11

The student matched its teacher (v3 R@5 0.585 vs Giga@384 0.582), so copying better could not help
further. v4 adds a supervised InfoNCE term against the fixed Giga passage vectors: a train-split
complaint or diagnosis phrase, positive = the teacher's best-scoring chunk of a recommendation whose
registry ICD-10 codes cover the phrase's code (Q1's grade-3 relation), negatives = the other
positives of the batch and the teacher's nearest chunks of other documents
(`tools/benchmarks/src/build-distill-pairs.ts`, `embedding_distill.py train --pairs --init`). It
continues from v3 for 1 500 steps (encoder lr 3e-5), keeping the distillation terms.

**Leakage found and removed.** The first pair set excluded Q1's records but not their patients: 92
of the 195 Q1 complaint patients had other visits among the training pairs (48 dev, 45 test), and a
patient's visits repeat complaints and diagnosis. That run reached R@5 0.779 and was discarded. The
pair builder now drops every visit of a Q1 patient and every RuCCoD train file that holds a Q1 dev
record: 5 931 pairs over 437 recommendations, patient overlap 0. Diagnosis phrases still have close
neighbours in training (9 of 100 RuCCoD test queries at trigram Jaccard ≥ 0.8 — disease names
repeat), so a strict subset without any training phrase at Jaccard ≥ 0.6 is reported too. The
unlabelled distillation texts of v1–v3 still contain other visits of Q1 patients; they carry no
labels, only the teacher's own vectors, which the students did not exceed.

| Q1 (research harness) | dev R@1 / R@5 / MRR | test R@1 / R@5 | strict test (126) R@1 / R@5 / complaints R@5 |
|---|---|---|---|
| e5-small | 0.263 / 0.425 / 0.338 | 0.301 / 0.491 | 0.254 / 0.421 / 0.225 |
| v3 | 0.353 / 0.617 / 0.463 | 0.399 / 0.552 | 0.341 / 0.508 / 0.394 |
| v3 + 1 500 distillation steps (control) | 0.365 / 0.623 / 0.469 | 0.405 / 0.564 | 0.349 / 0.516 / 0.408 |
| v4b, pair weight 1.0 | 0.569 / 0.790 / 0.666 | 0.595 / 0.773 | 0.548 / 0.730 / 0.732 |
| **v4c, pair weight 0.3** | 0.539 / **0.802** / 0.655 | **0.595 / 0.779** | **0.548 / 0.738 / 0.732** |

**Coverage probe.** Only 6 Q1 queries target a recommendation without pairs, so Q1 cannot show
whether supervision crowds out the 337 uncovered documents. A self-retrieval probe takes 15 words of
each document's complaints / clinical-picture section as the query and its own document as the
answer (771 documents):

| | with pairs R@1 / R@5 | without pairs R@1 / R@5 |
|---|---|---|
| v3 | 0.600 / 0.832 | 0.533 / 0.738 |
| control | 0.609 / 0.837 | 0.542 / 0.744 |
| v4b (weight 1.0) | 0.570 / 0.837 | 0.482 / 0.720 |
| **v4c (weight 0.3)** | **0.609 / 0.839** | **0.509 / 0.729** |

v4c keeps the Q1 gain of v4b with half its cost on uncovered documents (R@1 −0.024, R@5 −0.009 vs
v3); it was chosen on dev and the probe.

**App path, v4c** (MedicalCore, the same KD1 modules, `KD1_FUSION` unchanged — a dev grid over band
0.5–2 and lexical weight 0–0.3 is flat within one or two queries):

| Clinical hybrid | test R@1 | test R@5 | test complaints R@5 | all R@1 | all R@5 |
|---|---:|---:|---:|---:|---:|
| e5 | 0.301 | 0.497 | 0.278 | 0.267 | 0.473 |
| v3 | 0.344 | 0.564 | 0.430 | 0.318 | 0.561 |
| **v4c** | **0.454** | **0.718** | **0.633** | **0.436** | **0.727** |

Drugs with v4c: indication hit@1 0.578, hit@5 0.867, precision@5 0.596 (v3 0.600 / 0.844 / 0.569;
e5 0.600 / 0.911 / 0.573); trade-name top-1 1.00. The int8 export's cosine to PyTorch is lower than
v3's (min 0.976 on the export check), but the app-path numbers above are measured through it.
Published as `datasets/kd1-query-encoder-2026.10.11.2`.

Caveat: the pair labels and Q1's relevance come from the same registry ICD mapping, so Q1 measures
how well the model learned that mapping on unseen patients and phrases; it is not an independent
judgement of relevance. The owner's own queries (`owner-queries.json`, hand-chosen targets) do not
share it (`run-semantic-kr.ts --set=owner`, the same modules and app path; e5 from the pre-KD1
commit with the same benchmark file):

| Owner queries naming a КР (45), clinical hybrid | R@1 | R@5 | MRR | thoughtful R@5 (21) | rush R@5 (24) |
|---|---:|---:|---:|---:|---:|
| e5 | 0.400 | 0.667 | 0.499 | 0.571 | 0.750 |
| KD1 v3 | 0.533 | 0.844 | 0.674 | 0.762 | 0.917 |
| **KD1 v4c** | **0.578** | 0.822 | **0.682** | 0.714 | 0.917 |

KD1 is a large, independent gain over e5 in the owner's wording (R@5 +0.16–0.18). v4c against v3 is
even (two queries better at R@1, one worse at R@5 in hybrid; semantic only 0.578 / 0.867 vs 0.533 /
0.822): the supervised term's +0.15 on Q1 is mostly the ICD mapping it learned and does not carry
over to independent queries — nor does it cost anything there. v4c stays for its R@1 and complaint
gains.

## Emulator check, 2026-10-11

Debug APK (Capacitor, the published catalog and model) on an Android 16 arm64 emulator
(`sdk_gphone64_arm64`, Chrome 133 WebView), driven through the WebView DevTools socket:

- First run: core 72 MB from the release, then Settings → «Поиск по смыслу»: 130 MB from
  `datasets/kd1-query-encoder-2026.10.11.2`, both ONNX parts and the joined file verified, «Готово к
  работе» in 60–80 s. The 26 КР the owner queries name installed through their pointer pages; the
  installed records carry the `.kd1` versions.
- The 45 owner queries naming a КР, typed into the search box in «Клинический разбор» over those 26
  modules: vectors used in 41, the expected КР in the top 5 for 39 (thoughtful 19/21, rush 20/24),
  first for 20; submit → rendered results p50 685 ms, p90 1.4 s.
- First semantic query after the app or the model is installed or updated: 5.9–8.7 s (once);
  later cold starts 0.7–1.0 s. Loading the model when the search box gets focus made no measurable
  difference here and was not kept.
- Fixed from the run: the model card stayed on «Проверяем файлы…» while later files and parts
  downloaded (the phase was never set back; old since E2), its «Как это работает» still described
  e5-small; the fact counter said «Распознано 1 полей».
- Seen: «Давящая боль за грудиной, депрессия ST» puts the depression КР first (ACS second and
  third; with the full case sentence ACS is first) — the model reads «депрессия ST» as the mood
  disorder, like «молочница» as the breast.
- Not done: a physical phone (the emulator runs on Apple silicon, faster than a phone), drug
  modules on the device.

`tools/ingest/scripts/verify_embedded_release.py --marker kd1` re-checks the release offline: app
pins, every mirror file by git blob hash, and every module's checksums, profile and vector coverage
(790 modules, model and mirrors: OK on 2026-10-11).

## False friends, 2026-10-11

Teacher against student (v4c), same passage vectors, top 5: for «от молочницы», «таблетки/свечи от
молочницы» the teacher returns fluconazole, miconazole, natamycin; the student returns mastopathy and
contraceptive products. For «депрессия сегмента ST на ЭКГ» the teacher stays cardiac; the student
puts the depression КР second. Controls («мастопатия», «депрессия, потеря интереса») are right for
both. The vectors of the modules are fine; the student did not learn the teacher's reading.

Two student variants did not fix it and were not kept: v5 (v4c + 148 016 more training texts — every
core alias and canonical term, every sentence of the indication sections, a 2–6-word span of every
КР chunk; dev R@5 0.802 → 0.754) and v6 (v5's texts + the drug indication passages in the ranking
term + sampling texts in proportion to the student–teacher gap; dev R@5 0.784). Both still rank
mastopathy products first for «от молочницы».

What the vectors *say* about such a query is measurable: the student's best cosine. Per query set,
its 10th percentile is 0.38 (Q1 complaints), 0.41 (Q1 diagnoses), 0.35 (owner queries), 0.31 (drug
indications); the «молочница» queries peak at 0.22–0.24. Hybrid fusion used only the cosine relative
to the query's best one (`band`), so the best of a set of weak hits counted as fully strong.
`SemanticFusion.confidence` multiplies every semantic strength by where the best cosine lies between
`low` and `high`; `KD1_FUSION.confidence = {low: 0.25, high: 0.35}`. When the vectors are unsure, the
ranking falls back to lexical evidence.

| clinical hybrid | Q1 dev R@1 / R@5 | Q1 test R@1 / R@5 | owner R@1 / R@5 | drugs hit@1 / hit@5 |
|---|---|---|---|---|
| `KD1_FUSION` before | 0.425 / 0.749 | 0.454 / 0.718 | 0.556 / 0.822 | 0.578 / 0.867 |
| **with confidence** | 0.425 / 0.743 | **0.460** / 0.718 | 0.556 / 0.822 | 0.578 / 0.867 |
| + corroboration 0.6 | 0.401 / 0.743 | — | — | 0.511 / 0.844 |

In the drug set «от молочницы» is found (Ацилакт, Флуконазол ШТАДА, ТАЛС, натрия тетраборат) and one
weak hit of «давление» (a glaucoma-drop list either way) drops out. On the emulator, five thrush
wordings: fluconazole in the top 3 for «молочница», «молочница у женщин чем лечить», «лечение
молочницы у женщин»; «средство от молочницы» falls back to weak lexical matches of «средство».
Raising `corroborationWeight` (a chunk found by both lexical and vector search should not score below
a vector-only one) would help «депрессия ST», whose vectors are confident (0.46), but costs dev R@1
and drug hit@1, so it was not adopted.

**Drug search on the device.** All 32 drug packages installed through «Скачать препараты» (343 MB):
indications such as «таблетки от головы» (кофеин, папаверин, Нурофен), «от изжоги» (Изжогофф,
Гевискон), «снотворное» (мелатонин), «мазь от грибка ногтей» (Экзодерил, Экзонафтин) are right, but a
query takes 5–14 s in «Препараты» against 0.7 s for КР. On the host the lexical part alone takes
0.9–5.5 s over those modules; the vector stage is cheap in the app's cached WASM store. This is
lexical work over ~3 GB of drug modules, not KD1; it is a separate task.

## Left

1. Phone measurement of the student through the WebView (WASM), as for e5 (the export has the same
   architecture and graph size plus one 384×384 MatMul).
2. «депрессия ST» (ST depression read as the mood disorder) with a short query; «средство от
   молочницы»-type queries where the confidence fallback meets weak lexical evidence.
3. «Препараты» search latency with all drug modules installed (5–14 s on the emulator).
4. A physical phone: first-query and steady query times in a real WebView.
5. Release gates (`benchmark:real:release`) run on core.db without vectors and are unaffected; the
   semantic sets above are the measurement of this change.
