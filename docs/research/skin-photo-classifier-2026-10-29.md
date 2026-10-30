# Skin-lesion photo classifier («Дерматология по фото») — research, 2026-10-29

Status: research only, no code changed, no weights downloaded. Figures marked *est.* are my estimates
from parameter counts, not measurements. Numbers I could not verify against a primary source are marked
*unverified*. This is not legal advice.

## 1. Summary and recommendation

**Recommended (A): a small fine-tuned CNN plus a "nearest reference images" strip.**
EfficientNet-B0 or MobileNetV3-Large (ImageNet start), fine-tuned on openly licensed phone photos
(SCIN, PAD-UFES-20) plus the owner's illustrated guide, 20–30 classes plus "other / not skin". Each
class maps to МКБ-10 codes in declared data; the codes open the app's cards and клинические
рекомендации through the existing МКБ bridge.

| | A (recommended) | B: Derm Foundation as teacher / probe | C: retrieval only, no diagnosis labels |
| --- | --- | --- | --- |
| Model | fine-tuned small CNN (+ kNN over reference images) | Google Derm Foundation embeddings + linear head | embedding model + kNN over guide/open images |
| Weights licence | own weights; **local-only** if any NC or guide data was used | Health AI Developer Foundations terms (gated, flow-down) | own/Apache backbone; index local-only |
| Expected quality | top-3 about 60–80 % on common conditions *est.*; weak on rare ones and on dark skin | best open embedding for clinical photos; no task numbers published *unverified* | no accuracy claim; shows what looks similar |
| Size shipped | 6 MB (INT8) – 22 MB (FP32) | 1.5 GB model: not shippable; a distilled student would be A | 6–22 MB + about 15 KB per reference thumbnail |
| Effort | 5–8 weeks to a measured prototype, most of it data work | +1–2 weeks on top of A | 2–3 weeks |

Do **not** ship PanDerm, DermLIP or MONET: non-commercial licence or no licence, ViT-L/B size, no
phone-scale variant. Do not expect Google-paper numbers (section 3): they come from 17 k teledermatology
cases with several photos and metadata per case.

Rights (section 5) and Russian device status (section 6) point to one product shape: **A's output is
"visually similar conditions" with measured, stated limits, backed by retrieval (C), not a
diagnosis.** That also matches the invariant (retrieval before generation, sources visible).

## 2. Fit with the repository

- **Runtime exists.** `onnxruntime-web` is pinned to 1.27.0 (root `package.json` override).
  `ecg-model.worker.ts` already runs a CPU ONNX model through `onnxruntime-web/webgpu` shared with
  transformers.js, so a classifier adds no second wasm. WebView threading and speed on a mid-range
  phone are not measured anywhere in the repo.
- **Photo pattern exists.** `EcgPhotoPicker.tsx` (camera via `capture="environment"`, gallery,
  jpeg/png/webp), `ecg-photo-quality.ts` (quality gate), `ecg-model.ts` (catalog item with URL,
  SHA-256, byte size, licence; install verified, cached on the device).
- **Bundling pattern exists.** KD1: `e5-model.ts` pins files by size and SHA-256;
  `scripts/fetch-query-model.ts` fetches, verifies and stages them into the APK web assets; the APK
  check fails the release if the model is missing. APK is about 229 MB against about 300 MB, so
  a 6–22 MB model fits; a 100 MB one would not be wise.
- **Precedent against.** `docs/ECG_MODEL_BUNDLE.md`: "Diagnostic image CNNs remain research
  documentation only and are not accepted by either bundle validator." A derm classifier reverses
  that line, so it needs an ADR (dependency-direction rule: UI imports no model code; the core gets a
  port).
- **МКБ-10 link exists.** `packages/core/src/icd-bridge.ts`: `documentIcdCodes` reads `icd10Codes` /
  `mkbCode` from documents; `IcdRecommendationIndex` lists recommendations by code, matching a code
  or its category/subcode (siblings never match); `bridgeIcdRecommendations` labels results
  «Рекомендация по коду МКБ J20.9». A typed code already returns its МКБ card first
  (`exactIcdCardIds`). So a class declares codes and the app resolves documents; the model never names
  a document.

