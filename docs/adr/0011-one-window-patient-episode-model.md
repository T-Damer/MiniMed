# ADR-0011: One-window patient and episode model

- Status: accepted
- Date: 2026-07-21

## Context

MiniMed should let a clinician or student start with one free-text query and continue in the same surface. Patient-specific queries may need to be found later, continued, or compared with similar prior cases.

Semantic similarity alone cannot identify a patient: common symptoms can make unrelated patients appear nearly identical. Automatic merging would contaminate clinical context and subsequent recommendations.

## Decision

Use three separate records:

- `WorkspaceThread` — the complete query, clarification, retrieval, and navigation history;
- `PatientProfile` — optional local identity and stable longitudinal facts;
- `ClinicalEpisode` — one problem, encounter, or period of care linked to a patient when known.

The system may propose three distinct actions:

1. possible patient match, based primarily on stable local identifiers and corroborating demographics;
2. possible episode continuation, based on patient match plus temporal and clinical context;
3. semantically similar case, based on symptoms, investigations, treatment, and outcomes.

No proposal changes stored data until the user explicitly accepts it. A rejected or ignored proposal creates a new episode and may retain a non-owning link to the similar case. Every copied or confirmed fact records its origin.

General educational queries remain workspace threads without a patient or episode. A thread can be attached later only through an explicit user action.

## Consequences

- The UI can remain a single search/chat-like surface while the domain model stays explicit.
- Vector search is useful for related-case discovery but never serves as patient identity resolution.
- Patient storage requires encryption, no clinical logs or telemetry, explicit export/delete, and a temporary no-save mode before the feature is released.
- The patient workspace remains a local clinical notebook rather than an EMR claim before 1.0.