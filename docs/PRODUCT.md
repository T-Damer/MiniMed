# Product contract

## Purpose

MiniMed helps a clinician navigate a trusted local medical corpus while reviewing a patient case. It is
retrieval-first: the source remains primary, and generated text is always optional and subordinate.

MiniMed is currently a personal offline-first tool. Its longer-term product direction is a general
clinical workspace for physicians, with the first broad clinical focus on outpatient therapy for
children and adults. Specialty clinicians should be able to use the same patient workspace,
calculators, questionnaires, and locally authored tracking templates without requiring a separate
specialty application.

The target workflow is:

```text
patient case
  → deterministic query analysis
  → local retrieval
  → relevant documents and exact fragments
  → optional source-constrained model extraction
  → clinician verification in the original source
```

## Useful outcomes

For a patient case, MiniMed should:

- surface plausible diagnostic candidates to verify;
- show the evidence fragment and document behind every candidate;
- find treatment and dosing passages when they exist in the installed sources;
- state clearly when dosing evidence or required patient inputs are missing;
- open the exact cited location in one action;
- keep working when the local model is absent or fails.

A diagnostic candidate is not a final diagnosis. A quoted dose passage is not a patient-specific
calculation or prescription. A patient-specific calculation is allowed only through an explicit,
versioned deterministic tool whose required inputs, rule source, units, limitations, and evaluation
state are visible.

## Product direction

The intended clinician workflow combines four related capabilities:

1. **Diagnostic support:** accept symptoms and patient context, then return up to five ranked
   diagnostic candidates with red flags, missing discriminating data, reasons for inclusion, and
   exact supporting sources. The list is a differential to verify, not an autonomous diagnosis.
2. **Knowledge retrieval:** find a medication, condition, clinical recommendation, legal act, or
   exact source passage without requiring a model.
3. **Patient-specific tools:** run calculators and questionnaires with explicit patient bindings and
   save completed results as versioned observations when the clinician chooses a patient.
4. **Longitudinal patient work:** keep local patient profiles, visits, files and images, clinician
   notes, measurements, treatment events, and comparable time series.

A medication event records both the standardized MNN identity and, when selected, the exact trade
name/KLP with a dated snapshot of form, strength and source identity. This permits longitudinal
analysis by active substance without losing the product that was actually prescribed or used.

The default diagnostic presentation orders candidates by estimated fit without displaying a numeric
probability. Qualitative likelihood levels remain an optional presentation variant. Numeric
probabilities remain a separate future mode and require a representative labelled validation set,
calibration, and measured performance before they may be shown as probabilities.

## Clinical knowledge graph

MiniMed treats the medical corpus as an evidence-backed graph rather than a set of unrelated
documents. Its canonical node families are:

- `ClinicalFinding` — a symptom, sign, complaint, or measured value;
- `Condition` — a disease, syndrome, clinical state, or diagnostic candidate;
- `Intervention` — a medication, procedure, care method, preventive measure, or other treatment;
- `Investigation` — an examination, laboratory test, imaging study, or diagnostic method;
- `PatientContext` — age, sex, pregnancy, weight, allergy, comorbidity, organ function, and timeline;
- `ClinicalTool` — a calculator, questionnaire, score, rule, or tracking template;
- `SourceEvidence` — the exact source fragment and provenance supporting a statement;
- `ClinicalRelation` — a typed, evidence-backed connection between nodes.

Typical relations connect findings to possible conditions, conditions to investigations and
interventions, interventions to medications or methods, patient context to applicability, and tools
to the concepts they calculate or assess. Each clinical relation keeps its source evidence,
population constraints, validity period, recommendation status, authority, and review state. Its
retrieval weight ranks evidence for a query; it is never presented as diagnostic probability or
permission to prescribe.

Search interprets a query as a requested traversal through this graph. For example,
`жаропонижающее ребенку 4 лет` asks for interventions related to fever and applicable to that age;
`капли в нос ребенку 6 месяцев при насморке` adds route/form and age constraints; and
`давление 200/120` records a measured finding that may lead to conditions, urgent-routing evidence,
investigations, and treatment passages. A measurement alone is not silently converted into a final
diagnosis.

Catalog metadata such as ESKLP can identify medicines, forms, strengths, and trade names, but cannot
by itself establish indications, age applicability, dosing, or symptom-to-treatment relations.
Those edges require traceable clinical or regulatory source evidence.

Clinician-authored content forms a separate personal trust layer. A doctor's note, local rule, or
template may supplement an official source but must never silently become an official MiniMed fact.
Russian official sources define the default applicable profile; international sources remain
separately identified and may supplement or disagree with it.

## Clinician-authored tracking templates

The target workspace generalizes the existing user-questionnaire concept into a clinician-authored
tracking template. A template describes what to collect during a patient visit or repeated
observation: field labels and types, units, allowed values, required context, repeatable groups,
attachments, and numeric observations suitable for charts. A questionnaire is one template type,
not the universal data model.

Template definitions and patient exports need stable, versioned JSON contracts. The same contracts
should be usable by the local UI and by a future API, but they do not imply a hosted backend. A saved
event keeps the template version and field identities used at the time so later template edits do not
rewrite clinical history.

MiniMed's versioned JSON remains the canonical internal model. FHIR is deferred to an import/export
adapter for a concrete external system and profile; it is not an internal storage requirement while
there is no defined interoperability counterparty.

[Gynecology history](https://t-damer.github.io/gynecology-history/) is the concrete product reference:
one patient card, shared demographic data, any number of specialty visits, local persistence, and
portable import/export. MiniMed should retain that workflow while replacing a fixed gynecology form
with physician-defined templates and typed longitudinal observations.

## Data model

The owner supplies good source documents. The deterministic pipeline extracts text and provenance,
normalizes it into authored Markdown, validates it, and builds searchable SQLite packs. Generated model
text never replaces an original paragraph.

Most sources can remain locally versioned. A later update tracker may monitor selected online catalogs
for newer editions, but network access is not part of the primary query path.

## Product invariants

- Search and exact source reading work fully offline.
- Retrieval happens before generation.
- Every displayed model-derived clinical item resolves to retrieved chunk IDs.
- Dose text must be an exact retrieved excerpt containing a numeric dose and regimen.
- The model never silently completes missing facts or calculates a patient dose.
- Deterministic handling owns negation, red flags, validation, and fallback.
- Source text, proposed structure, reviewed knowledge, and generated output remain distinguishable.
- Patient queries and source contents are not logged.
- Private documents, patient data, credentials, and model weights are not committed.

## Scope

Current priority:

- browser experience;
- high-quality Russian retrieval;
- deterministic document preparation and local packs;
- small local models for structured extraction and reranking;
- evidence-linked diagnostic, dose, and document suggestions;
- local protected patient profiles, visits, events, and longitudinal observations;
- versioned calculators, assessments, and user-authored questionnaires.

Not current priorities:

- Android/iOS parity;
- a Rust rewrite;
- accounts, sync, telemetry, or a hosted backend;
- autonomous diagnosis or prescribing;
- arbitrary user-authored clinical formulas or executable code;
- automatic corpus maintenance without owner-selected sources.

## Success

- Recall@5, exact-anchor resolution, provenance, and zero-result gates stay green as the corpus grows.
- Explicitly named diagnoses and medicines rank their matching source highly.
- Unsupported model output is rejected without hiding deterministic results.
- Physicians reach the relevant source passage faster than by opening documents manually.
- Corpus updates are reproducible from declared inputs and checksums.
