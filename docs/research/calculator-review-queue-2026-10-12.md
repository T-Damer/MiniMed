# Calculator review queue — MedSolutions gap batch (2026-10-12)

The ~160 calculators added on 2026-10-12 (STATE CALC-ALL) were rebuilt from primary publications or current
Russian clinical recommendations. The MedSolutions «Справочник врача» database
(`data/raw/medsolutions-spravochnik-vracha/databases/mes.sqlite`) was used only as a list of what was missing
and as a cross-check. This file lists what a clinician should still look at: items whose numbers were read
from abstracts or secondary sources, open decisions, and what was left out.

## Verified (2026-10-13, STATE CALCV)

Owner 2026-10-13 «data with quality problems — fix it»: every item of the former «Read from secondary sources or
abstracts only» table was re-read against a primary text, an official document, or the best open reproduction.
Worked examples from the publications (or hand-computed from the published table, arithmetic in the comments) live in
`apps/app/src/features/calculators/*-primary-source*.test.ts`. Tool records that changed carry the patch version
`1.0.1` and modules the next `preview.2`.

### A. Checked against the primary full text or an official document

| Tool | Source actually read | Result |
| --- | --- | --- |
| CRUSADE | Subherwal 2009, Circulation 119:1873 (PMC3767035, Table 4, Fig. 2) | all point ranges, bands ≤20 / 21–30 / 31–40 / 41–50 / >50 and rates 3.1 / 5.5 / 8.6 / 11.9 / 19.5 % match |
| Rockall (complete) | Rockall 1996, Gut 38:316 (PMC1383057, Tables II–IV) | items, points (max 11 / 7 before endoscopy) and rebleeding / mortality per score match; pre-endoscopy mortality added |
| ARISCAT | Canet 2010, Anesthesiology 113:1338 (Tables 6, 7) | points and cut-offs identical; published PPC rates added (0.7 / 6.3 / 44.9 % development, 1.6 / 13.3 / 42.1 % validation); derivation-cohort limitation corrected |
| RECIST 1.1 | Eisenhauer 2009, Eur J Cancer 45:228 (EORTC PDF, §4.3, Table 1) | unchanged; NE row and CR-then-recurrence not modelled |
| SLEDAI-2K | Gladman 2002, J Rheumatol 29:288 (Table 2) + КР 484_2 | 24 descriptors, weights, 10-day window match; «>2 joints» wording → «two or more», «persistent» wording for rash, alopecia, mucosal ulcers, proteinuria |
| SCORE2 (<70 y) | SCORE2 paper (PMC8248998) + coefficient table, Eur Heart J 2022;43:241 | baseline survival, coefficients, centring and all 8 region scales match; paper's own example reproduces; categories match ESC 2021 Table 5 |
| MELD-Na | Kim 2021 (PMC8608337), Kim 2008 (PMC4374557), OPTN 2016 policy 9.1.D | schema implements the OPTN 2016 variant (+1.32·(137−Na) − 0.033·MELD·(137−Na), Na 125–137), which is NOT the Kim 2008 equation; re-sourced and described accordingly; cap 40 holds for the final value; CVVHD rule added |
| WHO 2023 malnutrition | WHO guideline on wasting and nutritional oedema 2023 (IRIS PDF, §1.2.2–1.4) | WHZ −3 / −2, MUAC 115 / 125 mm (6–59 months), oedema = severe: unchanged |
| NIHSS | Russian КР «Ишемический инсульт и ТИА» 2024 (ID 814), full NIHSS appendix; КР 523 | 15 lines, max 42, bands 1–4 / 5–15 / 16–20 / 21–42 match; untestable (UN) items still entered as 0 (documented limitation) |
| Hunt–Hess | КР «Геморрагический инсульт» 2025 (ID 523), appendix Г1 | stages and one-grade shift match; grade II label «умеренная или сильная головная боль» |
| ASIA (AIS A–E) | Kirshblum 2011, J Spinal Cord Med 34:535 (PMC3232636) | sacral-sparing / «three levels» / «half of key muscles» rules match |
| Rivermead Mobility Index | КР 814 appendix Г6 (15 questions) + PMC2169252 | 15 items, scoring 0–15, no bands: unchanged |
| ВПХ-СП, -СГ, -СС, -У(Л), -ЭХ | «Указания по военно-полевой хирургии» МО РФ 2013 (tables 1–3, 8–11, 4.3) + ГВМУ 2022 methodical recommendations | rows, points, bands and mortality match; table 4.4 differs from 4.3 (4.3 used, stated); overlaps/gaps documented. ВПХ-У(Л): 20 → 90 % band |
| Harris–Benedict | Harris & Benedict, Carnegie Publication 279 (1919), archive.org full text | constants match (label 1918 → 1919, monograph added); Mifflin–St Jeor from the 1990 abstract |
| HOMA-IR, Matsuda thresholds | Russian diabetes algorithms 12th ed. (Dedov 2025), insulin-resistance table | HOMA-IR <3.2 children / <2.77 adults; Matsuda >2.6 / >3.4; formulas match; the algorithms cite no origin for the thresholds (stated) |
| Calvert cap | Calvert 1989 abstract; Praiss 2023, NRG Oncology, Gynecol Oncol 174:213 (PMC10330633) | the 125 mL/min cap is the NCI/CTEP October 2010 guidance and GOG/NCCN 2011, not Calvert; stated as a convention; GOG minimum creatinine and adjusted weight not applied (stated) |

