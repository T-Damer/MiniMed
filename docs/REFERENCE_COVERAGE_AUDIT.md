# Reference coverage and reader clarity — 17 September 2026

Read with `CONTENT_BACKLOG.md`, `CONTEXT.md` and `RUSSIAN_TERMINOLOGY.md`. This is a source-code
review and a proposed coverage plan, not a completed audit of the user's installed databases.
No provider calls, paid inference, new source downloads or Actions runs are required by this patch.

## Observed on 0.6.39 (`d85750c`)

- GitHub code search found no `Ясперс` or `PANSS` hits. This does not establish absence from binary
  SQLite packs. `PHQ` leads to the existing clinical-content backlog, not an implemented PHQ module.
  Apgar, EPDS, Ferriman–Gallwey and Whooley are already listed as implemented. Educational psychology
  profiles must not be counted as clinical assessment coverage.
- Inline links filter the current document family by ID, but another source with the same title
  can still produce a self-looking link. An illustrated reference pointer and a clinical source
  pointer are not interchangeable. Never deduplicate them by title or discard their evidence.
- Generated pointer section order is not content-first. The reader also has a separate download
  banner preceding sections, and several source kinds lack a visible human-readable reader label.

## Narrow code changes in this draft

- Reorder only generated `core_catalog_pointer` root subtrees so an existing `Краткое описание` or
  `Определение` precedes routing metadata. Keep all original section/chunk objects and anchors, and
  do not change full clinical source-document ordering.
- Suppress inline candidates equal to the current title/short title after case/whitespace/ё folding.
  This is a presentation decision, not an identity crosswalk. Keep related terms and explicit
  alternative-source choices from other documents; do not use broad search aliases for suppression.
- Add regression cases for these policies. Local execution is unavailable; these tests, formatting,
  type checks and browser behavior have not been executed in this continuation. Keep the PR draft.

## Next content slice, not claimed implemented

Build on the existing tool schemas and concept layer; do not add a competing glossary database.
Represent a criterion set, severity/staging classification, screening questionnaire, rating scale
and calculator as different object kinds. A historical descriptive criterion set is not a numeric
score or automatically a currently recommended diagnostic rule.

Each catalog object needs source-backed names/eponyms/abbreviations, specialty memberships, intended
purpose/population, source edition, Russian-language provenance, last verification date, rights and
separate availability flags for metadata, explanatory text and a runnable validated form. A bare
surname such as `Ясперс` may have several contextual results; do not turn it into one forced synonym.
No medical definition, score threshold or question wording is authored from memory by this audit.

Candidate registries, checked 17 September 2026:

- Russian clinical-recommendation source texts already collected by MiniMed: inventory their named
  scales, diagnostic criteria, severity tables and assessment appendices with exact section anchors.
  First compare raw/prepared/pack/index layers before assuming another download solves a miss.
- Mapi Research Trust PROQOLID / ePROVIDE: instrument descriptions, developers, languages and use
  conditions. It is a discovery/permissions registry, not a blanket redistribution license:
  https://www.mapi-trust.org/services/eprovide/proqolid
- NINDS Common Data Elements: disease-specific recommended instruments and copyright notices.
  Proprietary questionnaires are not provided by the registry for unrestricted copying:
  https://commondataelements.ninds.nih.gov/General%20%28For%20all%20diseases%29
- HealthMeasures / PROMIS: original measures, translations and administration rules. Translations
  and electronic implementation require the applicable permissions; availability is not permission:
  https://www.healthmeasures.net/explore-measurement-systems/promis/obtain-administer-measures

Measure coverage against an explicit specialty checklist, not the claim "all knowledge for a doctor".
Missing source text, blocked redistribution, missing index metadata and retrieval failures must be
separate report outcomes. Author/source name alone must not make an item appear clinically current.

## Follow-up reader and retrieval acceptance gates

1. A term card, reference article, clinical guideline and a pointer have distinct labels, sources and
   availability states. Brief content comes first; routing/download details come afterward. The
   separate reader download banner and target-type labels still need their own implementation.
2. One concept can display multiple clearly labelled sources. Deduplicate only verified identical
   source/version or discovery/detail relationships; same title is insufficient. No source-text loss.
3. For a known but uninstalled tool, lookup returns its catalog entry and a precise download action.
   A text-only criterion set never offers an invented score. An available metadata entry is not
   reported as a completed, validated questionnaire.
4. Regression inventory includes `Ясперс`, `критерии Ясперса`, Russian/Latin instrument names,
   abbreviation-only queries and words found only inside definitions. Expected IDs and source
   anchors must be established from real corpus evidence, not fabricated to make tests pass.
5. Reproduce the user's `Анафилактический шок` route on installed data, record the two document IDs
   locally, check their source/version/target metadata and compare index-only versus full-pack states.
   No patient/query telemetry or upload is introduced. A source-code diagnosis is not that device test.
