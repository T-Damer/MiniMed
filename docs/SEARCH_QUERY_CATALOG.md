# Russian search discovery catalog

These queries are product requirements and regression inputs. Preserve their original spelling; normalized aliases may be added separately. Every query must produce an intent, at least one retrieval branch, and non-blocking clarification suggestions when material context is missing.

| Exact query | Expected primary intent | Important extracted/context fields | Expected refinement behavior |
|---|---|---|---|
| `Мальчик 5 лет, 3 дня назад появилась сыпь` | diagnosis | male, 5 years, 3 days, rash | ask for temperature, distribution/appearance, exposures, medications, red flags as data coverage grows |
| `Лечение бронхиальной астмы` | treatment | asthma | ask age, severity, control/step, current therapy, contraindications |
| `Лечение бронхиальной астмы первой степени при потере контоля девочке 3 лет` | treatment | female, 3 years, asthma, loss of control; preserve typo `контоля` | do not ask for control again; ask weight, severity/red flags, current therapy |
| `Мазь при укусе комара` | treatment | topical-treatment request, insect bite | ask age, reaction severity, allergy/anaphylaxis signs, skin integrity |
| `Помощь при ссаденой ране` | treatment | first aid, abrasion; preserve typo `ссаденой` | ask depth/contamination, bleeding, tetanus context, age |
| `Мазь при ожоге у ребенка 1 месяца` | treatment | infant 1 month, burn, topical-treatment request | ask burn depth/area/location, mechanism, weight, red flags; prefer routing/safety before a drug card |
| `Препарат для снижения давления` | medication | therapeutic goal: blood-pressure reduction | broad result: show classes and require diagnosis/measurement, age, urgency, comorbidities, pregnancy, current drugs |
| `Препараты при мигрени` | medication | migraine, plural/class request | show treatment groups and source-linked drugs; ask acute vs preventive goal, age, pregnancy, frequency and contraindications |
| `Вскармливание ребенка в 4 месяца` | care-guidance | age 4 months | ask current feeding type, growth, prematurity and clinical restrictions |
| `Прикорм ребенка в 4 месяца` | care-guidance | age 4 months, complementary feeding | retrieve feeding guidance rather than disease treatment; ask readiness/prematurity/allergy context |
| `Прибавка в весе ребенка в 4 месяца` | care-guidance | age 4 months, growth reference | retrieve growth/reference material; ask birth data, gestational age and feeding type |
| `Какой прикорм разрешен в 4 месяца` | care-guidance | age 4 months, permitted foods | retrieve age-specific guidance and source; avoid drug/treatment routing |
| `Группа здоровья при язвенной болезни, болеет ей 2 месяца` | administrative-reference | peptic ulcer, duration 2 months | do not infer a group; ask severity, complications, remission/exacerbation, functional limitations and governing rule version |

## Intent rules

Intent classification is deterministic and runs before retrieval. It affects branch labels/weights and clarification fields, but it does not generate a medical answer.

A query may have secondary intents. For example, `Мазь при ожоге...` is primarily treatment and secondarily medication lookup. `Препараты при мигрени` is primarily medication lookup and remains linked to migraine treatment documents.

## Dirty-search policy

Russian search normalization should be data-driven where possible:

- `ё`/`е`, punctuation, case, and light morphology;
- clinical aliases and trade/INN names from the content pack;
- common keyboard/layout and spelling variants;
- units and equivalent strength expressions;
- explicit negative findings;
- source-language and translated names.

The two observed variants `контоля` → `контроля` and `ссаденой` → `ссадиной` are covered by regression tests. Product-specific typo aliases should ultimately live in versioned alias data rather than grow into an unreviewed code dictionary.
