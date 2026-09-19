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

## Energy/macronutrient requirements

Structured artifact:

`docs/research/data/infant-energy-macronutrient-needs-program2019.json`

Appendix 1 (printed page 184) gives first-year requirements per kg body weight:

- 0–3 months: 115 kcal/kg; protein 2.2 g/kg; fat 6.5 g/kg; carbohydrate 13 g/kg;
- 4–6 months: 115 kcal/kg; protein 2.6 g/kg; fat 6.0 g/kg; carbohydrate 13 g/kg;
- 7–12 months: 110 kcal/kg; protein 2.9 g/kg; fat 5.5 g/kg; carbohydrate 13 g/kg.

The source also separates animal protein and the vegetable component of fat; those fields are retained
in the dataset. The 1–3 year absolute daily row is intentionally outside this first-year artifact.

## Formula-volume caloric method

A deeper source pass corrected the earlier negative finding. Chapter 4 (printed page 56) explicitly
states that adapted-formula volume is calculated on **actual body weight by the caloric method** at
115 kcal/kg during the first six months.

Structured source contract:

`docs/research/data/infant-formula-volume-caloric-method-program2019.json`

The same passage gives daily-volume ceilings:

- 3 months: 850 ml/day;
- 4 months: 900 ml/day;
- source wording “after 5 months”: 1000 ml/day.

MiniMed still must **not** convert this into a universal ml/kg shortcut. Turning kcal/day into ml/day
requires the prepared formula's energy density, and the wording “after 5 months” needs an explicit
boundary decision. The source also defers underweight/overweight cases to separate chapters.

Therefore the earlier statement “no daily-volume method was found” is superseded. What remains
unsupported by this source is a simple body-mass fraction rule such as “1/5 of body weight.”

## Next feeding slices

High-value structured candidates still available from this source include:

- WHO-based infant anthropometric interpretation table (the app already has WHO growth tooling, so
  avoid duplicating it unless source-linking is useful);
- weight-gain references and early neonatal supplementation context;
- disease-specific feeding tables, which should stay separate from healthy-infant feeding and should
  not be imported into the general feeding module.
