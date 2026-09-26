# Retinopathy of prematurity source extraction — current 2026 application

## Source

Current clinical recommendation:

- title: **Ретинопатия недоношенных**;
- ID: **107_2**;
- approved: 2025;
- applies from: 19.01.2026;
- review due no later than: 2027;
- population: children.

Research artifact:

`docs/research/data/rop-screening-classification-kr107_2-2025.json`

The current pediatric ophthalmology Order №614н (09.10.2025) is stored as a separate regulatory
overlay for follow-up/treatment timing.

## Who enters screening

The KR includes preterm infants if either criterion is met:

- gestational age at birth <35 weeks;
- birth weight <2000 g.

Incomplete peripheral retinal vascularization without disease is kept separate from ROP itself.

## First examination schedule

Current KR Table 2 is represented directly:

- birth GA 22–27 weeks → first exam at 30–31 weeks postconceptual age;
- birth GA 28–30 weeks → 32–34 weeks postconceptual age / about 4 weeks of life;
- birth GA >=31 weeks → no later than 2 weeks of life.

Severe concomitant neonatal disease can justify examination one week earlier.

## Follow-up

- incomplete vascularization without ROP: repeat in 2 weeks;
- detected ROP: weekly observation under the current ophthalmology order;
- aggressive posterior ROP: repeat in 3 days.

The artifact does not attempt to collapse these into one generic interval.

## Type 1 / Type 2

Type 1 is retained as:

- zone I, any stage with plus disease;
- zone I, stage 3 without plus disease;
- zone II, stages 2–3 with plus disease.

Type 2:

- zone I, stages 1–2 without plus disease;
- zone II, stage 3 without plus disease.

Type 1 is treatment-indicating; Type 2 is an observation category in this source contract.

## Threshold ROP

The current KR definition is stored separately:

- stage 3;
- plus disease;
- extraretinal proliferation over either 5 consecutive or 8 cumulative clock hours.

This is not merged into “Type 1” as a synonym even though treatment pathways overlap.

## Treatment routing

The research artifact stores source indication patterns for laser and anti-VEGF treatment, but no
drug/dose choice.

Order №614н requires treatment of active progressive Type 1 ROP no later than 72 hours after medical
indications are identified.

## Promotion gate

Before runtime use:

1. reconcile the KR screening timetable with the organizational wording of Order №614н;
2. clinically review zone/stage/plus logic;
3. keep Type 1, Type 2, threshold ROP and aggressive posterior ROP as separate concepts;
4. verify follow-up stopping conditions;
5. keep treatment initiation as an ophthalmologist decision rather than an autonomous app action.
