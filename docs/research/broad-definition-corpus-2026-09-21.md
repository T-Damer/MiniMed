# Broad medical definition corpus — 21 September 2026

## Product requirement, not a small demonstration dictionary

The user explicitly rejected a 36-card pilot as insufficient. The requested product is a broad
Russian reference with definitions, symptoms, syndromes, signs, eponyms, criterion sets and
classifications; it must also find a term from a remembered incomplete definition. Expanding the
manual pilot by a few entries per iteration does not satisfy this requirement.

An initial planning target is **at least 20,000 source-linked Russian sense/definition records**
across several source families, followed by measured gap-driven expansion. This is an authoring
coverage target, NOT today's measured count, a promise of disjoint medical concepts, or permission
to pad the count with spelling variants, empty cards, duplicate definitions or English-only notes.
The 6,939-sense batch below is a starting corpus, not a ceiling or a claim of complete coverage.
Do not defer all ingestion until clinician review: eligible material can enter a separate
`requires-review` collection. Clinical review, source authority and redistribution rights remain
three distinct checks. Unknown redistribution rights must not be promoted by a review badge.

## Completed full-source step

Code/data integration commit: `a14588dfb95e6480f35e2ac1a869b3225fd3ad83`.
Measured workflow: https://github.com/T-Damer/MiniMed/actions/runs/35605241721
The first attempt failed only at an unsupported `process.resourceUsage()` call in Bun 1.2.3;
the successful rerun reports current RSS through `process.memoryUsage().rss`, not an invented peak.

The entire previously collected and released Russian Wiktionary/Kaikki medical selection was
projected into the new compact glossary, with no handpicked sampling:

| Measured quantity | Value |
| --- | ---: |
| Original Russian source senses | 6,939 |
| Distinct original names | 6,661 |
| Supplied Russian gloss strings | 6,940 |
| Existing editorial starter entries | 36 |
| Entries in the combined lookup | 6,975 |
| Source-catalog rows in the combined lookup | 6 |
| Compact source JSON bytes | 4,302,994 |
| Deterministic gzip comparison bytes | 999,668 |

This is reuse and integration of an existing real corpus, not a claim that these source texts were
newly authored or newly crawled in this pass. Homonyms and source-specific senses retain their
original identities; the combined count is not a deduplicated count of canonical clinical concepts.
Not every supplied gloss is a complete clinical definition. The simple cross-reference prefix
heuristic returned zero flagged records; that does not establish that all glosses are substantive.

Source subject memberships overlap: medicine 4,647; anatomy 938; physiology 401; pharmacology 204;
psychology 517; psychiatry 407. Original labels, definitions, source line/sense, record checksum and
archive checksum are retained. Source attribution/license/history links appear on the source-gloss
cards, while editorial drafts keep a different label. No model translation, invented synonym,
scoring rule, same-as edge or clinician approval was added.

The generated payload is `content/definition-drafts/ruwiktionary-2026.9.16.json`; it is reproducible
using `scripts/build-definition-corpus.py` from the existing `senses.jsonl.gz` and `source.json`.
The builder refuses existing output paths and rejects incomplete expected counts, duplicate
identities, wrong source snapshots/pages, empty glosses and unadmitted subjects. One numeric source
reference per entry replaces repeated collection-level bibliography. The exact per-entry locator
and record checksum are deliberately not removed to save bytes.

The same optional DEV lookup now loads the full source corpus alongside the original 36 entries.
It builds one shared inverted index rather than independently scoring shards and concatenating
incomparable result lists. Ordinary MedicalCore document retrieval, released SQLite packs and APK
remain unchanged; this is not yet a production optional-module rollout.

## Actual verification and failures

The successful run executed 11 Python exporter tests and all 65 existing definition Vitest tests,
formatted the touched TypeScript files with the locked toolchain, and audited every source-name
surface against the combined 6,975-entry lookup. It uploaded no Actions artifacts. The completed
one-time write workflow was removed; the ordinary builder and quality runner remain in the repo.

