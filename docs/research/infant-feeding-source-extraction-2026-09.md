# Infant feeding source extraction — 2026-09-19

## Source

**«Национальная программа оптимизации вскармливания детей первого года жизни в Российской
Федерации»**, 2019, 4-е переработанное и дополненное издание.

Public PDF:
https://xn--b1aaisgq1jga.xn--p1ai/Files/RussiaGuid/Programma2019.pdf

The document is publicly accessible through pediatric professional/medical-library sources, but no
open redistribution license for its tables was established in this pass. Every extracted artifact is
therefore blocked from publication/runtime use until rights review.

## Complementary-feeding table

Structured artifact:

`docs/research/data/infant-complementary-feeding-scheme-program2019.json`

Source: Table 5.1, printed page 60.

The source table covers approximate amounts for age columns 4–5, 6, 7, 8 and 9–12 months. The
extraction preserves:

- blank cells as `null`;
- separate values for industrial meat puree vs boiled meat;
- fraction-of-yolk values rather than coercing them to grams;
- source footnotes (“not as the first complementary food”; curd by indication from 6 months).

It is not an individualized feeding prescription. The surrounding source text explicitly calls the
scheme approximate and discusses individual timing within the 4–6 month window.

## Early colostrum-volume table

Structured artifact:

`docs/research/data/newborn-colostrum-volume-per-feed-program2019.json`

Source: Table 3.2, printed page 39.

It records the source's average consumed-colostrum ranges per feed:

- 0–24 h: 2–10 ml;
- 24–48 h: 5–15 ml;
- 48–72 h: 15–30 ml;
- 72–96 h: 30–60 ml.

These are stored as a descriptive neonatal reference, not an automatic supplemental-feeding dose.
The surrounding text discusses special supplementation scenarios separately; those narrative
suggestions are intentionally not converted into a dosing engine.

## Negative extraction finding

A targeted search of this 2019 program did not identify a general “volumetric method” / universal
daily-volume formula such as a simple fraction of body mass. MiniMed therefore must not cite this
program as authority for such a formula.

If a daily-volume calculator is added, it needs a separate exact source and population contract.

## Next feeding slices

High-value structured candidates still available from this source include:

- WHO-based infant anthropometric interpretation table (the app already has WHO growth tooling, so
  avoid duplicating it unless source-linking is useful);
- weight-gain references and early neonatal supplementation context;
- disease-specific feeding tables, which should stay separate from healthy-infant feeding and should
  not be imported into the general feeding module.
