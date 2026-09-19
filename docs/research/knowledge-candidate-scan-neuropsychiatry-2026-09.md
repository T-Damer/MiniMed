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


## Batch 2 — depression, anxiety, addictions and Parkinson disease

This pass extends the same review-only queue. It intentionally records only instrument identity,
recommendation metadata and source location. It does not copy item text, answer choices, scoring keys,
stimuli or normative tables.

### Depressive episode / recurrent depressive disorder

Current source checked: Russian Ministry of Health clinical recommendation **«Депрессивный эпизод,
Рекуррентное депрессивное расстройство»**, approved 2024, adults, ID 301, revision due no later than
2026.

Recommendation mirror:
https://sudact.ru/law/klinicheskie-rekomendatsii-depressivnyi-epizod-rekurrentnoe-depressivnoe-rasstroistvo_1/klinicheskie-rekomendatsii/

The current appendix inventory explicitly contains:

| Candidate | Type | Source position | Extraction disposition |
| --- | --- | --- | --- |
| HDRS-17 / Hamilton Rating Scale for Depression | scale | Appendix Г1 | accept for concept review |
| MADRS / Montgomery-Asberg Depression Rating Scale | scale | Appendix Г2 | accept for concept review |
| HCL-33 hypomania questionnaire | questionnaire | Appendix Г3 | accept for concept review; Russian-version/rights check before any form redistribution |
| C-SSRS / Columbia-Suicide Severity Rating Scale | structured assessment | Appendix Г4 | merge with the same stable concept already found in schizophrenia; do not create a duplicate entity |

Appendix inventory:
https://sudact.ru/law/klinicheskie-rekomendatsii-depressivnyi-epizod-rekurrentnoe-depressivnoe-rasstroistvo_1/prilozhenie-g1-gn/

The same recommendation explicitly describes HDRS/MADRS as quantitative severity/dynamics tools, so
their source links should be kept distinct from the diagnostic criteria for F32/F33.

### Generalized anxiety disorder

Current source checked: clinical recommendation **«Генерализованное тревожное расстройство»**,
approved 2024, adults, registry ID 457, version 3, revision due no later than 2026.

Registry summary:
https://minzdrav.clinirec.ru/kr/generalizovannoe-trevozhnoe-rasstroystvo/

The appendix contains sixteen named instruments. The high-value discovery set is:

| Candidate | Type | Source position | Extraction disposition |
| --- | --- | --- | --- |
| HARS / Hamilton Anxiety Rating Scale | scale | Appendix Г1 | accept for concept review |
| GAD-7 / ГТР-7 | questionnaire | Appendix Г2 | accept for concept review |
| SCL-90-R | questionnaire | Appendix Г3 | accept for concept review; distribution rights/version review required |
| Integrative Anxiety Test (ИТТ) | assessment_method | Appendix Г4 | accept for concept review |
| STAI / Spielberger-Hanin anxiety inventory | questionnaire/scale | Appendix Г5 | accept; reviewer chooses stable type |
| BAI / Beck Anxiety Inventory | questionnaire/scale | Appendix Г6 | accept; rights/version review required |
| Sheehan Anxiety Scale | scale | Appendix Г7 | accept for concept review |
| MMPI | assessment_method | Appendix Г8 | external/restricted assessment candidate |
| ISTA / Ammon ego-structure test | assessment_method | Appendix Г9 | external/restricted assessment candidate |
| УСК / subjective-control method | assessment_method | Appendix Г10 | external/restricted assessment candidate |
| Personal Beliefs Test | questionnaire | Appendix Г11 | external/restricted assessment candidate |
| Life Style Index (LSI) | questionnaire | Appendix Г12 | external/restricted assessment candidate |
| Coping Strategies questionnaire (СПП) | questionnaire | Appendix Г13 | external/restricted assessment candidate |
| Melbourne Decision Making Questionnaire (MDMQ) | questionnaire | Appendix Г14 | external/restricted assessment candidate |
| KON-2006 | questionnaire | Appendix Г15 | external/restricted assessment candidate |
| КОП-25 treatment-adherence questionnaire | questionnaire | Appendix Г16 | accept for concept review |

Appendix inventory:
https://www.consultant.ru/document/cons_doc_LAW_486381/6e3b74e12dd38fa2dc87ae963cb86ba66d45b2a3/

This recommendation is a strong justification for the new `assessment_method` candidate type: MMPI,
ISTA and several experimental-psychology methods are not safely represented as ordinary symptom
scales.

