# MiniMed ECG digitizer bundle v1

MiniMed installs one waveform-only ZIP. It converts an ECG image into numerical traces and contains
no diagnostic classifier, disease labels, or probability scores:

```text
minimed-ecg-model.json
open_ecg_digitizer.json
onnx/open_ecg_digitizer.onnx
licenses/open-ecg-digitizer-CC-BY-SA-4.0.txt
```

The manifest format is:

```json
{
  "format": "minimed-ecg-waveform-digitizer",
  "formatVersion": 1,
  "name": "Open ECG Digitizer",
  "version": "2026.1",
  "source": "https://github.com/Ahus-AIM/Electrocardiogram-Digitization",
  "license": "CC BY-SA 4.0"
}
```

Installation verifies the catalog byte size and SHA-256, validates the archive, and atomically
switches the device-local cache. Inference runs locally through ONNX Runtime Web. The fixed-layout
postprocessor reports extracted lead coverage, duration, grid scale, and RR/heart rate only when its
quality checks pass; manual measurements remain the fallback.

## Reproducible package

Model weights and generated bundles stay outside Git:

```bash
python tools/ingest/scripts/package_open_ecg_digitizer.py \
  /tmp/Electrocardiogram-Digitization \
  /tmp/unet_weights_07072025.pt \
  /tmp/minimed-ecg-open-digitizer-2026.1-q8.zip \
  --calibration-dir /tmp/ecg-image-kit/data/generated_images
```

The browser adapter reproduces the upstream sparse-probability normalization and `0.1` signal
threshold before deterministic fixed-layout 3x4+1R extraction. It does not reproduce the upstream
perspective correction or layout/OCR pipeline; failed or review-only results stay in the manual
workflow. Even a usable automatic RR/heart-rate result remains a draft until the clinician explicitly
accepts it; diagnostic rules never consume an unconfirmed digitizer result.

## Numeric diagnostic pack

The optional adult numeric pack is separate from the image digitizer:

```text
minimed-ecg-diagnostic-pack.json
hgb-model.json
NOTICE.txt
```

It is trained on the public PTB-XL+ Uni-G feature table, accepts a fixed 30-field contract in ms/mV,
and returns calibrated `NORM`, `MI`, `STTC`, `CD`, and `HYP` hypotheses with a per-class abstention
zone. Installation verifies 261,070 bytes and SHA-256
`f51d88ced3687fe0840eff51d8187ea59a6ba401b5c364368cf0b6140e09832d`, validates the exact feature
order/units and bounded tree structure, and stores the pack in a separate device-local cache. The UI
requires all 30 clinician-confirmed values and age 18–120; it does not impute missing values.

The exported JavaScript-readable HGB matched sklearn on all 2,185 adult test records with maximum
probability difference 0. A browser install/control inference also passed. These are engineering
parity checks, not clinical qualification. The `MI` class is a broad training-label pattern and is
never presented as confirmation of acute infarction.

The published `2026.2` model uses format version 1 and a symmetric abstention margin. Runtime also
accepts format version 2, which replaces that margin with explicit per-class `negativeThreshold` and
`positiveThreshold` values. The local `2026.3` safety candidate uses this asymmetric policy: its
negative pathology cutoffs were selected on validation fold 9, then evaluated once on fold 10. It
reduced confident pathology false negatives from 23.2% to 5.3%, while pathology coverage fell from
93.6% to 65.6%. The candidate ZIP is not published and the catalog intentionally remains on
`2026.2` until external validation and release access are available.

Diagnostic image CNNs remain research documentation only and are not accepted by either bundle
validator. Candidate inputs, licensing problems, and measured limitations are in
[ECG_DIAGNOSTICS_RESEARCH.md](ECG_DIAGNOSTICS_RESEARCH.md),
[research/ecg-photo-ai-open-source.md](research/ecg-photo-ai-open-source.md), and
[research/ecg-numeric-diagnostic-algorithms-2026.md](research/ecg-numeric-diagnostic-algorithms-2026.md).

## Publishing

The stable model channel retains other MiniMed model assets while adding or replacing either ECG
bundle:

```bash
bun run models:publish -- /tmp/minimed-ecg-open-digitizer-2026.1-q8.zip
bun run models:publish -- /tmp/minimed-ecg-numeric-adult-2026.2.zip
```

The current digitizer and numeric pack are published in the
[`models-preview-1`](https://github.com/T-Damer/MiniMed/releases/tag/models-preview-1) prerelease.
The Pages build copies it to the CORS-safe download mirror; DEV serves the same path through the Vite
release proxy.
