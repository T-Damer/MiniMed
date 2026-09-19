# Neuropsychiatry knowledge-candidate extraction — 2026-09-19

## Scope

This is a source-backed authoring queue for MiniMed's concept-first knowledge extraction work.
It records assessment/instrument names that are explicitly present in approved Russian clinical
recommendations or stable legal/reference mirrors of those recommendations.

Nothing in this file is a published tool definition. No questionnaire item text, protected stimulus
material, scoring key, diagnostic cutoff, or generated clinical interpretation is copied here.
Every row remains a review candidate until it is reconciled to the corresponding MiniMed clinical
recommendation document/version and explicitly promoted.

## Psychiatry — schizophrenia, 2024

Source: Clinical recommendation **Шизофрения**, approved by the Russian Ministry of Health,
year 2024, ID 451, adult population. The current source mirror identifies the recommendation,
developer (Российское общество психиатров), year and recommendation ID and exposes the appendix
headings.

Source URL:
https://meganorm.ru/mega_doc/dop1/8/spravochnaya_informatsiya_standarty_i_poryadki_okazaniya/2/klinicheskie_rekomendatsii_shizofreniya_odobreny_minzdravom.html

| Candidate | Type | Explicit source evidence | Extraction disposition |
| --- | --- | --- | --- |
| PANSS — Positive and Negative Syndrome Scale / Шкала оценки позитивных и негативных симптомов | scale | Appendix Г1; recommendation text also references PANSS for symptom assessment | accept for concept review; do not copy full form automatically |
| BNSS — Brief Negative Symptom Scale / Краткая шкала оценки негативных симптомов | scale | Appendix Г2; Russian-language psychometric publication is cited by the recommendation | accept for concept review; rights/version review required |
| Calgary Depression Scale for Schizophrenia | scale | Appendix Г3 and recommendation text reference | accept for concept review |
| PSP — Personal and Social Performance scale | scale | Appendix Г4 | accept for concept review |
| SAD PERSONS / шкала ургентной оценки суицидального риска | scale | Appendix Г5; recommendation identifies Patterson et al. source | accept for concept review; do not infer diagnostic value |
| C-SSRS — Columbia-Suicide Severity Rating Scale | structured assessment | Appendix Г6; recommendation names the original source and a Russian version | accept as external/restricted assessment candidate pending rights/version review |
| SAS — Simpson–Angus Scale for extrapyramidal symptoms | scale | Appendix Г7 and treatment text reference | accept for concept review |
| BFCRS — Bush–Francis Catatonia Rating Scale | scale | Appendix Г8; recommendation names Bush et al. validation publication | accept for concept review |

### Scanner implications

This recommendation is a useful stress corpus because several real instruments are exposed mainly as
appendix headings or acronyms. The deterministic scanner should be expected to recover them through a
combination of structural headings and the reviewed-name inventory; it should not need to copy the
instrument bodies to discover that the concepts exist.

## Neurology — ischemic stroke/TIA

Source: approved clinical recommendation **Ишемический инсульт и транзиторная ишемическая атака у
взрослых**, section 2.2 mirror.

Source URL:
https://sudact.ru/law/klinicheskie-rekomendatsii-ishemicheskii-insult-i-tranzitornaia-ishemicheskaia/klinicheskie-rekomendatsii/2/2.2-fizikalnoe-obsledovanie/

| Candidate | Type | Explicit source evidence | Extraction disposition |
| --- | --- | --- | --- |
| NIHSS — National Institutes of Health Stroke Scale | scale | Section 2.2 explicitly recommends NIHSS and points to Appendix Г1 | accept for concept review |
| Glasgow Coma Scale / Шкала комы Глазго | scale | Section 2.2 explicitly recommends GCS and points to Appendix Г7 | already implemented tool; use as known-inventory/source-link candidate |

The recommendation explicitly distinguishes the roles of these instruments from the rest of the
neurological examination. MiniMed should preserve the source locator rather than turning the mention
into an inferred diagnosis or treatment rule.

