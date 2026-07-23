# Product contract

## Purpose

MiniMed helps a clinician navigate a trusted local medical corpus while reviewing a patient case. It is
retrieval-first: the source remains primary, and generated text is always optional and subordinate.

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
calculation or prescription.

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
- evidence-linked diagnostic, dose, and document suggestions.

Not current priorities:

- Android/iOS parity;
- a Rust rewrite;
- accounts, sync, telemetry, or a hosted backend;
- autonomous diagnosis or prescribing;
- automatic corpus maintenance without owner-selected sources.

## Success

- Recall@5, exact-anchor resolution, provenance, and zero-result gates stay green as the corpus grows.
- Explicitly named diagnoses and medicines rank their matching source highly.
- Unsupported model output is rejected without hiding deterministic results.
- Physicians reach the relevant source passage faster than by opening documents manually.
- Corpus updates are reproducible from declared inputs and checksums.
