# Vaccination calendar of order 1122н: transcription record (VAX1, 2026-10-05)

Owner request (2026-10-05): «For 1122н — add a whole grid, printable.» This note records which edition
was transcribed, from which official files, how it was checked, and what a clinician has to look at.
The product side (screen, print, plan) is described in `docs/CURRENT_STATE.md` («Календарь прививок»).

## Edition

| | |
|---|---|
| Order | Минздрав России от 06.12.2021 № 1122н «Об утверждении национального календаря профилактических прививок, календаря профилактических прививок по эпидемическим показаниям и порядка проведения профилактических прививок», рег. Минюста № 66435 от 20.12.2021 |
| Amended by | Минздрав России от 12.12.2023 № 677н, рег. Минюста № 77040 от 30.01.2024; in force from 01.09.2024; adds «Настоящий приказ действует до 1 сентября 2030 г.», replaces row 24 of Appendix 2 (COVID-19) and adds paragraph 15 to Appendix 3 |
| Printed edition line | «по приказу № 1122н в ред. приказа № 677н» |
| Valid until | 01.09.2030 (677н) |
| Checked on the portal | 2026-10-05 |

Official files (publication.pravo.gov.ru, retrieved 2026-10-05; scans without a text layer, page numbers
below are PDF pages):

| File | eoNumber | Pages | Bytes | SHA-256 |
|---|---|---|---|---|
| 1122н | `0001202112200070` | 15 | 911 733 | `5bc4f95c44d6caedef5eb1519bc6a53f4383509d80df63d025492708af4cfa9d` |
| 677н | `0001202401300021` | 2 | 109 240 | `3cd1c0d9330a5590f218507ad33ebac3983a3fab51136badf3b8e0b88d6ee63b` |

Pages of 1122н: 1–2 the order, 3–6 Appendix 1, 7–12 Appendix 2, 13–15 Appendix 3. Pages of 677н: 1 the
order, 2 the amendments.

## Which amending orders exist

The portal API (`/api/Documents`, no login, no CAPTCHA, read-only) was asked on 2026-10-05 for titles
containing `1122н` (5 hits: 1122н, 677н and three unrelated orders with the same number), and for
`прививок`, `календаря`, `иммунопрофилактик`, `Национального календаря` (213 distinct acts, Минздрав
orders from 2021-12 on: only 1122н and 677н amend or replace the calendars; the others are
supply-request and compensation forms, the separate order 8н of 13.01.2022 (list of contraindications to
COVID-19 vaccination, not part of 1122н and not transcribed), pharmacy rules and regional acts). `bun run vaccination:check-updates` repeats the title query and
lists any federal Минздрав order about прививок that is not in the registry
(`tools/ingest/src/localmed_ingest/vaccination_calendar.py`, `SOURCES`).

Not excluded by this method: an amending order whose title names neither `1122н` nor the calendars, and
any change of the orders after 2026-10-05. Third-party consolidated texts (Гарант, Консультант) were not
compared; they are secondary and were not used.

## Method

1. `python -m localmed_ingest.vaccination_calendar fetch` downloads both PDFs with their provenance;
   `ocr` recognises them with the repository's macOS Vision step. Raw files stay in the git-ignored
   `data/raw/vaccination-calendar/`.
2. The tables do not survive OCR as cells, so the cells were **read from the scan page by page** and
   typed into the reviewed transcription `vaccination_calendar_1122n.py` (printed wording; line breaks
   of a printed cell joined with a space; typographic oddities of the order kept).
3. `prepare` checks every transcribed word against the OCR text of the PDF pages the row cites. Result:
   all 58 rows, the previous edition of row 24 and the three footnotes are at 100 % except two words the
   OCR did not read (`к` in Appendix 2 row 20; `18` in Appendix 3 paragraph 12), both confirmed on the
   scan. A row below 80 % stops the build. The check also fails when a cited page does not contain the
   row's words, which guards the page references. The words of the OCR that no transcribed text covers
   are only the page headers and the introductory part of the order (`review` subcommand).
4. The structured fields of a national-calendar item (infection, vaccination or revaccination, number of
   the dose, «группы риска», the condition after a dash) are parsed from the printed wording by the
   preparer; an item it cannot parse stops the build. They are not typed by hand.
5. The data (`apps/app/src/features/vaccination/data/ru-minzdrav-1122n.json`) is validated at the package
   boundary by `packages/contracts/src/vaccination-calendar.ts`.

Counts: Appendix 1 — 19 rows (15 by age with 29 vaccinations, 4 by category); Appendix 2 — 24 rows (1 of
them from 677н); Appendix 3 — 15 paragraphs (1 from 677н, 3 footnotes).

## Not in the data, on purpose

The order prints no dates, no minimum intervals between doses, no catch-up schedule and no list of
contraindications; they come from the instructions of the vaccines. The app does not add them. The
«План ребёнка» computes dates only from the ages the table prints and says so.

## For a clinician: what to check against the PDF

The whole transcription needs a clinician's check (no clinician has seen it). Specifically:

1. **Rows 16–19 of Appendix 1** (long category cells; rows 18 and 19 run over PDF pages 4–6). The cell of
   row 18 reads «работники медицинских и организаций, осуществляющих…» as printed (a word is missing in
   the order itself).
2. **Appendix 2 row 24 (COVID-19)** is the text of 677н; the original 1122н text (priority levels, children
   12–17) is kept as the previous edition. Appendix 3 paragraph 14 (children 12–17) is still in the order
   although the amended row no longer names children: as printed.
3. **Appendix 2 row 2**: «лица, временно или постоянно находящееся» as printed.
4. **Appendix 2 row 19**: the third bullet has a hyphen before «однократно»; the others have a dash.
5. **Paragraph breaks inside the cells of Appendix 2** (where a cell holds several sentences) follow the
   printed line breaks; the wording is unchanged but the break between two paragraphs is a reading of the
   layout.
6. **Population tags** (`children` / `adults` / `both`) on the rows drive the «Дети / Взрослые» filter.
   They are declared in the reviewed transcription from the wording of the row, not printed in the order.
   For Appendix 2 every row is `both` except 21 and 23 (children) and 24 (adults, after 677н).
7. **`appliesTo` of Appendix 3 paragraphs** (which paragraph is shown next to which infection) is an
   editorial association: 9 hepatitis B and influenza, 10 tuberculosis, 11 hepatitis B, 12–13 poliomyelitis,
   14–15 SARS-CoV-2, 1–8 every vaccination. The preparer checks that the infection is named in the
   paragraph.
8. **Plan conventions**: «3–7 день» counts days of life from the day of birth as day 1; «4,5 месяца» is four
   calendar months and fifteen days; the window «6–7 лет» is shown from the 6th to the 7th birthday.

## Refreshing

`bun run vaccination:check-updates` (network) before a release; when a new order appears, fetch it, add it
to `SOURCES`, review the changed rows against the scan and rebuild with `bun run vaccination:prepare`
(needs the raw files and macOS for the OCR step). A test rebuilds the JSON from the raw files when they
are present and compares.
