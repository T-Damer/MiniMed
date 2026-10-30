# Four Hugging Face ECG models: review for MiniMed (2026-10-30)

Question from the owner: do `Manhph2211/ECG-Scan`, `convaiinnovations/medgemma-4b-ecginstruct-lora`,
`PULSE-ECG/PULSE-7B` and `PKUDigitalHealth/ECGFounder` improve the app?
Checked 2026-10-30 from the HF files API, model cards, linked papers and GitHub code. "Unverified"
marks anything not read from a primary source or not measured here. Licences are noted but are not a
blocker for local experiments (personal use).

## Verdict

| Rank | Model | Verdict | One-line reason |
|---:|---|---|---|
| 1 | **ECGFounder** | **Run one cheap experiment, then maybe fine-tune** | Only candidate that fits the stack: 1D CNN, ~31 M parameters, MIT, third-party ONNX already exists. Earlier smoke test used the wrong slice of the pipeline (2.5 s fragments, top-1 metric); the continuous rhythm-II strip with the 1-lead checkpoint and a fine-tuned head were never tried. |
| 2 | ECG-Scan | Park; at most a 2-hour embedding probe | Gated (manual) + CC BY-NC, embeddings only (no label head), 1.23 GB fp32 ViT-L, code not released, only synthetic renders tested. |
| 3 | PULSE-7B | Skip for the app; optional 1-hour desktop comparator | 14 GB, LLaVA-1.6/Vicuna-7B, free-text answers; best published numbers are on synthetic renders and below our own numeric pack even in its training domain; no phone-photo evidence. |
| 4 | MedGemma-4B LoRA | Skip | Same training data as PULSE with no evaluation at all (training token accuracy only), base model gated under HAI-DEF terms, free text. Only "advantage": a 4B VLM is the one that could conceivably run on a flagship phone. |

## What the repo already knows (so it is not repeated)

| Model | Status in existing notes |
|---|---|
| ECGFounder | **Evaluated.** `research/ecg-photo-ai-open-source.md` ("local ECGFounder smoke-test"): official 12-lead 150-label checkpoint, 20 PTB-XL records. Correct label in top-1/top-3/top-5: native 500 Hz 50/95/100 %; PTB-XL 100 Hz source upsampled 20/70/85 %; visible 2.5 s printed fragments (repeated to 10 s) 0/15/35 %; after Open ECG Digitizer (18 QC-passed cases) 0/16.7/44.4 %. Digitizer preserved ECGFounder's own output (top-1 agreement 18/18, Jaccard 0.82) so the loss is the input representation, not the digitizer. Conclusion there: "not ready as a photo diagnosis head; needs a classifier trained or fine-tuned on the 3×4 / short-lead representation". `research/ecg-ready-pretrained-cnn-2026.md` lists it as "widest output, heavy, poor on short/unsynchronised 3×4 segments". |
| PULSE-7B | **Not named anywhere.** Closest relative, ECG-R1-8B (PKU, Apache-2.0, 9B MLLM), was reviewed in `research/ecg-photo-ai-open-source.md` and `research/ecg-numeric-diagnostic-algorithms-2026.md`: "too large for a local browser, may invent plausible findings; keep only as a future research comparator". |
| MedGemma LoRA | Not evaluated. (Gemma/Llama catalog entries need explicit licence acceptance in Settings, `docs/LOCAL_MODELS.md`.) |
| ECG-Scan | Not evaluated (HF repo created 2026-04-08, paper 2026-04-02; notes date from Aug-Sep 2026 and do not mention it). |
| Direct-image CNNs in general | A patient-disjoint ResNet18 trained by us on 21,251 synthetic 12×1 PTB-XL renders reached macro-AUC 0.912 / macro-F1 0.727 on synthetic test but **2/9 exact matches, micro-F1 0.444, NORM recall 0/6, 6 MI false positives** on 9 real PM-ECG-ID phone photos (3 base ECGs × iPhone/Samsung/Doogee). Rejected (`tools/ecg-cnn/h200-run-20260902.json`, `docs/state/ecg-research-log.md`). This is the key prior for ECG-Scan, PULSE and MedGemma: all three are image-native and trained on synthetic renders. |

