# Neonatal screening source extraction — current 2026 legal edition

## Source identity

Current source contract:

`docs/research/data/neonatal-screening-order-274n-current-2026.json`

Base act: Ministry of Health Order №274н dated 21.04.2022 on care for patients with congenital and/or
hereditary diseases.

Current amendment: Order №745н dated 19.12.2025, registered by the Ministry of Justice №85184 and
effective from 01.04.2026.

The amendment adds AADC deficiency and X-linked adrenoleukodystrophy to the expanded neonatal
screening list.

## Why the dataset is versioned instead of storing only “36 diseases”

Public Ministry materials in 2025 commonly described expanded neonatal screening as screening for
36 diseases. The current legal text changed in 2026.

MiniMed therefore stores:

- exact legal-edition identity;
- the statutory ICD-group/concept structure;
- explicit 2026 additions;
- specimen timing and workflow.

It does **not** use a fixed headline count as the canonical identity, because several legally listed
conditions are grouped under one ICD heading and the count can become stale when the order changes.

## Collection timing and workflow

The current order specifies heel blood after 3 hours from feeding:

- term newborn: 24–48 hours of life;
- preterm newborn: day 7, represented in the source as 144–168 hours.

The source workflow separates:

1. universal screening;
2. formation of a high-risk group;
3. confirmatory biochemical and/or molecular-genetic testing;
4. medical-genetic counseling after confirmation.

A screening-positive/high-risk result is therefore not represented as a diagnosis.

## Naming collision in MiniMed

The repository already contains a different **Order №274н from 2025** concerning sanatorium forms.
Document number alone is insufficient. Search/index identity must include issuer, date/year and
document purpose.

## Promotion gate

Before publishing this research contract:

1. perform a second legal-text comparison against the current official edition;
2. verify every disease/concept mapping and ICD grouping;
3. preserve the 01.04.2026 amendment boundary;
4. keep screen-positive/high-risk states separate from confirmed diagnoses;
5. do not substitute older 2025 “36 diseases” marketing wording for the current legal edition.
