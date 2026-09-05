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

## Search discoverability

A schema may opt into the search suggestion card with `search.kind`: `medication-dose` or
`infusion-volume`. Medication calculators also declare one canonical medication term and aliases.
`search.bindings` may point to existing age, weight, formulation, route, and indication inputs;
formulation, route, and indication bindings must reference `select` inputs. Their declared option
order is the display priority. These fields are routing metadata only: formulas, dosing rules,
population restrictions, and contraindications remain in reviewed source-backed calculator content.
When no installed schema matches, search renders only its normal results.

## Schema v2 and result evaluation

Published calculator definitions use `schemaVersion: 2` only. Each definition declares an explicit
`evaluation` state (`verdict`, `missing-context`, `unavailable`, or `not-applicable`) and stable
`observationMappings`. A mapping can expose a final input, derived step, or output as a canonical
`metricId`/unit for longitudinal patient dynamics. `patientBinding` may fill only explicitly declared
fields such as date of birth, biological sex, age on the event date, or a recent measurement; the
selector is always an explicit `patientId` and never a name match.

When a selected patient is present, the completed result captures normalized inputs, the selected
context, definition version, provenance, and a structured reference verdict in the encrypted patient
vault. A missing or unverified reference remains visible as “Оценка недоступна”; the engine does not
guess a norm. Unit conversion, calendar calculations, and other outputs without a meaningful
reference use `not-applicable`. Only final deterministic numeric mappings create graph points; drafts
and free-text results do not.

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

Each preview result can be stored locally, printed, shared, and written to a patient note. Pediatric
anthropometry is now available through the WHO source module below; medication-dose calculators remain
roadmap metadata until their dosing rules are versioned.

## Pediatric anthropometry and office BP (implemented)

The source module `content/tool-modules/pediatrics-growth.json` defines two schema-driven calculators.
The ВОЗ anthropometry workspace
It accepts exact date of birth, measurement date, sex, measurement position, length/height, weight,
head circumference, and mid-upper-arm circumference. One run calculates every filled and applicable
indicator: BMI; WHO 0–5 length/height-for-age, weight-for-age, weight-for-length, weight-for-height,
BMI-for-age, head-circumference-for-age, and MUAC-for-age; and WHO 5–19 height-for-age, weight-for-age,
and BMI-for-age. Each z-score and percentile is numeric, rendered through the shared chart schema,
print pipeline, and observation mappings.

The embedded reference data are the official machine-readable WHO `anthro` and `anthroplus` tables.
The engine applies the WHO LMS formula, interpolation, age/length boundaries, and the documented
adjustment beyond ±3 SD. It refuses unsupported ages and omits indicators whose measurement or age
range is not applicable. There is intentionally no single normal/abnormal verdict across different
anthropometric indicators; clinical interpretation remains contextual and longitudinal.

Required inputs and `atLeastOne` input groups are declared in schema data, marked in the form, and
disable Calculate until the minimum input set is present. Patient selection explicitly prefills date of birth, sex, and recent bound measurements. Saving is an
explicit user action: it appends a dated immutable calculator event and observations, including the
source links and normalized inputs, without silently overwriting existing data.

The separate office-BP calculator accepts exact dates, sex, height, and both mean SBP/DBP values for
ages 1–17. Below 13 years it uses the nearest measured-height column from AAP Tables 4–5 without
inventing interpolation; at 13 years it switches to the corrected fixed adolescent thresholds. It
classifies one visit, not hypertension, and records the entered measurements in patient dynamics.
The full AAP table transcription is experimental pending a redistribution-permission decision.

Related calculations remain separate reference families even when the workspace links to them:

- Fenton uses gestational/postmenstrual age for preterm infants and remains a neonatal calculator;
- ECG measurements and interpretation remain in the dedicated ECG calculator.

AnthroCalc is a UX and coverage reference only. MiniMed does not copy its implementation, bundled
reference data, or interface. WHO provenance is recorded in the schema, but distribution rights for
the underlying tables still require a release review; a repository code license is not assumed to
license the data automatically.

Fenton 2025 is not approximated from chart pixels or replaced by the 2013 reference. The current LMS
coefficients and official oracle cases must be obtained from University of Calgary with terms that
allow offline embedding and redistribution before that calculator can be released.

## References display

Every calculator page exposes its source links in a native disclosure before data entry. The saved-result
"Источники и ограничения" panel retains publisher, version, review date, population and limitations.
For calculators with more than one or two sources, a richer table (title/publisher, edition or publication
date, reviewed date, page/section, link) remains a later presentation improvement. A book source has no
link, and MiniMed itself never appears as a source row.
