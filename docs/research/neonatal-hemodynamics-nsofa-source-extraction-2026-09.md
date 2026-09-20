# Neonatal hemodynamic reference and nSOFA extraction — 2026-09-20

## Source

Current clinical recommendation **«Сепсис новорожденных»**, ID 912_1, 2025.

The recommendation contains both a hemodynamic reference appendix and formal neonatal organ-failure
assessment tools. MiniMed keeps those as different semantic objects.

## Mean arterial pressure appendix

Research artifact:

`docs/research/data/neonatal-mean-arterial-pressure-kr912_1-2025.json`

Appendix A3.8 gives mean arterial pressure values at 0, 12, 24, 36, 48, 60 and 72 hours for four
gestational-age bands:

- 23–26 weeks;
- 27–32 weeks;
- 33–36 weeks;
- 37–43 weeks.

The artifact is marked `source_reference_table_not_treatment_threshold`. It must not be turned into an
autonomous hypotension trigger without reviewing the source cohort and clinical context.

## nSOFA

Research artifact:

`docs/research/data/nsofa-assessment-kr912_1-2025.json`

Appendix G1 contains the neonatal sequential organ failure assessment (nSOFA). The compact semantic
definition preserves three systems:

- respiratory: intubation state plus SpO2/FiO2 ratio;
- cardiovascular: number of adrenergic/dopaminergic agents plus systemic corticosteroid use;
- hematologic: platelet count.

The recommendation instructs clinicians to assess newborns in intensive care daily, using the worst
state/value during the day and summing the three system scores.

No MiniMed low/moderate/high score bands are added. The recommendation only states that higher scores
are associated with a greater probability of adverse course and death.

The source points to Wynn & Polin (Pediatric Research, 2020) as validation literature. The original
validation population is narrower (preterm very-low-birth-weight infants with late-onset sepsis) than
an unrestricted neonatal population, so that provenance must stay visible if this becomes a runtime
tool.

## Next assessment work

Current KR 912_1 also contains NEOMOD and a modified NEOMOD. They should be extracted separately rather
than treated as aliases of nSOFA because their domains, scoring and validation populations differ.
