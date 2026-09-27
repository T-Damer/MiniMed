# Definition reference 2026.9.28: KR glossaries, abbreviations, lexical glosses

Moved from `docs/CURRENT_STATE.md` on 2026-09-28. Local edition only; not published.


- **New parser, not a new source.** `tools/ingest/src/localmed_ingest/clinical_definition_sections.py`
  splits the 541 `definition-section` records already sitting in
  `clinical-source-excerpts-2026.09.21` (previously excluded from every edition) into individual
  verbatim term→definition pairs. It only promotes a whole paragraph as the entry's own definition
  when the heading is specifically `N.N Определение заболевания…` (109 full glossary sections + 190
  disease-definition promotions + 22 partially-parsed sections; 32 nonstandard and 8 placeholder
  sections are left out and listed, not force-parsed); a separate pass reads 597 `Список сокращений`
  records into a distinct `kind: "abbreviation"` type. Same-title/same-wording repeats across KR
  documents fold into one entry with multiple citation blocks; different wording under the same
  title stays separate and flagged `conflicting-definition`/`conflicting-expansion` (66 / 1 034
  distinct titles). Draft file:
  `content/definition-drafts/clinical-glossary-and-abbreviations-2026.09.28.json` (706 clinical
  definitions + 6 418 abbreviations after 3 entries were dropped for colliding with an
  already-applied external-source completion).
- **Scope selection now has three explicit record types.** `definition_reference_scope.py` used to
  drop every Wiktionary gloss and could not admit an abbreviation type at all. It now selects three
  disjoint kinds — clinical definitions, `kind: "abbreviation"` (`coverage: "abbreviation"`), and
  Wiktionary `text_kind: "source-gloss"` lexical glosses (`coverage: "gloss"`) — each gated by its
  own coverage label so one can never be silently counted as another. The UI must read
  `knowledge_entities.kind = 'abbreviation'` for abbreviation cards and
  `metadata.textKind = 'source-gloss'` (equivalently `coverage = 'gloss'`) to label a card
  "Викисловарь"; this is not yet wired into `apps/app`.
- **Edition `2026.9.28` (experimental-preview, DEV-only, not published):** 30 132 entries (16 069 in
  `2026.9.27`): 9 180 clinical definitions (+706 over the 8 474 baseline), 6 939 Wiktionary lexical
  glosses (0 → 6 939, previously fully excluded by scope), 6 418 abbreviation expansions (new
  type), 7 595 names still `needs-definition`. Installed 175 824 896 bytes, gzip 38 959 050 bytes,
  sha256 `5bd71c47…9faa3` (db) / `a5b06803…4f7f` (gz). Verified with
  `scripts/verify-definition-reference.ts`: all 22 056 source name surfaces found, 0 missing.
  Report: `docs/research/clinical-glossary-extraction-2026-09-28.json`.
- **Missing-name closing effect (of 7 637 `needs-definition` titles):** 452 now have a same-title
  clinical-definition candidate (421 baseline + 31 from the new KR glossary split; review queue in
  `docs/research/definition-review-queue-2026-09-28.{json,md}`, no auto-merge), 860 have a
  Wiktionary lexical gloss only, 14 match an abbreviation only, 6 311 still need an external
  specialist source. A same-title match is a sense-check signal, not a same-as relation.
