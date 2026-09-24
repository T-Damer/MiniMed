# ECG pipeline: measured limits and rejected candidates

> Moved verbatim from `docs/CURRENT_STATE.md` on 2026-09-24 so the mandatory state file stays short.
> Newest entries first; later entries supersede earlier ones.

The ECG photo tool has experimental automatic waveform extraction for the fixed 3x4+1R layout,
but still falls back to manual calipers when its quality gate does not pass. Its adult-alpha rule
layer does not infer morphology, rhythm, infarction, or bundle/AV block from intervals alone.
Complete RBBB/LBBB hypotheses require explicit clinician-entered morphology and are worded as
review-required patterns rather than diagnoses; automatic morphology extraction, full
perspective/layout correction and clinical validation remain absent. No diagnostic CNN is shipped
or accepted by the ECG bundle validator; candidate classifiers remain documentation-only.
A patient-disjoint direct-image ResNet18 experiment was subsequently trained on 21,251 adult
PTB-XL synthetic 12x1 renders (folds 1-8/9/10, with all patients behind three real-phone holdout
ECGs excluded). It reached test macro-AUC 0.912 and macro-F1 0.727, and its exported ONNX matched
PyTorch on the nine phone files within 0.000192 probability. This did not transfer to real PM-ECG-ID
photographs: three base ECGs photographed by iPhone, Samsung and Doogee produced only 2/9 exact
multi-label matches, micro-F1 0.444, zero NORM recall (0/6), six MI false positives and three CD
false positives. EXIF-orientation correction and a grid-crop recheck did not change the rejection.
The same three ECGs as clean renders matched 2/3, isolating a material synthetic-to-phone domain
shift. The candidate is therefore rejected for runtime integration and probability fusion; the
reproducible scripts and measured report are under `tools/ecg-cnn/`, while weights remain outside
Git with SHA-256 recorded there.
The downloadable Ribeiro 1D ResNet was reproduced locally from its checksum-matched official
weights. On the authors' 827-record test artifacts, the selected seed retained macro-F1 0.925 and
macro-AUROC 0.998; averaging ten published seeds without refitting thresholds reduced macro-F1 to
0.900 despite a small average-precision gain. On the existing 20-record MiniMed smoke set, the
native 500 Hz signal found both available sinus-bradycardia labels but missed the one AF label;
after the 100 Hz/3x4/Open-ECG path, both the selected seed and mean-of-ten ensemble found none of
the three available positive target labels when short segments were kept at their real times.
Repeating each 2.5-second segment recovered only one bradycardia and still missed AF. This small,
label-sparse smoke is not a general sensitivity estimate, but it rejects Ribeiro and a naive
same-family ensemble as ready diagnostic heads for the current photo representation.
On 20 licensed ECG Image Kit images, matching upstream sparse normalization and the `0.1` signal
threshold increased clean-image `usable` results from 6/20 to 9/20 and RR extraction from 17/20 to
18/20. All 20 synthetic 7° rotations and all 20 affine-skew variants stayed outside `usable`, so
phone-like geometry still fails closed instead of feeding the rule layer.
A separate 15-record PTB-XL/PTB-XL+ numeric smoke test found no complete-BBB false positive in
five NORM controls, but strict AHA RBBB morphology matched only 2/5 CRBBB-labelled 12SL feature
rows; the published table lacks the core LBBB notch/slur flag. Therefore 12SL-derived feature names
are not mapped automatically into MiniMed morphology observations, and this small check is not a
sensitivity/specificity claim.
OpenECG `boundary_int8.tflite` was also checked as a measurement-only candidate on 15 continuous
10-second LUDB/QTDB records: pooled six-boundary macro-F1 was 0.951 in the local wiring smoke, but
QTDB overlaps the model's training domain. On ten held-out LUDB records, zero-padded central crops
collapsed to 0.066 at 2.5 seconds and 0.097 at 5 seconds. It is therefore not integrated: the
current photo digitizer exposes short sequential lead segments rather than a reviewed continuous
10-second trace, and OpenECG rhythm/diagnostic heads remain out of scope.
PTE-ECG `1.0.0-alpha.1` was also rejected after a fixed 15-record PTB-XL/PTB-XL+ comparison. Its
QRS and PR mean absolute errors against Uni-G were 52.8 and 48.6 ms, and it detected none of nine
Uni-G QRS durations at or above 120 ms. The implementation measures QRS from Q peak to S peak and
derives axis from R amplitudes in I/aVF, so its 1930 extracted features are not interchangeable
with the equipment-style inputs required by the rules or numeric pack.
A broader numeric-algorithm review found no permissive ready-made 12-lead rule engine. Construe is
a real knowledge-based rhythm interpreter but is AGPL/Python; Minnesota/NOVACODE and PEDMEANS are
useful public rule specifications rather than reusable engines. The public MEANS physician manual
is the most complete description found of an equipment-style numeric interpreter — lead/global
measurements, boolean criteria, scoring and suppression rules — but its engine and rule base are
not open source. The new MIT `ecg-interpreter` 0.1.0 package was rejected because it is single-lead,
uses unsafe proxy diagnoses, and tests only its own synthetic signals.
A follow-up search found RECGDT, the closest new executable candidate: its R pipeline converts
delineated ECG measurements into six disease scores and ships model files, but it remains unsuitable
for the app because the code is GPL-3.0, the pipeline depends on its own raw-waveform delineation,
and the training provenance/external validation of the bundled models is insufficient. SCP-ECG v3.0
and DICOM waveform templates standardize statements, certainty and provenance but do not calculate
diagnoses; they remain possible future interchange vocabularies rather than engines.
The official PTB-XL+ split was reproduced locally. ECGDeli was rejected for manual-input training
after its P/PR/QRS/QT distributions disagreed strongly with both equipment algorithms; Uni-G and
12SL nearly matched in standard ms/mV. The final adult-only 30-field Uni-G HGB achieved test
macro-AUC 0.913, macro-F1 0.720 and calibrated Brier 0.090. Without retraining, independent 12SL
test measurements retained macro-AUC 0.908/F1 0.719, supporting cross-measurer portability. With a
±0.10 abstention band the Uni-G test answered 93.6% of class-record pairs at macro-F1 0.755 among
answered pairs. A reproducible evaluator now executes the exact validated release JSON rather than
the Python training object and records immutable input hashes plus per-class threshold, calibration,
abstention, and false-negative metrics. Of 2151 eligible adult 18–120 fold-10 rows, 2130 passed the
app's complete/in-range contract (16 had a missing feature and five were out of range). It
reproduced macro-AUC 0.913, threshold macro-F1 0.719, Brier 0.090, 10-bin ECE 0.025, and 93.7%
coverage at answered macro-F1 0.754. Current abstention remains insufficient for a standalone
negative conclusion: 403 of 1740 positive pathology labels were confident false negatives (23.2%
pooled), including 111/530 MI, 96/484 STTC, 122/470 CD, and 74/256 HYP. The pack remains only a
probabilistic hypothesis above confirmed measurements and rules. The external report is
`/tmp/minimed-ecg-numeric-release-eval-20260901/report-v2.json`, SHA-256
`a729197c9aaadb1631852ac052de82fec198bb06799287c1d0f5bed5647ab854`.
The released JSON inference was also cross-checked on the same 2130 complete adult fold-10
rows against the independent rule layer: CD captured 164/168 wide-QRS findings but 246/410 positive
CD hypotheses had QRS below 120 ms; only 94/208 positive HYP hypotheses met Sokolow–Lyon; and
154/963 positive NORM hypotheses coexisted with at least one literal rule finding. These are
different scopes, not grounds for model veto. The UI now explains support or mismatch after each
estimate and never lets a NORM hypothesis hide measured deviations.
The current browser digitizer was also exercised end-to-end on 15 external images: 4 passed its
`usable` gate, 10 required review and one failed, with no runtime crash. These images cannot validate
RR accuracy because many use a recording speed other than the fixed 50 mm/s profile. More
importantly, the digitizer currently returns waveforms/RR/heart rate but not the 24 P/Q/R/S/T
amplitudes as validated equipment measurements. MiniMed now derives visible one-complex Q/R/S/T
drafts from `usable` waveforms and can copy all 24 amplitudes into the numeric form after an
explicit action, but this heuristic has only synthetic unit coverage plus browser smoke evidence;
every field stays editable and a complete 30-field form is still required. Independently of the
probabilistic pack, the numeric form now calls the same pure adult interval-rule core as the photo
workflow, so manual RR/PR/QRS/QT/QTc input produces explainable findings without an image or model;
a directly entered Framingham QTc is accepted. The numeric form asks for sex and applies AHA QTc
review thresholds `>450 ms` for men and `≥460 ms` for women; without sex it keeps the conservative
`>470 ms` threshold, while `≥500 ms` remains urgent. When QRS is at least 120 ms, ordinary QTc
classification is suppressed in favor of an explicit QT/JT-correction review finding. It also
evaluates an optional adult QRS axis and the
Sokolow–Lyon voltage criterion from S V1 plus R V5/V6, showing the exact measurements and explicitly
avoiding a negative-LVH claim. The axis threshold was compared locally with strict machine statements in
MIMIC-IV-ECG: 747,252 comparable rows produced 0.970 sensitivity, 0.915 specificity and 0.608 PPV
for binary out-of-range agreement. Because missing machine statements are not clinical negatives
and results vary by `cart_id`, the UI reports only the measured deviation and does not infer its
cause. On the same source, strict interval-statement agreement was strongest for rate ≥100
(sensitivity/specificity 0.990/0.997) and PR >200 (0.953/0.987), while QRS ≥120
(0.927/0.903, PPV 0.451) and Framingham QTc >470 (0.678/0.936, PPV 0.343) confirmed that these
outputs must remain literal measurements/review findings rather than diagnoses.
The numeric form now upgrades PR >200 ms to a review-required first-degree AV-delay pattern only
when the clinician explicitly confirms that every P wave conducts to QRS 1:1; unknown or non-1:1
conduction leaves the output at the literal prolonged-PR finding.
It also reports a review-required adult WPW-type ventricular-preexcitation pattern only when
PR <120 ms, QRS >120 ms and a clinician explicitly confirms a delta wave. Missing/boundary
criteria abstain, and a complete bundle-branch pattern is suppressed when the preexcitation rule
is complete because preexcitation itself changes QRS morphology; the UI does not call this WPW
syndrome.
A review-required AF pattern is available only after the clinician manually confirms all three
ACC/AHA ECG observations: RR intervals irregular without a repeating pattern, no distinct
repeating P waves, and irregular atrial activity/fibrillatory waves. A contradictory 1:1 P→QRS
observation suppresses the pattern. The digitizer now exports and shows the consecutive RR
intervals from the full rhythm-II row as an editable automatic draft in addition to median RR and
heart rate. A 15-image rhythm smoke (3 each NORM, AFIB/AFL, PAC, PVC and TACHY) produced only 6
`usable`, 8 `review` and 1 `failed` extraction; a conservative short-window irregularity candidate
fired on two AF examples (only one `usable`), not on the flutter example and not on the 12
non-AF examples. Automatic AF remains disabled because those image labels do not provide beat-wise
RR/P-wave reference annotations and the quality-qualified positive sample is far too small.
A repeated 2026 search found no better permissive numeric diagnostic engine: ECG-R1 exposes a
simplified generative prompt rather than executable validated rules, ECGomics publishes no source
pipeline, FeatureDB has no explicit code license or diagnostic layer, and OpenECG's broad rhythm
output comes from a learned single-lead codec. These remain research comparators; runtime stays on
confirmed measurements, independent deterministic rules and the separate adult numeric pack.
A subsequent device-contract audit reached the same implementation boundary. The official Philips
guide shows that broad apparatus statements depend on representative beat groups plus per-lead
P/P'/Q/R/S/R'/S'/T amplitudes, durations and areas, QRS notch/delta/VAT, several ST points and
quality/suppression state; MIMIC-IV-ECG v1.0 exposes only global fiducials/axes and machine text.
ECGDataKit is a useful Apache-2.0 reference for importing digital ECG formats but contains no
diagnostic engine. CardioDiag trains global-measurement XGBoost models against patient ICD codes,
has no reusable weights or explicit repository license, and predicts associated clinical diagnoses
rather than a formal interpretation of the presented trace. No additional runtime rule was added:
the next safe expansion is a validated per-lead measurement contract, not another global-score
heuristic.
A strict five-field adult LAFB candidate was also preflighted against PTB-XL fold 10 and 12SL
measurements: it matched only 16/158 LAFB-labelled rows but 0/1,998 negatives. It is now exposed
only as a positive adult compatible-pattern rule when QRS <120 ms, axis is −90…−45°, qR in aVL,
aVL R-peak time ≥45 ms and rS in II/III/aVF are all manually confirmed; ventricular origin,
pacing, pre-excitation or any unknown field suppresses the result. Its absence never excludes
LAFB. The fixed 15-case image smoke still shows why photo-auto LAFB remains disabled. Separate
X/Y grid calibration fixed clean amplitude
gain from 1.772 to 0.945, and a derivative-energy RR detector reduced heart-rate MAE to 1.73 bpm
on clean and 0.87 bpm on phone-like renders. Clean median lead correlation is 0.981, but phone-like
correlation remains 0.410; a repeated-lead-II consistency gate now leaves all 15 clean renders
`usable` while 11/15 phone-like renders require review. The pipeline still cannot supply the QRS
axis/duration, aVL R-peak time or qR/rS morphology needed by the rule. Photo-derived values remain
editable drafts, not diagnostic measurements.
The numeric panel now enforces that boundary in runtime: deterministic findings and the optional
numeric model remain disabled until the user explicitly confirms that intervals, axis, amplitudes
and morphology were checked against the source ECG. Importing another draft or editing any checked
measurement/morphology clears confirmation and removes the findings until they are rechecked.
A strict adult LPFB candidate was rejected after a PTB-XL+/12SL preflight: on human-validated fold
10 it matched 4/15 LPFB rows but also 8 non-LPFB rows (specificity 99.63%, PPV 33.3%). Normal/RAD,
IRBBB and infarct/ST-T records produced the same numeric morphology, so the app does not infer LPFB
without the unavailable clinical exclusions for other causes of right-axis deviation.
Confirmed manual beat-sequence observations can now produce five adult AV-conduction patterns:
Mobitz I requires periodic non-conducted P waves plus progressive PR lengthening; Mobitz II
requires periodic non-conducted P waves plus constant PR around the dropped QRS; 2:1 is kept as
its own pattern and is never relabelled as either Mobitz type. High-grade requires at least two
consecutive non-conducted P waves while some AV conduction remains; complete AV block requires
AV dissociation and no evidence of P→QRS conduction. The latter two request urgent review. All
require distinct P waves, non-1:1 conduction, no pacing and explicit exclusion of a blocked
premature atrial beat. Unknown fields, conflicting conduction/dissociation or PR observations,
and any missing suppression abstain; a negative pattern is never emitted.
The numeric panel can now accept ordered P- and QRS-onset times in milliseconds and draft those
same tri-state observations before clinician confirmation. Applying another sequence or changing
the event times clears the derived observations, confirmation and findings; pacing and blocked-PAC
exclusions remain explicit manual inputs. The production TypeScript sequence analyzer plus the
existing interpreter reproduced the 15 fixed OpenECG oracle-boundary cases 15/15, and the browser
flow was checked for Mobitz I, complete AV block and stale-draft invalidation. This remains a
synthetic wiring test, not clinical validation of the heuristic event-association thresholds.
A further open-source refresh found two useful comparators but no embeddable broad numeric engine.
RECGDT publishes GPL R code and six `.rds` disease-score models over RR/PR/QRS/Q/QRS amplitudes,
QTc and ST features, but does not document enough cohort/calibration evidence for clinical reuse.
Construe is a genuine AGPL knowledge-based rhythm interpreter, but consumes waveforms rather than
the confirmed numeric contract. The May 2026 `ecg-interpreter` package was rejected because it
labels STEMI from a single mean ST threshold and complete AV block from rate plus QRS width.
A newer MIT ECG-Reasoning-Benchmark publishes 6,403 explicit criterion/finding/grounding/decision
chains across 17 ECG diagnoses and is the best source found for deterministic regression fixtures.
It is not a runtime engine: its U-Net-based measurement/diagnosis pipeline is unpublished, several
diagnosis groups were regenerated in pre-release 0.0.2 after systematic issues, and its rule
thresholds still require independent clinical sourcing before implementation. Its published
third-degree-AV-block paths also omit separate fields for absence of all P→QRS conduction and for
two consecutive non-conducted P waves, so they cannot validate the stricter MiniMed rule without
leaking the target label into the inputs.
A newer broad Python/YAML `ecg-rule-engine` was also audited locally at commit `84abdf7`; all 45
unit tests passed and its 138-field adult/pediatric measurement contract is the closest public
example of the desired architecture. It is not reusable: package metadata declares it proprietary,
its rules are transcribed from the GE 12SL guide, and its reported PTB-XL comparison uses GE 12SL
measurements against GE 12SL statements rather than independent clinical truth. Its own
measurements-only report also leaves beat-dependent AF/flutter/pacing/ectopy paths at zero
sensitivity and reduces complete AV block to a partial atrial-minus-ventricular-rate surrogate.
OpenECG's Apache-2.0 synthetic AV generator then closed only the numeric wiring gap: 15 fixed-seed
clean lead-II boundary cases (Mobitz I, Mobitz II, 2:1, complete block, paced and VT controls)
matched the production MiniMed sequence analyzer and interpreter 15/15 when they saw only P/QRS
event arrays and an explicit pacing observation. This is synthetic oracle-boundary evidence, not clinical accuracy;
it does not validate high-grade block because the upstream Mobitz generators never drop two
consecutive P waves while preserving some conduction. No generator or external rule engine was
added to the app; only the derived numeric event contract is used at runtime.
An oracle perspective-rectification preflight on the same 15 phone-like renders restored median lead
correlation from 0.410 to 0.980, amplitude gain from 0.411 to 0.987, and made all 15 usable. A naive
red-grid corner detector was rejected despite 12/15 `usable` outputs because its median correlation
was only 0.299. Rectification is therefore the next proven image-pipeline layer, but automatic corners
require a grayscale/background-diverse benchmark before runtime use. The app instead exposes an
explicit four-corner editor: confirmed normalized corners are validated, perspective-warped locally
in the digitizer worker, and then passed to the existing segmentation/quality pipeline. Arrow keys
provide fine adjustment; the original photo remains unchanged.
The 261,070-byte
release asset is verified by exact size and
SHA-256; exported JSON inference matched sklearn on all 2,185 adult test rows, and a real browser
install/control inference passed. Adult models reject pediatric ECGs.
