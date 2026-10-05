# Official medical forms with prefill — plan (STATE F1, F2, F3)

Owner request 2026-10-05: put an official form into the app (e.g. 070/у) and get it filled from the
patient's data; the list of forms should come from official sources.

## Sources

Unified forms of medical documentation are approved by Минздрав orders. Each order's appendices
hold the blank itself and a «Порядок заполнения» (filling rules, field by field). The orders, not a
hand-made catalogue, are the list of forms:

- **274н of 13.05.2025** — outpatient forms, in force since 01.09.2025 (until 01.09.2031), replaced
  834н of 15.12.2014; registered by Минюст 30.05.2025 № 82433. Includes 070/у «Справка для получения
  путёвки на санаторно-курортное лечение» (appendix 5 = blank, appendix 6 = «Порядок заполнения»),
  072/у (appendices 7–8), 076/у (9–10), 079/у (11–12), 025/у (1–2) and 025-1/у (3–4). **Source taken
  from the official portal**: `publication.pravo.gov.ru`, eoNumber `0001202505300033`
  ([page](http://publication.pravo.gov.ru/document/0001202505300033),
  [PDF](http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202505300033)), 59 pages, 3 616 092
  bytes, SHA-256 `e385d12af60d1aa9a54f4e493addd10d21b764413c697d8eba43358f58a5dd3c`, retrieved
  2026-10-05. The PDF is a scan without a text layer, so the text is recognised (macOS Vision) and the
  cited pages are reviewed against the scan (see «Done»). Secondary sites
  ([legalacts.ru](https://legalacts.ru/doc/prikaz-minzdrava-rossii-ot-13052025-n-274n-ob-utverzhdenii/),
  [pravo.ppt.ru](https://pravo.ppt.ru/prikaz/minzdrav/n-274n-347757)) were only pointers.
- **025/у (appendices 1–2) is deliberately not built.** It is the full outpatient medical card — about
  15 pages of blank and rules (PDF pages 4–18): a title sheet, the patient section and then a
  longitudinal record of visits, examinations, diagnoses, prescriptions and referrals that grows for
  years. That is a record of a patient's course, not a one-off certificate that is filled, printed and
  signed; in MiniMed it belongs to the patient workspace (episodes, events, diaries), which already
  holds the same facts in structured form. A printable extract can be generated from there later, and
  025-1/у (the per-visit talon, built) already carries the title-sheet data. Revisit only if the owner
  wants the paper card reproduced.
- **530н of 05.08.2022** — inpatient and day-hospital forms.
- Separate orders for other families (prescription blanks, driver certificates); added on demand.

The orders also belong in the regulatory corpus (search finds the order and its filling rules).

## Model

1. **Form module** (`kind: 'form'`, downloadable like tools): one schema per form, generated from
   the official text by a deterministic preparer, never hand-copied in the UI.
   - Identity: form number, title, approving order, appendix, edition date, official source URL and
     checksum of the source file.
   - Fields: id, label as printed, type (text, date, choice, ICD-10 code, signature/stamp place),
     required flag, and the exact «Порядок заполнения» paragraph that governs it (source span).
   - Layout: the printed blank's structure (blocks, field order, line lengths) so the print matches
     the official form one to one.
2. **Prefill bindings** declared in the schema, not in code: `patient.fullName`,
   `patient.birthDate`, `patient.sex`, `patient.address`, `patient.snils`, `patient.omsPolicy`,
   `patient.workplace`, `episode.diagnosis` (text + ICD-10 code), `episode.anamnesis`,
   `clinician.fullName`, `organization.name/address/ogrn`, `today`. The UI renders schema data and
   must not branch on form ids (AGENTS.md, as for calculators and questionnaires).
3. **Data the app does not have yet.** The patient profile has display name, birth date, sex, local
   number and free context. Needed: full name, address, СНИЛС, ОМС policy, workplace/school — in
   the encrypted patient vault (ADR 0015/0016), never in logs. A «Врач и организация» profile in
   Settings: organization name, address, ОГРН, clinician name — stored locally.
4. **Filling screen**: prefilled values marked as such, empty required fields highlighted, each
   field's filling rule one tap away (the source paragraph), validation from the schema (dates,
   ICD-10 code against the МКБ module).
5. **Output**: print / PDF through the existing print manager, laid out as the official blank, for
   signature and stamp. The app does not issue legally binding electronic documents (СЭМД via
   ЕГИСЗ needs an МИС and a backend, which the product excludes).
6. **Sections**: forms join the section bundles (SEC1), e.g. «Педиатрия» → 076/у, 026/у.

## First slice

070/у end to end: official text of 274н → preparer → schema with field rules → prefill from a
patient → print. Then 072/у, then the owner's priority list (076/у, 086/у, 027/у …).

## Done — F1 first slice (2026-10-05)

- **Source and provenance.** `python -m localmed_ingest.medical_forms fetch|ocr|prepare` (tools/ingest,
  `bun run forms:prepare` for the last step). `fetch` queries the portal API (`/api/Documents?Number=`),
  downloads the PDF and writes `data/raw/medical-forms/<eoNumber>.source.json` (URL, retrieval date,
  SHA-256); `ocr` runs the repository's macOS Vision script; `prepare` builds the schema. Raw PDF and
  OCR JSON stay in git-ignored `data/raw/medical-forms/`.
- **Deterministic preparer** (`medical_forms.py` + the reviewed blueprint `medical_form_070u.py`): OCR
  fragments are regrouped into printed lines, footnotes under reviewed per-page limits are dropped,
  the «Порядок» is cut into numbered paragraphs with page/line spans, `«NN» - name` code lists become
  field options (OCR look-alikes in codes are normalised and logged; a code the official text prints
  twice, `«82»`, is kept once). The printed caption of each of the 52 fields is located in the OCR text of
  appendix 5 or the build fails; every cited paragraph must exist. Each applied OCR correction is
  recorded in the schema (`source.extraction.corrections`). Output: the committed
  `apps/app/src/features/forms/schemas/ru-minzdrav-274n-070u.json`; a test rebuilds it from the raw
  files (when present) and compares.
- **Contract** `packages/contracts/src/form-schema.ts`: identity, source, screen sections, fields (type
  text/date/choice/icd10/checkbox/signature/stamp, required + basis, options, pattern, `notAfter`),
  the governing paragraphs with spans, prefill bindings (`FORM_PREFILL_PATHS`: `patient.fullName|
  birthDate|sex|snils|workplace|address.*|stayAddress.*|omsPolicy.*`, `episode.diagnosis.text|icd10`,
  `clinician.fullName|position`, `organization.name|address|ogrn`, `today`) with join/map declared in
  the schema, and the print layout (blocks, rows, blank lengths, boxed rows, date blanks, option rows).
  Rule status per field: `defined`, `by-line` (the printed line is governed, the part is not named) or
  `undefined` (the order says nothing; never invented).
- **Data the app lacked.** Patient profile (inside the vault snapshot, ADR 0015/0016): full name,
  address and stay address (8 parts each), СНИЛС, ОМС policy (number, date, insurer), workplace;
  episode diagnosis (text + ICD-10). Editor «Данные для справок и форм» in the patient card.
  «Врач и организация» in Settings (device-local `localStorage`, not patient data): organization name,
  address, ОГРН/ОГРНИП (control digit checked), clinician name, position.
- **UI** `apps/app/src/features/forms/**`: «Формы» list (`#/notes/forms`), reachable from «Мои файлы»
  (pinned folder) and the notes index; «Заполнить форму» in a patient card (`#/notes/forms?patient=`);
  filling screen (`#/notes/forms/<id>?patient=&episode=`): prefilled fields marked, empty required
  fields highlighted with a counter that jumps to the first one, the governing paragraph and its
  citation one tap away, validation from the schema, typed values kept in memory only (dropped when
  the vault locks), preview of the blank scaled from a 210 mm sheet and print / PDF through the print
  manager. The UI knows no form number.
- **Tests**: python 14 (preparer), contracts 9, app logic 16 + routing, Playwright
  `apps/app/e2e/official-forms.spec.ts` (fill 070/у for a test patient, rule on demand, preview, print
  popup, «Мои файлы» entry). Screenshots (390 px, light/dark) in `output/f1-screens/`.

## Done — F2: the rest of order 274н, the shortlist and the update check (2026-10-05)

- **Forms added** (same official file, same preparer and review method as 070/у): 072/у
  «Санаторно-курортная карта» (appendices 7–8, PDF pp. 37–44), 076/у «…для детей» (9–10, pp. 45–53),
  079/у «Медицинская справка о состоянии здоровья ребенка, направляемого в организацию отдыха детей
  и их оздоровления» (11–12, pp. 54–59) and 025-1/у «Талон пациента, получающего медицинскую помощь в
  амбулаторных условиях» (3–4, pp. 19–28). Each has a reviewed blueprint
  (`tools/ingest/src/localmed_ingest/medical_form_072u.py`, `…076u`, `…079u`, `…025_1u`; the
  sanatorium cards share `medical_form_sanatorium.py`, all share `medical_form_kit.py`). Every printed
  caption is located in the OCR text of the blank or the build fails; the few the OCR dropped (the word
  «дом» on the crowded address lines of 072/у, «Код меры социальной поддержки» on the rotated talon) are
  listed in `source.extraction.captionsReviewedOnScan` after being confirmed on the scan; every cited
  paragraph is cut from the OCR text; reviewed line- and text-level corrections are logged per page
  (`corrections`) and a reviewed line correction that no longer applies fails the build. Rules are
  cited per field with `defined` / `by-line` / `undefined`: e.g. in 025-1/у lines 10.1 and 11.1 and
  the «признак / ДН / снят с ДН» cells are `undefined` (the order lists lines 6–12 and never describes
  those cells), 079/у «Гражданство» is `undefined`, the return coupon of 072/076 is `by-line` (п. 9
  gives the whole coupon to the sanatorium doctor), and no coupon field is required.
- **Review against the scan.** Every cited page was compared with the scan: rule paragraphs word by
  word, code lists (89 regions, climate, factors, 10 social-support categories) and the blank's lines,
  by four independent reviewers (one per form; two for the talon) plus my own pass over the rotated
  talon at 3× zoom. Findings were corrected in the blueprints (missing short words at line starts
  — «у», «в», «с», «и» —, capital letters, Latin look-alikes such as «025/y» and «CCCP», footnote
  marks, lost commas and dots, one fully garbled line of п. 9.11, the lost dot after «9.21»,
  «I группу» for «1 группу» in 072/у п. 7.8) and are all logged in the schema. What stays unverified:
  hyphen vs en dash in running text (OCR cannot tell them apart; only the printed code lists were
  normalised, as in 070/у) and Latin/Cyrillic letters inside the scan itself.
- **Contract additions** (`packages/contracts/src/form-schema.ts`, all optional, generic — the UI
  never branches on a form): `pageBreakBefore` and `framed` on a layout block (the reverse side of a
  two-sided blank; boxed groups of the talon), `lines` on a field segment (a long entry on several ruled
  lines), `codes` / `mark: 'underline'` on an options segment («нужное подчеркнуть» in 079/у), a
  `table` segment (cells are fields or printed captions, header cells with `colSpan`/`rowSpan`: the
  prescriptions and visit-date tables of the talon), a `words` binding (`{from, count}`: surname, name
  and patronymic of the talon are the words of one full name), the `patient.citizenship` path and
  `source.extraction.captionsReviewedOnScan`.
- **Data the app lacked.** Only `patient.citizenship` was added (patient vault profile, editor «Данные
  для справок и форм», prefill path); `patient.workplace` already existed and is bound where a printed
  line needs it (025-1/у line 14). Not added on purpose: identity document (series/number), type of
  locality, educational organisation, height/weight — printed on the blanks but not data the app holds.
- **Printing.** 072/у, 076/у, 079/у are two-sided: the reverse side starts on a new sheet
  (`@page`/`break-before`); 025-1/у is an A4 landscape sheet printed on both sides (the scan in the
  official PDF is rotated by 90°). The preview scales the sheet by its orientation. 070/у stays one
  sheet. The e2e counts the sheets of the PDF Chromium makes from the print page: 070/у 1, the others 2.
- **Tests.** Python: committed schemas of all five forms (provenance, rule statuses, no OCR look-alikes
  or footnote marks left in a paragraph, code lists, per-form invariants) and a fresh rebuild from the raw
  OCR per form; stale-correction and scan-reviewed-caption behaviour. Contracts: the new segment kinds.
  App: registry (five forms, stable ids), print (page break, landscape talon with tables, underline
  marks), prefill (words, citizenship, diagnosis), patient vault (citizenship). Playwright
  `official-forms.spec.ts`: 070/у as before plus the four new forms from one patient (prefill marks, rule
  on demand, preview text, real sheet count). Screenshots (390 px, light and dark) are in
  `output/f2-screens/`.

### Candidates for the owner (status after F3: see «Done — F3»)

Forms that are **not** in 274н, checked on `publication.pravo.gov.ru` on 2026-10-05 (eoNumbers are
verified against the API: number, date, Минюст registration). Every one of these official PDFs is an
image scan without a text layer (0 characters on every page), so each needs the OCR route described
above. Effort is relative to 070/у (a cheap form is about one day, measured in person-days, not
measured on a build). The owner picks; none is built.

| Form | Name | Approving order in force | eoNumber (API) | Status | PDF | Structure | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 057/у | Направление для оказания медицинской помощи | 519н of 02.09.2025, Минюст 83857 of 16.10.2025 | `0001202510160032` | In force; no expiry clause in the text; no amendments found | scan, 5 pp, 0.36 MB | blank 1 p, ~15 lines; rules ~2.5 pp, per line | 1–1.5 days |
| 058/у | Экстренное извещение о случае инфекционной, паразитарной болезни … | 740н of 20.08.2026, Минюст 88291 of 16.09.2026 | `0001202609170010` | Registered, **in force only from 01.03.2027** to 01.03.2033; the form in use today has no source on the portal; no amendments | scan, 9 pp, 0.65 MB | blank 2 pp, ~17 numbered items; rules 6 pp, paragraphs 10.x per item | 2–3 days |
| 088/у | Направление на медико-социальную экспертизу медицинской организацией | joint Минтруд 488н / Минздрав 551н of 12.08.2022, Минюст 70900 of 10.11.2022 | `0001202211100014` | In force (replaced 27н/36н); no expiry date; no amendments found | scan, 31 pp, 1.9 MB | blank 13 pp with sections, tables, many checkboxes; rules 17 pp | 6–9 days |
| 003-В/у | Медицинское заключение водителя (кандидата в водители) | 1092н of 24.11.2021, Минюст 66130 of 30.11.2021 | `0001202111300131` | In force 01.03.2022–01.03.2028 (replaced 344н); no amendments found | scan, 17 pp, 1.2 MB | blank 2 pp with category tables; rules 4 pp, per line | 1.5–2 days; print only as a draft (protected печатная продукция required) |
| 071/у | Заключение для тракториста, машиниста, водителя самоходных машин | 395н of 09.06.2022, Минюст 68933 of 21.06.2022 | `0001202206210025` | In force 03.07.2022–01.03.2028 | scan, 3 pp, 0.18 MB | blank 1 p; no filling rules (all fields `undefined`) | 1 day |
| 002-О/у, 003-О/у | Заключения для владельца оружия | 1104н of 26.11.2021, Минюст 66144 of 30.11.2021 | `0001202111300144` | In force 01.03.2022–01.03.2028 (replaced 441н); no amendments found | scan, 12 pp, 0.8 MB | two 1-page certificates; general rules, none per field | 1 day each |
| 107-1/у, 148-1/у-88, 148-1/у-04(л) | Рецептурные бланки | 1094н of 24.11.2021, Минюст 66124 of 30.11.2021 | `0001202111300115` | In force 01.03.2022–01.03.2028 (replaced 4н, 54н, 1175н); no amendments found | scan, 43 pp, 2.9 MB | blanks on 4 pp (appendix 2); rules in appendices 1 and 3, no per-field rules; 107/у-НП is appendix 4 (+1 day, low value) | 2.5–3 days for the three; drafts only (the organisation prints its own blanks) |
| 025-2/у | Талон пациента с сифилисом, гонококковой и хламидийной инфекциями, лепрой | 761н of 27.08.2026, Минюст 88426 of 24.09.2026 | `0001202609240042` | In force from 01.03.2027 to 01.03.2033; niche | scan, 8 pp, 0.49 MB | blank 2 pp; rules 5 pp | 2–3 days |
| 086/у | Медицинская справка (врачебное профессионально-консультативное заключение) | **none in force**; last text in 834н of 15.12.2014, appendices 19–20 | 834н: `0001201502260006` (repealed 01.09.2025) | Not in 274н; no successor order found on the portal | scan, 78 pp (the whole 834н) | blank 1–2 pp, rules ~1.5 pp | 2 days, only as a «historical edition» — not recommended |
| 027/у, 095/у, 063/у | Выписка из карты; справка об освобождении учащегося; карта профилактических прививок | **not verified**: Soviet-era Минздрав orders are not on the portal; not in 834н, 274н or 530н; 063/у is not in the national vaccination calendar order 1122н either | none found | legal status unverified | n/a | n/a | blocked: no official source to build from |
| 057/у-04 | Старое направление | order 255 of 2004 (membership from memory, not verified); 255 repealed by 119н of 13.03.2025 | 119н: `0001202504140026` | superseded by the new 057/у (519н) | n/a | n/a | do not build |

How to read it: 834н of 15.12.2014 (eoNumber `0001201502260006`) was repealed completely from
01.09.2025 with its amendments (2н, 1186н, 190н); 274н carries only 025/у, 025-1/у, 070/у, 072/у,
076/у and 079/у, so the old outpatient forms 086/у, 086-2/у, 030/у, 030-13/у, 032/у and 043/у are
**not** in 274н and have no successor order on the portal. Two cautions: since 01.09.2026 order
286н of 15.04.2026 (eoNumber `0001202605290025`, Минюст 86684, until 01.09.2032) lets medical
organisations issue справки and medical certificates in free form unless a law fixes the form, and
certificates such as 003-В/у must be printed on protected печатная продукция, so the app can only
produce a draft or a preview for those, never the legal document.

Recommended order if the owner agrees: 057/у (cheapest, current, reuses patient/ОМС/address/diagnosis
bindings), 058/у (common, text-heavy; label it «действует с 01.03.2027»), 003-В/у with 071/у (shared
layout, valid to 2028; drafts only), 002-О/у + 003-О/у, 088/у last. Skip 086/у, 027/у, 095/у and 063/у
until the owner supplies an official source for them. Not verified in this pass: order 255 of 2004
(not on the portal), the Soviet-era orders, amendments hidden in orders whose titles do not name the
base order (checked by title over the 2 375 Минздрав documents of the portal, plus the text of 327н),
and the effort figures (estimates, not measured).

## Done — F3: layout-fidelity check and thirteen new forms (2026-10-05/06)

### Layout-fidelity check (`bun run forms:overlay`, `bun run forms:calibrate`)

- **Render.** `tools/forms-overlay/render-print.ts` renders the *empty* print of every schema to a PDF
  with Chromium, from the same HTML the print manager receives, at the paper size the schema declares.
- **Compare.** `localmed_ingest.medical_form_overlay check` (PyMuPDF, pure Python, no new dependency)
  puts the official scan page (rotated and, since the scan is a photograph of a sheet, fitted to the
  print sheet; a size mismatch beyond 5 % is a violation) under the print:
  - **text** — the words of the print (PDF text layer) and the OCR words of the scan are aligned as two
    sequences, then the leftovers by position; per word the vertical and left offsets (mm), per line
    the font scale (identical lines' width, narrow end, because justified lines are wider), the
    agreement of line breaks; the page offset of the appendix heading («Приложение № N …», not part of
    the form) is taken from the first form line;
  - **rules** — long strokes (blank underlines, box and table borders) found in both rasters with one
    detector (150 dpi): recall of the scan's strokes, their vertical/length offset;
  - **sheet** — sheet count, paper deviation, `printScale` (the body font in the PDF over the declared
    one: when a line overflows, Chromium silently shrinks the whole page — that is a violation);
  - images in `output/f3-screens/<key>/` (`-overlay.png`: scan cyan, print red, both black;
    `-side-by-side.png`).
  Tolerances (`TOLERANCES` in the module): word coverage ≥ 0.85, median vertical offset ≤ 2 mm, p90 ≤ 4
  mm, p98 ≤ 8 mm, median left offset ≤ 2 mm, font scale 0.95–1.05, line-break agreement ≥ 0.8, rule
  recall ≥ 0.8, rule offset ≤ 1.5 mm vertical / 3 mm length, paper deviation ≤ 5 %, print scale ±4 %.
- **Calibrate.** `medical_form_overlay calibrate` fits, from the scan alone: side margins (extent of the
  scan text), font size (quarter points), line height (down to 1.1 while the print is taller than the
  scan) and the space above each layout row; the result is a committed file per form
  (`tools/ingest/medical-form-calibration/<form id>.json`) that the preparer merges into the schema
  (`page.lineHeight`, rows' `spaceBeforeMm`, margins/font). A calibrated row that no longer exists in
  the blueprint fails the build. What calibration cannot fix is the structure and is done in the
  blueprints: **one layout row per printed line** (`stretch` rows spread one line over the width,
  `justify` rows wrap paragraphs), column widths, blank lengths, boxes, tables.
- **Result file.** `tools/ingest/medical-form-overlay-results.json` holds the figures of the last run
  per form; a pytest checks that every registered form is there, that the figures still satisfy
  `TOLERANCES`, and that any violation carries a written reason (`acceptedViolations`). After a layout
  change run `bun run forms:overlay -- --update-results`, then `bunx biome format --write` on the file.
  Blanks that share a scan page with another blank (prescription blanks) are measured on a masked copy
  built from `blank_regions` of the blueprint.
- **Contract additions** (optional, generic): row `spaceBeforeMm`, `minHeightMm`, `align: stretch`;
  page `lineHeight`; segment kinds `rule` (empty ruled line), whole-year date part, option
  `separators`/`range`/`joined`, `indentMm`, `lineStyle`, `charCells`, running-text table cells,
  block `insetMm`, and more (see `packages/contracts/src/form-schema.ts`).

Results (median / p90 / p98 vertical offset of the print against the scan, mm; line breaks = share of
print lines broken where the scan breaks; rules = share of the scan's strokes found in the print):

| Form | before F3 (median / p90 / max) | now | words | lines | rules | sheets |
| --- | --- | --- | --- | --- | --- | --- |
| 070/у | 4.4 / 9.9 / 16.0 | 0.3 / 1.1 / 4.3 | 0.95 | 0.83 | 0.94 | 1 |
| 072/у | 11.5 / 26.3 / 32.6 | 0.3 / 1.0 / 1.9 | 0.93 | 0.99 | 0.81 | 2 |
| 076/у | 27.1 / 63.5 / 67.5 | 0.5 / 1.1 / 1.9 | 0.92 | 1.00 | 0.85 | 2 |
| 079/у | 32.5 / 65.1 / 74.6 | 0.2 / 0.6 / 0.9 | 0.97 | 0.96 | 0.93 | 2 |
| 025-1/у | 27.7 / 46.6 / 50.6 | 0.3 / 2.1 / 3.0 | 0.94 | 0.82 | **0.71** | 2 |
| 057/у | new | 0.3 / 0.5 / 0.8 | 0.88 | 0.94 | 0.91 | 1 |
| 058/у | new | 0.2 / 0.8 / 1.4 | 0.99 | 0.96 | 0.97 | 2 |
| 088/у | new | 0.2 / **4.1** / 7.9 | 0.97 | 0.87 | 0.84 | 13 |
| 107-1/у | new | 0.1 / 1.0 / 1.4 | 0.91 | 0.98 | 0.80 | 2 |
| 148-1/у-88 | new | 0.2 / 0.5 / 1.1 | 0.87 | 1.00 | 0.88 | 2 |
| 148-1/у-04(л) | new | 0.2 / 1.4 / 1.8 | 0.91 | 0.92 | 0.88 | 2 |
| 003-В/у | new | not measurable page by page (below) | 0.53 | 1.00 | 0.33 | 1 (scan 2) |
| 071/у | new | 2.3 / 3.6 / 5.8 | 0.77 | 0.95 | 0.67 | 2 |

«Before» are the first runs of the tool on the F2 print (scan taken at its own page size, first version of
the metric); 070/у was then tuned by the coordinator, the other four forms by separate fitting passes. The first printed layout of F1/F2 was a flowing reconstruction (10 pt, 15 mm margins); the scans use
10–14 pt, justified lines and explicit breaks, which is what the fit reproduces now.

Remaining differences, honestly (all in `acceptedViolations` of the results file with the reason):

- **088/у** — p90 4.1 mm against 4.0: long checkbox cells in the tables on sheets 3–4 and 6–7 wrap one or
  two words differently; the signature block on sheet 13 is about 5 mm off.
- **025-1/у** — rule recall 0.71 against 0.80: the scan is skewed by about 0.4°, its table grid and long
  rules are detected in pieces; every border is in place on the overlay (recall was 0.84 before the scan
  was fitted to the sheet). The signature slot prints a «подпись» caption the scan does not have; the print
  title is 10 % narrower (only three row sizes exist).
- **003-В/у** — the official page 15 carries the appendix heading, the blank continues on page 16; the print
  is one A4 sheet (the form is one sheet). Page-by-page matching therefore pairs scan page 2 with a sheet
  that holds the whole form: figures meaningless. Measured by the agent against the two form areas
  stitched into one page (scratch script, not in the repository): words 0.87, dy 0.5 / 1.8 / 2.1 mm, line
  breaks 0.96, rules 0.93. Restriction row 2 breaks after another word than the scan.
- **071/у** — word coverage 0.77 (the OCR reads the ruled tables partly; 0.92 with the long rules removed
  from the OCR input, agent measurement), restrictions table drifts about 4 mm down (scan lines justified,
  print ragged-right, an extra forced line in row A IV), the scan's categories table is 2.6 mm narrower.
- **Everywhere** — signature segments always print their caption/stub (a field must appear on the blank), the
  scan draws one long rule for name and signature; dashed lines on the scan detect only as short pieces;
  handwritten dates in the appendix heading («от «13» мая 2025 г.») are printed as text where the form
  itself carries them (057/у, 058/у), a stub «подпись» differs by 5–10 mm in caption rows; Latin/Cyrillic
  letters on the scans are not distinguishable.

### Forms added (each from the official order text on publication.pravo.gov.ru, recorded in the registry)

| Form | Order | eoNumber | In force | Fields (defined / by-line / undefined) | Sheets |
| --- | --- | --- | --- | --- | --- |
| 057/у Направление для оказания медицинской помощи | 519н of 02.09.2025, Минюст 83857 of 16.10.2025 | `0001202510160032` | the order names no date: **27.10.2025** by the general rule (10 days after the publication of 16.10.2025; stated in the edition line and in the notes), no expiry | 37 (21 / 15 / 1) | 1 |
| 058/у Экстренное извещение о случае инфекционной, паразитарной болезни … | 740н of 20.08.2026, Минюст 88291 of 16.09.2026 | `0001202609170010` | **from 01.03.2027 to 01.03.2033** (clause 2 of the order); shown as «Вступает в силу с 01.03.2027» | 80 (51 / 28 / 1) | 2 |
| 088/у Направление на медико-социальную экспертизу медицинской организацией | joint Минтруд 488н / Минздрав 551н of 12.08.2022, Минюст 70900 of 10.11.2022 | `0001202211100014` | 10 days after publication (21.11.2022), no expiry | 216 (181 / 35 / 0) | 13 |
| 107-1/у Рецептурный бланк | 1094н of 24.11.2021, Минюст 66124 of 30.11.2021 | `0001202111300115` | 01.03.2022–01.03.2028 | 20 (13 / 1 / 6) | 2 |
| 148-1/у-88 | same | same | same | 17 (11 / 0 / 6) | 2 |
| 148-1/у-04(л) | same | same | same | 40 (27 / 2 / 11) | 2 |
| 003-В/у Медицинское заключение (водитель, кандидат в водители) | 1092н of 24.11.2021, Минюст 66130 of 30.11.2021 | `0001202111300131` | 01.03.2022–01.03.2028 (item 5 of the order) | 57 (47 / 10 / 0) | 1 |
| 071/у Медицинское заключение (тракторист, машинист, водитель самоходных машин) | 395н of 09.06.2022, Минюст 68933 of 21.06.2022 | `0001202206210025` | 03.07.2022–01.03.2028 | 56 (0 / 0 / 56: the order has no filling rules) | 2 |

Notes per form:

- The user's «057/у-04» is the old form of order 255 of 2004, repealed; its successor is the new 057/у of 519н.
- **058/у** is registered but not in force until 01.03.2027; the list and the fill screen say so
  (`validityLine`), and the form in use today has no source on the portal and is not built.
- **Prescription blanks** and the two driver/machine certificates are **drafts**: the order requires the
  organisation's own (some protected) printed stock; the schema notes say so. The three prescription blanks
  share scan pages (a blank starts under the reverse side of the previous one) and are reproduced as printed
  on the order's pages.
- **003-В/у**: the scan splits the blank over two pages because of the appendix heading; the print is one
  sheet. The category codes are Latin on purpose (Latin and Cyrillic look the same on the scan).
- **071/у** has no «Порядок заполнения»; the order's own clauses 1–2 are kept as the schema's rules, every
  field is `undefined`.
- New prefill capabilities: patient name as «Иванов И.И.» (`format: initials`), checkbox ticked by a mapped
  value (`sex: male` → the «Мужской» box).

### Forms checked and not built

Verified on 2026-10-05 on the portal (API + OCR of the orders) by a research pass:

| Form | Verdict |
| --- | --- |
| 086/у, 086-2/у (справка профессионально-консультативная) | **not in force**: both were appendices of 834н, repealed from 01.09.2025 by 274н, which carries only 025/у, 025-1/у, 070/у, 072/у, 076/у, 079/у; no successor order; certificates are free form since 286н of 15.04.2026 (eo `0001202605290025`, 01.09.2026–01.09.2032) unless a law fixes the form |
| 030/у, 030-13/у, 032/у, 043 | same: 834н repealed, no successor on the portal |
| 027/у, 063/у, 095/у | **no official text on the portal** (the Soviet order 1030 of 04.10.1980 is not there); the only basis is a Минздрав letter of 31.10.2023 № 13-2/3106565-159 saying the forms of 1030 stay in use until new ones are approved — not an approved current form; a paper выписка is free form (order 789н of 31.07.2020, eo `0001202009240027`); 530н (inpatient, eo `0001202210190009`) has no стандалон выписка/справка form |
| 025-2/у талон (761н of 27.08.2026, eo `0001202609240042`) | exists, in force from 01.03.2027 to 01.03.2033; niche, not built (2–3 days) |
| 002-О/у, 003-О/у (1104н, `0001202111300144`) | in force 01.03.2022–01.03.2028; not built (weapon-owner certificates, not common; 1 day each) |

Other current forms found by the pass, not built: 106/у medical death certificate and 106-2/у (352н, `0001202105310022`, valid to 01.09.2027,
2–3 days), 131/у (271н, `0001202605270017`, from 01.09.2026), 030-ПО/у (211н, `0001202505230032`), 030/у-Д/с (212н,
`0001202505290026`), паспорт врачебного участка (671н, `0001202608140006`), извещение о профзаболевании (258н,
`0001202506020063`), 315-1/у and 316-1/у (196н, `0001202505190024`). Not on the portal at all: 112/у, 026/у, 111/у, 156/у-93.

### Update check (`bun run forms:check-updates`)

Local, never a scheduled job (repository policy: content builds run locally). Registry:
`tools/ingest/medical-form-sources.json` — per source order: eoNumber, number, date, title, Минюст
registration, publication and PDF URLs, page count, byte size, SHA-256 of the PDF, the forms built from
it (key, number, schema id and file), `watchTerms`/`watchRequire` and `acknowledgedOrders`. A test keeps
it in step with the blueprints and the committed schemas.

1. For each order it asks the portal API for the record (pages, size) and downloads the current PDF; a
   different SHA-256, size or page count is `changed`.
2. It searches `Documents?Name=<order number>` for orders published later whose title says «внесении
   изменений» / «признании утратившим силу» and names the base order by number and date («от 13 мая
   2025 г. № 274н» or «13.05.2025 № 274н»): `new` until a human lists them in `acknowledgedOrders`.
   Other new Минздрав orders matching `watchTerms` + `watchRequire` («унифицированных форм медицинской
   документации» + «амбулаторных условиях») are listed as possible replacement sets, for a human only.
3. `--metadata-only` skips the download. `--rebuild` re-fetches a `changed` file, re-runs the OCR
   (macOS Vision) and every blueprint of that source. A caption that is no longer found, a cited
   paragraph that disappeared or a reviewed line correction that no longer applies is a failure
   printed as «HUMAN REVIEW REQUIRED» — nothing in the repository is overwritten. A rebuild that
   matches everything but changes the text of a cited paragraph is staged in
   `data/build/forms-updates/<eoNumber>/` and also needs review. Only a rebuild that matches and
   changes no cited paragraph updates the raw files, the schemas and the registry (SHA-256, size,
   date). Because the reviewed corrections belong to one OCR run, even a rescanned identical file
   usually asks for review (an experiment with the unchanged PDF and a fresh Vision run changed
   paragraphs of 070/у, 072/у, 079/у and made two reviewed corrections inapplicable).
   A replacement published under a **new** eoNumber is never rebuilt automatically: add a registry
   entry and a blueprint.
4. A JSON report is written to `data/build/forms-update-check.json` (per source: status, file
   differences, amending orders, possible replacements, errors, rebuild outcome). Network failures
   are reported per order (`status: error`, the message, exit code 2), never swallowed.
5. Run it before every release (docs/RELEASES.md) and after any news of changes to the order.

## Next steps

- Pick further forms from the lists above (025-2/у from 2027, the weapon certificates, 106/у).
- Add the orders and their «Порядок» to the regulatory corpus (search finds the filling rules).
- ICD-10 against the МКБ module: `validateForm` takes an `icdKnown` hook; the format check runs now,
  the module lookup is not wired (the МКБ module is a large optional download).
- Sections (SEC1) keep «Формы — скоро»; wiring 070/у into «Психиатрия» etc. needs a per-form
  specialty tag in the schema.
- Human review of the OCR-derived code lists (89 subjects of the Russian Federation) against the scan
  once more before the form is called verified; a second recogniser would catch residual slips.

## Owner requirement: layout fidelity (2026-10-05) — measured since F3

The printed blank must preserve the layout of the original form file: block order, line breaks,
field positions, boxed rows, table grids and the one- or two-sided sheet structure as on the official
scan. Since F3 this is **checked automatically** (see «Done — F3»); a new form is held to the same
`TOLERANCES` by `bun run forms:overlay` and a committed result file.

## Open questions for the owner

- Which of the «Candidates for the owner» to build next; whether 025/у (the full outpatient card)
  should ever be reproduced on paper (see Sources).
- 025-1/у is filled per visit; the app has no «visit» entity yet, so one talon is one form session
  (today's date, the episode's diagnosis). Is that enough?
- 079/у line «Состояние здоровья» takes the episode's main diagnosis into its first row; п. 7.7 asks
  for the child's existing diseases, so the value is editable and marked «подставлено».
- «Врач и организация»: implemented per device (one profile); a per-patient override is not built.
- `required` is not stated by the order. Used: `source` where a paragraph says the line «указывается»
  (ФИО, дата рождения, пол, ОМС, СНИЛС, диагноз и код МКБ — п. 6.11 «с обязательным указанием кода» —,
  рекомендации, подписанты), `editorial` for the header and the form date; the 6.3 group (набор
  социальных услуг) is optional. Printing is never blocked by an empty required field.
- Ambiguous or missing rules: п. 6.14 names «заведующий отделением (председателя врачебной комиссии)»
  and п. 6.15 the chair again; п. 8 has the electronic form signed by the head of the organisation,
  while the blank has three signature lines; the form date, form number, header lines and paper
  signatures are `undefined`; the parts of the address lines (район, улица, тел.) are `by-line`.
- 070/у has no workplace line (025/у has «Место работы, учебы», п. 10.13); `patient.workplace` stays
  declared for the forms that print it.
- «Пол»: only `male`/`female` map to the printed codes 1/2; `intersex`/`unknown` stay empty.
- The order's «Должность врача» line needs a position the profile had not carried: `clinician.position`
  was added next to `clinician.fullName`.
