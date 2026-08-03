# Medical calculators

MiniMed calculators are deterministic tools. The same calculation engine must power forms, text parsing, tests, and any future printable view. UI code must not reimplement formulas.

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

- the authoritative source URL and publisher;
- formula name and version or publication date;
- date when the source was reviewed;
- intended population and age range;
- required laboratory method or measurement assumptions;
- exclusions, known limitations, and interpretation notes;
- reference test cases derived independently from the implementation.

Changing a formula, coefficient, population boundary, or interpretation rule requires a new reviewed source entry and regression tests. An article summary, search snippet, secondary calculator, or remembered formula is not sufficient as the sole source.

## First preview set

1. Unit conversion for mass, length, and volume.
2. Body surface area by the Mosteller 1987 equation.
3. Adult creatinine eGFR by CKD-EPI 2021 without a race coefficient.
4. Pediatric bedside CKiD/Schwartz 2009 with the source population restricted to ages 1–16 years.
5. Pediatric maintenance water by Holliday–Segar 100/50/20 and the separately displayed 4–2–1 hourly approximation.

Each preview result can be stored locally, printed, shared, and written to a patient note. Pediatric anthropometry and medication-dose calculators remain visible only as roadmap metadata and cannot return a numeric clinical result until their reference data and dosing rules are versioned.
