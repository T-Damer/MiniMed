# ECG AV-sequence dataset research (2026)

## Decision

Use `vitaldb/openecg`'s compositional generator for a lawful, local 15-case deterministic-rule benchmark. Treat it as synthetic validation, not clinical validation. Generate with fixed seeds, retain the generator metadata, and use the real LUDB templates only as morphology sources; do not use diagnosis labels to construct measured sequence fields. The current generator cannot create the MiniMed high-grade pattern with two or more consecutive nonconducted P waves while some conduction remains, so that case stays unvalidated rather than being post-filtered into existence.

## Best candidate: OpenECG synthetic AV-block generator

Repository commit: [`60ac8887ab0d640fbab6ef094d023b72a9f630c5`](https://github.com/vitaldb/openecg/tree/60ac8887ab0d640fbab6ef094d023b72a9f630c5). The repository is Apache-2.0 licensed ([license](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/LICENSE#L1-L10)). It documents loaders for LUDB, QTDB, ISP, BUT PDB, and the synthetic AV-block dataset ([README](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/README.md#L9-L24)).

The generator was designed for the exact annotation gap relevant here: LUDB/ISP/QTDB label coupled P waves but do not label orphan P waves. It extracts real LUDB sinus P and QRS-T templates, then retimes them on atrial and ventricular schedules. It emits `p_on`, `p_off`, `qrs_on`, `qrs_off`, `t_on`, and `t_off` boundaries ([source](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/synth.py#L2-L26)).

| MiniMed field | OpenECG mapping | Independence / leakage assessment |
|---|---|---|
| Distinct P waves | Every placed P receives `p_on`/`p_off`; one P template is reused per window | Deterministic signal construction, independent of diagnosis labels |
| P→QRS conduction flag | Derive by temporal association between returned P and QRS boundaries | Not emitted as a separate field; the association tolerance is MiniMed benchmark logic and needs external validation |
| ≥2 consecutive nonconducted P waves | Present in complete AV block because no P waves conduct; absent in the supplied Mobitz I/II generators | Cannot validate MiniMed high-grade AV block without extending the generator or obtaining external annotations |
| Some conduction present and absent | Mobitz I conducts the first N−1 P waves and drops the last; Mobitz II conducts all except every 2nd/3rd P ([source](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/synth.py#L318-L350)) | Deterministic and label-independent |
| AV dissociation | Complete AVB places P waves and ventricular escape beats on independent schedules ([source](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/synth.py#L308-L315)) | Strong synthetic ground truth; no clinical diagnosis lookup required |
| Pacing exclusion | `paced` is a separate scenario with independent atrium and paced wide QRS; `vt` has no P waves ([source](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/synth.py#L597-L627)) | Use `paced` and `vt` as negative controls; exclude paced cases from AVB positives |
| Blocked-PAC exclusion | The generator's dropped P waves are scheduled sinus P waves, not PAC labels | No PAC diagnosis label is used; retain scenario metadata |

Complete AVB explicitly models two regular, independent rhythms and reuses consistent P/QRS morphology within a window ([source](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/synth.py#L484-L509)). The template bank defaults to sinus records and excludes paced 3°AVB records `{34, 74, 90, 104, 111}` when collecting paced templates, specifically to avoid overlap leakage ([source](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/openecg/synth.py#L105-L137)).

### Why no 12-lead renderer was added

The generator API is lead-oriented (`generate_avb_window(..., lead, ...)`). Independently generating 12 leads would create inconsistent beat schedules, while a correct renderer would require an upstream change that exposes one shared schedule and conduction map. That work is unnecessary for the present question: this benchmark validates whether numeric P/QRS events can drive deterministic rules, not whether the photo digitizer can recover them. The 12-lead rendering idea is therefore deferred rather than approximated.

The LUDB source data is available from PhysioNet under ODC-By 1.0 ([official access and license](https://physionet.org/content/ludb/1.0.0/#L224-L230)). Keep downloaded data outside the repository and record its version/checksum in the benchmark manifest.

Suggested reproducible command shape (after pinning the repository and installing its documented dependencies):

```bash
python - <<'PY'
# Call TemplateBank.from_ludb(...), then generate_avb_window(...)
# with fixed seeds; retain signal, labels, meta, seed, and source-record IDs.
PY
```

OpenECG supplies the deterministic primitive, but not MiniMed's case manifest or a coordinated 12-lead renderer.

## Real PhysioNet/WFDB datasets

MIT-BIH Arrhythmia is useful for an external spot-check. Its official annotation description includes `x` = non-conducted P wave (blocked APB), `BII` = second-degree heart block, `P` = paced rhythm, and beat codes for junctional escape, ventricular escape, paced, and fusion beats ([official annotation table](https://physionet.org/physiobank/database/html/mitdbdir/intro.htm#L81-L103)). It is only two-channel, has no complete set of P-wave boundaries or per-P conduction assignments, and `x` specifically denotes a blocked atrial premature beat. Therefore it cannot supply the required 15 independent cases without manual reinterpretation and does not cleanly satisfy blocked-PAC exclusion.

LUDB is a 12-lead, 200-record database with waveform annotations, but its coupled-P limitation is the reason OpenECG adds synthesis. It cannot by itself provide orphan-P, conduction-sequence, or complete-AV-dissociation ground truth. QTDB similarly provides beat/wave annotations but is not an AV-block sequence corpus. These are appropriate template sources, not the MiniMed AV-sequence benchmark itself.

## ECG-Reasoning-Benchmark

The official repository describes a diagnosis-driven, multi-turn benchmark over PTB-XL and MIMIC-IV-ECG. It provides finding/grounding/diagnostic QA answers ([README](https://github.com/Jwoo5/ecg-reasoning-benchmark#L248-L266)) and requires the original ECG files separately ([README](https://github.com/Jwoo5/ecg-reasoning-benchmark#L288-L304), [image/signal inputs](https://github.com/Jwoo5/ecg-reasoning-benchmark#L404-L437)). Its release notes say 3AVB and PAC samples were re-sampled ([README](https://github.com/Jwoo5/ecg-reasoning-benchmark#L169-L181)). Those are diagnosis/sample labels and grounding questions, not independent P-to-QRS event annotations. It is therefore rejected for deterministic AV-sequence validation and target-leakage control, though it may be useful later for model-level reasoning evaluation.

## Rejected / not sufficient

- **LUDB/QTDB alone:** insufficient orphan-P and conduction labels; use only as morphology/template sources.
- **MIT-BIH Arrhythmia:** useful `x`/`BII` annotations and pacing codes, but two-channel and not a complete independent event-grounded AVB corpus; use only as external spot-check.
- **ECG-Reasoning-Benchmark:** diagnosis-driven QA, not independent sequence ground truth; reject for this benchmark.
- **Undocumented synthetic generators:** reject unless their source, license, seed behavior, and event-level labels are inspectable and reproducible.

## Local 15-case boundary benchmark

The pinned generator was run locally at 250 Hz with lead-II templates from the first 24 LUDB sinus-rhythm records. LUDB `1.0.1` was downloaded outside the repository; the source ZIP SHA-256 was `d03192c7361ab5deeaba3f0d46e274b9ecb0b74c9caf8964151e20f1b5a7df06`. Background wander, mains hum, and motion artifacts were disabled because this experiment tested the numeric event contract, not delineation from a noisy signal.

The production TypeScript `analyzeEcgAvSequence` function and the existing interpreter saw only P/QRS boundary arrays plus an explicit pacing observation. The analyzer associated each QRS with the immediately preceding P inside its fixed 80–400 ms window, required at least 80% stable coupling for conducted patterns, and then used periodic missing associations, fixed versus progressive PR, reset after a dropped QRS, and loss of stable P→QRS coupling. The scenario name was used only to score the result.

| Cases | Seeds | Expected numeric pattern | Result |
|---|---|---|---|
| Mobitz I | `4101`–`4103` | progressive PR then dropped QRS | 3/3 |
| Mobitz II | `4205`, `4207` | fixed PR with periodic dropped QRS | 2/2 |
| 2:1 conduction | `4201` | every second P conducts; do not force a Mobitz subtype | 1/1 |
| Complete AV block | `4301`–`4303` | atrial rate exceeds ventricular rate and stable coupling is absent | 3/3 |
| Paced negative controls | `4401`–`4403` | abstain through pacing exclusion | 3/3 |
| Ventricular-tachycardia controls | `4501`–`4503` | abstain because distinct P waves are absent | 3/3 |

All 15 cases matched the expected MiniMed pattern. The same analyzer is exposed in the numeric panel as an editable draft: changing its event sequence invalidates the draft and final interpretation, while pacing and blocked-PAC exclusions stay manual. This is a wiring proof over clean oracle boundaries, not sensitivity/specificity evidence: the fixed PR window, coupling threshold and regularity limits are heuristics, only one lead was used, no false-positive rhythm corpus was included beyond paced/VT controls, and the generator itself defines the expected physiology. The next valid test is the same boundary-only evaluator on independently annotated real P/QRS sequences.

## Final recommendation

**Keep as research benchmark:** OpenECG generator plus LUDB templates and fixed seeds. **Runtime implementation:** keep the dependency-free numeric P/QRS event contract already added, not the generator itself. **Do not claim high-grade validation:** the upstream Mobitz generators drop only one P at a time. **Reject:** using diagnosis labels from PTB-XL/MIMIC or MIT-BIH rhythm labels as the primary event-level truth.

Open question: validate the runtime P→QRS association tolerance on independently annotated real sequences before treating its drafts as more than clinician-reviewed assistance.
