# Definition reference 2026.9.29: abbreviation-list bugfix, dedup fixes, edition rebuild

Local edition only; not published. Supersedes
[definition-reference-2026-09-28.md](definition-reference-2026-09-28.md)'s "known data bug" note.

## What changed and why

1. **Fixed the `Список сокращений` mislabeling bug** (`scripts/extract_prepared_definitions.py`).
   ~596 `explicit-definition` records were a whole "Список сокращений"/"Сокращения" block
   mislabeled as the definition of the block's first acronym (the `ABBREV_HEADING` guard, added
   uncommitted by a prior agent, stops that). To avoid silently losing the raw text those blocks
   still are for `tools/ingest/src/localmed_ingest/clinical_definition_sections.py`'s abbreviation
   splitter, a new dedicated `coverage: "abbreviation-section"` capture was added: the whole block,
   verbatim, under the document's own title — no chunk-position or source-type restriction, so it
   also picks up 335 abbreviation-list sections the old (buggy) code silently dropped entirely.
   Regenerated **offline, no network fetch**, from the same 744 pinned per-document SQLite packs,
   located locally at `output/release-0.6.33/packages/` and verified byte-identical (sha256) to the
   `databaseSha256` already recorded in the previously committed extraction. Full diff (596 removed,
   935 added, 10 486 unchanged records verified byte-identical):
   `docs/research/definition-abbreviation-lead-bugfix-2026-09-27-diff.json`. 2 of the 4 recovered
   lead-paragraph records have a `sectionTitle` that does not match their own body text (a
   pre-existing heading/body misalignment in that KR document's own structure); flagged in the diff
   report, not repaired.
2. **Fixed trailing-punctuation over-splitting** (`clinical_definition_sections.py`). The
   glossary/abbreviation dedup key hashed the raw quote, so "антибактериальная терапия",
   "антибактериальная терапия." and "антибактериальная терапия;" each minted a separate record.
   The fold key now strips trailing `.`, `;`, `,` and whitespace; each citation block still keeps
   its own untouched verbatim quote. Regression tests added
   (`tools/ingest/tests/test_clinical_glossary_sections.py`).
3. **`parentTitle` misattribution** (the UI agent's `АД → парент "АВП"` report) was a symptom of
   bug (1): the buggy `prepared.lead.*` record's title (the block's *first* acronym) leaked into
   `parentTitle` for every pair parsed out of that block. Fixed by construction once (1) is fixed —
   `abbreviation-section` records are titled with the real document title. Confirmed with a raw-text
   check against `kr.rf.451_3`/`650_2`/`675_2` (the source lines were never actually shifted; this
   was never a table/OCR row-alignment bug) and locked in with a regression test.
4. **Catalog description now built from real per-record-type counts**
   (`scripts/prepare-definition-reference.py`). It used to report one lumped
   "N исходных определений" figure that silently included abbreviation expansions and Wiktionary
   glosses. It now reads `selection.selectedByRecordType` from `definition_reference_scope.py`
   (already computed, already separates `clinical-definition`/`abbreviation`/`lexical-gloss`) and
   composes a properly Russian-pluralized, per-type description. New catalog-entry description:
   *"8 582 клинических определения, 8 369 расшифровок сокращений, 6 939 лексических толкований:
   определения и расшифровки с исходными формулировками и ссылками…"*.
5. **3 external-source name-completions superseded.** Regenerating surfaced 3 names
   (`Ксеростомия`, `Многоплодная беременность`, `Инфекционный эндокардит`) that a KR glossary entry
   now defines natively, while an existing MSD/clinic-site completion
   (`clinic-completions-2026.09.23.json`, `msd-topic-completions-2026.09.23.json`) also targeted the
   same name — `apply_name_completions` correctly refuses to complete an already-defined name, so
   the build failed until those 3 targets (and their now-orphaned blocks/sources) were removed from
   the two completion files, with `completion-inputs.json` updated to the new byte counts/sha256.
   Nothing about the *other* targets in those files changed.

Also unified the "Список сокращений" line-splitter shared by `clinical_definition_sections.py` and
`clinical_aliases.py` (core search aliases) into one module
(`tools/ingest/src/localmed_ingest/abbreviation_line_parsing.py`) and produced a reconciliation
report between the two paths — see
[abbreviation-alias-reconciliation-2026-09.md](abbreviation-alias-reconciliation-2026-09.md). No
change to `core.db` or its aliases.

## Regenerated source drafts (replacing the previous ones)

| File | Records | Bytes | sha256 |
|---|---:|---:|---|
| `clinical-source-excerpts-2026.09.21.part-01.json` | 5 062 | 15 648 028 | `77dc7dbf…4fc` |
| `clinical-source-excerpts-2026.09.21.part-02.json` | 4 828 | 15 637 871 | `7f2c607d…610` |
| `clinical-source-excerpts-2026.09.21.part-03.json` | 1 531 | 4 212 776 | `dd750343…313` |
| `clinical-glossary-and-abbreviations-2026.09.29.part-01.json` | 7 159 | 15 640 708 | `e70d0b70…4a` |
| `clinical-glossary-and-abbreviations-2026.09.29.part-02.json` | 1 913 | 5 286 102 | `ce5d469f…b1` |

(Repacked from 5+1 files into 3+2 to stay within the 16 MiB per-input / 32-input manifest budget
after the record count grew; `content/definition-drafts/clinical-source-excerpt-assets.ts` updated
to match. `clinical-glossary-and-abbreviations-2026.09.28.json` deleted — superseded, not a raw
source.) `content/definition-drafts/source-inputs.json`: 31 inputs, 27 790 entries (was 32/25 503).

clinical-source-excerpts byCoverage after the fix: `abbreviation-section` 932 (was 0), `definition-section`
541 (unchanged, byte-identical), `explicit-definition` 7 632 (was 8 224), `section-excerpt` 2 317
(unchanged). clinical-glossary-and-abbreviations: 703 clinical-glossary entries (was 706), 8 369
abbreviation entries (was 6 418).

## Edition 2026.9.29 (experimental-preview, DEV-only, local build only — no upload/publish performed)

Built with `prepare-definition-reference.py --publication-state experimental-preview --artifact-url
https://github.com/T-Damer/MiniMed/releases/download/definition-reference-2026.9.29/minimed.definition.reference.2026.9.29.db.gz`
(placeholder future-release URL, matching the naming convention of prior editions; nothing was
actually uploaded or a release created).

- **31 488 entries** (was 30 132): 192 311 296 bytes installed, 42 165 531 bytes gzip.
- `sqliteSha256`: `sha256:0e00c19e…d2`; archive `sha256:274ca6ec…60`.
- Files: `data/build/definition-reference/2026.9.29/minimed.definition.reference.2026.9.29.db{,.gz,.catalog-entry.json,.report.json}`.
- Verified with `bun scripts/verify-definition-reference.ts … 31488 corpus`: all **23 279** source
  name surfaces found, **0 missing**. `data/build/definition-reference/2026.9.29/verify-report.json`.

### Gap inventory (rerun)

| | 2026.9.28 | 2026.9.29 |
|---|---:|---:|
| sourceRecords | 30 132 | 31 488 |
| definitionRecords | 9 180 | **8 582** |
| pendingRecords (`needs-definition`) | 7 595 | 7 598 |
| — ready-for-source-research | 7 143 | 7 144 |
| — same-title-definition-needs-sense-review | 452 | 454 |

**`definitionRecords` going down (9 180 → 8 582, −598) is the fix working, not a regression.** The
old figure double-counted: −592 net from removing the 596 buggy `prepared.lead.*` records (each
previously counted as its own "definition") while only 4 genuine ones were recoverable, −3 from the
glossary's own trailing-punctuation dedup, −3 from the 3 superseded completions above. Every one of
those removed records was either the same abbreviation list re-labelled under a different acronym or
an exact duplicate of a still-present record — nothing that was a real, distinct clinical definition
was lost; `docs/research/definition-abbreviation-lead-bugfix-2026-09-27-diff.json` lists every
removed id with its reason.
`docs/research/definition-gap-inventory-2026-09-29.json` /
[definition-review-queue] regenerate pending if a fresh same-title queue export is needed later
(452→454 pairs; not re-exported to `.md` this pass — see boundary below).

### Closed-gap routes — 5 examples each, with provenance

**KR (`clinical_definition_sections.py`, this session's fix directly enabled these 3 + the 2 lead
recoveries below)**

| Title | Excerpt | Source document (KR) |
|---|---|---|
| Многоплодная беременность | «Многоплодной называют беременность, при которой в организме женщины развиваются два или более плодов.» | Многоплодная беременность |
| Инфекционный эндокардит | «инфекционно-воспалительное сердечно-сосудистое заболевание, обусловленное прямой инвазией микроорганизмами…» | (term-glossary section of) Аномалия Эбштейна |
| Ксеростомия | «сухость во рту, вызванная сниженным или отсутствующим выделением слюны.» | (term-glossary section of) Деформация перегородки носа |
| Мононевропатия срединного нерва | «патологическое состояние, вызванное компрессией ствола срединного нерва или его воспалением…» | Мононевропатии |
| Трансплантация лёгкого (лёгких) | «общепризнанный метод хирургического лечения терминальных стадий хронических заболеваний лёгких…» | Трансплантация легкого (легких)… |

**MSD Manual Professional (`msd-definitions-2026.09.23-b.json`, pre-existing — not extended this
session; see task-2 status below)**

| Title | Excerpt | MSD path |
|---|---|---|
| Ларингеальная дистония | «периодический спазм гортанных мышц, который вызывает нарушение голоса» | `.../заболевания-гортани/дистония-гортани` |
| Гемифациальный спазм | «односторонние безболезненные синхронные сокращения мышц лица…» | `.../гемифациальный-спазм` |
| Гиперспленизм | «цитопенический синдром, обусловленный спленомегалией» | `.../гиперспленизм` |
| Пролактинома | «нераковые опухоли, образованные лактотрофами гипофиза» | `.../пролактинома` |

(Only 4 exist in this file; none added this session — see below.)

**Specialist journals (`specialist-journal-active-2026.09.22/*`, pre-existing, CC BY-NC-SA 4.0 —
not extended this session)**

| Title | Excerpt | Journal / DOI |
|---|---|---|
| Негативная галлюцинация (НГ) | «характеризуется отсутствием восприятия объектов… при неповреждённом сенсорном канале» | Неврологический вестник, 10.17816/nb14094 |
| Синдром Котара | «характеризуется галлюцинаторным отрицанием своего «Я» и «бредом отказа»…» | Неврологический вестник, 10.17816/nb14094 |
| Алекситимия | «трудность выявления, описания своих чувств, неспособность к дифференциации и вербализации своих эмоций» | Неврологический вестник, 10.17816/nb14094 |
| Симптом | «индуктивная, стандартизированная, абстрактная категория» | Неврологический вестник, 10.17816/nb20398 |

**Wiktionary (`ruwiktionary-2026.9.16.json`, CC BY-SA 4.0, unchanged this session)**

| Title | Gloss |
|---|---|
| кокцидиоид | «биол., мед. паразитический грибок, возбудитель кокцидиоидоза» |
| карбапенем | «фарм. группа бактерицидных препаратов широкого спектра…» |
| анурия | «мед. отсутствие поступления мочи в мочевой пузырь» |
| дистрактор | «мед. инструмент… применяемый при хирургических операциях…» |
| аффектация | «психол. преувеличенное выражение какого-либо чувства…» |

## Task 2 (external sources) — mostly deferred, with a concrete reason

`clinic_definition_completions.py`'s `verify_excerpt()` caps a quote at 25 words combined per
source URL — calibrated against the already-connected consumer-oriented sites (invitro.ru,
smclinic.ru, dermatology.ru). Live MSD Manual Professional (RU) browsing this session found its
lead-paragraph sentences for complex syndromes routinely run 30–40 words (e.g. short-QT syndrome's
defining sentence is 38 words) with no shorter self-contained clause available; several high-priority
candidates (short/long-QT syndrome, SIDS) could not be fit under the cap without cutting mid-clause,
which was rejected. `docs/research/definition-gap-priority-2026-09-27.json` — a from-scratch priority
scoring (mirrors and documents the methodology in
[definition-gaps-2026-09.md](definition-gaps-2026-09.md); the original one-off script was never
saved to the repo) — is available for a follow-up pass, along with the finding above so a follow-up
agent doesn't re-discover the word-budget mismatch from scratch. No MSD or journal network fetches
were performed against new candidates this session; the 4 MSD + journal entries already in the
corpus predate this session.

## Boundary

Source-extraction-only; no clinical/independent reverse-search/device qualification or new-release
rights implied. A same-normalized-title match is a sense-check signal, not a same-as relation — the
452→454 same-title review queue still needs an editor's pairwise decision, no auto-merge performed
or implied.
