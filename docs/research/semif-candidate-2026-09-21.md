# SemIf — candidate, not an installed dependency

Decision: 2026-09-21, user-approved candidate for R4 of `../DEFINITION_REFERENCE_PLAN.md`.
Status: **candidate / not evaluated on MiniMed / disabled**. R1b (installed-size work)
and R2 (owned SQLite/app integration) remain ahead of this experiment. No model download,
package dependency, inference call, clinical rule, remote endpoint or release is introduced.

## Inspected upstream, pinned rather than tracked implicitly

Repository: https://github.com/TheoLeeCJ/SemIf
Reviewed revision: `ca3ba65f142967030ecb453346e94d6f476a69df`.
Primary implementation/method sources at that revision:

- `docs/METHOD.md`, `docs/RESULTS.md`;
- `src/semif_phase1/core.py`, `direct.py`, `shared.py`;
- `webgpu-demo/README.md`, `worker.js`, `THIRD_PARTY.md`.

The native baseline reads allowed answer-token logits from a frozen causal model;
it is not a new small trained classifier or a reproduction of Jev's undisclosed training.
The Python contract offers 2–16 options. The separate browser demonstration uses an
allowed one-token completion and its own 2–20 option/context/runtime settings; do not
assume its quantized quality or prefix reuse equals the native BF16 implementation.
Upstream scores are conditional on supplied alternatives, not calibrated diagnostic
probabilities. The repository documents order/wording sensitivity. Those are reasons
to test, not evidence of clinical fitness. Code and model licenses require separate checks.

## Proposed MiniMed tasks

1. Reverse definition lookup over an already retrieved, source-linked candidate set.
2. Evidence/criterion matching from original free text plus explicitly entered structured
   observations. Preserve subject, negation, uncertainty and time; a relative's old symptom
   is not the patient's current finding.
3. Selection of source-backed clarification questions and potentially applicable reference
   instruments from a declared list. Instrument scoring and mandatory eligibility checks
   remain deterministic code operating on validated inputs.

Keep the original user wording alongside any parsed patient state, so a preprocessing
mistake does not erase the evidence. Results can identify existing cards/questions; they
must not replace source definitions, invent scale items, imply discoverer identity, mark
unreviewed corpus facts as approved, or independently authorize a medical intervention.

## Evaluation contract before any application experiment

- Start with frozen input/candidate IDs and source editions. Measure candidate recall
  separately from selection/ranking; an absent target cannot be repaired by reranking.
- Compare ordinary order, the existing reranker and SemIf on the same evidence budget.
  Evaluate reverse lookup, evidence matching and question selection as separate tasks.
- Include insufficient/contradictory evidence, absent corpus concepts, multiple acceptable
  answers, longitudinal and family-history cases, units and missing structured fields.
- Perturb option order, harmless phrasing and irrelevant context. Include instructions
  embedded in untrusted input/source text; a typed output is not an injection defense.
- Freeze development and evaluation populations; report visible authored probes as such.
  Keep any clinician-authored holdout separate. Do not turn failed probes into aliases or
  conflate these results with the existing 33-query clinical challenge.
- Do not compare softmax scores from different candidate groups as common probabilities.
  Independent candidate questions need an explicitly validated common scoring/calibration
  protocol; retain a none/insufficient outcome and quantify confident errors.
- Verify the exact model revision, tokenizer/answer boundaries, quantization, prompt and
  backend together. No BF16-to-GGUF or desktop-to-Android quality/latency extrapolation.
- Measure cold load, warm p50/p95, incremental/peak memory, disk/download bytes and offline
  behavior. A multi-gigabyte 4B artifact is optional and requires explicit installation;
  no background download and no compulsory model in the small reference package.
- Exact-name lookup bypasses models. Failure, cancellation, OOM or incompatible devices
  preserve the ordinary SQLite reference path. No unbounded JSON fallback or new DB owner.

## Exit decision

Admission requires a reproducible benefit on the declared Russian medical tasks, acceptable
error/abstention behavior and a measured resource budget on the actual target runtime.
Until then retain this as an R4 candidate, not a selected architecture. No inference or
MiniMed accuracy result has been produced for SemIf in this work item.
