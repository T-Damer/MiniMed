# Pediatric cardiometabolic reference extraction — 2026-09-19

## Source

Current Russian clinical recommendation **«Артериальная гипертензия у детей»**, registry ID 571,
version 2, year 2025.

Registry:
https://minzdrav.clinirec.ru/kr/arterialnaya-gipertenziya-u-detey/

The recommendation appendix contains several reusable reference tables. This extraction keeps them as
blocked authoring artifacts rather than immediately turning them into runtime clinical rules.

## Extracted review artifacts

### Waist circumference

`docs/research/data/pediatric-waist-percentiles-kr571-v2-2025.json`

- ages 2–18 years;
- boys and girls;
- 10th / 25th / 50th / 75th / 90th percentiles;
- values in cm;
- source Table 17.

Source:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-17/

### Left-ventricular mass references

`docs/research/data/pediatric-lv-mass-percentiles-kr571-v2-2025.json`

- ten source age bands;
- boys and girls;
- source sample size per band/sex;
- LV mass (ММЛЖ, g);
- LV mass indexed to height^2.7 (ИММЛЖ, g/m^2.7);
- p10 / p25 / p50 / p75 / p90 / p95 plus source minimum/maximum;
- source Table 15.

Source:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-15/

No LVH cutoff is inferred from these distributions. A future organ-damage interpretation must use an
explicit, independently reviewed criterion rather than treating a percentile table as a diagnosis.

### Lipid reference cells

`docs/research/data/pediatric-lipid-reference-kr571-v2-2025.json`

Source Table 16:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-16/

The rendered table includes total cholesterol, LDL-C, non-HDL-C, age-specific triglycerides and HDL-C.
It is intentionally stored as source-cell text rather than executable limits because the HTML rendering
drops several inequality operators. For example, some “high” cells contain only a value such as
`5.2 / 200` without a visible `>=` sign; the target HDL mmol/L cell likewise loses an operator.

MiniMed must verify these cells against the original PDF or another authoritative rendering before
encoding threshold rules.

## Metabolic-syndrome table: not numerically promoted

Table 18 is source-identified but **not** converted to structured numeric rules in this pass.

Source:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-18/

Reason: the HTML-flattened row for HDL criteria loses column boundaries and comparison operators,
making the sex/age-specific limits ambiguous. The source points to the IDF pediatric metabolic-syndrome
consensus, but source attribution does not license reconstructing missing table syntax by assumption.

Status: `requires-pdf-visual-review`.

## Publication boundary

All JSON artifacts in this slice are:

- `review-required`;
- `publicationState: blocked`;
- `rightsStatus: unresolved`;
- authoring-only;
- absent from runtime/calculator/module catalogs.

Before any promotion, values need independent source verification, rights review, and a separate
clinical decision contract specifying exactly how the references are used.


## BMI adult-equivalent threshold table

The current recommendation's Table 12 was extracted into:

`docs/research/data/pediatric-bmi-adult-equivalent-thresholds-kr571-v2-2025.json`

It contains half-year age steps from 2 through 18 years and sex-specific BMI values corresponding,
in the source table, to adult BMI 25 and 30 kg/m². The artifact is review-only and must not replace
MiniMed's WHO BMI-for-age z-score/LMS path: these are different reference systems with different
interpretive contracts.

Source:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-12/

## Cuff-size table: source identified, structured promotion deferred

Table 3 is clinically useful but the HTML rendering flattens at least two rows ambiguously (including
the generic child row and the large-arm/thigh row). It is therefore **not** promoted into a numeric
dataset from the HTML text alone.

Source:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-3/

Status: `requires-pdf-visual-review`. The recommendation's rule that the inflatable bladder length
should cover at least 80% of arm circumference is retained as source context, but no ambiguous row
values are reconstructed by assumption.
