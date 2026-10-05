# Official medical forms with prefill — plan (STATE F1)

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

## Next steps

- 072/у (appendices 7–8; the patient, address, ОМС and clinician bindings are reusable), then 076/у,
  079/у, 025/у.
- Add the orders and their «Порядок» to the regulatory corpus (search finds the filling rules).
- ICD-10 against the МКБ module: `validateForm` takes an `icdKnown` hook; the format check runs now,
  the module lookup is not wired (the МКБ module is a large optional download).
- Sections (SEC1) keep «Формы — скоро»; wiring 070/у into «Психиатрия» etc. needs a per-form
  specialty tag in the schema.
- Human review of the OCR-derived code lists (89 subjects of the Russian Federation) against the scan
  once more before the form is called verified; a second recogniser would catch residual slips.

## Open questions for the owner

- Priority list of forms after 070/у.
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