Correction to the task framing: no diagnostic CNN is shipped. Shipped ML is the digitizer U-Net
(`Open ECG Digitizer`, q8 ZIP, ~19 MB) and the 261,070-byte adult numeric HGB pack. The "small CNNs"
are the rejected ResNet18 and the rejected Ribeiro 1D ResNet. Bundle validators reject any
diagnostic classifier (`docs/ECG_MODEL_BUNDLE.md`).

## Current pipeline: inputs, outputs, measured quality

| Stage | Contract | Measured |
|---|---|---|
| Photo → rectification | Automatic sheet corners (`ab3bdf365`) + manual 4-corner editor | Oracle rectification restores median lead correlation 0.410 → 0.980 on 15 phone-like renders; automatic corners still lack a grayscale/background-diverse benchmark. |
| Digitizer (`ecg-waveform-digitizer.ts`) | ONNX U-Net in worker; fixed 3×4+1R or 12×1; **100 Hz**, 4–12 s; per-lead `Float32Array`, plus full-length **rhythm lead II** row (≥80 % coverage required) and RR list; quality `usable`/`review`/`failed` | 20 PTB-XL smoke: 9/10 clean and 9/10 phone-like with all 12 leads, SNR 16.7 / 15.8 dB. In-app on 15 external images: 4 usable / 10 review / 1 failed. 15 rhythm images: 6 usable / 8 review / 1 failed. Synthetic: clean median correlation 0.981, phone-like 0.410 (all 11/15 phone-like need review); HR MAE 1.73 / 0.87 bpm. |
| Numeric rule layer | Confirmed RR/PR/QRS/QT/QTc, axis, Sokolow-Lyon, ST at J, AV/WPW/AF/LAFB patterns, all clinician-confirmed | Literal findings, no diagnosis; MIMIC agreement for interval rules in `state/ecg-research-log.md`. |
| Numeric HGB pack | 30 clinician-confirmed fields (ms/mV), age 18-120 → NORM/MI/STTC/CD/HYP | Test macro-AUC 0.913, macro-F1 0.720, Brier 0.090, ECE 0.025; with abstention 93.7 % coverage at answered macro-F1 0.754 but **23.2 % pooled confident false negatives** (403/1740). |
| Automatic AF / rhythm | Disabled | Conservative irregularity candidate fired on 2 of 3 AF images (1 usable), 0 of 12 non-AF; openecg codec missed 2/2 AF after the photo path. |
| Real-phone holdout | 3 base ECGs × 3 phones (PM-ECG-ID) + 15 external images | Statistically tiny. 60-page no-patient capture pack is generated (`generate-ecg-phone-capture-pack.ts`) but not printed or photographed yet. |

So the gap an ML model could fill is: an **automatic** waveform-level second opinion (rhythm in
particular) without requiring 30 hand-confirmed fields. The binding constraint is the real-phone
evaluation set, not the choice of backbone.

## Model sheets

### 1. ECGFounder (`PKUDigitalHealth/ECGFounder`)

