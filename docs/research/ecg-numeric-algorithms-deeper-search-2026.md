# Deeper search: numeric ECG diagnostic algorithms (2026-08-31)

## Classification

TYPE D — comprehensive: source, documentation, licensing, thresholds, and integration fit.

## New candidates and findings

### `vitaldb/openecg`: useful numeric delineation, not a deterministic diagnostic engine

OpenECG is Apache-2.0 and ships deployable TFLite/ONNX artifacts. Its public interface accepts a one-dimensional signal, emits sample-indexed P/QRS/T boundaries, and exposes three streams: wave frame, beat type, and rhythm. The documented labels include sinus, VPC, paced, fusion, AVB, AFib, BBB, and ventricular rhythm. The repository reports held-out cohorts (including Lydus hospital ECG and CODE-test), with rhythm macro-F1 0.797 on Lydus and 0.767 on CODE-test; AVB/AFib/BBB are explicitly reported. See the pinned README [lines 16–24](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/README.md#L16-L24), [lines 72–89](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/README.md#L72-L89), and [lines 91–100](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/README.md#L91-L100).

This is model inference over numeric waveform data, not an auditable threshold/rule implementation. It is therefore a possible offline delineation benchmark (Apache-2.0), but does not satisfy MiniMed’s explicit-confirmation rule contract or replace manual morphology fields. Its single-channel input and learned rhythm head also do not expose pediatric/age-specific thresholds.

### ECG-Reasoning-Benchmark: the best new rule/test corpus, but not a released engine

The MIT-licensed repository at commit [`90a53f1`](https://github.com/Jwoo5/ecg-reasoning-benchmark/tree/90a53f107023c7c196cbf08de183b871b2a5798c) publishes 6,403 structured reasoning samples over 17 diagnoses: three AV-block groups, complete RBBB/LBBB, LAFB/LPFB, LVH/RVH, PAC/PVC, and territorial MI/ischemia. Each JSONL sample contains a target label, a reasoning-path identifier, criterion selection, finding identification, lead/wave/measurement grounding, and an intermediate decision that may explicitly say that further findings are required ([schema](https://github.com/Jwoo5/ecg-reasoning-benchmark/blob/90a53f107023c7c196cbf08de183b871b2a5798c/README.md#L126-L176)). Its first-degree AV-block example is exactly the safe shape already used by MiniMed: confirm 1:1 AV conduction, then PR `>200 ms`, otherwise do not complete the conclusion ([example](https://github.com/Jwoo5/ecg-reasoning-benchmark/blob/90a53f107023c7c196cbf08de183b871b2a5798c/README.md#L266-L285)).

This is materially more useful than a diagnosis-only dataset because its positive and negative paths can become fixtures for a deterministic interpreter. However, it is still a **benchmark corpus, not executable diagnostic code**. The paper says its labels were produced by a U-Net3+ wave detector plus hierarchical logic, filtered for agreement with source labels; only 143 representative paths were reviewed by three specialists, after which the authors manually inspected all extracted paths ([pipeline and review](https://arxiv.org/abs/2603.14326#S3), [sampling](https://arxiv.org/abs/2603.14326#S4.SS2)). The repository does not publish that measurement/diagnosis pipeline. Release `0.0.2` also regenerated all LAFB, LPFB, LVH, third-degree AV-block, PAC and PVC samples after systematic issues were found ([release notes](https://github.com/Jwoo5/ecg-reasoning-benchmark/blob/90a53f107023c7c196cbf08de183b871b2a5798c/README.md#L21-L37)). Therefore the corpus is suitable for deriving candidate rule graphs and regression tests only after every threshold is checked against an independent clinical source.

The strongest immediate use is offline test generation: convert each reasoning path to `present / absent / unknown`, preserve the explicit “further findings required” state, and run MiniMed’s pure rule functions against those fixtures. Do not import the waveform detector or call the benchmark labels independent clinical truth. The current pre-release also has very few PTB-XL positive second- and third-degree AV-block cases, so those diagnoses need MIMIC-IV-ECG and separate clinical review before sensitivity claims.

A local schema audit prevents using 15 of these records as a direct validation of MiniMed’s strict complete-AV-block rule. The published third-degree paths expose bradycardia, RR regularity, atrial fibrillation and AV dissociation, but do not separately encode “no P→QRS conduction” or “at least two consecutive non-conducted P waves.” Filling those missing fields from the diagnosis label would be target leakage. The current rule therefore keeps synthetic boundary tests and a browser wiring smoke only; a 15-case clinical comparison still needs independently reviewed beat-sequence annotations.

### `mdbasit897/ecg_plot`: small executable interval-rule example, but no declared license

The repository contains executable report logic over numeric PR, QRS, and QTc measurements. It labels PR 120–200 ms normal, >200 ms first-degree AV block, and <120 ms short PR/pre-excitation consideration; QRS >120 ms is reported as wide/possible BBB; QTc ≤450 ms normal, 450–470 ms borderline, and >470 ms prolonged. See the pinned implementation [lines 188–219](https://github.com/mdbasit897/ecg_plot/blob/a3dc40c3e2f3fa32365e33729ef799e45d8cdde6/clinical_report.py#L188-L219). The constants also record adult ranges, Bazett correction, male QTc 450 ms and female QTc 460 ms [lines 61–86](https://github.com/mdbasit897/ecg_plot/blob/a3dc40c3e2f3fa32365e33729ef799e45d8cdde6/ecg_constants.py#L61-L86).

There is no LICENSE file in the repository root, and the project is primarily plotting/measurement code. Treat as reject for code reuse; the thresholds are only a lead for benchmark cases and are insufficiently age-aware for a pediatric product.

### Minnesota Code / NOVACODE: specification and historical software, no current permissive runnable implementation found

The primary historical description says NOVACODE classifies ECGs according to Minnesota Code and adds logic for conduction defects, acute myocardial infarction, and serial changes ([PubMed record](https://pubmed.ncbi.nlm.nih.gov/2233384/)). The public NIH appendix exposes NOVACODE serial classification code definitions ([Appendix I](https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/GetPdf.cgi?id=phd004495.1)), but neither source provides a maintained, permissively licensed implementation accepting a modern JSON/tabular measurement schema. Searches found no new authoritative GitHub implementation beyond already reviewed material. Conclusion: use the published code vocabulary/specification as a benchmark mapping, not as copied executable logic.

### Commercial device labels and parameter lists

Philips DXL, Glasgow, and VERITAS output terms can be useful as a *vocabulary discovery* source, but a vendor’s statement list is not automatically a reusable open algorithm or license. Safe MiniMed use is to define its own clinically reviewed output vocabulary, cite public clinical standards, and preserve provenance; do not copy proprietary manuals, hidden thresholds, or vendor-specific implementation text into code. This search found no public license granting reuse of those commercial rule sets.

### `Arpit-Gupta-Anumana/ecg-rule-engine`: closest broad tabular engine, but proprietary and circularly evaluated

Commit [`84abdf76b21de6838d5945016893a543fefc6af9`](https://github.com/Arpit-Gupta-Anumana/ecg-rule-engine/tree/84abdf76b21de6838d5945016893a543fefc6af9) is the closest implementation found to the desired architecture. It contains a typed expression evaluator, a 138-feature dictionary, 56 adult/pediatric YAML rule files and explicit suppression stages. The input vocabulary covers global rates/intervals/axes, per-lead P/Q/R/S/T and ST amplitudes, per-lead durations, age, sex and prior-stage rhythm/conduction flags. Its local unit suite passed all 45 tests on Python 3.14.

It cannot be reused. The package metadata explicitly declares `license = { text = "Proprietary" }`; there is no open-source license. The repository also says its YAML files are LLM-assisted transcriptions of the GE Marquette 12SL Physician's Guide, so copying either code or rule prose would import an incompatible proprietary derivative. Its headline validation is not independent clinical validation: both the 788 input features and diagnostic “ground truth” are GE 12SL outputs over PTB-XL. The measurements-only report is still valuable as an engineering warning: simple global rules work for some literal findings, but AF, flutter, pacing, ectopy and junctional rhythm have zero sensitivity when beat-level features are absent. The AV-block file itself admits that Mobitz I/II are not encoded and that complete block is reduced to the partial surrogate `atrial_rate - ventricular_rate > 25 bpm`.

The lawful takeaway is the shape of the input contract, not its implementation: MiniMed needs a small typed measurement schema, tri-state missingness, explicit suppression dependencies and evidence traces. Thresholds must continue to come from independent clinical standards, with independent fixtures.

### Construe: a real symbolic interpreter, but not the requested tabular runtime

Construe at commit [`8370cd52e8da1873790cb2c522d89d1d2dbfb00a`](https://github.com/citiususc/construe/tree/8370cd52e8da1873790cb2c522d89d1d2dbfb00a) is a genuine knowledge-based abductive ECG interpreter. It builds P/QRS/T and rhythm hypotheses and includes sinus rhythm, bradycardia/tachycardia, atrial fibrillation, extrasystoles, bigeminy/trigeminy, asystole and ventricular flutter. It is useful prior art for temporal reasoning and explicit abstention. It is not a drop-in numeric-table engine: it consumes MIT-BIH waveforms/annotations, depends on an old Python/WFDB stack, warns that rhythm search is NP-hard and substantially slower, and is AGPL-3.0. It also does not supply the broad 12-lead contour/ischemia/hypertrophy statement set MiniMed wants.

## What remains genuinely open and numeric

OpenECG is the only new permissively licensed executable candidate located, but it is learned rather than deterministic. ECG-Reasoning-Benchmark is the strongest new permissive **rule/test corpus**, but it omits the pipeline that generated its measurements and diagnoses. The new GE-derived rule engine proves that a 138-field tabular DSL is practical, but its proprietary declaration and circular GE-vs-GE evaluation make it unusable. Construe remains useful symbolic prior art rather than a tabular runtime. No permissive age-aware broad engine with independent validation cohorts was found. Existing clinical standards remain the authority for production rules.

## Ranking

1. **Integrate now:** no external runtime engine. Extend the existing typed numeric contract only when each added field enables an independently sourced rule.
2. **Benchmark only:** ECG-Reasoning-Benchmark for rule-path coverage; OpenECG for P/QRS/T event sequences; Construe for symbolic-rhythm comparison.
3. **Study contract only:** the proprietary GE-derived engine's feature taxonomy, missing-feature reporting and suppression graph; copy no code or rules.
4. **Reject:** `ecg_plot` for reuse (no declared license, adult thresholds); commercial DXL/Glasgow/VERITAS rule text as implementation; Minnesota/NOVACODE as code until a lawful, runnable source with schema is located.

## Smallest compatible next rule slice

The global interval/axis slice plus Mobitz I/II/2:1, high-grade and complete AV-conduction patterns now exist. The numeric panel now accepts editable P/QRS onset arrays and derives the existing tri-state observations; they stay unconfirmed until clinician review, while pacing and blocked-PAC exclusions remain manual. The production analyzer and interpreter matched all 15 OpenECG oracle-boundary cases: Mobitz I, Mobitz II, 2:1 and complete block, with paced/VT controls abstaining. Do not add ischemia/MI next: those need verified lead-level J/ST/T and Q-wave durations that the current input contract does not provide. Do not claim high-grade validation until a real or synthetic source contains two consecutive blocked P waves with some conduction preserved.

Open questions: none
