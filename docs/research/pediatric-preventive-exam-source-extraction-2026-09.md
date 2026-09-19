# Pediatric preventive-exam schedule extraction — Order 211n, 2025

## Source

Current Russian Ministry of Health Order **№ 211н dated 14.04.2025**, registered by the Ministry of
Justice on 22.05.2025 № 82300, effective 01.09.2025–01.09.2031.

Official publication:
https://publication.pravo.gov.ru/document/0001202505230032

MiniMed already has a source-linked regulatory summary:
`content/regulatory-rf-pilot/order-211n-preventive-exams.md`.

That card covers organization, health groups and physical-education medical groups, but explicitly
does not reproduce the complete age-by-age list of specialists and investigations.

## Structured schedule

Research artifact:

`docs/research/data/pediatric-preventive-exam-schedule-order-211n-2025.json`

The Appendix №1 table was visually checked across the PDF pages containing all 31 rows. The structured
artifact spans:

- newborn period;
- every month from 1 through 12 months where the order defines a row;
- 1 year 3 months and 1 year 6 months;
- ages 2 through 17 years.

Each row separates:

- unconditional specialists;
- unconditional laboratory/instrumental studies;
- sex-conditional specialists;
- screening-risk conditional specialists;
- risk-group conditional cholesterol testing.

## Important conditional examples

- 18 months: mental-development risk screening is listed; neurologist participation is conditional on
  the screening result/risk group.
- 2 years: the same screening is listed; child-psychiatrist participation is conditional on risk.
- 6 and 10 years: cholesterol express testing is only for children in the risk group.
- gynecology and pediatric urology/andrology are encoded with the source's sex conditions instead of
  becoming universal visits.

## Scope boundary

The artifact does not infer investigations absent from Appendix №1.

The order itself points tuberculosis screening and screening for illegal psychoactive-substance use to
separate legal acts. MiniMed therefore does not silently add those procedures to this schedule.

Health-group classification I–V remains a separate part of Order 211n and is already summarized in the
regulatory card. Schedule rows do not determine the child's health group.

## Promotion gate

Before this becomes a runtime age-based helper:

1. perform a second line-by-line comparison against the official publication;
2. decide how exact age/date matching should behave near month/year boundaries;
3. keep all conditional triggers visible in the UI;
4. preserve the order version/effective dates and supersession handling;
5. never present omitted or refused investigations as if they were completed.