## 3. Candidate models and datasets

### Models

| Model | Input | Classes / reported quality | Size | Licence (weights) |
| --- | --- | --- | --- | --- |
| Google Derm Foundation (BiT-M ResNet101x3, 448 px, 6144-d embedding) | clinical + dermoscopy | embedding only; linear probes 10–15 % more accurate than plain BiT-M (Google); no task table *unverified* | `variables` file 1.53 GB (HF API); TF-Keras only | gated, HAI-DEF terms: distribution allowed with use restrictions passed on, and "any required health regulatory authorization" |
| PanDerm (ViT-L/16; Base ViT-B/16) | dermoscopy, clinical, TBP, pathology | strong linear-probe/few-shot results claimed, numbers not retrieved | L about 1.2 GB *est.*; B about 340 MB FP32 *est.* | CC BY-NC-ND 4.0, "non-commercial academic research" |
| DermLIP (ViT-B/16, CLIP; Derm1M 403 k pairs) | clinical + dermoscopy | zero-shot, no numbers on card | about 340 MB *est.* | card says cc-by-nc-nd-4.0 and cc-by-nc-4.0 (inconsistent) |
| MONET (CLIP ViT-L/14, 105 k image-text) | clinical + dermoscopy | concept scoring, not a classifier | about 1.2 GB vision tower *est.* | no licence field on card; card calls deployed use out of scope |
| Google DLS (Liu 2020) | 1–3 clinical photos + metadata | 26 conditions: top-1 71 %, top-3 93 % (3,756 cases); versus dermatologists 63–66 % top-1 / 75 % top-3; types II–IV top-1 69–72 % | not released | none (no weights) |
| Public HF/GitHub ISIC or HAM10000 classifiers (e.g. EfficientNet-B0, 8 classes, 81.75 % test) | **dermoscopy** | 7–8 pigmented-lesion classes | 5–20 MB | often MIT, but trained on CC BY-NC data and wrong image type for phone photos |

Open ImageNet-class backbones to fine-tune (parameter counts from the standard model cards; sizes *est.*,
4 / 2 / about 1 byte per parameter):

| Backbone | Params | FP32 / FP16 / INT8 | CPU cost at 224 px *est.* |
| --- | --- | --- | --- |
| MobileNetV3-Large | 5.4 M | 22 / 11 / about 6 MB | about 50–150 ms in wasm |
| EfficientNet-B0 | 5.3 M | 21 / 11 / about 6 MB | about 100–250 ms |
| EfficientNet-B3 | 12 M | 48 / 24 / about 12 MB | about 0.3–0.7 s |
| ViT-S/14 (DINOv2) | 22 M | 88 / 44 / about 22 MB | about 0.5–1.5 s |
| ConvNeXt-Tiny | 28.6 M | 114 / 57 / about 29 MB | about 1–2 s |

Depthwise nets (MobileNet, EfficientNet) lose accuracy under naive INT8; plan FP16 or calibrated /
quantisation-aware INT8 and measure. Speeds are guesses until a phone run.

### Data and licences (the repo is public; record plainly)

