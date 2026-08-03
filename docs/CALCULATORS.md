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

## Initial delivery order

1. Unit conversion for mass, length, and volume.
2. Adult renal-function block after its formula and population are explicitly selected.
3. Pediatric renal-function block after its formula version, age limits, and laboratory assumptions are fixed.
4. Pediatric anthropometry after one reference dataset and its LMS tables are versioned in the repository.
5. Medication calculations only after dose source, concentration, route, maximum dose, and rounding policy are represented separately.

Planned clinical calculators remain visible only as roadmap metadata and must not return numeric clinical results.
