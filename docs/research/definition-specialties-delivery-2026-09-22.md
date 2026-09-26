# Specialty terminology and fuller source cards — 22 September 2026

This pass follows the user's content-first DEV direction: collect useful source records,
update the selected corpus and build the database. No installer compatibility, model adoption,
clinical scoring, release or architecture rewrite was undertaken.

Verified implementation/data commit: `f0510f17fbd00243c51710e68dcf692452342b66`.
Checked input: `bcd70ba6a500822f2a7aa848736d63e8f4693ecb`.
Successful build/verification: https://github.com/T-Damer/MiniMed/actions/runs/35733136461
The work remains in draft PR #180, stacked on #174.

## Coverage actually added

| Measure | Result |
| --- | ---: |
| Previous active source/editorial records | 22,813 |
| Acquired/admitted specialty descriptions before page-ID deduplication | 4,343 |
| Already represented Wikipedia page identities | 1,386 |
| Newly added source records | 2,957 |
| Final active source/editorial records | 25,770 |
| Previously absent normalized name surfaces | 2,629 |
| New page records with names already represented by another source | 328 |
| Final normalized name surfaces | 19,478 |

Source pages come from the explicit specialty selection in
`content/definition-drafts/ruwiki-selection-specialties-2026.09.22.json` and its bounded category
traversal. This extends medicine-related terminology across pharmacology, toxicology, immunology,
hematology, genetics, neuroscience and other selected specialties. Seed selection is not a claim
that every medical specialty or every queued branch was completely acquired.

The proposed kinds of the 2,957 additional records are 2,904 general terms/descriptions,
42 syndromes, five law-labelled entries, two scale-labelled entries, three classifications and
one tool description. These categories are derived from source headings and are not clinical
adjudications. A normalized name, article ID and canonical medical concept are different things.
All new records remain source-local, `requires-review` and `local-dev`.

A page encountered through several disciplines is stored only once. Existing page IDs do not
increase the new-record count; same-named but distinct source identities are not silently merged.
The 1,386 overlapping observations are retained in the authoring acquisition rather than added as
runtime duplicates. The ordinary clinical/editorial/Wiktionary/prepared-source inputs are unchanged.
The supplied owner-only psychiatry material is not uploaded or included in this public delta.

## Existing cards now contain more than introductions

All **61 selected scale/classification cards** were expanded from the introductory snapshot to
source sections rendered from a specified article revision. Together they contain **371 sections
and 49 physical source tables**. These totals include introductions, explanatory material,
limitations and references, not 371 new concepts or 49 independently validated clinical instruments.

Examples checked in the source refresh ledger include:

- Geriatric Depression Scale: six source sections.
- Hospital Anxiety and Depression Scale: six source sections.
- Epworth Sleepiness Scale: four source sections.
- French catheter scale: three sections and one table.
- Anatomical Therapeutic Chemical classification: four sections and one table.

The renderer preserves paragraph and list order, explicit ordered-list start/value markers, table
captions, physical rows, header-cell flags and declared rowspan/colspan. Merged cells are marked in
the plain-text representation rather than guessed into scoring rules. Compact numeric geometry is
stored separately from the cell text, so the table prose is not duplicated in metadata. The existing
reader still receives text on demand; no full JSON corpus is imported into the UI.

The recorded transformations are HTML-to-plain-text formatting, omitted page navigation/scripts
and omitted media. They are not model-written definitions, medical corrections, translated roots,
verified biographies or executable questionnaires. Images are not copied. Tables have an explicit
review-required status. The generic renderer rejects unsupported nested-table/span layouts instead
of quietly dropping cells; no such fallback was needed for these 61 selected cards.

Article revision IDs and exact render-response hashes are both retained. A pinned article revision
alone does not freeze transcluded template versions: the archived API response is the evidence for
the observed rendering. Earlier introduction snapshots remain available for audit, outside the
selected runtime inputs. Attribution, article/history links and the CC BY-SA source declaration are
retained. This does not certify rights to an independently published proprietary instrument.

## Real database and storage costs

The actual final numeric SQLite build has **25,770 records** and **165,785,600 bytes**.
Its gzip transport is **41,734,815 bytes**. Compared with the preceding verified edition, the
increase is 22,024,192 installed bytes and 5,840,261 gzip bytes. These are measured file sizes,
not RAM, install peaks, Android PSS or a claim that the whole application is this size.

Active Wikipedia inputs are composed in
`content/definition-drafts/ruwiki-reference-2026.09.22-v2/records-*.json`.
The existing `source-inputs.json` selects those records plus the unmodified other source families.
Raw acquisition files, response archives and old edition inputs are not phone download dependencies.
Sources and blocks are shared through the ordinary builder rather than embedded as repeated complete
source descriptions in each card. No binary database was committed or published as a release asset.

Prepare the current DEV edition from this branch:

```bash
uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version 2026.09.22-specialties-2 --built-at 2026-09-22
```

Use a new version if that generated output already exists. This builds the local optional reference
and its installer descriptor. It does not replace private source inputs, notes or the released core.

## Executed checks and exact limits of the result

**82 selected Python tests passed**, with zero failures, errors or skips. Scoped Ruff and strict
Pyright checks passed. The synthetic cases cover ordered/nested lists, Unicode and inline text,
physical table geometry, forbidden/unsupported layouts, wrong revision/page rejection, unchanged
source records, page-ID deduplication, local numeric namespaces and immutable generated outputs.

The final SQLite passed integrity and foreign-key checks. **All 31,756 projected source blocks**
were compared against stored text and metadata. Every enriched card was reproduced from its archived
render response with network creation prohibited. The other source inputs retained their hashes.
No approved knowledge facts or relations were created.

The real file-backed application reader returned a nonempty result for **19,478/19,478 normalized
name surfaces**, with a maximum of 20 rows per adapter call. That audit is name availability, not
independent relevance, source-variant completeness or reverse-description performance.

A stricter per-new-record check found the specific new source ID in the first 20 results for
**2,955/2,957** new names. Two IDs remain outside that window:

| New source ID | Name |
| --- | --- |
| `ruwiki.definition.249485` | Хирургическое лечение |
| `ruwiki.definition.50457` | Клиническое исследование |

Both cards exist and are retrievable by ID. Their exact-name Top-20 visibility is an **open search
case**, not passed by substituting an unrelated same-title result. No aliases or ranking weights
were changed to conceal these misses.

All **61 enriched cards**, their **371 blocks** and **380 text slices** were read through the bounded
SQLite reader and reconstructed exactly. Every slice was at most 4,096 Unicode code points; each
source reference resolved. This was a host reader check, not a new browser/Android test, whole-repo
CI qualification or independent clinical/reverse-search assessment.

Machine evidence: `definition-specialties-2026-09-22.json` and the composed source directory's
`refresh-report.json`. The existing Python source replay verifier and ordinary corpus reader verifier
remain in the repository. Earlier reports document earlier editions and should not replace these
current counts.

## Content-first next work

Continue covering actual missing terms and substantive source sections, using both established
clinical source families and explicitly unreviewed secondary material. Separate complete instrument
content from mere descriptions and separately review source-table interpretation before offering
scoring. The two exact-name source-visibility cases above need conservative variant grouping, not
fabricated aliases. An independent reverse-definition set, explicit etymology/root dictionary and
sourced scientist identities remain open; this batch does not claim to complete them.

No private PDF or derived owner text, model weights, APK, released database or Actions artifact was
uploaded. The completed temporary specialty acquisition/rebuild workflows are removed after this
verified delivery; source collectors, data, tests, plan and evidence remain.