| Dataset | Content | Licence | Use here |
| --- | --- | --- | --- |
| SCIN (Google) | 10,408 phone photos, 5,033 contributions, US volunteers; 89 % allergic / infectious / inflammatory; dermatologist labels, Fitzpatrick (estimated) | SCIN Data Use License: sharing and adaptation allowed, no commercial ban, no re-identification, attribution | **best open source of common inflammatory conditions**; weak on cancers; US-skewed |
| PAD-UFES-20 | 2,298 smartphone images, 6 classes (BCC, SCC/Bowen, melanoma, actinic keratosis, nevus, seborrhoeic keratosis) | CC BY 4.0 | the only open phone-photo lesion set; biopsy-driven, Brazilian, mostly light skin |
| HAM10000 | 10,015 dermoscopic images, 7 classes | CC BY-NC 4.0 (Harvard Dataverse terms) | dermoscopy only; pretraining at best; local-only weights |
| ISIC 2019 / 2018 / 2020 and archive | dermoscopy, 8–9 classes | mostly CC BY-NC (2019 and 2020 aggregate NC sources); SLICE-3D 2024 has a CC BY "permissive" subset | same as HAM10000; take only CC-0/CC-BY subsets if published |
| Fitzpatrick17k | 16,577 atlas images, 114 conditions, skin-type labels | CC BY-NC-SA 3.0 on the labels; pictures come from two commercial atlases (DermaAmin, Atlas Dermatologico); images by request or URL | label/class ideas and evaluation; rights of the pictures unclear, keep local |
| DDI (Stanford) | 656 biopsy-proven images, 570 patients, skin types I–II 208 / III–IV 241 / V–VI 207 | Stanford Research Use Agreement: personal non-commercial research, no derivative works, no sharing the link | **evaluation only** for dark-skin performance; never train, never commit |
| DermNet, Derm7pt, Derm1M | atlases / pairs | NC (DermNet CC BY-NC-ND, from memory *unverified*) | do not use |
| Wikimedia Commons | per-image CC | CC BY / CC BY-SA, per image | possible gap filler with per-image provenance; labels noisy |

Reality check on difficulty: Google's 26-class result used 17,777 cases with several photos and 45
metadata fields, and Google notes types V–VI were too rare to analyse. Fitzpatrick17k (114 classes) top-1
was reported near 20 % in a secondary source (*unverified*), and DDI shows 29–40 % ROC-AUC drops of
older models on dark skin and on rare / inflammatory conditions. Models degrade on skin types they
did not see; fine-tuning on DDI-like data narrows the gap.

## 4. The owner's illustrated guide

I have not seen it; the plan below holds for any atlas-style guide with a diagnosis per picture.

**Three uses, in this order.**

1. **Held-out evaluation set for Russian practice (first, and always).** It fixes what "correct"
   means for this clinic's vocabulary and presentation. Caveats: atlas pictures are textbook
   presentations, so accuracy on them is inflated; with one to ten pictures per diagnosis, per-class
   accuracy is meaningless (a 500-picture set gives about ±4 % on overall top-3, nothing per class).
   Mitigate by re-photographing a printed page and a screen with a phone (adds blur, glare, perspective,
   moiré) and by adding the owner's own consented clinic photos over time.
