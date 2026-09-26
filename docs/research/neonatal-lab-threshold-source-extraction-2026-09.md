# Neonatal laboratory decision-threshold extraction — 2026-09-20

## Why this is separate from laboratory reference intervals

Current neonatal clinical recommendations contain many clinically important laboratory cutoffs, but
they are **diagnostic/treatment decision thresholds**, not healthy-population reference intervals.

MiniMed should model those as a separate semantic class. Otherwise a value such as CRP >10 mg/L for
supporting neonatal-sepsis assessment could be incorrectly displayed as a universal laboratory
"normal range".

Structured artifact:

`docs/research/data/neonatal-lab-decision-thresholds-krs-2025.json`

The dataset explicitly declares
`semanticClass: clinical_decision_thresholds_not_reference_intervals`.

## Sepsis neonatorum — KR 912_1, 2025

Current recommendation: **«Сепсис новорожденных»**, ID 912_1, year 2025, revision due by 2027.

Current source mirrors identify the following disease-specific thresholds:

- leukocytosis >30 ×10^9/L and leukopenia <5 ×10^9/L;
- neutrophilia >20 ×10^9/L on days 1–2 and >7 ×10^9/L after day 3;
- thrombocytopenia during the first 72 hours:
  - <123 ×10^9/L at gestational age >=33 weeks;
  - <104 ×10^9/L at gestational age <=32 weeks;
- after 72 hours: platelets <150 ×10^9/L irrespective of gestational/postnatal age;
- procalcitonin >=2.5 ng/mL for the early source interval and >=2.0 ng/mL after 72 hours;
- CRP >10 mg/L;
- presepsin >800 pg/mL;
- immature/total neutrophil ratio >0.2;
- glucose <2.6 or >10 mmol/L;
- lactate >2 mmol/L.

The Appendix A3.2 neutropenia table is retained separately by birth weight and postnatal age. In
particular, the <=1500 g group uses a final >48 h threshold of ANC <1100 cells/µL, whereas the
>1500 g group continues through >48–72 h (<2000) and >72 h (<1500). These bands must not be
flattened into one generic ANC range.

The recommendation also gives treatment-decision platelet thresholds for sepsis/septic shock/DIC:
<25 ×10^9/L without bleeding and <50 ×10^9/L with ongoing bleeding. They are stored as decision
thresholds, not as reference intervals.

## Neonatal polycythemia — KR 909_1, 2025

Current recommendation: **«Полицитемия новорожденного»**, ID 909_1, year 2025, revision due by 2027.

The disease definition uses **venous hematocrit >=65%**.

Sampling matters:

- peripheral/capillary hematocrit >65% triggers venous confirmation;
- the recommendation notes that capillary hematocrit is commonly higher than venous;
- treatment decisions use the venous hematocrit.

The research artifact also records the source's venous-Hct treatment boundaries (70–75% in the
asymptomatic infusion context, >=65% with symptoms/no dehydration and >=76% when asymptomatic for
partial-exchange consideration), but intentionally omits the procedural treatment implementation.

## Safety boundary

This extraction does **not** resolve the broader backlog item “neonatal laboratory reference
intervals”. It only provides source-backed disease-specific decision thresholds.

A future neonatal lab reference card still needs method/population-specific normal intervals for
healthy term/preterm newborns, preferably from a validated laboratory dataset.

Promotion rules:

1. keep recommendation ID/year on every threshold;
2. never show a disease-decision cutoff as a generic normal range;
3. preserve gestational age, birth weight and postnatal age qualifiers;
4. use venous Hct where the polycythemia recommendation requires venous measurement;
5. do not create an autonomous sepsis or polycythemia diagnosis from one laboratory value.