### Alcohol-related disorders

Three current 2024 recommendations expose separate instrument families and should not be collapsed into
one generic “alcohol scale” concept.

1. **Alcohol withdrawal syndrome**, F10.3, ID 784, adults and children, revision due no later than 2026:
   - CIWA-Ar is the explicit withdrawal-severity scale.
   - Source:
     https://sudact.ru/law/klinicheskie-rekomendatsii-psikhicheskie-i-povedencheskie-rasstroistva-vyzvannye_7/klinicheskie-rekomendatsii/
   - Appendix:
     https://sudact.ru/law/klinicheskie-rekomendatsii-psikhicheskie-i-povedencheskie-rasstroistva-vyzvannye_1/prilozhenie-g/

2. **Harmful use of psychoactive substances**, current 2024 recommendation:
   - AUDIT is explicitly recommended for detecting harmful alcohol use.
   - Source section:
     https://sudact.ru/law/klinicheskie-rekomendatsii-psikhicheskie-i-povedencheskie-rasstroistva-vyzvannye_11/klinicheskie-rekomendatsii/2/2.5/

3. **Alcohol dependence syndrome**, F10.2, ID 899 version 1, 2024:
   - Naranjo causality algorithm is present as a medication-adverse-reaction tool and should not be
     misclassified as an alcohol-severity scale.
   - the recommendation also contains the Altschuler quantitative assessment of pathological alcohol
     craving; this should become a separate review candidate rather than an inferred synonym of AUDIT
     or CIWA-Ar.
   - Source:
     https://sudact.ru/law/klinicheskie-rekomendatsii-psikhicheskie-i-povedencheskie-rasstroistva-vyzvannye_15/klinicheskie-rekomendatsii_1/
   - Appendix:
     https://sudact.ru/law/klinicheskie-rekomendatsii-psikhicheskie-i-povedencheskie-rasstroistva-vyzvannye_3/prilozhenie-g/

A separate hepatology recommendation also names CAGE and AUDIT. Those are additional reviewed
source-document links to the same concepts, not new instrument identities.

### Parkinson disease

Registry/source checked: clinical recommendation **«Болезнь Паркинсона, вторичный паркинсонизм и
другие заболевания, проявляющиеся синдромом паркинсонизма»**, ID 716. The registry still lists the
2021 recommendation as applicable, but its own planned revision date was no later than 2023. MiniMed
must therefore retain an explicit freshness warning until a newer approved version appears in the
registry.

Current registry listing:
https://www.consultant.ru/document/cons_doc_LAW_519392/6061e48b39aeace5591b55d04ff553f9ee8405e7/

Confirmed candidates include:

| Candidate | Type | Source position | Extraction disposition |
| --- | --- | --- | --- |
| MDS-UPDRS | scale | Appendix Г1 | accept for concept review; rights/licensing review before form redistribution |
| Hoehn and Yahr scale | scale | within MDS-UPDRS appendix | accept for concept review |
| MMSE | scale | Appendix Г2 | merge with existing stable MMSE concept |
| MoCA | scale | Appendix Г3 | merge with existing stable MoCA concept; keep external/restricted boundary |
| HADS | questionnaire/scale | Appendix Г4 | accept; reviewer chooses stable type |

Appendix examples:
https://www.consultant.ru/document/cons_doc_LAW_408585/58aaa924fe26d7a1cdd02aee26c60531585e4fe1/
https://www.consultant.ru/document/cons_doc_LAW_408585/7e925fc25daa7ab125cef9ad580858558a4a3167/

### Cross-source identity rules reinforced by this batch

- C-SSRS now has reviewed source mentions in schizophrenia and depressive-disorder recommendations:
  one concept, multiple document links.
- MMSE/MoCA occur in cognitive-disorder and Parkinson recommendations: one concept each, multiple
  document links.
- AUDIT occurs in addiction and hepatology contexts: one concept with different clinical source
  contexts, not duplicate tools.
- CIWA-Ar, AUDIT and the Altschuler craving assessment measure different constructs and must remain
  separate concepts.
- Naranjo belongs to medication adverse-reaction causality despite appearing inside an alcohol
  recommendation.
- Recommendation year/version/freshness belongs in source-link metadata; it must not be inferred from
  the date MiniMed happened to ingest the document.

### Scanner change prompted by the corpus

The deterministic candidate vocabulary now includes `assessment_method` in addition to scales,
questionnaires, criterion sets, classifications and severity systems.