| Item | Finding |
|---|---|
| Input | Waveform, not a photo. 12-lead checkpoint `12 × 5000` (10 s at 500 Hz); 1-lead checkpoint `1 × 5000`; `config.json`: `{"input_size": 5000, "sampling_rate": "500Hz", "time": "10s", "lead_num": "12/1"}`. Paper: resample to 500 Hz, notch 50/60 Hz, Butterworth band-pass (paper contradicts itself: low-pass 50 Hz in §2.1 vs 30 Hz in S3.3; high-pass 0.5 vs 1 Hz), 10 s windows **zero-padded if shorter**, z-score per segment. Repo code differs: `ptbxl_eval.py` does a global (all-lead) z-score and linear resample only; `dataset.py` also applies `filter_bandpass`. Lead order I, II, III, aVR, aVL, aVF, V1-V6. |
| Output | 150 sigmoid labels (`tasks.txt`, Marquette-12SL-style statements such as ABNORMAL ECG, ATRIAL FIBRILLATION, RIGHT BUNDLE BRANCH BLOCK, SEPTAL INFARCT). Labels come from cardiologist/technician-confirmed 12SL statements parsed by regex (287 phrases → 150), PU-style loss. Not calibrated probabilities. |
| Architecture | `Net1D` (RegNet-like grouped 1D conv + SE, Swish): filters 64-160-160-400-400-1024-1024, blocks 2-2-2-3-3-4-4, kernel 16, group width 16. **My count from `net1d.py`: 30.8 M parameters, ~1.16 GMAC per 12-lead 10 s input.** The paper's Table S11 says 76.3 M and its architecture text is internally inconsistent; the released graph agrees with my count (below). |
| Files | `12_lead_ECGFounder.pth` 369,942,585 B; `1_lead_ECGFounder.pth` 369,807,481 B. Range-read of the zip directory (no full download) shows each `.pth` holds `epoch`, `step`, `state_dict` **and the Adam optimizer** (`exp_avg`, `exp_avg_sq`) and scheduler: 370 MB ≈ 3 × 123 MB fp32 weights. Deployable weights are therefore ~123 MB fp32 / ~62 MB fp16 / ~31 MB int8 (estimate, int8 accuracy *unverified*). The 1-lead file has the same size, so the paper's "scaled down" 1-lead model is not smaller in the released checkpoint. `.pth` is a pickle: load with `weights_only=True` or convert in a sandbox. |
| Licence / gating | MIT on card and repo; not gated. Paper says data/model are "open access" without naming a licence; training data HEEDB (Harvard-Emory) is distributed via BDSP, so provenance of the weights' training data is restricted even though the weights are MIT. |
| Reported metrics | 10.77 M ECGs / 1.82 M subjects (HEEDB). Internal AUROC > 0.95 for 80 diagnoses; committee test (20 labels) AUROC 0.968, F1 0.677 vs cardiologists 0.640. External (digital signals): CODE-test 6 labels AUROC 0.981; **PTB-XL average 0.924**; 1-lead on PhysioNet 2017: NSR 0.975, AF 0.957. Fine-tune gains on MIMIC-IV-ECG tasks. **No images, scans, photos or digitized signals; no noise-perturbation experiment** (paper). |
| Third-party ONNX | `ghirani33/ecgfounder-onnx` (MIT, 2025-10-29): two 123.5 MB fp32 graphs, 12-lead 150 classes and an "all71" PTB-XL-aligned fine-tune (claims macro AUROC 0.909 on fold 10, n = 2,163, and 115 ms on Raspberry Pi 4: unverified third-party numbers; provenance of the 71-class head unverified; its README names tensors `input`/`logits` but the graph uses `ecg_signal`/`predictions`). **I downloaded the 123.5 MB 12-lead graph and inspected it here**: opset 14, 30.76 M initializer parameters (matches my count), dynamic batch, ops are all standard (Conv, BatchNormalization, Sigmoid, Mul, Einsum, Pad, MaxPool, ReduceMean, Gemm...); onnxruntime CPU ran one 12×5000 input in ~13 ms on this Mac (random input, desktop number, not a phone figure). |
| Phone feasibility | **Yes.** ONNX export feasible (already done by a third party; re-export ourselves for provenance). Compute ~1.2 GMAC: a fraction of a second even on WASM (guess 0.1-0.6 s, *unverified*). RAM: weights + small activations (<~250 MB fp32, *estimate*). The ECG worker already runs `onnxruntime-web` and the digitizer is q8 QDQ, so the same path works. Ship as a separate optional downloadable pack (~31-62 MB), never in the APK. |

Why the earlier smoke test does not close the question:

1. It fed the 12-lead model **repeated 2.5 s fragments**; the real 3×4 page is four non-simultaneous
   segments (a known distribution mismatch, already flagged in `ECG_DIAGNOSTICS_RESEARCH.md`).
2. It scored **top-1 among 150 labels** where generic labels (ABNORMAL ECG, OTHERWISE NORMAL ECG)
   compete with specific ones, so even the native 500 Hz signal got only 50 % top-1. Per-label AUROC
   on a declared mapping is the right metric.
