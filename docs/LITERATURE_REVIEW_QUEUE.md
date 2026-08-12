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