### B. Checked against open full-text reproductions (primary paper paywalled or bot-blocked)

| Tool | Reproduction used | Result |
| --- | --- | --- |
| Wells DVT | NICE CG144 App. C Table 1 (adapted from Wells 2003), abstracts Wells 1997/2003/2006 | ten items unchanged; «not less than 3 cm»; pooled DVT prevalence 5.0 / 17 / 53 % added (Wells 2006 JAMA); limitations: 1997 model had no previous-DVT item, 3-tier cut-points not seen in the 1997 full text |
| Padua | Barbar 2010 abstract + two tables adapted from the paper | 11 items, weights, ≥4 high risk, 0.3 / 11.0 / 2.2 %: unchanged |
| TIMI STEMI | timi.org calculator, MSD, Wikidoc, ACC summary, Morrow 2000 abstract | nine items and 0.8…35.9 % unchanged; age-75 boundary (≥75 vs >75) differs between reproductions, schema scores 75 as 3 |
| NYHA | NYHA 9th ed. (1994) text as reproduced in three protocol appendices | labels now carry «anginal pain»; class IV wording corrected |
| CCS angina | Campeau 1976 table as in Can J Cardiol 2009 (PMC2723031) + Campeau 2002 abstract | class II thresholds (uphill, after waking, >2 blocks / >1 flight) added |
| Mehran | original figure reprinted in PMC3711663 + abstract | items, bands ≤5 / 6–10 / 11–15 / ≥16, CIN 7.5 / 14.0 / 26.1 / 57.3 %, dialysis 0.04 / 0.12 / 1.09 / 12.6 % confirmed |
| CEAP, CEAP extended | CEAP 2020 update as in PMC10927428 and the Russian КР «Варикозное расширение вен» 2024 | 2020 additions (C2r, C4c, C6r, Esi, Ese; extended: 2020 segment abbreviations, Ret, AASV) |
| ХАН (Фонтейн, Покровский, Резерфорд) | КР 2025 «Хроническая ишемия… ПХ» Table 4, КР КИНК 2026, Hardman 2014, PARC | mapping unchanged; Rutherford 5/6 wording per Rutherford's own definitions, Pokrovsky IIa/IIb distances, «unsuitable in diabetes» caveat |
| APACHE II | Knaus 1985 scoring form (unict Allegato 3), MSD, SFAR | 12 rows, age, chronic health, GCS, ARF rule unchanged; A-aDO₂ formula convention (PaCO₂/0.8 vs R = 1) and secondary mortality bands stated in limitations |
| MPM II admission, 24 h, 48 h | Serrano 2000, Med Intensiva 24:49 (Tables 7, 8, worked examples), Arabi 2002 appendix | admission constant, age and 14 coefficients; 24 h / 48 h constants −5.64592 / −5.39153; both worked examples reproduce (logit 0.15143, 0.00048, 0.25487) |
| RASS, Ramsay | Sessler 2002 table in PMC9358336 / PMC8759207; Ramsay's own PMC1317048 | RASS +4 / +3 / +2 descriptors aligned; Ramsay unchanged |
| ISTH overt DIC, SOFA, MEWS | PMC5011102, PMC4057033; Lambden 2019 PMC6880479 (Table 1); PMC8132807, PMC6526008 + abstracts | scoring unchanged; undefined edge values (ISTH 100 / 3 / 6 / 1.0, MEWS SBP 70 / HR 40, 130 / RR 30, SOFA MAP 70 / platelets 150) take the ≥ / higher-score reading, now stated; SOFA has no 342 µmol/L threshold |
| PSI / PORT | Fine 1997 abstract, points table PMC11153623 / PMC7135093, IDSA 2000 (PMC7109923) | class IV mortality 8,5–9,3 → **8,2–9,3 %** (the 8,5 came from КР 654_2); IDSA source added |
| SMART-COP | Charles 2008 abstract, PMC7126707, PMC13219718 | items, points, age-specific thresholds unchanged; risk proportions come from review wording |
| POSSUM / P-POSSUM | PMC4541674 (Copeland 1991 tables + equations), Prytherch 1998 abstract | all variables and the three equations unchanged; WBC exactly 4.0 is printed in two rows (schema: 1 point) |
| Mannheim | PMC10578822, JCDR 2020;14(6):PC09, Billing 1994 abstract | items, points, classes (2.3 / 22.5 / 59.1 %) unchanged; organ-failure tooltip adds urea >16.7 mmol/L and complete obstruction |
| Caprini | Gould 2012 (ACCP, PMC3278061 Table 7), PMC11025444 | weights and ACCP bands unchanged; limitation: the app's bands are the ACCP adaptation |
| МНОАР | anest-rean.ru, medsoftpro.ru, lecture slides | rungs, +1 for emergency, classes unchanged (1989 publication not found online) |
| Evans | PMC3038406, PMC5582395 | 1 + 1 mL/kg/% and 2000 mL glucose unchanged; «half in 8 h» added; no area/volume cap in any source, none added |
| Morse | PMC13149994 (VHA study Table 3), AHRQ levels | six items, 25/15/0-15-30/20/0-10-20/15, 0–24 / 25–44 / ≥45: unchanged |
| Hoehn–Yahr (modified) | Goetz 2004 table as in PMC5676002 | stages 0–5 incl. 1.5 / 2.5 unchanged |
| Karnofsky | PMC3837542 (table of the 1948 scale) | ten levels and groups unchanged |
| Kérdő | КР «Миопия» 109, medi.ru | formula (1 − DBP/HR)·100 and sign reading unchanged |
| Ruffier | HFJC 2014 Table 1, PMC7473550, PMC5154562, Russian teaching paper | formula and bands unchanged; limitations: Russian protocol P₂ at 45–60 s, Dickson index is a different formula |
| Zung SDS / SAS | PMC10818784, PMC10451887 (items), Dunstan & Scott 2018 / 2020 (PMC5828114, PMC7048044) | reverse items, raw 20–80, index = raw/80·100, cut-offs on raw sums (SDS 40 / 48 / 56; SAS 36 / 40) match: no «index applied to raw sums» error |
| Lille | Louvet 2007 abstract + four reproductions (PMC4015369, PMC4509754, PMC4081674, PMC7043083) | equation, units, 0.45 unchanged; unsupported «development cohort» claim dropped; creatinine >115 vs ≥115 differs between sources (> kept) |
| SLICC/ACR DI | SLICC form + glossary (PhenX PX171001), КР 484_2 appendix Г3 | 41 items, ESRD rule, max 47: unchanged (the index paper is Gladman 1996) |
| NAFLD fibrosis score | Angulo 2007 abstract, three PMC reproductions, КР 748_2 | formula and cut-offs −1.455 / 0.676 unchanged; the impaired-fasting-glucose definition (≥5.6 mmol/L) not confirmed |
| Burch–Wartofsky | four open reproductions (PMC10792856, PMC12332481, PMC10599096, PMC11108650) | unchanged; two reproductions print heart rate «99–109» for the first band, evidently a typo for 90–109 |