| Whole-source / new-probe measurement | Result |
| --- | ---: |
| Normalized source-name surfaces | 6,657 |
| Source record first for its exact name | 6,637 / 6,657 |
| Every same-name source sense present in Top-20 | 6,654 / 6,657 |
| New descriptive probes | 40 |
| Expected names present in the combined corpus | 36 / 40 |
| Descriptive Top-1, among present targets | 11 / 36 |
| Descriptive Top-5, among present targets | 16 / 36 |
| Descriptive Top-20, among present targets | 16 / 36 |

A source-name Top-1 miss can include a same-name editorial card coming first; it is not automatically
an unrelated result. The three missing same-name groups are `об`, `в/в` and `при`, exposing an exact
lookup gap for short abbreviations/stop words. Do not silently relax their audit away.

The 40 descriptive probes were authored before inspecting imported gloss texts and were not inserted
as aliases or used to retune this import. They are still public development probes, not private
clinician qualification. Four expected names (атаксия, дисметрия, ортопноэ, брадипноэ) lack an exact
name/alias target in this selection. Another 20 present targets are absent from Top-20 for their
respective descriptive query. Preserve both the corpus gap and retrieval gap. The previous small
pilot's 19/20 Top-1 result is not a large-corpus quality claim.

Warm name lookup p50/p95 were approximately 0.030/0.344 ms on the CI host. Index construction was
630 ms. Current process RSS after the audit was 270,512,128 bytes. RSS includes Bun and the whole
benchmark process, multiple parsed representations and index structures: it is neither incremental
index memory, a measured peak, nor Android/WebView memory. JSON/gzip figures are payload bytes,
not an installed SQLite size or total application footprint.

No full-workspace typecheck/build, browser rendering, production-bundle exclusion audit or physical
Android validation was completed in this data/engine run. Overall PR readiness is not established.
The exact measurements and all 40 outcomes remain in `bulk-definition-size-2026-09-21.json` and
`bulk-definition-quality-2026-09-21.json` beside this note.

## Ordered expansion after this batch

1. Import definitions from existing prepared Russian clinical recommendations, educational material
   and psychiatric reference sources. Preserve actual definition paragraphs and complete criterion
   lists with edition/page/section anchors. Record missing definitions instead of inventing them.
2. Use existing Krasota i Meditsina preparation/crawl tooling for an additional review-required
   source batch. Separate a short definition from a full article; retain rights decisions and source
   coordinates. No new bulk import from that site is claimed in this completed batch.
3. Add further explicitly licensed Russian dictionary/encyclopedia extracts with sense-level
   filtering. Detect source duplicates without merging homonyms or different meanings of eponyms.
   Coverage counts must separate distinct names, senses, full definitions, references and synonyms.
4. Repair generic candidate-generation and morphology gaps using training queries; keep a separate
   held-out clinician-written reverse-search set and corpus-derived exact-lookup audit. Do not add
   every failing test sentence as an alias. Missing terms need content work, not larger reranking
   weights. Exact short-name lookup must not be blocked solely by stop-word removal.
5. Move the qualified glossary into optional, versioned modules through the existing installer and
   storage owner. Measure decoded/transport bytes, index memory, first-query latency and update
   overhead on device before claiming a mobile budget. Do not require complete books/articles,
   their images or an entire language dictionary merely to show a definition.

The existing MeSH collection provides separate English definition coverage; it must not inflate
Russian-definition counts. Etymology remains planned under
`definition-catalog-and-etymology-2026-09-21.md`: shared source/root IDs, original language/spelling,
component translation, and an independent review state. It is not generated automatically as a
byproduct of this larger import.

All work remains in the same draft PR #180 on `experiment/system-one-search-benchmark`, stacked
on #174. No merge or release is implied by the source count or the successful corpus workflow.