To avoid a large false-positive jump, generic body text containing «тест»/«методика» is not enough to
create an assessment-method candidate. This type is discovered only from a specific structural heading
or an exact reviewed-name inventory hit. Generic headings such as «Диагностические тесты» are rejected.

The same patch also carries forward the previously validated scanner cleanups from the dependent
assessment work: scale prose-tail cleanup, suppression of duplicate severity/classification candidates,
and preservation of explicitly reviewed surface variants.


## Batch 3 — bipolar disorder, OCD, panic disorder and PTSD

Checked against publicly indexed current recommendation metadata on 2026-09-19. As in the earlier
batches, this is an identity/source queue only: no item text, scoring keys, stimuli or normative tables
are copied into MiniMed.

### Bipolar affective disorder

Current recommendation: **«Биполярное аффективное расстройство»**, ID 675_2, revision 2, approved
2025, adults, revision due no later than 2027. The Ministry-hosted PDF identifies the 2025
recommendation; current clinical-recommendation indexes list it as active/applied.

Sources:

- https://apicr.minzdrav.gov.ru/api.ashx?id=675_2&op=GetClinrecPdf
- https://www.consultant.ru/document/cons_doc_LAW_510703/
- https://medvestnik.ru/cr/675_2.html

Confirmed appendix/source candidates:

| Candidate | Type | Source position | Extraction disposition |
| --- | --- | --- | --- |
| C-SSRS | structured assessment | Appendix Г1 | merge with the existing C-SSRS concept |
| HCL-32 | questionnaire | Appendix Г3 | new reviewed concept candidate |
| YMRS / Young Mania Rating Scale | scale | Appendix Г4 | new reviewed concept candidate |
| HAM-D-17 / HDRS-17 | scale | Appendix Г5 | merge with the depression-source concept |
| MADRS | scale | Appendix Г6 | merge with the depression-source concept |
| HCL-33 | questionnaire | later appendix | merge with the depression-source concept |

The recommendation itself explicitly recommends a validated Russian HCL-32 or HCL-33 for hypomania
screening in patients presenting with a depressive episode. That source context should be retained on
the document link rather than turned into a generic diagnostic rule.

### Obsessive-compulsive disorder

Current recommendation: **«Обсессивно-компульсивное расстройство»**, ID 650_2, approved 2025,
adults, revision due no later than 2027.

Sources:

- https://www.consultant.ru/document/cons_doc_LAW_503151/
- https://sudact.ru/law/klinicheskie-rekomendatsii-obsessivno-kompulsivnoe-rasstroistvo-odobreny-minzdravom-rossii/klinicheskie-rekomendatsii/

Confirmed candidates:

| Candidate | Type | Source position | Extraction disposition |
| --- | --- | --- | --- |
| FLY-BOCS / Florida Yale-Brown Obsessive Compulsive Scale | scale | Appendix Г1 | new reviewed concept candidate; rights/version review before any form redistribution |
| C-SSRS | structured assessment | Appendix Г2 | merge with the existing C-SSRS concept |

This is another concrete example where source links multiply but concept identity should not.

### Panic disorder

Current recommendation: **«Паническое расстройство»**, ID 456, version 3, approved 2024,
adults, revision due no later than 2026.

Sources:

- https://minzdrav.clinirec.ru/kr/panicheskoe-rasstroystvo/
- https://sudact.ru/law/klinicheskie-rekomendatsii-panicheskoe-rasstroistvo-odobreny-minzdravom-rossii/klinicheskie-rekomendatsii/2/2.5/

Confirmed named candidates include:

| Candidate | Type | Extraction disposition |
| --- | --- | --- |
| PDSS / Panic Disorder Severity Scale | scale | new reviewed concept candidate |
| Wayne/Veyn autonomic-change questionnaire/scale | questionnaire/scale | review identity and preferred canonical name |
| Panic Screening Questions / panic-attack screening questionnaire | questionnaire | new reviewed concept candidate |
| HARS | scale | merge with generalized-anxiety source concept |
| SCL-90-R | questionnaire | merge with generalized-anxiety source concept |
| Integrative Anxiety Test (ИТТ) | assessment_method | merge with generalized-anxiety source concept |
| STAI | questionnaire/scale | merge with generalized-anxiety source concept |
| BAI | questionnaire/scale | merge with generalized-anxiety source concept |
| Sheehan Anxiety Scale | scale | merge with generalized-anxiety source concept |

This recommendation is also a useful parser fixture because the text explicitly distinguishes
clinical rating scales from experimental/psychological methods. MiniMed should retain that distinction.

