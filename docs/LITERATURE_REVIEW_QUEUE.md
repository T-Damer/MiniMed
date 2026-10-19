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

### Feeding norms module — disagreements between the books (2026-10-13)

`minimed.reference.feeding.ru` publishes the values exactly as printed and lists every disagreement in its
document «Источники, расхождения и проблемы». **Decision needed** (clinician): which book a calculator
should follow where they differ — kcal/kg by quarter of the year (Почивалов 120–125, 120–115, 115–110,
100–105) vs 115 and 110 (Программа 2019, Капитан); daily volume cap (Программа 850/900/1000 мл, Капитан 1 л
and «may exceed 1 L», workbook 1000 мл); share of calories per meal for children over one year (Почивалов
2014 vs 2021); vitamin D prophylaxis 1000 МЕ (Программа 2019, табл. 10.4) vs 400 МЕ (`PITANIE.pdf`); niacin of
7–12-month-olds 4 mg (workbook) vs 7 mg (Программа 2019, прил. 1); zinc 7 vs 4 mg, magnesium 50 vs 55 mg and
iodine of Капитан табл. 16.4 vs Программа 2019 прил. 1. The calculators keep each method as a separate
output and do not merge them.

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


### `ПДБ/ПроцентильМЖ.pdf` — no bibliographic source captured

The OCR draft (`data/intermediate/replicate-ocr/pdb.procentil-mzh.ocr-draft.json`) contains real centile
tables for length/height, chest circumference, and head circumference, separately for boys and girls, by
month/year. Nothing in the extracted text names a publisher, author, edition, or year — the filename alone
is not a citable source under the [CALCULATORS.md](CALCULATORS.md) source contract. **Decision needed**:
identify which textbook/standard this table was scanned from (check the physical/PDF file's own cover or
ask whoever originally saved it) before it can back any shipped calculator.

### `ПДБ/ПроцентильМЖ.pdf` — two different norm systems, not reconciled

The same file also contains a σ (standard-deviation / "sigma method") growth classification distinct from
the WHO SDS/percentile system already reference-carded in `who-child-growth-standards.md`: cutoffs are
±1σ = average, ±1–2σ = below/above average, ±2–3σ = low/high, beyond ±3σ = dwarfism/gigantism — a
different framing than WHO's +1/+2/+3 SDS overweight-risk bands (different purpose: this one classifies
height/stature, WHO's is BMI/weight-for-age risk). **Decision needed**: does the z-score/percentile
calculator implement WHO only, the σ-method only, or both as separate tools — and if the σ-method ships,
it needs its own source citation (see above) since it is a distinct claim from the WHO card.

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

### `ПДБ/ПроцентильМЖ.pdf` — stray empty 8th table column

Every extracted table (length, mass, chest, head) has 7 real centile columns (3/10/25/50/75/90/97 %) plus
a trailing empty 8th column in the OCR output. Likely a table-boundary artifact from the source scan
rather than real data, but not verified against the original page image. **Decision needed**: confirm
against the source PDF page before treating the 7-column reading as final.

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
