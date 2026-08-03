# Medication interaction checking

## Decision

MiniMed treats drug interaction checking as deterministic clinical pharmacology rather than free-form model generation.

The checker only returns a positive or negative clinical conclusion when a reviewed interaction assertion exists. If no reviewed assertion matches a pair, the result is `unknown`: absence of a relation is not evidence of compatibility.

The first browser pilot uses the same logical shape as the existing knowledge graph:

- normalized medication entities and aliases;
- medication-class membership;
- reviewed interaction assertions;
- explicit conclusion, severity, certainty, mechanism and clinical action;
- source metadata and short exact evidence excerpts.

The reusable relational persistence target is the existing set of `knowledge_entities`, `medication_profiles`, `knowledge_relations` and `knowledge_evidence` tables. Interaction-specific values are stored in relation predicates/status and structured relation metadata rather than creating an incompatible second graph.

## Supported conclusions

The engine never returns a bare boolean. It uses one of:

- `contraindicated`;
- `avoid`;
- `management-required`;
- `monitor`;
- `separate-administration`;
- `documented-minor`;
- `documented-no-significant-interaction`;
- `potential-mechanistic-interaction`;
- `conflicting-evidence`;
- `unknown`.

A documented negative assertion is different from `unknown`. The former requires explicit reviewed evidence that a meaningful interaction was not found; the latter means that the connected reviewed graph contains no applicable assertion.

## Initial pilot

The initial browser catalog intentionally remains small and auditable. It includes reviewed official-label assertions for:

- escitalopram with monoamine oxidase inhibitors, including linezolid;
- escitalopram with pimozide;
- fosfomycin with metoclopramide;
- fosfomycin with cimetidine.

Therefore `escitalopram + fosfomycin` returns `unknown`, not “compatible”.

Sources:

- DailyMed escitalopram prescribing information, section 7 Drug Interactions;
- DailyMed fosfomycin tromethamine prescribing information, Drug Interactions.

The clinical model follows the same high-level separation used by FHIR R5 `ClinicalUseDefinition`: a definitional interaction identifies the subject, interactant, type, effect and management information. FHIR is an interoperability reference, not the source of MiniMed clinical assertions.

## User flow

The checker appears in the **Medications** search mode. It can be used directly with comma-, plus- or newline-separated medication names. When query analysis identifies at least two medication facts in an ordinary question, the checker is populated automatically.

Every unique pair is evaluated. Unresolved medication names remain visible and are not silently ignored. The current limit is 20 unique medications per check.

## Safety boundary

The pilot does not yet account for dose, timing, formulation, route, renal or hepatic function, electrolytes, pregnancy, age or patient-specific risk factors. These dimensions belong in future applicability constraints attached to assertions. The result remains decision support and must preserve access to the current official source.

A local model may later summarize the deterministic result, but it must not create, upgrade or negate an interaction assertion.
