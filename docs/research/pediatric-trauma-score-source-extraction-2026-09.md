# Pediatric Trauma Score extraction — 2026-09-20

## Current Russian clinical relevance

Current clinical recommendation **«Травма селезенки у детей»**, 2025, ID 938_1, explicitly uses
the Pediatric Trauma Score (PTS) when discussing injury severity.

The recommendation states that trauma is considered severe when the PTS total is **8 or lower**.

Current source:
https://www.consultant.ru/document/cons_doc_LAW_513863/ce7bcf6109e4b251019bb2dc2d604cd153adf200/

## Structured artifact

`docs/research/data/pediatric-trauma-score-kr938_1-2025.json`

PTS contains six components, each scored +2 / +1 / −1:

- body weight;
- airway;
- systolic blood pressure;
- central nervous system state;
- open wound severity;
- fractures.

The total range is −6…12.

The component matrix is linked to the classic PTS definition/validation literature. The current
Russian KR is used separately to establish current Russian clinical relevance and the ≤8 severe-trauma
interpretation.

## Why the sources are kept separate

The 2025 Russian spleen-trauma recommendation does not reproduce the full six-component scoring table.
MiniMed therefore must not imply that every matrix cell comes directly from KR 938_1.

The artifact separates:

- classic score definition;
- current Russian source linkage;
- current Russian ≤8 severity threshold.

Historical mortality percentages often reproduced alongside PTS are intentionally omitted from this
research contract because they are not required by the current Russian recommendation.

## Promotion gate

Before runtime promotion:

1. clinician review of subjective airway/wound/CNS labels;
2. rights/source review of the compact score definition;
3. validation that the UI makes the +2/+1/−1 scale unambiguous;
4. keep PTS as triage/severity support rather than an autonomous diagnosis or treatment rule.
