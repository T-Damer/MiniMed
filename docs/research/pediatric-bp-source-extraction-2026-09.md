# Pediatric blood-pressure percentile extraction — 2026-09-19

## Purpose

This is a review-only structured extraction from the current Russian clinical recommendation
**«Артериальная гипертензия у детей»**, registry ID 571, version 2, year 2025.

Registry:
https://minzdrav.clinirec.ru/kr/arterialnaya-gipertenziya-u-detey/

Current recommendation mirror:
https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/

The current recommendation explicitly includes reference tables for:

- neonatal blood pressure by gestational age;
- blood-pressure percentiles at one year;
- height percentiles from 1 to 17 years;
- 90th/95th/99th blood-pressure percentiles by age, sex and height percentile;
- ambulatory blood-pressure monitoring references by age and height;
- additional pediatric cardiometabolic reference tables.

This first structured slice extracts only the office blood-pressure Tables 5 and 6.

## Structured artifact

Review-only dataset:

`docs/research/data/pediatric-bp-percentiles-kr571-v2-2025.json`

Shape:

- ages: 1–17 years;
- sex: boys / girls;
- BP percentiles: 90 / 95 / 99;
- height percentiles: 5 / 10 / 25 / 50 / 75 / 90 / 95;
- values: systolic and diastolic blood pressure in mmHg;
- 51 rows per sex, 102 rows total.

Sources:

- boys, Table 5:
  https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-5/
- girls, Table 6:
  https://sudact.ru/law/klinicheskie-rekomendatsii-arterialnaia-gipertenziia-u-detei-odobreny/prilozhenie-a3/tablitsa-6/

The rendered tables themselves cite the 2009 second revision of the Russian pediatric-hypertension
recommendations as their underlying numerical source. The 2025 clinical recommendation republishes
these tables in its reference appendix.

## Automated checks already applied

The extraction was checked mechanically before commit:

- exactly 51 rows for boys and 51 for girls;
- complete ages 1 through 17;
- exactly 90th, 95th and 99th BP rows for every age;
- seven systolic and seven diastolic values per row, matching the seven height percentiles;
- values are non-decreasing as height percentile rises within a row;
- at every age/height cell, 90th < 95th < 99th BP percentile;
- observed systolic range: boys 94–147 mmHg, girls 97–139 mmHg;
- observed diastolic range: boys 49–97 mmHg, girls 52–93 mmHg.

These checks catch transcription-shape errors; they are not independent clinical validation.

## Safety / publication boundary

The JSON is deliberately marked:

- `status: review-required`;
- `publicationState: blocked`;
- `rightsStatus: unresolved`;
- `verificationStatus: single-source-transcription`;
- `intendedUse: authoring-review-only`.

It is not wired into a calculator, runtime lookup, released SQLite module, or clinical decision rule.

Before promotion:

1. compare all 102 rows against an independent copy of the same source table or perform
   clinician line-by-line verification;
2. resolve redistribution/publication rights for the complete numeric table;
3. model the actual diagnostic algorithm separately — table lookup alone is not a diagnosis;
4. explicitly define height-percentile derivation/source and behavior when exact age/height bins are
   unavailable;
5. verify how the recommendation handles adolescents where adult absolute thresholds may also apply;
6. add separate ABPM references rather than reusing office-BP percentiles for ambulatory measurements.

## Next pediatric-hypertension slices

The same current recommendation contains several high-value structured tables that can be extracted
without inventing clinical knowledge:

- Tables 7–10: ABPM reference values by age/height and sex;
- Table 4: height percentiles;
- Table 15: LV mass/LV mass-index percentiles;
- Table 16: pediatric lipid target/borderline/high values;
- Table 17: waist-circumference percentiles;
- Table 18: metabolic-syndrome criteria.

Each should remain its own source-versioned review artifact so a later calculator/reference module can
compose only independently verified pieces.