## Cognitive disorders in older adults

Sources:

- approved recommendation **Когнитивные расстройства у лиц пожилого и старческого возраста**,
  neuropsychological assessment section:
  https://sudact.ru/law/klinicheskie-rekomendatsii-kognitivnye-rasstroistva-u-lits-pozhilogo_1/klinicheskie-rekomendatsii/2/2.5/2.5.1/
- assessment appendix listing:
  https://sudact.ru/law/klinicheskie-rekomendatsii-kognitivnye-rasstroistva-u-lits-pozhilogo/klinicheskie-rekomendatsii/2_2/2.5-inye-diagnosticheskie-issledovaniia/

| Candidate | Type | Explicit source evidence | Extraction disposition |
| --- | --- | --- | --- |
| MMSE — Mini-Mental State Examination / Краткая шкала оценки психического статуса | scale | Recommended as a standard cognitive screening scale; Appendix Г1 | concept exists; keep external/restricted tool boundary |
| MoCA — Montreal Cognitive Assessment | scale | Recommended as a standard cognitive screening scale; Appendix Г2 | concept exists; keep external/restricted tool boundary |
| Modified Addenbrooke's Cognitive Examination | scale/battery | Appendix Г3 | accept for concept review |
| Mini-Cog, modified | assessment | Appendix Г4 | accept for concept review |
| Frontal Assessment Battery | assessment battery | Appendix Г5 | accept for concept review |
| Clock Drawing Test | test | Appendix Г6 | accept for concept review; scanner currently has no generic `test` candidate type |
| Free and Cued Selective Reminding Test | test | Appendix Г7 | accept for concept review; scanner gap |
| 5/12-word test | test | Appendix Г8 | accept for concept review; scanner gap |
| Verbal fluency / verbal-association methods | test | Appendix Г9 | accept for concept review; scanner gap |

The last four rows expose a real schema gap: MiniMed's current automatic candidate types are
`scale`, `questionnaire`, `criterion_set`, `classification`, and `severity_grade`. Generic
named tests/batteries should not be forced into `scale`; they need either an explicit `test` /
`assessment_method` concept type or a deliberate mapping during review.

## Geriatrics / depression-screening cross-links

The 2024 recommendation **Старческая астения** includes a large assessment appendix. Its listed
instruments include PHQ-2/PHQ-9, Cornell depression scale, Lawton IADL, Barthel, delirium assessment,
Morse fall scale, insomnia severity index, MMSE and MoCA.

Reference listing:
https://www.consultant.ru/document/cons_doc_LAW_478292/6e3b74e12dd38fa2dc87ae963cb86ba66d45b2a3/

This is useful as a cross-specialty source-mention set: when the same concept appears in psychiatry,
neurology and geriatrics, MiniMed should keep one stable concept identity with multiple reviewed
document links, not create duplicate entities by source.

## Extraction decisions

1. Add these names to the manual expected-name set for the next real-corpus psychiatry/neurology scan.
2. Prefer reviewed-name inventory matching for acronyms (PANSS, BNSS, PSP, C-SSRS, SAS, BFCRS,
   NIHSS, MMSE, MoCA) rather than broad acronym heuristics.
3. Add a dedicated generic named-test concept type only after checking existing knowledge-entity schema
   compatibility; do not silently label every `тест` mention as a scale.
4. Preserve one concept with many source-document links when the same instrument occurs in several
   recommendations.
5. Keep full copyrighted/restricted instrument material outside the redistributable pack unless rights
   are explicit. Source presence proves clinical relevance, not redistribution permission.

## Next extraction batch

Run the same source-backed pass over:

- depression/anxiety clinical recommendations;
- alcohol/substance-use recommendations;
- Parkinson disease and dementia recommendations;
- rehabilitation/stroke follow-up recommendations.

For each batch, record exact recommendation ID/version, source section/appendix, canonical instrument
name, aliases/acronyms, and whether MiniMed may redistribute the actual form or only expose an external
assessment/result shell.
