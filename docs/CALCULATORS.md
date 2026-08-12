# Medical calculators

MiniMed calculators are deterministic tools. The same calculation engine must power forms, text parsing, tests, and any future printable view. UI code must not reimplement formulas.

The first release is explicitly a prototype for validating workflow, formula traceability, local persistence, printing, sharing, patient-note integration, and end-to-end browser behavior before the catalog is expanded.

## Safety contract

- Every input has an explicit quantity and unit.
- No clinically meaningful input receives a silent default.
- Values must be finite and checked against documented physical or formula-specific bounds.
- Unit conversion happens before a clinical formula and is included in the calculation trace.
- Results preserve sufficient precision internally; rounding is an explicit presentation rule.
- Every result exposes the selected formula, normalized inputs, intermediate steps, output unit, and warnings.
- A calculator must refuse to calculate when required data are missing, units are ambiguous, or the patient is outside the supported population.
- Text parsing may fill a draft form, but calculation begins only after all required fields and units are unambiguous.

## Source contract for clinical formulas

A clinical calculator cannot move from `planned` to `available` until its definition records:

- an identifiable authoritative source — a URL for online publications, or title/publisher/edition/year
  and the cited page or section for a book (a printed or scanned textbook is an acceptable source; it
  does not need an online URL);
- formula name and version, publication date, or edition;
- date when the source was reviewed;
- intended population and age range;
- required laboratory method or measurement assumptions;
- exclusions, known limitations, and interpretation notes;
- reference test cases derived independently from the implementation.

Changing a formula, coefficient, population boundary, or interpretation rule requires a new reviewed source entry and regression tests. An article summary, search snippet, secondary calculator, or remembered formula is not sufficient as the sole source.

MiniMed itself is never the cited source for a formula, norm, or interpretation — the citation always
names the actual textbook, standard, or publisher the number came from. Users have no reason to trust
MiniMed as an authority; they can only evaluate a citation they recognize.

## First preview set

1. Unit conversion for mass, length, and volume.
2. Body surface area by the Mosteller 1987 equation.
3. Adult creatinine eGFR by CKD-EPI 2021 without a race coefficient.
4. Pediatric bedside CKiD/Schwartz 2009 with the source population restricted to ages 1–16 years.
5. Pediatric maintenance water by Holliday–Segar 100/50/20 and the separately displayed 4–2–1 hourly approximation.

Each preview result can be stored locally, printed, shared, and written to a patient note. Pediatric anthropometry and medication-dose calculators remain visible only as roadmap metadata and cannot return a numeric clinical result until their reference data and dosing rules are versioned.

## Growth z-score/percentile calculators (planned)

Anthropometry results (length/height-for-age, weight-for-age, weight-for-length, BMI-for-age, head
circumference) must move beyond the source-linked summary card in `who-child-growth-standards.md` into
an actual calculator. Numeric tables may trace to the WHO Child Growth Standards / Growth reference data
for 5–19 years already cited there, or to a reviewed propaedeutics textbook (e.g. Kapitan, Pochivalov)
cited by title/publisher/edition/page under the source contract above. Either way the specific table and
page used for the shipped cut-offs must be recorded, not just the book as a general reference.

Requirements beyond the existing calculator contract:

- **Sex and exact age are required before a verdict, not just before a number.** The calculator may
  compute a raw z-score/percentile as soon as inputs are numerically valid, but it must withhold the
  normal/abnormal interpretation until sex and age (or gestational-corrected age where applicable) are
  supplied, since the WHO cut-off tables are sex- and age-specific.
- **Explicit normal-range verdict.** Once the gating inputs are present, the result must state where the
  value falls against the WHO-defined bands already described in `who-child-growth-standards.md`
  (e.g. risk of overweight above +1 SDS, overweight above +2 SDS, obesity above +3 SDS for 0–5 years;
  the symmetric wasting/stunting bands below −2/−3 SDS), not just the bare z-score number.
- **Visual position indicator.** The result must render a compact visual (a marker on a bounded
  distribution/percentile-band strip) showing where the computed z-score sits relative to the normal
  range, in addition to the numeric value — a bare number is not sufficient for this calculator family.
- **Limitation text must repeat the existing caveats**: one point does not replace clinical judgement,
  unusual centile-crossing needs separate interpretation, and the calculator does not substitute for the
  original WHO tables.

## References display

The existing "Источники и ограничения" panel (`CalculatorsView.tsx`) renders each
`CalculatorSourceReference` as a plain paragraph. For calculators with more than one or two sources —
growth standards in particular, which cite separate 0–5 and 5–19 tables — sources must render as a table
(columns: title/publisher, edition or publication date, reviewed date, page/section, link) instead of a
paragraph list, opened from the same "Источники и ограничения" action already present on every result.
A book source has no link and leaves that column empty rather than pointing anywhere else, and MiniMed
itself never appears as a row in this table.
