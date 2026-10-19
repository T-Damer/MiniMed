# Literature review queue

Working queue of anything found in OCR drafts or private-library extraction that needs a human decision
before it can inform published content — a wrong number, an ambiguous OCR read, an unverifiable claim, or
a source-attribution question. This is not a content pack and nothing here is published; see
[LITERATURE_BANK.md](LITERATURE_BANK.md) for the source classification and OCR pipeline this queue draws
from.

Each entry: what was found, why it is questionable, and what a reviewer needs to decide. Remove an entry
once it has been resolved (accepted, corrected, or rejected) — do not mark it done in place, since a
resolved queue item has no further reason to stay in a review queue.

## Open items

### Feeding norms module — disagreements between the books (resolved 2026-10-19)

Owner 2026-10-19: follow the latest official documents. The module still prints every book as written; its
document «Источники, расхождения и проблемы» now has «Какие значения действуют сейчас», and the pediatrics
calculators follow it: energy 115/115/110 ккал/кг to one year and 1300 ккал/сут for 1–3 years
(МР 2.3.1.0253-21, which supersedes МР 2.3.1.2432-08); volume caps 850/900/1000 мл (Программа 2019, kept in
the 2024 draft); vitamin D 500 МЕ (to 1 mo), 500–1000 МЕ (1–12 mo), 1000–2000 МЕ (1–18 y) per the КР
«Недостаточность витамина D. Рахит» (ред. 24.08.2024); niacin 7 mg, zinc 3/4 mg, magnesium 55/60/70 mg, iodine
70 мкг (МР 2021); meal shares per СанПиН 2.3/2.4.3590-20 (default in the 1–3-year calculator; the textbook
editions stay selectable). Open: the vitamin D guideline's registry entry was not seen (the PDF says «Год
утверждения: 202_»); the 4th edition of the feeding programme is a 2024 draft.

### Feeding norms module — rights and provenance of the private books (2026-10-13)

The texts are published for personal use while the repository is public (owner decision 2026-10-13); the
books' rights are not cleared (`rightsStatus: personal-library-private-use`). **Decided (owner 2026-10-19):**
MiniMed is a personal project with no global release, so the book text stays; revisit only if that changes. `PITANIE.pdf`
is a student summary of unknown authorship (created 2022-06-04, cites 2021–2022 teaching manuals without
titles); only its regime table, the newborn volume formulas and the hypogalactia degrees (also in Почивалов)
were used — confirm the regime table against a textbook.

### Feeding norms module — OCR and scan defects (2026-10-13)

Почивалов 2014/2021 text layers contain OCR errors in formulas (marked in the module); the Kapitan OCR draft
(`data/intermediate/replicate-ocr/pdb.kapitan.merged.ocr-draft.json`) has a wrong worked example («1/8 … 650
мл» for the scan's «1/6 … 866 мл») — only pp. 458–461 were transcribed, by eye from the page images.
Почивалов 2021 table 3 (monthly gain of preterm infants) and the sample-day table of `PITANIE.pdf` were not
carried because the text layer lost the cell grouping. **Decision needed**: whether to transcribe them from
the images; Kapitan tables 16.5–16.7 (complementary schedules by RF rules and WHO) are also not carried.

### `ПДБ/ПроцентильМЖ.pdf` — closed 2026-10-19: replaced by WHO standards, not used

Owner 2026-10-19: use official / high-ranked sources instead. Length/height, weight, BMI, head and arm
circumference are already covered by the WHO Child Growth Standards 2006 (0–5 y) and WHO Growth Reference
2007 (5–19 y) LMS tables in `minimed.calculator.pediatric-anthropometry-who`, with z-score bands per
indicator; Russian guidance names SDS on WHO standards (KR «Ожирение у детей», ID 229: «С учетом
рекомендаций ВОЗ … +2,0 SDS ИМТ»). The σ-method bands are textbook practice, not current guidance, and are
not shipped. Chest circumference has no WHO or other official reference and is not implemented. The
unidentified file is not extracted; its OCR-only problems (source, the empty 8th column) no longer matter.

### `ПДБ/pochivalov-_db_uchebnik.pdf` — large multi-table book, only automated-checked

272 pages, 257 tables detected by heuristic, 124 dose-per-kg (мг/кг, мкг/кг, г/кг, Ед/кг) mentions. No
garbled-text/replacement-character runs found, and the earlier 5-page bake-off already hand-verified one
representative dosing table (insulin pharmacokinetics) from this same book at full fidelity — but the
other 256 tables and 123 dose mentions were only automated-scanned, not read by a person. One concrete
formatting artifact found: a dose split across a line break, `10\n\nмг/кг`, in the raw markdown — the
number and its unit landed in separate lines with a blank line between them, which a careless downstream
read could silently drop. **Decision needed**: this book should not back any calculator or dosing claim
until a clinician has spot-checked at least the dosing-adjacent tables directly against the source scan,
consistent with the existing "model may not calculate a patient dose" safety contract in
[TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

### `ПДБ/PDB_Kapitan_n.pdf` — large multi-table book, only automated-checked

458 pages (split into 4 chunks for upload, merged back with page-range markers — see
[LITERATURE_BANK.md](LITERATURE_BANK.md)), 1036 tables detected by heuristic across the 4 parts. No
garbled-text corruption found, but not read by a person. Part 4 (pages 346-458) is a renal-system chapter
dense with normative lab values (urinalysis, Нечипоренко/Амбюрже/Зимницкий/Аддис-Каковский methods) — high
priority to review first given the pediatric-norms goal. **Decision needed**: same as pochivalov above —
no numeric value from this book backs a calculator or clinical claim until a clinician has spot-checked it
against the source scan.

### `neo.shabalov.ocr-draft.json` — Fenton chart missing numeric data (requires OCR source recovery)

`data/intermediate/replicate-ocr/neo.shabalov.ocr-draft.json` (Шабалов, неонатология, глава 8) contains references to
`Таблица 8.1` and `Рис. 8.1` (Fenton I.R., 2002), but the OCR only provides descriptive text around the Fenton chart and
no machine-readable point table of per-centile values. The existing table is Demентьева `Таблица 8.1`, with incompatible target
format for Fenton/INTERGROWTH percentile logic.
**Decision needed**: source one authoritative Fenton/INTERGROWTH extraction with explicit percentiles by week (3/10/50/90/97) before adding or revising any prematurity growth tool.
Targeted Qwen extraction for `391,395–404,406–409,411–450` is now available in `/tmp/minimed-ocr-qwen-neon` (per-page `qwen-neon-*.json`) and is awaiting manual table normalization + verification for the final numeric grid format (3/10/50/90/97 per centile-by-week and sex split).

### `neo.shabalov.ocr-draft.json` — neonatal laboratory references not machine-readable (requires OCR)

`data/intermediate/replicate-ocr/neo.shabalov.ocr-draft.json` (Шабалов, неонатология, главы 9–10) contains mentions of laboratory/biochemical markers in text, but no validated extraction of a complete, machine-readable reference-range block for neonatal norms.
**Decision needed**: extraction artifacts were expanded to `411–450` and `504–510` pages via Qwen-local and are now present as per-page outputs; finalize by hand-validating and normalizing age-specific neonatal lab-reference tables before shipping any lab-reference calculator.