### C. Still not verified

| Tool | What is missing |
| --- | --- |
| Pusajó relaparotomy index | Pusajó 1993 (Arch Surg 128:218) paywalled, no open table; the schema follows the Moscow 2017 instruction; secondary descriptions give other thresholds (limitation lists them) |
| Ranson | non-gallstone criteria confirmed (Ann Surg 1979, PMC1397201); gallstone set and mortality per score only in secondary pages |
| TRISS | MTOS 1995 constants agree with four open reproductions, Boyd 1987 / Champion 1990 / Schluter 2010 full texts not reachable (the schema uses the 1995 set, now stated) |
| SCORE2-OP | Table 2 coefficients confirmed in the paper; baseline survival, mean offsets and region scales are in the supplement (CAPTCHA); they agree with the CRAN package RiskScorescvd and a third implementation |
| MPM II 72 h | the 72 h constant −5.23840 appears in no readable reproduction (disclosed) |
| Nitrogen balance | Blackburn 1977 not accessible; +4 g is the standard form in OA papers, some sources use a 2 g total (limitation) |
| Goldman, Detsky | Goldman 1977 and Detsky 1986 full texts unreachable; weights agree with abstracts and table reproductions |
| ВПХ-У(Л) CK-MB unit | both official documents print «12,5 ммоль/л» for CK-MB, which is physiologically implausible; no primary source found |
| Hoehn–Yahr original (1967), Karnofsky 1949, Kérdő 1966, Collen 1991 | originals not online; reproductions agree |
| Wells DVT 3-tier cut-points | Wells 1997 full text not seen |