3. It never used the **1-lead checkpoint on the continuous rhythm strip**. In the 3×4+1R layout the
   digitizer already returns a full-length lead II row (up to 10 s, ≥80 % coverage gate). The 1-lead
   model was trained on lead I plus, with probability 50 %, a derived limb lead including II, and
   reports AF AUROC 0.957 externally. This is the one place where a continuous, correctly timed
   single-lead input exists in our output, and it is exactly where our rule layer is weakest (AF/
   flutter/ectopy are disabled).
4. It never fine-tuned. A frozen 150-label head built on 12SL statements is the wrong head for our
   5-class / rhythm scope; the backbone is the asset.

Caveats that remain: the 100 Hz digitizer output has to be upsampled to 500 Hz (the PTB-XL 100 Hz
upsample already cost 30 points of top-1 in the old smoke, partly a metric artefact, partly real);
amplitude is destroyed by z-score (so voltage criteria stay with the rule layer); training labels are
machine-assisted 12SL text, so label noise is inherited.

### 2. ECG-Scan (`Manhph2211/ECG-Scan`)

| Item | Finding |
|---|---|
| Input | **Photo/scan of a 12-lead ECG** (any image; processed with `CLIPImageProcessor` of `openai/clip-vit-large-patch14-336`, RGB). |
| Output | **An embedding vector only** (`.embeddings`); pipeline tag `feature-extraction`. No label head, no text. Zero-shot results in the paper need a text encoder (frozen Bio-Med-CPT teacher) and prompts that are not part of this checkpoint. |
| Architecture / size | CLIP vision encoder adapted with LoRA (r=16, α=32), trained to align with a frozen signal encoder (D-BETA) and text encoder via a three-way (Gramian) contrastive loss plus soft-lead reconstruction. HF reports **307,440,384 params, F32, `model.safetensors` 1,229,841,744 B**. Roughly a stock ViT-L/14 vision tower; if so ~190 GFLOPs per 336 px image (CLIP paper figure for ViT-L/14@336; *unverified for this checkpoint*, `config.json`/`modeling_ecgscan.py` are behind the gate). |
| Licence / gating | **Gated, manual approval** (`gated: manual`), `cc-by-nc-4.0` per HF API and card (a search snippet said Apache-2.0; the API is authoritative). Code: card's GitHub badge is a placeholder; arXiv page links no code; paper says it "will release code and checkpoints". 17 downloads, 8 likes. |
| Training / eval data | MIMIC-IV-ECG, 789,511 signal-text pairs, images **synthesised online with ECG-Image-Kit** (layouts, resolutions, noise). No real photos or scans in training. Evaluation also on synthesised images of PTB-XL, CPSC2018, CSN, CODE-test. Paper: validation under real imaging conditions is future work. |
| Reported metrics (avg AUC %) | Linear probe 1/10/100 % labels: ECG-Scan 71.93/84.51/90.41 vs Open-Digitizer+D-BETA 71.64/81.48/86.56 vs D-BETA (true signal) 82.18/88.28/91.56. Zero-shot avg (PTB-XL, CPSC2018, CSN): 75.8 vs Open-Digitizer+D-BETA 68.6 vs D-BETA 77.1. CODE-test zero-shot 94.78 vs D-BETA 96.79 vs Open-Digitizer+D-BETA 94.04; residents/student 90.5-93.6. Domain-shift table avg 80.05. All on synthetic renders. |
| Phone feasibility | **No.** Full ViT-L at fp32 is 1.23 GB; int8 would still be ~310 MB, over the budget for one optional model, and ~190 GFLOPs per photo is seconds-to-tens-of-seconds on a phone CPU (*guess*). ONNX export of a CLIP vision tower is routine, but custom `trust_remote_code` is unseen. A distilled small student would be a separate project. |

What is interesting: its own paper shows an image-native embedding beating "Open-Digitizer + signal
foundation model" on synthetic renders by ~4 AUC points (linear probe, 100 % labels) and ~7 (zero-shot).
That supports our two-branch idea only on synthetic data; the same synthetic-to-phone gap sank our
ResNet18, and nothing in the paper tests it. Cheapest informative use, if the owner requests access
(free, manual approval; I cannot request it): embed the 9 PM-ECG-ID phone photos, their clean renders
and 3 other base ECGs, and check whether photos of the same ECG from three phones sit closer to each
other and to their render than to other ECGs (invariance probe, ~2 hours on a desktop). Do not
build anything on it before that.

