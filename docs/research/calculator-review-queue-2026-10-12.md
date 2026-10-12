# Calculator review queue — MedSolutions gap batch (2026-10-12)

The ~160 calculators added on 2026-10-12 (STATE CALC-ALL) were rebuilt from primary publications or current
Russian clinical recommendations. The MedSolutions «Справочник врача» database
(`data/raw/medsolutions-spravochnik-vracha/databases/mes.sqlite`) was used only as a list of what was missing
and as a cross-check. This file lists what a clinician should still look at: items whose numbers were read
from abstracts or secondary sources, open decisions, and what was left out.

## Read from secondary sources or abstracts only

| Module | Tool | What to verify |
| --- | --- | --- |
| cardiology | Wells DVT, Padua, CRUSADE, TIMI STEMI | item lists / point tables / mortality vs full text |
| cardiology | NYHA, CCS | class wording |
| cardiology | SCORE2-OP | baseline survival, mean offsets and region scales (supplement not accessed; 3 independent implementations agree) |
| cardiology | Mehran | dialysis rates and the 14.0 / 26.1 % CIN rates |
| cardiology | CEAP, ХАН (Фонтейн, Покровский, Резерфорд) | abstract/MedSolutions-level only — keep or drop |
| intensive-care | APACHE II | mortality-by-score bands (MSD Manual), A-aDO₂ definition |
| intensive-care | MPM II | coefficients checked against SFAR pages, papers paywalled |
| intensive-care | Nitrogen balance | +4 g constant from recall (Blackburn 1977 has no abstract) |
| intensive-care | Ramsay, RASS | level wording |
| intensive-care | ISTH overt DIC, SOFA bilirubin, MEWS | boundary choices at exactly 100 / 20 µmol/L / HR 40 and 130 |
| surgery-trauma | POSSUM / P-POSSUM, Mannheim, Pusajó, Ranson, Goldman, Detsky, ARISCAT, Caprini, Rockall, МНОАР, Evans, Morse | original papers not read in full |
| surgery-trauma | TRISS penetrating coefficients | one secondary page |
| surgery-trauma | ВПХ scales | gaps/overlaps in printed intervals resolved to the worse band; CK-MB unit |
| neurology-rehab | NIHSS | item wording (NIH PDF blocked), untestable items entered as 0 |
| neurology-rehab | Hunt–Hess, modified Hoehn–Yahr, ASIA 2011 steps, Karnofsky, Rivermead, Kérdő, Ruffier, Zung | secondary wording and bands |
| metabolic-lab | HOMA-IR / Matsuda thresholds | Russian diabetes algorithms cite no origin |
| metabolic-lab | Burch–Wartofsky, Harris–Benedict constants | open reproductions |
| pulmonology | PSI item points, SMART-COP thresholds and risk proportions | WikEM / MSD / КР tables |
| rheum-gi-onco-uro | Lille coefficients and renal-insufficiency definition, SLICC item list, RECIST response table, NAFLD fibrosis formula, SLEDAI-2K wording | secondary |
| rheum-gi-onco-uro | Calvert GFR cap 125 mL/min | protocol convention, offered as an explicit toggle |
| rheum-gi-onco-uro | MELD-Na cap at 40 | not confirmed |
| obstetrics | WHO 2023 malnutrition thresholds | UNICEF–WHO briefing note (IRIS blocked) |

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
