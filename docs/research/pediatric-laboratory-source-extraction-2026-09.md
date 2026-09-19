# Pediatric laboratory reference extraction — 2026-09-19

## Existing MiniMed slice

`content/reference-rf-pilot/laboratory-reference-intervals.md` already includes a small method-specific
CALIPER hematology slice (RBC, hemoglobin, WBC and platelets) plus selected chemistry/CSF values from
the Bangladesh National Formulary hosted by WHO.

The runtime/reference card correctly warns that the performing laboratory's validated interval takes
precedence.

## CALIPER hematology expansion

Research artifact:

`docs/research/data/caliper-dxh900-pediatric-hematology-expansion-2020.json`

Source:

- Tahmasebi H, Higgins V, Bohn MK, Hall A, Adeli K.
- CALIPER Hematology Reference Standards (I).
- American Journal of Clinical Pathology. 2020;154(3):330–341.
- DOI 10.1093/ajcp/aqaa059; PMID 32561916; PMCID PMC7403759.
- Beckman Coulter DxH 900 analyzer.
- healthy Canadian pediatric cohort, birth to <21 years.

This research slice intentionally adds selected common parameters absent from the currently bundled
MiniMed card:

- hematocrit;
- MCV, MCH, MCHC and RDW-CV;
- mean platelet volume;
- lymphocyte percentage/absolute count;
- neutrophil percentage/absolute count;
- monocyte and eosinophil absolute counts;
- reticulocyte percentage and absolute count.

Age/sex partitions are preserved from the source. For example, adolescent hematocrit and neutrophil
percentage retain the source's sex split rather than being averaged.

## What is deliberately not copied

The compact artifact omits confidence intervals, cohort counts and research-only analyzer parameters.
Clinical review should return to Table 1 for those details.

The source article is not treated as an open license for wholesale redistribution of the table.
Therefore this expansion remains `publicationState: blocked` and is not automatically merged into
the existing reference module.

## Promotion gate

Before promoting selected intervals into a published MiniMed reference module:

1. decide which common clinical parameters materially improve the existing card;
2. retain analyzer/method metadata visibly;
3. verify the exact age-boundary syntax and sex partitions against the source table;
4. review redistribution scope;
5. retain the rule that the performing laboratory's own interval wins;
6. do not transform an out-of-range result into a diagnosis.