### Post-traumatic stress disorder

The publicly indexed current recommendation is still **«Посттравматическое стрессовое
расстройство»**, ID 753 / 753_1, approved 2023, adults. Its declared revision deadline was 2025.
Current legal/recommendation indexes still expose that 2023 recommendation as active/applied in
September 2026.

A 2025 public report from the Bekhterev National Medical Research Center said an update was being
finished and was planned for approval in early 2026, but this extraction pass did not find a newer
approved recommendation in the current public indexes. MiniMed must therefore keep a freshness warning
and must not synthesize a 2026 edition.

Sources:

- https://www.consultant.ru/document/cons_doc_LAW_519392/57e5b6d1fe0bf3adbf2b4cd7c7399fc1c3e7ce6e/
- https://sudact.ru/law/klinicheskie-rekomendatsii-posttravmaticheskoe-stressovoe-rasstroistvo-utv-minzdravom/klinicheskie-rekomendatsii/
- https://base.garant.ru/406526717/

Confirmed 2023 appendix candidates:

| Candidate | Type | Extraction disposition |
| --- | --- | --- |
| TSQ / Trauma Screening Questionnaire | questionnaire | new reviewed concept candidate |
| CAPS / Clinician-Administered PTSD Scale | assessment_method | new reviewed concept candidate |
| SCID, PTSD module | assessment_method | new reviewed concept candidate; exact edition/version required |
| IES-R / Impact of Event Scale-Revised | scale/questionnaire | new reviewed concept candidate |
| Mississippi Scale for post-traumatic reactions | scale | new reviewed concept candidate |
| CES / Combat Exposure Scale | scale | new reviewed concept candidate |
| Psychophysiological stress-reaction severity scale | scale | review canonical identity/source before promotion |
| Peritraumatic Dissociative Experiences Questionnaire | questionnaire | new reviewed concept candidate |
| DES / Dissociative Experiences Scale | scale | new reviewed concept candidate |
| BHS / Beck Hopelessness Scale | scale | new reviewed concept candidate |
| TOP-8 / Treatment Outcome PTSD Scale | questionnaire/scale | new reviewed concept candidate |

The PTSD set reinforces why redistributable concept metadata and redistributable instrument content are
different things. A recommendation naming an instrument is enough to create a review candidate and a
source link; it is not enough to copy the form.

## Batch 3 identity/freshness conclusions

- C-SSRS now occurs in schizophrenia, depressive-disorder, bipolar and OCD recommendations: one stable
  concept, at least four reviewed source-document contexts.
- HAM-D/HDRS and MADRS occur in depressive-disorder and bipolar recommendations: reuse identity.
- HARS, SCL-90-R, ИТТ, STAI, BAI and Sheehan recur across generalized anxiety and panic disorder:
  reuse identity while preserving the different source sections and populations.
- Recommendation freshness must be an explicit source property. Current 2025 BAR/OCD sources supersede
  their older editions; the 2023 PTSD recommendation is still publicly indexed but overdue for revision,
  so it needs a warning rather than an invented replacement.
- Scanner promotion should remain conservative for experimental/diagnostic interviews such as CAPS,
  SCID, MMPI and ISTA: `assessment_method` is preferable to forcing them into `scale`.


## Batch 4 — multiple sclerosis and current stroke instruments

### Multiple sclerosis

Current recommendation: **«Рассеянный склероз»**, ID 739_2, approved 2025, adults and children,
published 2025-07-03 and due for revision no later than 2027. This supersedes the non-current 2022
edition.

Sources:

- https://base.garant.ru/412284282/
- https://meganorm.ru/mega_doc/dop1/8/spravochnaya_informatsiya_standarty_i_poryadki_okazaniya/2/klinicheskie_rekomendatsii_rasseyannyy_skleroz_odobreny.html
- https://www.consultant.ru/document/cons_doc_LAW_509772/6e3b74e12dd38fa2dc87ae963cb86ba66d45b2a3/

Confirmed assessment candidates in the current recommendation:

| Candidate | Type | Source position | Extraction disposition |
| --- | --- | --- | --- |
| РШСИ / Expanded Disability Status Scale (EDSS) | scale | Appendix Г1 | stable concept candidate; current KR uses the validated Russian version |
| Berg Balance Scale | scale | Appendix Г2 | concept review candidate |
| FIM / Functional Independence Measure | scale | Appendix Г3 | concept review candidate; rights/version review before form redistribution |
| Nine-Hole Peg Test | assessment_method | Appendix Г4 | concept review candidate |
| Frenchay Arm Test | assessment_method | Appendix Г5 | concept review candidate |
| Rivermead Mobility Index | scale/index | Appendix Г6 | concept review candidate |
| SF-36 | questionnaire | Appendix Г7 | concept review candidate; licensing/version review required |

