# OCR'd ГРЛС instructions: audit by a Haiku swarm — 2026-11-06 (STATE FIX-BATCH2)

Owner request (2026-11-06): look at the instructions whose text came from OCR, group the damage by
cause, fix the causes in the preparer, rebuild, spot-check.

## Method

- **Population.** Every OCR text of the ГРЛС instruction modules: the 2 306 documents of the OCR1
  overlay (`data/build/grls-ocr-quality.jsonl`, workspace `grls-ocr-cleaned`).
- **Deterministic screen** (7.8 M characters is too much to read): suspect spans by kind, with their
  document, section and line — « | » cell separators in 2 128 documents, headings met in one document
  only in 1 808, low-confidence blocks (< 0.5) in 1 853, a word with glued digits in 388, Markdown
  characters in 206, runs of short lines in 108, line-end hyphens in 38, Latin next to Cyrillic in 107.
- **Seven Claude Haiku agents**, one sample file each (≈70 000 characters, 120–260 entries with ±2–5
  lines of context), classified every entry into a fixed set of damage kinds and proposed a
  deterministic fix or «needs a human». Findings stayed local (session scratch), not in git.

## What they found

| sample | entries | main kinds |
| --- | ---: | --- |
| « \| » lines (two agents) | 240 | broken table 123, table fine line by line 34, « \| » inside prose 29, two page columns mixed 21, stamp/signature 20, OCR misread 11 |
| rare headings | 260 | stamp/requisites/page header 108, sentence promoted to heading 65, table cell/row 29, real heading 40, split heading 10, misread 8 |
| low confidence | 160 | readable and right 78, stamp/signature 29, misread 22, broken table 22, noise 7 |
| glued digits | 160 | OCR misread 103 (73 × «СУРЗА4» for CYP3A4, other CYP and ATC codes), legitimate 48 (ЦОГ1, ОАТ3), footnote mark 7 |
| Markdown / mixed script | 180 | footnote «*» and a leading «>» (the reader shows both literally: no defect), look-alike Latin in Russian words 69 |
| short lines / hyphens | 160 | a table held cell by cell 102, a real short-line list 48, two columns mixed 10 |

Grouped by cause:

1. **Headings that are not section titles** — registry stamps and requisites («08103m90 • ОГРН …»),
   the registration number printed as a page header («ЛП-№(000577)-(РГ-RU)-160222»), ministry approval
   stamps, table rows and sentences starting in lower case, and running page headers (the trade name or
   an all-capitals line on every page). They became sections and filled the contents.
2. **Drug codes spelled with Cyrillic look-alikes** — CYP and ATC codes (СУРЗА4, СYР2С19, А10ВВ09):
   search and the interaction index do not find them.
3. **Tables** — scanned tables (one visual line per row, cells wrap) and text-layer tables held cell
   by cell (Флуоксетин, Дулоксетин Канон adverse effects). Rows cannot be rebuilt without guessing.
4. **Not safe to repair automatically** — « | » inside prose (where a gap is a cell boundary and where
   not is not decidable from the line), two page columns interleaved, word-level misreads, footnote
   marks vs missing spaces (a rule found the definition for 3 of 7 only).

## What changed (`tools/ingest/scripts/grls_render_repair.py`)

Applied by re-rendering each body from its stored extraction (no new OCR: the Vision cache is gone),
into `data/intermediate/grls-render-repair` + overlay `data/build/grls-render-repair.jsonl`:

- causes 1: 3 845 headings → paragraphs in 1 890 documents; 523 running headers → page marks in 191;
- cause 2: 3 357 codes in 390 documents (CYP3A4 1 826, CYP2C19 452, CYP2C9 411, CYP2D6 210 …), every change listed
  per block in the overlay;
- cause 3: 11 349 blocks of 198 text-layer documents marked as table cells; the reader shows marked
  lines as cells («Таблица из скана» with its rows, «Таблица без строк и столбцов» for cells) instead of
  gluing them into prose;
- cause 4: left as it is.

2 163 of 8 947 documents changed; 37 skipped because their stored extraction no longer renders to the
stored body. Module rebuild, republish and spot checks: `CURRENT_STATE.md` «OCR audit and module
rebuild».
