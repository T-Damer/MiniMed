# Content-first terminology delivery — 22 September 2026

The user's current priority is **collecting terms and refreshing databases**. Breaking changes to
DEV code/prepared formats are permitted; backward-compatibility work is not a prerequisite. This
is recorded in AGENTS.md and DEFINITION_REFERENCE_PLAN.md. Personal/private data and source fidelity
are not disposable. No additional installer, memory or model work is claimed in this content pass.

Final data/intake/build commit: `bb9261b6f8e03f5be1367f4a6c10a994c97842a1`.
Successful final verification: https://github.com/T-Damer/MiniMed/actions/runs/35695790543
The earlier acquisition/build completed in `37ba4520a08262eeda143fe4195a3e9ffdc3cd59`.
All changes remain in draft PR #180, stacked on #174; no merge or release.

## Actual added coverage

| Quantity | Final count |
| --- | ---: |
| Earlier source/editorial records | 18,133 |
| Newly admitted Russian Wikipedia introduction records | 4,680 |
| Combined active source/editorial records | 22,813 |
| Previously absent normalized name surfaces | 3,703 |
| Existing normalized names with an additional source | 977 |
| Combined normalized name surfaces | 16,849 |

These are source-local descriptions and normalized names, not that many proven distinct canonical
clinical concepts. Different meanings or sources remain separate. No test phrases were inserted as
aliases, and no English definition was translated to inflate Russian coverage.

The new source's proposed categories are 4,040 general terms/descriptions, 287 syndromes,
234 symptoms, 50 scale/questionnaire descriptions, six classifications, 58 tool/test descriptions
and five law-labelled records. Category proposals derive from source titles/category memberships;
they are not a clinical adjudication. A scale introduction is not a full instrument or newly
implemented scoring method. All new records remain `requires-review`, `local-dev` and source-linked.

Source coverage includes medical terminology, anatomy, physiology, pathology, diagnosis, laboratory
methods, psychiatric material and assessment descriptions. The initial category traversal visited
350 category nodes, selected 5,385 article IDs and made 620 bounded, serial API requests. It stopped
at the declared category budget; queued/unfetched branches are reported, not presented as complete.

## Intake corrections rather than inflated counts

The initial collector admitted 5,187 source descriptions before medical-domain QA. Broad category
inheritance also reached heraldry, headwear, beds, dance and other nonmedical branches. The offline
intake replays archived category edges, excludes declared nonmedical subtrees and preserves pages
that also have an allowed medical path. It does not rewrite any source passage.

Final accounting: **5,187 - 508 quarantined acquired descriptions + one restored source = 4,680**.
The restored page is the Ganser syndrome introduction: a researcher's birth date in the lead must
not cause a syndrome article to be mistaken for a biography. Source names alone still do not become
resolved scientist identities or discovery-priority assertions.

A first intake also revealed an over-broad person-category prefix: `гистологи` matched `гистология`,
and `гастроэнтерологи` matched the medical discipline. Exact category matching restored 255 medical
records compared with that first intake. The actual policy now has a regression test covering
histology, pathological histology, gastroenterology and the separate person categories. The first
intake report is preserved as historical evidence; its smaller count is not the current edition.

Raw acquired shards, rejected candidates and the checksummed API archive remain available for
source audit. **They are not runtime inputs or additional phone downloads.** The active manifest
lists only the `admitted-*.json` source files plus the pre-existing editorial, Wiktionary, clinical
and prepared-tool sources. The shared source descriptor is deduplicated by the ordinary builder.
Domain filtering is not proof that every accepted article is a complete or clinically sound definition.

## Literal source wording and origin notes

Every new card retains the complete returned plain-text introduction, including paragraph breaks
and source-provided origin notes. No model paraphrase, clinical modernization, inferred root
translation or harmonization with the user's textbook was performed. A count of **2,059** leads
containing Greek/Latin/German/English language markers is recorded, but this is **not** a count of
independently verified etymologies or a completed root dictionary.

Each source block retains its article URL, page ID, retrieval time, exact API-response SHA-256,
page-record SHA-256 and author-history URL. TextExtracts can be cached: the observed latest revision
ID is stored as observational metadata, not falsely claimed to prove that the extract belongs to
that revision. The response archive is the fidelity evidence. Images, tables and the remaining
article body are not represented by these introduction-only cards.

The previously extracted 450 records from Semenov/Bersenev (2006) remain a separate private source
module. They are not new records in this public batch, and no owner PDF or derived text was sent to
GitHub/CI. Existing textbook wording is not replaced by Wikipedia descriptions.

## Database actually rebuilt

The final ordinary numeric SQLite edition has **22,813 records**, **143,761,408 installed bytes**
and **35,894,554 gzip bytes**. SHA-256 of the SQLite file:
`79cb3683c44fd761e1b2b17784f4ac6a7336308aa22e0c75b35aecaf6fa5ec2d`.
These are database/transport sizes, not RAM or device measurements. The raw-source archive is not
part of the SQLite download dependency list.

The preparer now consumes `content/definition-drafts/source-inputs.json`, verifying each path,
byte count, SHA-256 and source-record count. The old fixed 18,133-entry condition is removed. The
browser verification harness's expected count also comes from this manifest, although no new
browser run is claimed in this content pass. Future source refreshes replace the selected snapshot
rather than appending duplicate page identities from old and new versions.

The database and local catalog descriptor were built in the verification runner, not committed as
binaries or published as a download. To reproduce the active source edition from this branch:

```bash
uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version 2026.09.22-terms-final --built-at 2026-09-22
```

Use a new DEV version or explicitly remove obsolete generated outputs if that version already
exists. This does not grant permission to delete personal notes or private source inputs. The
ordinary app can then install the prepared local reference through its existing package UI.

## Executed checks and remaining content work

**65 selected Python cases passed, with zero failures/errors/skips**, alongside strict authoring
Ruff/Pyright checks. The final database passed SQLite integrity and foreign-key checks. Every one
of the 4,680 new records was compared against exact source text and provenance in the final SQLite;
all quarantined source IDs were confirmed absent. Original acquisition files remained byte-identical.
The scope replay used an execution network guard and made zero new source requests.

Machine evidence: `definition-expansion-2026-09-22.json`,
`definition-intake-build-2026-09-22.json`, and the source folder's `intake-report.json`.
The acquisition and first-intake reports remain explicitly historical, not competing final counts.
These checks do not establish independent reverse-search relevance, clinical review, whole-app or
Android correctness. For example, the exact-name corpus checks now include брадипноэ, while
дисметрия and ортопноэ still lack exact targets in the active set. Do not declare those gaps fixed
by pointing to an unrelated result or changing ranking weights.

Continue with missing medical category/source coverage, substantive definitions and fuller
scale/classification source sections. Preserve incomplete instruments and candidate biographies as
separate queues until the source supplies enough information. Content expansion remains the work
priority; SemIf and device/installer work remain separately recorded, not prerequisites to collection.
The completed temporary source probe, acquisition and intake workflows were removed. No private
source, model weights, SQLite binary, APK, release asset or Actions artifact was published.
