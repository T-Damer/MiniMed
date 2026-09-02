# OpenECG as a local ECG numeric delineator

Checked: 31 August 2026

Status: primary-source implementation and benchmark note. It is not clinical validation and does
not approve a model for release.

## Decision

OpenECG is worth a **measurement-layer benchmark**, not adoption as a broad ECG diagnosis engine.
Its useful local artifact for MiniMed is the compact `codec_v6_int8.onnx` frame head: from one
10-second lead it labels P, QRS and T spans, from which per-lead PR/QRS/QT measurements can be
derived. MiniMed must ignore the codec's beat and rhythm classes for the first experiment and keep
the existing clinician-reviewed morphology plus deterministic rule layer authoritative.

This boundary matters. The OpenECG codec is single-lead; its own model card says BBB is limited by
lead II because the discriminating RBBB/LBBB morphology is in V1/V6. It therefore cannot replace
the 12-lead observations required by MiniMed's bundle-branch rules, cannot produce a trustworthy
global simultaneous QRS from a sequential paper layout, and cannot diagnose ischemia, infarction,
hypertrophy, lead reversal or the cause of a wide complex.

## Measurement and diagnostic statement generation are separate layers

Published coding systems do not remove this boundary. The CDC/NCHS
[HHANES NOVACODE manual](https://wwwn.cdc.gov/nchs/data/hhanes/6540.pdf), the primary
[NOVACODE serial-comparison paper](https://doi.org/10.1016/S0022-0736(10)80041-X), Minnesota Code,
and the published [GE 12SL](https://landing1.gehealthcare.com/rs/005-SHS-767/images/45351-MUSE-17Nov2022-6-1-Quick-Reference-Guide-LP-Diagnostic-Cardiology.pdf)
and [Glasgow](https://8331374.fs1.hubspotusercontent-na1.net/hubfs/8331374/Knowledge%20Base/corpuls3/20210525_glasgow_GAN_v1.0_ENG_Druck.pdf)
physician guides describe coding criteria, comparisons and the features required to form statements.
None supplies a ready, permissively licensed browser runtime. A delineator may populate
measurements; a separately sourced rule layer must decide whether the required cross-lead, beat, RR
and morphology evidence is complete.

A fresh open repository illustrates the architecture but is not adoptable:
[`Arpit-Gupta-Anumana/ecg-rule-engine` at `84abdf7`](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/tree/84abdf76b21de6838d5945016893a543fefc6af9)
describes 56 YAML rule files, 133 variants and a 138-feature DSL, evaluated on 21,799 PTB-XL
records using GE 12SL features and GE 12SL statements as ground truth
([README coverage](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/blob/84abdf76b21de6838d5945016893a543fefc6af9/README.md#L265-L277)).
Its package metadata says `Proprietary`
([`pyproject.toml`](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/blob/84abdf76b21de6838d5945016893a543fefc6af9/pyproject.toml#L5-L12))
and no permissive `LICENSE` is present at that commit. Its README claims verbatim transcription of
GE criteria, while rule files explicitly retain
[proxies](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/blob/84abdf76b21de6838d5945016893a543fefc6af9/rules/acute_mi_stemi.yaml)
and [stubs](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/blob/84abdf76b21de6838d5945016893a543fefc6af9/rules/ectopy.yaml).
Evaluation against the same vendor's features and statements is
circular rather than an independent clinical test: the published measurements-only report gives
LBBB F1 0.6594, RBBB 0.5503, acute-MI 0.1382 and zero for AF/flutter/ectopy
([primary CSV](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/blob/84abdf76b21de6838d5945016893a543fefc6af9/reports/12sl_metrics_measurements_only.csv)).
Use it only as a reference for a traceable DSL/evidence report. Do not copy its code, rules or GE
transcription into MiniMed.

## Pinned implementation and licensing

The candidate is OpenECG `0.11.0` at immutable commit
[`60ac8887ab0d640fbab6ef094d023b72a9f630c5`](https://github.com/vitaldb/openecg/tree/60ac8887ab0d640fbab6ef094d023b72a9f630c5).

| Item | Pinned fact | Consequence for MiniMed |
|---|---|---|
| Code/package license | [`pyproject.toml` declares Apache-2.0 and the root `LICENSE`](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/pyproject.toml#L1-L8). | The Python source has an explicit permissive code license. Preserve the license and notices if code is ported. |
| Shipped weights | The package definition explicitly includes `.tflite`, `.pt`, `.onnx`, model cards and the root license in the distribution ([artifact rules](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/pyproject.toml#L112-L150)). | The weights are shipped as package artifacts, but no model card or model-directory file gives them a separate weight license. Treat Apache-2.0 as the repository/package declaration, **not** as independently verified training-data-derived-weight clearance. Legal review remains required before redistribution. |
| Layered codec | `codec_v6_int8.onnx`, 3,778,653 bytes, SHA-256 `640d2d13fbf71065b38cd999177ec294fafd532d608662f705cfb8c485e951f8`. | Preferred browser experiment because MiniMed already ships ONNX Runtime Web. |
| Boundary model | `boundary_int8.tflite`, 1,480,128 bytes, SHA-256 `2e130ed795491764ffa4f7eff5decc06a4531ac69e1cab51bfbffa714bc0b3fb`. | Useful reference artifact, but MiniMed has no TFLite browser runtime and should not add one for this experiment. |
| Project maturity | PyPI metadata classifies the project as `Development Status :: 3 - Alpha` ([metadata](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/pyproject.toml#L24-L35)); the model card says research/educational only and not for diagnosis ([limitations](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/models/codec_v6_MODEL_CARD.md#L84-L108)). | Pin the exact bytes; do not follow an unversioned model automatically or present output as a medical-device result. |

LUDB 1.0.1 and QTDB 1.0.0 files use the Open Data Commons Attribution License 1.0
([LUDB license](https://physionet.org/content/ludb/1.0.1/LICENSE.txt),
[QTDB license](https://physionet.org/content/qtdb/1.0.0/LICENSE.txt)).
Their records may be used for an attributed benchmark, but source IDs, versions, licenses and
transforms must remain in the fixture manifest.

## Actual model contracts

OpenECG ships two different learned delineators. Their metrics and input contracts must not be
mixed.

### v56c boundary TFLite

- Input: one one-dimensional lead, exactly 2,500 samples at 250 Hz (10 seconds), rank-normalized.
- Longer signals are divided into non-overlapping 10-second windows; a final partial window is
  zero-padded.
- Learned output: 500 frames at 50 Hz with four classes: `other`, `P`, `QRS`, `T`, plus a boundary
  regression head.
- Deterministic decoder: argmax contiguous runs, drops runs shorter than two frames (40 ms), and
  converts frames to sample-indexed P/QRS/T spans. See the pinned
  [`deploy.py` input constants and decoder](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/deploy.py#L45-L52)
  and [`Inference.predict`](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/deploy.py#L393-L474).
- Lead: the production graph is one-channel and does not recover information absent from that lead.

### codec v6 ONNX

- Input: one rank-normalized lead, 5,000 `float32` samples at 500 Hz (10 seconds), shape
  `(batch, 5000)`.
- Learned outputs at sample resolution: frame logits `(B,5000,4)`, beat logits `(B,5000,6)` and
  rhythm logits `(B,5000,6)`. The exact class orders and tensor shapes are in the
  [v6 model card](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/models/codec_v6_MODEL_CARD.md#L1-L14)
  and [artifact section](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/models/codec_v6_MODEL_CARD.md#L110-L117).
- Architecture: 1,159,572 parameters, single lead, 10 seconds at 500 Hz, with per-window rank
  normalization ([model card](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/models/codec_v6_MODEL_CARD.md#L38-L47)).
- Direct `OnnxCodec.encode` truncates input beyond 10 seconds and zero-pads shorter input. The
  separate streaming helper is needed for longer recordings. Its 2-second edge guard means a
  standalone 10-second result should be scored separately on the inner 6 seconds and on the whole
  window; otherwise edge behavior is hidden.

### Learned versus deterministic output

| Output | Origin | MiniMed treatment |
|---|---|---|
| P/QRS/T sample labels and boundaries | Learned frame head; the v56c decoder also applies deterministic run filtering/boundary conversion. | Candidate measurement input; benchmark against expert boundaries. |
| Beat classes (`sinus`, `vpc`, `paced`, `fusion`, `unknown`) | Learned beat head, then deterministically gated to samples the frame head labels as QRS. | Ignore in the first integration. |
| Rhythm classes (`sinus`, `avb`, `paced`, `afib`, `bbb`, `ventricular`) | Learned rhythm head; report-level label/confidence is a deterministic sample-frequency aggregation. | Do not expose or feed the MiniMed rule engine. It is not a 12-lead diagnosis. |
| R-peaks and heart rate | `detect_qrs`, a NumPy signal-processing detector; RR/HR summaries are arithmetic over its peaks. | May be compared to the current deterministic RR path, but must retain provenance. |
| PR, QRS and QT in `report()` | Deterministic medians and P→QRS/QRS→T pairing over the **learned frame spans**. | Learned-dependent measurements, not independent rule-only facts. |
| AF check | Hand-written RR rules in `afib.py`, trained/tuned by a sweep described in the source. | Do not call it an independent clinical validator; exclude from this delineation benchmark. |
| Pacing check and brady/tachy/low-amplitude flags | Deterministic thresholds/rules in `pacer.py` and `report.py`. | Exclude from the first integration; source-specific thresholds are not MiniMed-qualified. |

The exact report fusion is documented in the pinned
[`report.py`](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/report.py#L1-L31)
and its [measurement construction](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/report.py#L216-L366).

## Published performance and what it does not prove

All figures below are author-reported in the OpenECG repository; this review did not independently
rerun the clinical benchmarks.

### v56c boundary detector

The pinned benchmark report gives six-boundary macro-F1 using Martínez tolerances (P 50 ms, QRS
40 ms, T-on 50 ms, T-off 100 ms): 0.963 on 41 LUDB validation records using lead II, 0.971 on 72
ISP test records using lead II, and 0.908 on a 44-record QTDB T-subset using the first lead. It also
reports median timing error no worse than 16 ms for any boundary on ISP. The int8 TFLite mean F1
over LUDB/ISP/QTDB is reported as 0.9274 versus 0.9299 for Torch fp32. See the full
[pinned benchmark tables](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/docs/benchmarks/v56c_vs_baselines.md).

These are not broad clinical-accuracy numbers:

- v56c was trained on LUDB, QTDB, ISP and a synthetic AV-block mix. LUDB validation uses the
  repository's committed record split, but QTDB is also a training source and no record-disjoint
  QTDB test split is documented.
- The QTDB result is a selected subset whose densest annotated 10-second window has T-on labels for
  at least 80% of QRS annotations. This is a label-completeness filter over sparse selected beats,
  not all 105 QTDB records.
- LUDB validation masks predictions outside each lead's annotated range plus 100 ms. That prevents
  unlabeled edge beats from counting as false positives, but it is different from whole-strip use.
- Aggregated boundary F1 does not establish interval MAE, failure rate, calibration, robustness to
  photo-digitization error or patient-level clinical performance.

### codec v6

The v6 model card reports held-out LUDB frame boundary macro-F1 0.855, or 0.867 after excluding 10
of 492 validation windows with P/T labels but no QRS, and median timing error 11.1 ms. It separately
reports MIT-BIH DS2 VPC F1 0.929 and Lydus hospital rhythm macro-F1 0.797. Its CODE-test rhythm audit
reports macro-F1 0.767; the BBB row is F1 0.513 despite AUROC 0.946, with the model card explicitly
attributing the ceiling to single-lead information. These numbers are from different heads,
datasets and tasks and must not be combined into a single accuracy claim
([model card evaluation and limitations](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/models/codec_v6_MODEL_CARD.md#L49-L108)).

The v6 frame head also trained on LUDB, QTDB and ISP. Consequently the 15-record suite below is an
implementation/regression benchmark. Only its LUDB rows inherit OpenECG's committed held-out split;
the QTDB rows have training overlap and must be labeled `interoperability-only`.

### Local 15-record smoke and short-window ablation

A local smoke run used the pinned `boundary_int8.tflite` on the ten LUDB validation lead-II rows
and five QTDB `q1c` T-complete windows locked below: 15 continuous 10-second inputs, scored at the
same Martínez tolerances. Aggregate six-boundary macro-F1 was **0.951**: P-on 0.976, P-off 0.943,
QRS-on 0.994, QRS-off 0.975, T-on 0.851 and T-off 0.969; median absolute boundary errors ranged from
4 to 26 ms. This is a local wiring smoke, not a published or independent clinical result: the five
QTDB records overlap the model's training domain, and the small hand-locked suite cannot estimate
patient-level sensitivity or subgroup performance.

A separate ablation took central crops from ten LUDB validation records and padded them exactly as
`Inference.predict`: 2.5 seconds scored 0.066 macro-F1, 5 seconds 0.097 and the original 10 seconds
0.847 when scored without upstream labeled-edge filtering. The absolute 10-second value is therefore
not directly comparable to the filtered upstream 0.963, but the collapse for padded short crops is
decisive. The package contract must accept only a **real continuous 10-second trace**; repeating or
zero-padding MiniMed's 2.5-second paper-layout lead segments is a no-go.

## Browser and ONNX feasibility

MiniMed already depends on `onnxruntime-web@1.27.0` and runs its ECG image segmenter in a Worker
with the WASM execution provider. Against that existing runtime, the pinned `codec_v6_int8.onnx`
was loaded and executed on a zero tensor with input `[1,5000]`; it returned frame `[1,5000,4]`, beat
`[1,5000,6]` and rhythm `[1,5000,6]`. This is a useful graph-compatibility smoke test only. It does
**not** qualify real-signal correctness, latency, peak memory, Android/iOS WebView behavior,
thermal impact or sustained use.

No new runtime is justified for the experiment. A minimal adapter can reuse ONNX Runtime Web and
port only rank normalization, frame argmax/run extraction, the 2-second evaluation mask and
interval aggregation to typed TypeScript. The model still computes the unused beat/rhythm heads;
a smaller frame-only ONNX is not shipped at the pinned commit. Re-exporting one would create a new
artifact that needs its own reproducible conversion and parity benchmark.

The TFLite boundary model is smaller, but adopting a second browser inference runtime solely for it
would add more integration and supply-chain surface than this research gate warrants.

## Gap from the current MiniMed digitizer contract

The current `EcgDigitizationResult` is an image-to-waveform contract, not a delineator contract:

- it fixes output to 100 Hz, whereas OpenECG requires 250 Hz (v56c) or 500 Hz (codec v6);
- it returns twelve sequential paper-layout lead segments. On a nominal 10-second 3×4+1R strip,
  each standard lead segment is only about 2.5 seconds;
- it returns the full 100 Hz rhythm-II samples plus the detected consecutive `rrIntervalsMs`, median
  `rrMs` and `heartRate`, but these remain photo-derived drafts without beat-wise reference labels;
- it carries extraction coverage and quality, but no calibrated per-sample uncertainty or boundary
  provenance;
- its `quality='usable'` only means the image extraction gates passed. It does not mean the trace is
  suitable for a second learned model.

Therefore the current digitizer result cannot honestly be zero-padded into a 10-second OpenECG
input and called equivalent. The first digital benchmark must read native LUDB/QTDB signals. A later
photo-chain benchmark requires an explicitly reviewed 10-second single-lead trace, resampling
provenance and a separate delineator quality gate.

OpenECG may supply per-lead QRS duration, but it cannot create the simultaneous earliest-onset to
latest-offset global QRS required by the MiniMed bundle-branch contract from sequential paper
segments. Nor does it emit R/R′/S component durations, notch/slur, absent-q observations or verified
lead placement. Those stay manual/independently measured.

## Minimal typed feature contract

This is the smallest boundary between the existing digitizer and a measurement-only OpenECG
adapter. It deliberately contains no rhythm/diagnosis class or probability.

```ts
type EcgTraceSource = 'digital-signal' | 'photo-auto';
type EcgTraceTiming = 'simultaneous' | 'sequential-paper-estimate';
type EcgTraceQuality = 'usable' | 'review' | 'failed';

interface EcgNumericTrace {
  readonly schemaVersion: 1;
  readonly lead: EcgLeadName;
  readonly sampleRateHz: 250 | 500;
  readonly samples: Float32Array;
  readonly source: EcgTraceSource;
  readonly timing: EcgTraceTiming;
  readonly quality: EcgTraceQuality;
  readonly qualityReasons: readonly string[];
  readonly reviewed: boolean;
}

interface EcgWaveSpan {
  readonly wave: 'P' | 'QRS' | 'T';
  readonly onsetSample: number;
  readonly offsetSample: number; // exclusive
}

interface EcgMeasuredInterval {
  readonly valueMs: number;
  readonly beatCount: number;
  readonly source: 'openecg-codec-v6';
  readonly reviewed: boolean;
}

interface EcgBeatSeries {
  readonly rPeakSamples: readonly number[];
  readonly rrMs: readonly number[];
  readonly source: 'deterministic-qrs' | 'manual';
  readonly reviewed: boolean;
}

interface EcgMorphologyObservation {
  readonly lead: EcgLeadName;
  readonly feature:
    | 'q-present'
    | 'r-prime-present'
    | 'terminal-s-present'
    | 'broad-r'
    | 'notched-or-slurred-r';
  readonly value: true | false | 'unknown';
  readonly source: 'manual' | 'validated-extractor';
  readonly reviewed: boolean;
}

interface EcgNumericFeatures {
  readonly schemaVersion: 1;
  readonly lead: EcgLeadName;
  readonly modelSha256: string;
  readonly spans: readonly EcgWaveSpan[];
  readonly beats: EcgBeatSeries;
  readonly morphology: readonly EcgMorphologyObservation[];
  readonly intervals: {
    readonly pr?: EcgMeasuredInterval;
    readonly qrs?: EcgMeasuredInterval;
    readonly qt?: EcgMeasuredInterval;
  };
  readonly quality: EcgTraceQuality;
  readonly qualityReasons: readonly string[];
  readonly reviewRequired: true;
}
```

Trust-boundary validation must reject a non-finite sample, length other than exactly 10 seconds,
unsupported frequency, `offsetSample <= onsetSample`, an out-of-range boundary, or delineation on a
`failed` trace. `photo-auto` features remain drafts until reviewed. A missing wave/interval stays
missing; it is never converted to zero or “normal.” OpenECG does not populate `morphology`; those
observations remain `unknown` until a clinician or independently validated extractor supplies them.
Beat/RR and morphology provenance must survive into any later statement engine so a global interval
cannot masquerade as complete diagnostic evidence.

## Exact local 15-record smoke manifest

The local smoke selected the first ten LUDB records from OpenECG's
[committed `seed=42` validation split](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/data/splits/ludb_v1.json#L163-L208)
and the first five QTDB records whose densest 10-second `q1c` window had T-on annotations for at
least 80% of annotated QRS complexes. The deterministic selection produced the exact IDs below.

For each LUDB row, score the full 10-second lead II at native 500 Hz against the independent
cardiologist `.ii` boundaries. For each QTDB row, use the first signal declared by the official
header and reproduce OpenECG's deterministic densest-annotation 2,500-sample window over `q1c`;
mark every QTDB result `interoperability-only` because the model trained on QTDB. Do not use `pu`,
`pu0` or `pu1` automatic annotations as gold labels.

| # | Dataset / record | Signal and expert annotation files | Benchmark status |
|---:|---|---|---|
| 1 | LUDB 1.0.1 / `10` | [`10.hea`](https://physionet.org/files/ludb/1.0.1/data/10.hea), [`10.dat`](https://physionet.org/files/ludb/1.0.1/data/10.dat), [`10.ii`](https://physionet.org/files/ludb/1.0.1/data/10.ii) | upstream-held-out |
| 2 | LUDB 1.0.1 / `11` | [`11.hea`](https://physionet.org/files/ludb/1.0.1/data/11.hea), [`11.dat`](https://physionet.org/files/ludb/1.0.1/data/11.dat), [`11.ii`](https://physionet.org/files/ludb/1.0.1/data/11.ii) | upstream-held-out |
| 3 | LUDB 1.0.1 / `14` | [`14.hea`](https://physionet.org/files/ludb/1.0.1/data/14.hea), [`14.dat`](https://physionet.org/files/ludb/1.0.1/data/14.dat), [`14.ii`](https://physionet.org/files/ludb/1.0.1/data/14.ii) | upstream-held-out |
| 4 | LUDB 1.0.1 / `20` | [`20.hea`](https://physionet.org/files/ludb/1.0.1/data/20.hea), [`20.dat`](https://physionet.org/files/ludb/1.0.1/data/20.dat), [`20.ii`](https://physionet.org/files/ludb/1.0.1/data/20.ii) | upstream-held-out |
| 5 | LUDB 1.0.1 / `21` | [`21.hea`](https://physionet.org/files/ludb/1.0.1/data/21.hea), [`21.dat`](https://physionet.org/files/ludb/1.0.1/data/21.dat), [`21.ii`](https://physionet.org/files/ludb/1.0.1/data/21.ii) | upstream-held-out |
| 6 | LUDB 1.0.1 / `22` | [`22.hea`](https://physionet.org/files/ludb/1.0.1/data/22.hea), [`22.dat`](https://physionet.org/files/ludb/1.0.1/data/22.dat), [`22.ii`](https://physionet.org/files/ludb/1.0.1/data/22.ii) | upstream-held-out |
| 7 | LUDB 1.0.1 / `28` | [`28.hea`](https://physionet.org/files/ludb/1.0.1/data/28.hea), [`28.dat`](https://physionet.org/files/ludb/1.0.1/data/28.dat), [`28.ii`](https://physionet.org/files/ludb/1.0.1/data/28.ii) | upstream-held-out |
| 8 | LUDB 1.0.1 / `33` | [`33.hea`](https://physionet.org/files/ludb/1.0.1/data/33.hea), [`33.dat`](https://physionet.org/files/ludb/1.0.1/data/33.dat), [`33.ii`](https://physionet.org/files/ludb/1.0.1/data/33.ii) | upstream-held-out |
| 9 | LUDB 1.0.1 / `34` | [`34.hea`](https://physionet.org/files/ludb/1.0.1/data/34.hea), [`34.dat`](https://physionet.org/files/ludb/1.0.1/data/34.dat), [`34.ii`](https://physionet.org/files/ludb/1.0.1/data/34.ii) | upstream-held-out |
| 10 | LUDB 1.0.1 / `35` | [`35.hea`](https://physionet.org/files/ludb/1.0.1/data/35.hea), [`35.dat`](https://physionet.org/files/ludb/1.0.1/data/35.dat), [`35.ii`](https://physionet.org/files/ludb/1.0.1/data/35.ii) | upstream-held-out |
| 11 | QTDB 1.0.0 / `sel14172` | [`sel14172.hea`](https://physionet.org/files/qtdb/1.0.0/sel14172.hea), [`sel14172.dat`](https://physionet.org/files/qtdb/1.0.0/sel14172.dat), [`sel14172.q1c`](https://physionet.org/files/qtdb/1.0.0/sel14172.q1c) | interoperability-only |
| 12 | QTDB 1.0.0 / `sel16539` | [`sel16539.hea`](https://physionet.org/files/qtdb/1.0.0/sel16539.hea), [`sel16539.dat`](https://physionet.org/files/qtdb/1.0.0/sel16539.dat), [`sel16539.q1c`](https://physionet.org/files/qtdb/1.0.0/sel16539.q1c) | interoperability-only |
| 13 | QTDB 1.0.0 / `sel16786` | [`sel16786.hea`](https://physionet.org/files/qtdb/1.0.0/sel16786.hea), [`sel16786.dat`](https://physionet.org/files/qtdb/1.0.0/sel16786.dat), [`sel16786.q1c`](https://physionet.org/files/qtdb/1.0.0/sel16786.q1c) | interoperability-only |
| 14 | QTDB 1.0.0 / `sel16795` | [`sel16795.hea`](https://physionet.org/files/qtdb/1.0.0/sel16795.hea), [`sel16795.dat`](https://physionet.org/files/qtdb/1.0.0/sel16795.dat), [`sel16795.q1c`](https://physionet.org/files/qtdb/1.0.0/sel16795.q1c) | interoperability-only |
| 15 | QTDB 1.0.0 / `sel17152` | [`sel17152.hea`](https://physionet.org/files/qtdb/1.0.0/sel17152.hea), [`sel17152.dat`](https://physionet.org/files/qtdb/1.0.0/sel17152.dat), [`sel17152.q1c`](https://physionet.org/files/qtdb/1.0.0/sel17152.q1c) | interoperability-only |

The authoritative dataset lists and hashes are
[LUDB `RECORDS`](https://physionet.org/files/ludb/1.0.1/RECORDS),
[LUDB `SHA256SUMS.txt`](https://physionet.org/files/ludb/1.0.1/SHA256SUMS.txt),
[QTDB `RECORDS`](https://physionet.org/files/qtdb/1.0.0/RECORDS) and
[QTDB `SHA256SUMS.txt`](https://physionet.org/files/qtdb/1.0.0/SHA256SUMS.txt).
LUDB supplies 200 ten-second 12-lead records at 500 Hz with each lead annotated independently by
cardiologists ([dataset methods](https://physionet.org/content/ludb/1.0.1/#methods)). QTDB supplies
105 fifteen-minute two-lead records, with manually determined waveform boundaries for only 30–50
selected beats per record; `q1c` is annotator 1's second pass
([QTDB data description](https://physionet.org/content/qtdb/1.0.0/#data-description)).

### Required outputs

Report per record and pooled, never just one headline score:

1. P-on, P-off, QRS-on, QRS-off, T-on and T-off sensitivity, positive predictive value and F1 at
   the same Martínez tolerances as upstream.
2. Median absolute and signed boundary error in milliseconds, plus the count of unmatched true and
   predicted boundaries.
3. PR, per-lead QRS and QT absolute error where the expert annotations provide both required edges;
   report missing intervals rather than imputing them.
4. Whole-window and inner-6-second results separately for codec v6.
5. `failed`, `review` and successful-record counts; cold/warm WASM time and peak memory on the
   actual supported browser and Android WebView.
6. A strict source column (`digital-signal` initially; later `photo-auto`) so digitizer error is not
   folded into delineator error.

Fifteen records are sufficient for a wiring and failure-mode smoke test, not for sensitivity,
specificity, subgroup, calibration or release claims. A release threshold must be set only after the
full upstream-held-out LUDB split and a genuinely model-external dataset have been run.

## MiniMed go/no-go

- **GO, benchmark only:** reuse the existing ONNX/WASM runtime to evaluate the pinned codec v6
  `frame` head after MiniMed can supply a reviewed, continuous 10-second single-lead trace. Keep the
  model optional, local and measurement-only; report P/QRS/T spans and derived intervals with model
  hash, source and review state.
- **NO-GO now:** the current image digitizer exposes only sequential approximately 2.5-second lead
  segments and discards the full rhythm waveform. The short-window ablation rules out padding those
  segments. Do not add a TFLite runtime, convert artifacts, or change the production contract until
  the continuous-trace boundary and full benchmark exist.
- **NO-GO for diagnosis/release:** ignore OpenECG beat/rhythm heads, do not import the proprietary
  GE-derived rule repository, and do not generate broad 12-lead statements from this layer. A later
  diagnostic engine must be independently implemented, licensed and validated against external
  physician-reviewed targets.

## Unknown or unverified facts

- No weight-specific license statement was found in the pinned model cards or model directory.
- The provenance and redistribution implications of every training source embedded in the weights
  were not independently audited.
- The repository does not publish an independent, model-external delineation test for codec v6.
- The v56c benchmark Markdown reports 44 QTDB T-subset records, while the benchmark script's module
  docstring says 39 and its selection is computed dynamically. The 44-record claim should not be
  repeated after a dependency/data change without rerunning the pinned script.
- OpenECG's reported 44 ms per 10-second v56c latency does not identify MiniMed's target browser,
  phone, thread count or power state. It is not a MiniMed performance estimate.
- The graph smoke did not verify real ECG parity between Python ONNX Runtime and ONNX Runtime Web,
  nor did it test iOS/Android WebViews.
- `report()` catches codec errors and can degrade to rules-only output. A MiniMed adapter must fail
  explicitly and preserve provenance rather than silently changing the measurement source.

## Source-validation notes

- Repository facts and code links are pinned to commit
  `60ac8887ab0d640fbab6ef094d023b72a9f630c5` (`v0.11.0`); no `main`-branch link is used for an
  implementation claim.
- The two shipped artifact sizes and SHA-256 values were computed from blobs checked out at that
  commit. The ONNX tensor-shape smoke was run with MiniMed's existing `onnxruntime-web@1.27.0` WASM
  runtime.
- Dataset links are versioned PhysioNet file URLs. Record membership should also be verified against
  the versioned `RECORDS` and checksum files during fixture collection.
- Primary dataset pages and papers: [LUDB 1.0.1](https://physionet.org/content/ludb/1.0.1/),
  [LUDB paper, DOI 10.1109/ACCESS.2020.3029211](https://doi.org/10.1109/ACCESS.2020.3029211),
  [QTDB 1.0.0](https://physionet.org/content/qtdb/1.0.0/) and
  [QTDB paper, official PhysioNet edition](https://physionet.org/physiobank/database/qtdb/doc/index.shtml).
- No secondary blog, catalog or benchmark summary is used as evidence in this note.
