# Official medical forms with prefill — plan (STATE F1)

Owner request 2026-10-05: put an official form into the app (e.g. 070/у) and get it filled from the
patient's data; the list of forms should come from official sources.

## Sources

Unified forms of medical documentation are approved by Минздрав orders. Each order's appendices
hold the blank itself and a «Порядок заполнения» (filling rules, field by field). The orders, not a
hand-made catalogue, are the list of forms:

- **274н of 13.05.2025** — outpatient forms, in force since 01.09.2025, replaced 834н of
  15.12.2014. Includes 070/у «Справка для получения путёвки на санаторно-курортное лечение» and
  072/у «Санаторно-курортная карта». Seen so far only in secondary sources
  ([legalacts.ru](https://legalacts.ru/doc/prikaz-minzdrava-rossii-ot-13052025-n-274n-ob-utverzhdenii/),
  [pravo.ppt.ru](https://pravo.ppt.ru/prikaz/minzdrav/n-274n-347757)); the text must be taken from
  the official publication (publication.pravo.gov.ru) before building.
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

## Open questions for the owner

- Priority list of forms after 070/у.
- Whether the «Врач и организация» profile should be per device or per patient record.