The current recommendation also carries source-backed diagnostic/clinical systems such as McDonald
criteria (2017 and 2010 variants), MAGNIMS MRI additions, and explicit relapse-severity criteria.
Those should be represented as `criterion_set` / classification concepts, not executable diagnostic
verdicts.

Important edition note: an older 2022 recommendation exposes a separately numbered EDSS appendix.
The 2025 recommendation is the source to link for current MiniMed discovery; the old edition should
remain only as historical provenance if retained at all.

### Ischemic stroke and transient ischemic attack

Current recommendation: **«Ишемический инсульт и транзиторная ишемическая атака»**, ID 814 /
814_1, approved 2024, adults and children, due for revision no later than 2026 and applicable from
2025-01-01.

Sources:

- https://www.consultant.ru/document/cons_doc_LAW_491652/
- https://base.garant.ru/410977224/
- https://sudact.ru/law/klinicheskie-rekomendatsii-ishemicheskii-insult-i-tranzitornaia-ishemicheskaia_1/klinicheskie-rekomendatsii/

Confirmed/reinforced candidates:

| Candidate | Type | Source evidence | Extraction disposition |
| --- | --- | --- | --- |
| NIHSS | scale | explicit neurological-deficit assessment; Appendix Г1 | merge with existing NIHSS concept |
| PedNIHSS | scale | pediatric stroke assessment; Appendix Г2 | separate pediatric variant/concept review |
| FOUR score | scale | consciousness assessment; Appendix Г8 | new concept candidate |
| Glasgow Coma Scale | scale | consciousness assessment; Appendix Г9 | merge with existing GCS concept |
| Pediatric Glasgow Coma Scale | scale | pediatric consciousness assessment; Appendix Г10 | variant/relation review rather than synonym by default |
| ASPECTS | scale | CT early-ischemic-change assessment; Appendix Г12 | new concept candidate |
| Modified Rankin Scale (mRS) | scale | repeatedly used for pre-stroke disability and outcome | new stable concept candidate |
| ABCD² | scale | used for high-risk TIA stratification | new stable concept candidate |

The recommendation uses several of these instruments together in treatment-selection conditions.
MiniMed extraction must keep them as source-backed concepts first; it must not convert co-occurrence in
a recommendation sentence into a new treatment rule unless that rule is separately modeled and
reviewed.

## Batch 4 extraction implications

- Current-edition resolution matters: 2025 MS must supersede the old 2022 source for discovery links.
- Pediatric variants such as PedNIHSS and pediatric GCS should not be auto-collapsed into the adult
  instrument merely because the names overlap.
- Named performance tests (Nine-Hole Peg Test, Frenchay Arm Test) validate the
  `assessment_method` type outside psychiatry.
- Diagnostic criteria (McDonald/MAGNIMS) and rating scales (EDSS/NIHSS) must stay different entity
  classes even when they are used in the same recommendation.


## Batch 5 — migraine source check and negative evidence

Current adult recommendation: **«Мигрень»**, ID 295, approved 2024, adults, due for revision no later
than 2026 and applicable from 2025-01-01.

Sources:

- https://base.garant.ru/410613100/
- https://base.garant.ru/410613100/7dede6ac8f25be619ed07c17ed1c62c9/
- https://www.consultant.ru/document/cons_doc_LAW_490921/

This pass confirms the **Visual Analogue Scale (VAS/ВАШ)** as a current source-backed scale and the
headache diary as a structured patient-observation method used to establish headache days and
analgesic-use days.

The existing MiniMed backlog also names MIDAS and HIT-6. This pass did **not** find either instrument in
the current adult 2024 recommendation's assessment appendix/text. An older Russian primary-care
standard mentions MIDAS, but that is a different, older source class and is not enough to claim that
MIDAS/HIT-6 are current-recommendation instruments.

Extraction decision:

- add VAS/ВАШ source linkage if not already represented;
- treat the headache diary as an `assessment_method`/structured observation candidate rather than a
  symptom scale;
- keep MIDAS and HIT-6 in backlog pending a separately verified current source; do not manufacture a
  link to KR ID 295.