### 3. PULSE-7B (`PULSE-ECG/PULSE-7B`)

| Item | Finding |
|---|---|
| Input | **ECG image** (printed or digital) + text prompt. LLaVA-1.6 "anyres" (grid pinpoints up to 672×672 / 1008×336 tiles over 336 px tiles; `max_position_embeddings` 4096); vision tower `openai/clip-vit-large-patch14-336`. |
| Output | Free text (answers, MCQ choice, report). No structured label set, no scores; AUC/F1 in the paper are derived from parsed text. |
| Architecture / size | `LlavaLlamaForCausalLM`, `pulse-llava-v1.6-vicuna-7b`: 7,062,906,880 params BF16, 3 shards = **14.13 GB** (4,938,993,632 + 4,947,390,880 + 4,239,524,944 B). Vision tower frozen; projector + LLM tuned, 3 epochs, 32×H100, ~10 h. |
| Licence / gating | Card says Apache-2.0, not gated. The base Vicuna-7B v1.5 is a Llama-2 derivative (Llama 2 Community Licence): whether Apache-2.0 on the card is fully accurate is *unverified*. GitHub repo has no licence file. ECGInstruct dataset card: Apache-2.0; ECGBench: no licence tag. |
| Training data | ECGInstruct, 1,156,110 samples (Table A1): PTB-XL 149,425; ECG-QA 139,358; MIMIC-IV-ECG 799,687; CODE-15% 67,640. **Images synthesised from signals with ECG-Image-Kit** incl. wrinkles, creases, rotation, yellowing, noise, layout changes (~1:1 augmented:clean). |
| Reported metrics (ECGBench, 9 sets) | PTB-XL Super (in-domain) AUC 82.4 / F1 74.8; CODE-15% AUC 90.7 / F1 85.4; **CPSC 2018 (out-of-domain) AUC 76.9 / F1 57.6**; ECG-QA acc 73.8; CSN acc 85.2 and G12EC acc 78.2 (8-option MCQ); MMMU ECG acc 58.0 (textbook/clinical images; paper does not say photo vs scan); ECG Arena 38.9 (GPT-4o-judged, +2 over Claude 3.5 Sonnet). Abnormality-detection sets are synthesised renders. **No photographed-paper evaluation. Hallucination analysis not stated.** Our HGB gets macro-AUC 0.913 on the same five PTB-XL superclasses (different protocol, manual features), PULSE gets 82.4 on its own training distribution. |
| Third-party evidence | Search found no independent evaluation of PULSE-7B on phone photos and no PULSE-7B GGUF/quantisation (`PULSE-7bv5` GGUF is an unrelated Chinese medical LLM with a similar name; do not confuse). |
| Phone feasibility | **Desktop/server only in our stack.** A 7B Q4_K_M LM is ~4 GB plus a ~0.6 GB CLIP-L mmproj (*estimates*), ≥6 GB RAM; anyres produces up to ~2,900 image tokens per page (5 × 576), so prefill alone is minutes on a phone CPU and decode a few tokens/s (*guesses*). The app's native llama.cpp is vendored with the `tools/mtmd` source tree but `ai_chat.cpp` is text-only: image input is not wired, and the biggest model it runs today is QVikhr 1.7B Q4 (1.11 GB). There is no GGUF/mmproj conversion recipe for PULSE (it is a LLaVA-1.6 architecture, which llama.cpp supports in principle; *unverified* for this checkpoint). |

Policy fit: free text that sounds clinical is exactly the failure mode already documented for
ECG-R1 ("severe hallucination in ECG MLLMs", repo note) and for small local models in
`CURRENT_STATE.md` ("can satisfy a JSON shape while citing irrelevant text"). Even an excellent
PULSE number would not meet the repo rule that probabilities stay separate from measurements.

### 4. MedGemma-4B ECGInstruct LoRA (`convaiinnovations/medgemma-4b-ecginstruct-lora`)