2. **Taxonomy source.** Take its diagnoses as the label list, normalise names to МКБ-10 codes from the
   official classifier (codes are facts, not the guide's expression), merge look-alike classes the
   photo cannot separate (for example eczema subtypes into one class with a code set), and record
   `code → class` in declared data (section 7). Check every class against the content core: a script
   lists documents per code, and a class with no клиническая рекомендация or card is shown as a card
   only, or dropped.
3. **Fine-tuning data.** Per class, rough needs: frozen embeddings + linear head 20–50 pictures; full
   fine-tuning of a small CNN 300–1000. An atlas gives 1–10, so it **cannot be the main training set**.
   It works as (a) few-shot prototypes for kNN (explanation strip), (b) extra positives for classes
   open data lacks, (c) a calibration set. Recipe: pretrained backbone, train head first, then unfreeze;
   class-balanced sampling; RandomResizedCrop (scale 0.6–1), flips and 90° rotations (skin has no
   orientation), mild brightness / white-balance / blur / JPEG jitter, **small hue shifts only**
   (erythema and pigment carry the diagnosis), mixup / cutmix; split by figure and case, never by
   augmented copy. If the guide enters training, split it first (for example 70 / 30) and freeze the
   30 % as the only untouched copy; a model trained on all of it needs a different evaluation set.
   Combine: SCIN + PAD-UFES-20 as the open core, HAM10000/ISIC only to pretrain the lesion classes, guide
   on top, DDI and own photos for testing.

## 5. Rights, stated plainly

- A published guide's pictures are copyrighted. The owner's personal use does not make them
  publishable, and the repository is public. **Keep the pictures, derived crops, embeddings, the
  trained weights and any index built from them local-only**, outside git: under `data/` (gitignored,
  recorded in `docs/data-ledger.json` when ≥ 50 MiB), the same way the existing local-only modules
  (Vidal, TNM) are kept. A model trained on them can memorise images, so treat the weights as a
  derivative.
- The same rule covers anything trained on CC BY-NC / NC-ND data (HAM10000, ISIC, PanDerm-based): fine
  for personal non-commercial use, not for the public mirror, GitHub Release or Pages.
- **Can be published:** the `code → class` map and class names (own wording, official МКБ-10), the
  training / evaluation scripts, aggregate metrics tables, the model card, and a manifest with the
  SHA-256 of the local weights. A model trained **only** on SCIN (attribution, no re-identification) and
  PAD-UFES-20 (CC BY 4.0) could be published with attribution; get that model separately so the public
  and the private builds stay distinct.
- Local build path: a `scripts/fetch-skin-model.ts` that reads a **local** path (not the mirror)
  and stages it into the APK, like `fetch-query-model.ts`; CI never has the weights, so a CI build
  simply has the feature absent.
- DDI forbids derivatives and link sharing: evaluation use only, files never copied into the repo.

## 6. Presenting 1–3 variants honestly

- **Output shape.** Up to three classes only while their summed calibrated probability reaches a floor
  (for example 0.6); otherwise fewer. Show «Похоже на» with the class, a coarse level
  (высокое / среднее / низкое сходство) instead of a bare percentage unless calibration is measured on
  held-out data (temperature scaling; report ECE). Under each: the nearest reference pictures with
  their source, then the МКБ card and рекомендации.
- **«Не определено».** Shown when the top probability is under a threshold, when the embedding is far
  from every class prototype (OOD: max-softmax or energy score plus Mahalanobis distance on embeddings),
  or when a small gate says "not skin / not a lesion". Train an explicit "other" class with non-skin,
  healthy skin, hair, clothing and screen-photo negatives.
- **Quality gate** before inference, reusing the ECG-photo pattern: Laplacian-variance blur, clipped
  exposure, low skin share, finding too small in frame (crop to a minimum pixel size), glare; the
  message says what to change («Слишком темно. Приблизьте очаг и включите свет»).
- **Malignancy is a separate head**, not a rank. A one-vs-rest "новообразование, требует осмотра"
  output uses a threshold fixed for ≥ 95 % sensitivity on the evaluation set, with the measured
  specificity written next to it. A lesion class below the top-3 can still raise it.
- **Style rules.** No disclaimers («не заменяет врача» is banned by AGENTS.md); state facts and limits
  instead, behind the header «?»: training sources and counts, number of classes, measured top-3 and
  malignancy sensitivity / specificity on the stated test set, skin types I–VI represented in
  training and test, "not trained on children / mucosa / nails / scalp" and similar. Name the real
  sources («SCIN, Google; PAD-UFES-20; оценочный набор — ...») as the assessment rules require. Numbers use
  the correct Russian plural forms.
- **Fairness gate.** Report accuracy per Fitzpatrick bucket (DDI for V–VI). If V–VI is untested or
  below a floor, the screen says so plainly rather than hiding it.

**Regulatory fact (Russia).** Under 323-ФЗ ст. 38, special software can be a medical device; state
registration is by Roszdravnadzor (Постановление Правительства № 1416 of 27.12.2012). Roszdravnadzor
letter 02И-297/20 (13.02.2020) treats software as a medical device when it is intended for medical
care and automatically interprets results, including with AI, so that they influence clinical
decisions; typical class 1–2a, about 3–9 months (class 1) to 8–24 months (class 2a), with clinical
trials. A scoping review of the register found a handful of registered dermatology AI products. A
photo-to-diagnosis feature fits that definition; an in-house tool for the owner is outside any
distribution, but any wider release needs registration or a retrieval-only positioning (C). *Check the
current acts and the register before relying on this summary.*

## 7. Integration sketch (names are proposals)

- **Declared data (schema first).** `apps/app/src/features/skin-photo/skin-classes.json`: per class
  `id`, `titleRu`, `icd10: ["L40", "L40.0"]`, `group`, `malignancyFlag`, `lookalikes`; a schema in
  `schema/` and a test that every code exists in the core and each class resolves to a document. The
  screen never branches on a class id.
- **Contract and port.** `packages/contracts`: `SkinPhotoResult { variants[{classId, level,
  probability?}], status: 'ok' | 'unsure' | 'not-skin' | 'poor-quality', quality[], malignancy }`. The
  core reads documents by МКБ code (existing `IcdRecommendationIndex` plus card lookup); the first
  prototype can open search with the code as the query, no core change.
- **Files.** `features/skin-photo/`: `skin-model.ts` (pinned manifest like `e5-model.ts`),
  `skin-model.worker.ts` (ort-web; resize 224–288, ImageNet normalisation, EXIF orientation),
  `skin-photo-quality.ts`, `SkinPhotoFlow.tsx` (shared picker extracted from `EcgPhotoPicker`),
  `skin-references.ts` (kNN over a local index), `SkinModelSettings` beside `EcgModelSettings.tsx`.
- **Distribution.** Bundle in the local APK (6–22 MB, KD1 precedent); web / iOS offer an optional
  download after the user confirms. A model may be recommended; the reference-image index is the
  "images" part and stays opt-in and local.
- **Offline.** Fully on device; photos stay in memory, are never logged, and are stored only if the
  clinician saves them to a visit. Needs an ADR and a `CURRENT_STATE.md` section after the prototype.

## 8. Open risks

1. Rights of the guide pictures and of NC datasets (section 5); re-check before publishing anything.
2. Domain gap: atlas and dermoscopy images versus live phone photos overstate real accuracy.
3. Dark skin and rare conditions: no open phone-photo set with enough V–VI cancer; DDI-style drops.
4. Few cancers in SCIN and six classes in PAD-UFES-20: melanoma sensitivity rests on small counts;
   report confidence intervals.
5. Anchoring on a ranked list; the "unsure" outcome and malignancy head must be tuned for safety.
6. Russian device status (section 6) if the app leaves the owner's hands.
7. Unmeasured: wasm speed and memory in the WebView, INT8 loss on depthwise nets, phone colour.

## 9. Phased plan

| Phase | Weeks | Content | Exit |
| --- | --- | --- | --- |
| 0 decide | 1 | owner picks A / C; ADR; rights ledger (`data/skin/`, gitignored); class list from the guide with codes; script that lists documents per code | class map with all codes resolved or marked |
| 1 prototype | 2–3 | frozen backbone + head on SCIN + PAD-UFES-20, ONNX export, ort-web worker, camera / gallery, quality gate, hidden screen, local weights | runs in browser and on a phone; speed and memory recorded |
| 2 evaluation set | 2–3 | digitise the guide into a private eval set (page and screen re-photos included), consented own photos, DDI for V–VI; fixed split, protocol, metrics: top-1 / top-3, per-class recall, malignancy sensitivity / specificity with CIs, ECE, per-skin-type | metrics table and failure list; go / no-go |
| 3 fine-tune | 2–3 | full fine-tune, augmentation as in section 4, calibration, OOD threshold, INT8 / FP16 comparison | meets thresholds fixed in phase 2 |
| 4 ship | 1–2 | `fetch-skin-model` local stage, manifest, help text with real numbers, tests (class map, quality gate, thresholds), `CURRENT_STATE.md`; QA pass as a doctor | one local APK; public repo carries no images or restricted weights |

## 10. Results, 2026-10-30

Per case on the held-out split (groups keep one patient or series in one split); "phone" = SCIN + PAD-UFES-20.

| Model | All cases top-1 / top-3 | Phone cases top-1 / top-3 | Cancer sens. / spec. (phone) | Size |
|---|---|---|---|---|
| B0, 21 classes, SCIN + PAD only (v1) | — | 52 % / 80 % | 94 % / 89 % | 16 MB |
| B0, 37 classes, all sources (shipped) | 75 % / 89 % | 61 % / 80 % | 97 % / 91 % | 16 MB |
| B0 + ConvNeXt-Tiny average | 77 % / 90 % | 63 % / 81 % | 95 % / 93 % | 122 MB |

Adding atlas, DermNet and ISIC photos lifted top-1 on phone photos by nine points and let the model learn 16
more conditions without losing top-3. The second model adds about one point, so the app keeps the single
B0. The weakest classes have the fewest photos (cellulitis, furuncle, impetigo, drug rash, milia); the next
gain is data, not architecture — Derm1M (gated on Hugging Face) is the largest open source left.

### Derm1M and a DermLIP teacher

Phone cases, and the phone cases DermLIP never saw (PAD + the SCIN photos outside Derm1M, 229 cases, mostly
PAD lesions). Malignancy thresholds at 95 % sensitivity on validation (the distilled B0: phone validation).

| Model | Phone top-1 / top-3 | Phone sens. / spec. | Unseen top-1 / top-3 | Unseen sens. / spec. | Ships |
|---|---|---|---|---|---|
| B0 (above) | 61 % / 80 % | 97 % / 91 % | 80 % / 94 % | 98 % / 80 % | was |
| DermLIP ViT-B/16 frozen + linear head, with details | 60 % / 85 % | 97 % / 95 % | 82 % / 99 % | 98 % / 84 % | no (ND licence) |
| B0 + 69k Derm1M photos, distilled from DermLIP | 61.5 % / 86.2 % | 96 % / 96 % | 79.5 % / 97.4 % | 97 % / 88 % | yes |

Top-1 on phone rashes stays near 60 %: SCIN labels are dermatologists' differentials from the same photos
(eczema, contact dermatitis, bites and folliculitis look alike), so top-3 is the fairer measure there. The
student matches its teacher on top-3 at 16 MB and B0 speed. Retraining DermLIP fully (local only) would make a
stronger teacher; DermFM-Zero (PanDerm ViT-L, 304M) needs the authors' open_clip fork and was not scored.

## Sources

- Derm Foundation card: https://huggingface.co/google/derm-foundation ; file sizes via https://huggingface.co/api/models/google/derm-foundation?blobs=true
- HAI-DEF terms: https://developers.google.com/health-ai-developer-foundations/terms
- SCIN: https://github.com/google-research-datasets/scin ; licence https://raw.githubusercontent.com/google-research-datasets/scin/main/LICENSE ; paper https://arxiv.org/abs/2402.18545
- PanDerm: https://github.com/SiyuanYan1/PanDerm ; DermLIP: https://huggingface.co/redlessone/DermLIP_ViT-B-16 ; MONET: https://huggingface.co/suinleelab/monet
- Liu 2020 / Google blog: https://research.google/blog/using-deep-learning-to-inform-differential-diagnoses-of-skin-diseases/ ; https://arxiv.org/abs/1909.05382
- DDI: https://aimi.stanford.edu/datasets/ddi-diverse-dermatology-images ; paper https://pmc.ncbi.nlm.nih.gov/articles/PMC9374341
- Fitzpatrick17k: https://github.com/mattgroh/fitzpatrick17k ; https://arxiv.org/abs/2104.09957 ; label audit https://www.arxiv.org/pdf/2401.14497
- PAD-UFES-20: https://data.mendeley.com/datasets/zr7vgbcyr2/1
- HAM10000: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/DBW86T (terms of use = CC BY-NC 4.0, read via the Dataverse API) ; paper https://pmc.ncbi.nlm.nih.gov/articles/PMC6091241
- ISIC 2024 SLICE-3D: https://challenge2024.isic-archive.com/background
- Russian rules: https://www.webiomed.ru/en/blog/on-the-rules-for-registering-software-as-a-medical-device-in-russia ; register review https://vestnikdv.ru/jour/article/download/16936/2078
- Repo: `AGENTS.md`, `docs/ECG_MODEL_BUNDLE.md`, `apps/app/src/features/semantic/e5-model.ts`, `scripts/fetch-query-model.ts`, `packages/core/src/icd-bridge.ts`, `docs/SEARCH_ARCHITECTURE.md` «МКБ → recommendation bridge»
