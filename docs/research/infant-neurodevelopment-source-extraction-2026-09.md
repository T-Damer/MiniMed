# Infant neurodevelopment milestone extraction — 2026-09-19

## Source and scope

A Ministry of Health-hosted 2025 clinical-approbation protocol contains an individual patient
registration form with an explicit **«Таблица оценки нервно-психического развития»** for ages
1–12 months.

Source PDF:
https://static-0.minzdrav.gov.ru/system/attachments/attaches/000/076/274/original/2025-44-8.pdf?1754462317=

The table was visually checked across the five PDF pages carrying the checklist before transcription.

Important source-context limitation: this is a registration form inside a clinical-approbation
protocol developed by the Ural Research Institute of Maternal and Infant Care, not a standalone
national normative guideline for healthy-infant development. MiniMed therefore stores the extraction
as research evidence only.

## Structured artifact

`docs/research/data/infant-neuropsych-development-milestones-minzdrav-2025.json`

The dataset contains:

- complete month sequence 1–12;
- 69 source-row milestone concepts;
- source domain codes for visual/auditory responses, emotions/social response, hand/object actions,
  gross movement, receptive/expressive speech and self-care skills;
- compact semantic IDs rather than copied full source sentences;
- the source's binary checklist contract: observed skill = 1, absent skill = 0.

No total-score interpretation or developmental-delay threshold is included.

## Why the text is normalized instead of copied

The source table is useful for concept discovery and age-linked milestone structure, but redistribution
rights for the complete wording were not established. The research artifact therefore stores compact
semantic identifiers and exact source/page provenance rather than reproducing the full table text.

This also makes later comparison against another validated developmental source easier: identity can
be matched at the milestone-concept level without treating wording differences as new clinical facts.

## Promotion gate

Before this can become a MiniMed developmental tool/reference:

1. identify an independent normative/validation source for the checklist or each retained milestone;
2. establish the intended population (healthy infants vs neurological follow-up);
3. review the exact scoring/interpretation contract;
4. verify Russian wording/terminology and any redistribution rights;
5. define how prematurity/corrected age affects age matching;
6. explicitly abstain rather than diagnose developmental delay from one missing skill.

Until then the artifact remains `review-required`, `publicationState: blocked`.
