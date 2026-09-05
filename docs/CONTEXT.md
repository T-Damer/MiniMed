# MiniMed domain glossary

These names describe the protected longitudinal patient workspace. They are deliberately separate
from ordinary local notes and from the medical-source search index.

| Term | Meaning |
| --- | --- |
| `PatientProfile` | A protected local patient card with a display name or pseudonym, optional record number, birth date, biological sex, and stable context. It is not an ordinary note. |
| `ClinicalEpisode` | A dated «Осмотр» inside one patient card. It can contain text and links to patient events. |
| `PatientEvent` | An immutable tool result or a dated manual measurement, laboratory result, medication event, or note linked to a patient and optionally an episode. |
| `PatientObservation` | A final numeric value from an event, identified by stable `metricId`, canonical unit, observation time, method/version, source, and (when available) a captured evaluation. |
| `ReferenceVerdict` | A structured snapshot of a deterministic reference rule: range identifier, title, explanation, attention level, numeric bounds when available, and source identifiers. |
| `Dynamics` | A read-only longitudinal view grouping observations by `metricId`, unit, instrument/method, scale, and version. Incompatible series are never silently merged. |

Calculators and questionnaires use contract schema version 2. A selected `patientId` is the only
way to fill protected context or persist an instrument result; names and free-text labels are never
used to match a patient. A result without a selected patient can still be calculated, printed, and
shared, but it stays in the ordinary local workflow.

## Medication catalog context

| Term | Meaning |
| --- | --- |
| `MnnCard` | Canonical standardized MNN page/container, not clinical truth. |
| `SmnnNode` | Source SMNN code identifies the exact standardized MNN+form+strength node. |
| `TradeNameRecord` | TN+registration child joined by `smnnCode`, not display name. |
| `TradeNameSupplement` | Allmed trade-name reference attached to an MNN identity; it is not an ESKLP registration/package or treatment evidence. |
| `PackagingImageAsset` | Source-linked Allmed packaging image associated with a trade-name supplement; it does not establish registration, indication, or dose. |
| `KlpPosition` | Exact ESKLP KLP package/producer/holder position keyed by `klpCode`. |

State metadata does not infer dosing/indications/equivalence.

## Clinical knowledge context

| Term | Meaning |
| --- | --- |
| `MedicalConcept` | A stable, source-independent clinical meaning such as a condition, finding, intervention, investigation, anatomy, or care topic. A classification code or a phrase in one document identifies or mentions a concept; it does not become the concept itself. |
| `CanonicalDefinition` | One exact, versioned, source-backed definition selected for a medical concept. Its stable identity points to the original source fragment; compact offline copies may repeat the text but must retain that identity and must not merge wording from several sources. |
| `ConceptName` | A preferred term, synonym, eponym, abbreviation, transliteration, or spelling variant associated with a medical concept. Ambiguous names may refer to several concepts and require context before linking. |
| `SourceMention` | An exact span in a versioned source that refers to a medical concept. Resolution adds navigation and provenance without rewriting the source text or turning the mention into a new clinical claim. |
| `SourceKeyword` | An explicit keyword term published in a source section such as `Ключевые слова`. It is a recall aid for navigation and candidate retrieval, not an exact diagnosis, treatment assertion, or dose rule. |
| `ClinicalFinding` | A symptom, sign, complaint, or measured value observed or stated in a patient context. It is distinct from a diagnosis. |
| `Condition` | A medical concept representing a disease, syndrome, clinical state, or diagnostic candidate that may explain findings. |
| `Intervention` | A medication, procedure, care method, preventive measure, or other action used in management. |
| `Investigation` | An examination, laboratory test, imaging study, or other diagnostic method. |
| `PatientContext` | Applicability facts such as age, sex, pregnancy, weight, allergy, comorbidity, organ function, and timeline. |
| `ClinicalTool` | A versioned calculator, questionnaire, score, rule, or tracking template with explicit inputs and interpretation. |
| `SourceEvidence` | The exact source fragment and provenance supporting a clinical statement. |
| `ClinicalRelation` | A typed connection between clinical nodes with source evidence, applicability, validity, authority, recommendation status, review state, and a retrieval weight. The weight is not a diagnostic probability. |
