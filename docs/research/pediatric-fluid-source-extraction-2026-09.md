# Pediatric fluid-therapy source extraction — 2026-09-20

## Current source

Current Russian clinical recommendation **«Недостаточность питания у детей старше 1 года
(Белково-энергетическая недостаточность)»**, 2026, ID 1041_1.

Current source pages:
- https://cr.minzdrav.gov.ru/preview-cr/1041_1
- https://www.consultant.ru/document/cons_doc_LAW_535890/
- https://base.garant.ru/414308892/

Structured artifact:

`docs/research/data/pediatric-fluid-therapy-source-contract-kr1041_1-2026.json`

## Three-component fluid model

The recommendation explicitly separates infusion volume into:

- physiologic requirement (ФП);
- dehydration correction (ЖВО);
- replacement of current pathological losses (ЖТПП).

The combined source formula is `Vит = ФП + ЖВО + ЖТПП`.

For physiologic requirement, the source gives:

- <=10 kg: 100 ml/kg/day;
- 10–20 kg: 1000 ml + 50 ml for each kg above 10;
- >20 kg: 1500 ml + 25 ml for each kg above 20.

The source states that physiologic requirement is replaced evenly over the day.

## Dehydration severity — Appendix A3.17

The source uses three clinical degrees:

- I: estimated 4–5% body-weight loss;
- II: 6–9%;
- III: >=10%.

Seventeen clinical features are retained semantically, including stool/vomiting, thirst, appearance,
skin elasticity, eyes/tears/fontanelle, mucosa, heart/pulse/cyanosis, breathing/voice, urine output and
temperature.

The table is **not** converted to an additive score and one sign does not produce a diagnosis.

## Dehydration-correction volume — Appendix A3.18

The source table is preserved as labelled: **infusion volume for correction of dehydration,
ml/kg/day**.

| Degree | <1 year | 1–5 years | >5 years |
| --- | ---: | ---: | ---: |
| I | 170 | 100–125 | 75–100 |
| II | 200 | 130–150 | 110 |
| III | 220 | 150–170 | 120 |

There is a source/population inconsistency worth preserving: the parent recommendation is titled
“children older than 1 year”, while A3.18 contains a “under 1 year” column. MiniMed stores those source
cells but marks them out of the parent recommendation population until they are independently
cross-checked against an infant-specific current source.

For stable hemodynamics the recommendation says the calculated dehydration-correction volume is split
in half: the first half over 8 hours and the second over 16 hours.

## Current pathological losses

The current source gives additive replacement estimates:

- each degree above 37 °C sustained for at least 8 h: 10 ml/kg;
- each 20 breaths/min above the age norm: 15 ml/kg;
- vomiting: 20 ml/kg;
- frequent stool: 20–30 ml/kg after each defecation;
- intestinal paresis grade II: 20 ml/kg;
- grade III: 40 ml/kg.

The recommendation states that current losses are replaced when they are registered.

## Important scope boundaries

This is not a universal emergency-fluid protocol. The parent source is a nutrition-deficiency
recommendation and itself lists conditions requiring fluid restriction, including cerebral edema,
heart failure, edema, acute kidney injury and significant respiratory failure.

The artifact does not replace:

- oral-rehydration recommendations for gastroenteritis;
- shock/resuscitation protocols;
- condition-specific fluid restriction;
- direct measurement of ongoing losses where available.

It remains `review-required` / `publicationState: blocked`.
