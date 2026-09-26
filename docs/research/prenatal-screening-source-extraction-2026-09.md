# Prenatal screening source extraction — current 2026 order

## Current legal source

Research artifact:

`docs/research/data/prenatal-screening-order-747n-current-2026.json`

Current order: Ministry of Health Order №747н dated 19.12.2025, registered №84894, effective from
10.01.2026.

Official publication:
https://publication.pravo.gov.ru/document/0001202512300089

The prior Order №1130н ceased to be the current care-order logic on 10.01.2026, although appendices
7–9 remain as retained protocol/referral form dependencies.

## Screening windows

The current order defines three prenatal screening windows:

- I trimester: 11+0 to 13+6 weeks;
- II trimester: 18+0 to 20+6 weeks;
- III trimester: 34+0 to 35+6 weeks.

The second-trimester source also describes the screening ultrasound itself as 19–21 weeks; both source
expressions are retained rather than silently normalized into one interval.

## I-trimester contract

The first-trimester source workflow includes:

- maternal height, weight and blood pressure;
- family-history review;
- screening ultrasound;
- PAPP-A;
- free beta-hCG;
- individual risk calculation for chromosomal anomalies, fetal-growth restriction, preterm birth and
  preeclampsia.

Chromosomal-risk routing categories are preserved:

- high: 1:100 and above;
- medium: 1:101–1:1000;
- low: 1:1001 and below.

These are routing categories, not diagnostic probabilities stored as a confirmed fetal diagnosis.

## NIPT and invasive diagnostics

The current order indicates NIPT/cell-free fetal DNA screening for medium- and high-risk groups, with
the source exception around already visible malformation signs on first-trimester ultrasound.

The research contract separately stores source indications for invasive prenatal diagnostics and the
listed methods:

- chorionic/placental biopsy;
- amniocentesis;
- cordocentesis.

No proprietary combined-risk algorithm is reconstructed.

## II and III trimester

II trimester retains screening ultrasound plus cervicometry.

III trimester retains fetal ultrasound plus uteroplacental Doppler, with source goals including
late-manifesting malformations, large/small-for-gestational-age fetus and abnormal fetal position.

## Safety boundary

The artifact explicitly keeps:

- screening ≠ diagnosis;
- NIPT ≠ confirmatory diagnosis;
- a high-risk ratio ≠ confirmed chromosomal abnormality;
- invasive testing as a clinician/geneticist decision pathway.

A second line-by-line legal review is required before runtime publication.