| Item | Finding |
|---|---|
| Input / output | ECG image + prompt → free text. Base `google/medgemma-4b-it` (SigLIP-style vision tower + Gemma-3 4B LM). |
| Architecture / size | LoRA r=32, α=64, targets include **both** LM projections (`q/k/v/o/gate/up/down_proj`) and vision-tower layers (`fc1`, `fc2`, `out_proj`). `adapter_model.safetensors` 308,107,928 B. Base `google/medgemma-4b-it`: 4,300,079,472 BF16 params (~8.6 GB). The repo also stores `checkpoint-9017/` with optimizer/RNG state (~0.6 GB, irrelevant for use). |
| Licence / gating | Adapter card: Apache-2.0 "following base model licence". **That is wrong or at least unchecked**: `google/medgemma-4b-it` is `license: other` (Health AI Developer Foundations terms) and **gated (auto-approve)**. Treat the adapter as HAI-DEF-governed; legal effect *unverified*. |
| Training | PULSE's ECGInstruct (1,154,110 samples, synthetic renders), 1 epoch, 8×A100-40GB, ~40 h. The only reported numbers are *training* statistics: "mean token accuracy 88.23 %", train loss 10.997 (implausibly high for a per-token loss, *unexplained*). **No ECGBench, no held-out, no per-diagnosis evaluation.** 0 downloads, 1 like, created 2025-12-10. |
| Third-party artefacts | Sibling repos exist (`convaiinnovations/medgemma-4b-ecginstruct`, `-merged`; unrelated community MedGemma-ECG fine-tunes incl. a GGUF); Google's base GGUF (via Unsloth): Q4_K_M 2.49 GB, Q8_0 4.13 GB, mmproj F16 851 MB. |
| Phone feasibility | **Plausible only as a research toy.** Merge the LoRA (including the vision-tower deltas, so llama.cpp's LM-only LoRA path is not enough; vision weights need re-exporting as a new mmproj), convert to GGUF, Q4_K_M ≈ 2.5 GB + mmproj ≈ 0.85 GB ≈ 3.3-3.4 GB download, ~4 GB RAM (*estimates*). 4B Gemma-3 on a high-end phone is a few tokens/s with a 256-token image (*guess*), but the app would need new JNI image plumbing (mtmd) first (days, not hours). |

It carries every limit of PULSE (synthetic training images, text output, no photo evidence) without
even PULSE's published benchmark. Skip.

## Where each could plug in, and what to do

Only ECGFounder plugs in cleanly:

```text
photo → rectify → Open ECG Digitizer → quality gate (usable) → [100 Hz leads + rhythm II]
                                                         ├─ rule layer / HGB (unchanged, confirmed values)
                                                         └─ NEW advisory pack (separate download, adult only, usable only):
                                                              rhythm-II → ECGFounder-1lead (+ fine-tuned head)
                                                              12×N      → ECGFounder-12lead (+ fine-tuned head)
                                                            → «hypothesis for review», never averaged with HGB
```

Constraints that already exist and must be kept: separate pack/manifest (not the digitizer bundle;
the current validator rejects diagnostic classifiers, so this needs a pack format like the numeric
pack and an ADR), age gate ≥ 18, `quality != usable` blocks it, probabilities are not shown as
disease probabilities, ordered results are not fused with HGB.

## Smallest useful experiment

**E0 - ECGFounder as-is, done properly (0.5-1 day, no training, desktop).**

- Weights: official 12-lead and 1-lead `.pth` (370 MB each; above the ~200 MB download cap used for
  this review, so not downloaded here). Convert in a sandbox with `weights_only=True`; compare with the
  third-party ONNX graph for sanity, ship our own export.
- Data we already have: the 20-record PTB-XL smoke set with its renders and Open-ECG outputs; the 15
  rhythm images (3 each NORM, AFIB/AFL, PAC, PVC, TACHY); the 15 external digitizer images; the 9
  PM-ECG-ID phone photos (via the browser digitizer); plus ≥500 PTB-XL fold-10 records rendered clean
  and phone-like with the existing `evaluate-ecg-photo-benchmark.ts` tooling.
- Protocol: declared mapping 150 labels → NORM/MI/STTC/CD/HYP and rhythm groups (AF/flutter, brady,
  tachy, PAC, PVC); **per-label AUROC / sensitivity at fixed specificity**, not top-1; report
  `CNN(native)` vs `CNN(digitized)` on the same base ECG (design from
  `ecg-digitalized-signal-cnn-and-digitizer-training-2026.md`); preprocessing exactly as `dataset.py`
  (verify `util.filter_bandpass`); 5 s inputs zero-padded to 10 s (as in the paper's windowing) vs
  repeated vs stretched, as an explicit ablation; 1-lead model on the rhythm-II row.
- Success gate (pre-registered):
  1. Sanity: native-signal mapped macro-AUROC within 0.02 of the published PTB-XL 0.924.
  2. Photo path, clean render: macro-AUROC ≥ 0.85 and drop vs native ≤ 0.05.
  3. Real phone photos (9 files, 3 base ECGs; indicative only): NORM recall ≥ 5/6 and ≤ 1/6 MI false
     positives, i.e. clearly better than the rejected ResNet18 (0/6 and 6/6).
  4. Rhythm: AF/flutter recall ≥ 2/3 with 0/12 false positives on the 15-image set, i.e. at least the
     current irregularity candidate while covering the `review` cases, which the rule layer cannot.
  5. Honest expectation: gates 2-4 likely fail for the frozen heads, as in the first smoke; the value
     of E0 is to separate "representation mismatch" (fixable by fine-tuning) from "digitizer
     fidelity" (not fixable by any classifier).

**E1 - fine-tune on digitizer-degraded signals (2-3 days incl. data generation; one GPU, hours).** Only
if E0 shows the backbone retains signal under the digitizer path (gate 1-2).

- Head: 5 PTB-XL superclasses (12-lead, folds 1-8 train / 9 validation / 10 test, patient-level) and a
  rhythm head on lead II (PTB-XL rhythm statements + PhysioNet 2017 / Chapman-Shaoxing where licences
  allow). Initialise from the pretrained backbone, train head + last stages first.
- Training signals: ECG-Image-Kit render → Open ECG Digitizer → 100 Hz → crop/pad exactly as at
  runtime. Digitizing is slow (3.6-19.5 s per image on Apple MPS): budget ~2-3 k records (≈2-16 h),
  and add signal-domain augmentation (lead drop-out, NaN gaps, band-limit, baseline wander, time
  warp) for the rest.
- Gate: fold-10 `render → digitizer → model` macro-AUROC drop vs native ≤ 0.05, calibration and
  coverage after abstention, then the same real-phone gate on **new photos**: print and photograph the
  existing 60-page capture pack (30 test pages, two phones) so n is no longer 3 base ECGs. Without
  that, no choice of backbone can be validated and none should ship.

**E2 - productisation (≈1-1.5 weeks, only after E1 passes).** int8 QDQ (check accuracy loss), pack
format + manifest + SHA-256, worker integration beside the digitizer, quality/age gate, schema-declared
labels and UI copy («гипотеза для проверки»), tests, `CURRENT_STATE.md` update.

| Step | Effort | Cost / risk |
|---|---|---|
| E0 | 0.5-1 day | Free; desktop CPU is enough for inference. |
| E1 | 2-3 days | Data generation dominates; one GPU-hour class training; main risk = digitizer fidelity, not the model. |
| Phone photos (print + shoot pack) | 0.5 day of the owner's time | Required for any claim; do it regardless of this review. |
| E2 | ~1-1.5 weeks | Pack format, ADR (diagnostic classifier), int8 parity, latency/RAM on a real Android phone (unmeasured). |

## Optional side experiments (not recommended for the app)

- **PULSE-7B comparator (≈1 hour on one rented GPU or Apple MPS at 4-bit, 14 GB download):** run the 9
  phone photos + 15 external images with a fixed prompt, score against labels. Only to learn whether
  the ECGInstruct recipe survives real photos at all; MedGemma LoRA is redundant to this, since it
  trains on the same data.
- **ECG-Scan embedding invariance probe (~2 hours after the owner requests access):** described above.

## Not verified here

- ECGFounder: weights (370 MB each) not downloaded; checkpoint contents inferred from the zip
  directory and pickle opcodes (no code executed); int8/fp16 accuracy; phone latency/RAM;
  `ghirani33` ONNX provenance beyond the structural inspection; paper vs release parameter conflict
  (76.3 M vs ~30.8 M); preprocessing discrepancy between paper, `dataset.py` and `ptbxl_eval.py`.
- ECG-Scan: contents of `config.json` / `modeling_ecgscan.py` (gated); true FLOPs; whether the 307 M
  parameters equal a stock CLIP ViT-L/14 tower; input resolution.
- PULSE-7B: vision tower inside the checkpoint (config says CLIP ViT-L/14-336, paper does not name it);
  Llama-2 licence inheritance; any llama.cpp/mmproj conversion; all phone memory/latency numbers are
  guesses.
- MedGemma LoRA: any quality at all; HAI-DEF terms for derived adapters; meaning of train loss 10.997.
- Phone-side numbers (RAM, latency, thermal) for every model: none measured; the only measured speed
  is a desktop onnxruntime run of the third-party ECGFounder graph.

## Sources

- ECG-Scan model: <https://huggingface.co/Manhph2211/ECG-Scan> (API `https://huggingface.co/api/models/Manhph2211/ECG-Scan?blobs=true`); card <https://huggingface.co/Manhph2211/ECG-Scan/blob/main/README.md>
- ECG-Scan paper: Pham et al., "Learning ECG Image Representations via Dual Physiological-Aware Alignments", <https://arxiv.org/abs/2604.01526> (HTML <https://arxiv.org/html/2604.01526>; last ~16 k characters of the HTML not read)
- MedGemma LoRA: <https://huggingface.co/convaiinnovations/medgemma-4b-ecginstruct-lora>; base <https://huggingface.co/google/medgemma-4b-it> (HAI-DEF terms: <https://developers.google.com/health-ai-developer-foundations/terms>); GGUF reference <https://huggingface.co/unsloth/medgemma-4b-it-GGUF>
- PULSE-7B: <https://huggingface.co/PULSE-ECG/PULSE-7B>; paper Liu et al., <https://arxiv.org/abs/2410.19008> (HTML <https://arxiv.org/html/2410.19008>); code <https://github.com/AIMedLab/PULSE>; ECGInstruct <https://huggingface.co/datasets/PULSE-ECG/ECGInstruct>; ECGBench <https://huggingface.co/datasets/PULSE-ECG/ECGBench>
- ECGFounder: <https://huggingface.co/PKUDigitalHealth/ECGFounder>; code <https://github.com/PKUDigitalHealth/ECGFounder> (`net1d.py`, `dataset.py`, `ptbxl_eval.py`, `finetune_model.py`, `tasks.txt`, branch `master`); paper Li et al., <https://arxiv.org/abs/2410.04133> (HTML <https://arxiv.org/html/2410.04133>; last ~12 k characters not read)
- Third-party ONNX: <https://huggingface.co/ghirani33/ecgfounder-onnx>
- Related reviewed elsewhere: ECG-R1 <https://huggingface.co/PKUDigitalHealth/ECG-R1-8B-RL>; PM-ECG-ID <https://zenodo.org/records/13617673>; PTB-XL <https://physionet.org/content/ptb-xl/1.0.3/>; ECG-Image-Kit <https://github.com/alphanumericslab/ecg-image-kit>; Open ECG Digitizer <https://github.com/Ahus-AIM/Electrocardiogram-Digitization>
- Repo evidence: `docs/ECG_MODEL_BUNDLE.md`, `docs/ECG_DIAGNOSTICS_RESEARCH.md`, `docs/LOCAL_MODELS.md`, `docs/research/ecg-ready-pretrained-cnn-2026.md`, `docs/research/ecg-direct-image-cnn-2026.md`, `docs/research/ecg-photo-ai-open-source.md`, `docs/research/ecg-digitalized-signal-cnn-and-digitizer-training-2026.md`, `docs/research/ecg-real-phone-holdout-refresh-2026.md`, `docs/state/ecg-research-log.md`, `docs/CURRENT_STATE.md`, `tools/ecg-cnn/h200-run-20260902.json`, `apps/app/src/features/calculators/ecg-waveform-digitizer.ts`, `docs/adr/0014-native-llama-cpp-android-runtime.md`