### CEAP and ХАН: keep or drop (decision)

All three tools are **kept**. They are classifications, not calculators, but each is a faithful, checked lookup that
Russian documents quote side by side (КР «Варикозное расширение вен» 2024 uses CEAP basic and advanced; КР 2025 and КИНК
2026 give Фонтейн / Покровский / Резерфорд in one table), and a doctor filling in an ambulatory record needs the exact
class wording. CEAP (basic) is a subset of CEAP extended, but the КР's basic form is the one printed in the record
template, so removing it would only move work to the user; no result history depends on it. If the catalog is ever pruned,
CEAP extended and ХАН are the first to move to a «Классификации» section (the schema has no string concatenation, so
neither can output the composed CEAP string). A future «reference» tool kind would fit them better than a calculator.

## Open decisions

- **Licences:** Zung SDS/SAS, Barthel (paraphrased wording), Rivermead, PAINAD, FINDRISC, BASDAI/BASFI — no explicit
  reuse licence found; item wording is our own paraphrase with attribution. Decide before the repo stays public.
- **Assessment section:** Zung SDS/SAS and HAM-D sit in the `self-reflection` section; a «Депрессия и тревога»
  section would fit better.
- **Goeke–Savelyeva gestosis score:** historical (not in the 2021/2024 preeclampsia КР); can be added with a
  «historical» limitation from secondary sources if wanted.

## Not added

- **Licensed or restricted:** MMSE, Beck BDI/BAI, FIM, Cattell 16PF, Rorschach, MoCA, GMFCS, MACS, PPS table,
  EDSS (Neurostatus), CAT (verbatim-only terms), IIEF-5, GerdQ, Lazarus coping test, PARI.
- **Not published / not reproducible:** FRAX, GRACE 2.0, Hubei lethality index, effective radiation dose (needs МУ
  2.6.1.2944-11 tables).
- **No verifiable primary source:** CPIS (variants disagree), non-overt DIC, fluid balance, Zhejiang COVID
  classification, SAMAMA, Petrussa, Finnegan, Krebs/Fischer CTG, VDI, CARO, NSS, clock drawing, ШОКС, rabies
  schedule, «Bidway» (no such instrument found).
- **Unsafe or obsolete:** Clark/Young paediatric dose rules.
- **Not a calculator:** IGF-1 (reference table), WHO MEC contraception table, infant-formula choice (vendor),
  paediatric carbohydrate «compensation» (dropped from current КР 287_3).

## MedSolutions errors found (primary source followed)

GRACE in-hospital points (ST deviation and markers overweighted), HEART troponin and age bands, PESI and
SAMe-TT₂R₂ cut-offs, DAPT missing the paclitaxel-stent point, Mehran eGFR table, EuroSCORE II diabetes and renal
categories, Goldman urea units (mmol/L for mg/dL), ARISCAT and Morse bands, SATS missing an AVPU item,
Friedewald triglyceride limit and outdated LDL goals, adrenal washout cut-off, nodule doubling-time
probabilities, testosterone unit slip, Zung index applied to raw sums, LAMS threshold, CDAI and Maddrey
citations, Maddrey bilirubin conversion, NEWS2 SpO₂ scale 2, Lung Injury Score bands, SOFA boundaries.
