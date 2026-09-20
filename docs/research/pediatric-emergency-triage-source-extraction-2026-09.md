# Pediatric emergency triage source extraction — 2026-09-20

## Current recommendation

Current Russian clinical recommendation **«Острая респираторная вирусная инфекция (ОРВИ)»**,
ID 25_3, approved 2026, children, revision due no later than 2028.

The current recommendation contains an explicit Pediatric Assessment Triangle (PAT) appendix and
references PEWS separately.

## Pediatric Assessment Triangle

Research artifact:

`docs/research/data/pediatric-assessment-triangle-kr25_3-2026.json`

PAT is stored as a **categorical visual assessment**, not an additive score. The recommendation
describes rapid 30–60 second assessment of:

- appearance;
- breathing;
- skin/circulation.

For each domain the source gives normal and pathological findings.

The source key explicitly interprets seven combinations:

- normal / normal / normal;
- normal / pathological / normal;
- normal / pathological / pathological;
- normal / normal / pathological;
- pathological / normal / pathological;
- pathological / normal / normal;
- pathological / pathological / pathological.

There are eight possible binary combinations. The textual key does not list
`pathological / pathological / normal`. MiniMed therefore records this as a source gap and does not
construct an eighth diagnosis/syndrome by symmetry.

## PAT triage levels

The recommendation separately gives disposition text for triage levels 1–5:

- levels 1–2: critical, evacuation to pediatric intensive care;
- level 3: urgent, hospital evacuation and priority treatment;
- level 4: semi-urgent/stable;
- level 5: non-urgent/outpatient.

The text page does not expose an explicit mapping from each of the seven PAT pattern rows to one of
these levels. The research artifact therefore sets `patternToTriageLevelMapping: null`.

A future runtime implementation must review the source figure/key before connecting those two layers.

## PEWS

The same current recommendation cites the 2023 Kommunarka methodology
**«Методика применения шкалы PEWS при оказании стационарной помощи детям»**.

The current recommendation does not itself provide the complete canonical PEWS scoring matrix.
Because PEWS has multiple implementations, MiniMed must not substitute a different hospital/NHS
variant merely because the name matches.

PEWS stays blocked until the exact cited methodology or a version-equivalent source can be reviewed.

## Boundary

PAT is a rapid triage/syndrome assessment and does not replace ABCDE evaluation, vital-sign
measurement, diagnosis, or resuscitation decisions.

The artifact remains `review-required` / `publicationState: blocked`.
