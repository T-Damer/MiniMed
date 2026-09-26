# Definition reference R1b — numeric-link pass, executed verification

Date: 2026-09-21. Same draft PR #180; no merge or release.
Implementation and measured reports: `df1c402377bfe1db276aeb588dd87925c5ba85fa`.
Successful verification: https://github.com/T-Damer/MiniMed/actions/runs/35641414351
Prior read-only profiling: https://github.com/T-Damer/MiniMed/actions/runs/35639604974
Active plan: [DEFINITION_REFERENCE_PLAN.md](../DEFINITION_REFERENCE_PLAN.md).

## SemIf status

The user-approved SemIf candidate is registered under R4 and in
[its pinned evaluation note](semif-candidate-2026-09-21.md). It is not an installed dependency,
selected architecture or evaluated MiniMed model. No weights, inference, provider calls or model
downloads were introduced. R1b/R2 remain ahead of this experiment.

## Measured bottleneck before choosing the change

`definition_reference_profile.py` opens a closed database read-only, accounts for table/index
pages through DBSTAT, counts logical column bytes and verifies the input file receipt is unchanged.
It prints no source text or clinical queries. The original R1 baseline reproduced exactly:
159,125,504 bytes, SHA-256 `82462d98f64d52e509ec16784036428fb9e72ce1867370cf29e3e46847520c43`.

The source document metadata occupied only 4,296 logical bytes across nine rows. It was not the
main remaining source of bloat. The `chunks` table occupied 58,204,160 physical bytes, including
18,008,329 logical metadata bytes and 15,998,268 original-text bytes. The 40,625 navigation links
occupied 22,712,320 table bytes plus multiple large indexes repeating the same long IDs.
An emptied ordinary `chunks_fts` also retained 6,197,248 bytes in its data structure.

The numeric profile is `definition-reference-r1b-baseline-profile-2026-09-21.json`. It distinguishes
physical allocation from logical column bytes and transport compression; those are not interchangeable.

## Implemented change

Migration `007_definition_reference_links.sql` adds local numeric entity/chunk keys and a narrow
ordered link table within the existing content pack. These are physical references to existing
`knowledge_entities` and `chunks`, not another canonical medical graph, database owner or concept
identifier system. Original external IDs, source/version/section/chunk/anchor fields remain intact.

`definition_reference_links` reconstructs the existing ten-column navigation shape. Reconstructible
link IDs, repeated source coordinates, role and ordinal metadata are derived rather than stored on
every row and in every large index. Original source tables, clinical facts/relations and the ordinary
knowledge-link schema are not rewritten. The dedicated reference reader is explicitly layout-aware;
generic clinical consumers are not silently redirected to this new view.

`definition_reference_compact_pack.py` builds a NEW immutable staging edition through the R1
builder, then performs the numeric transformation. It refuses non-reconstructible weights, roles,
review states, coordinates, IDs or extra metadata rather than silently discarding them. A savepoint
rolls back failures. Complete ordered logical row digests are checked before and after; publication
uses an atomic non-overwriting hard link. Installed or released databases are never opened for editing.

The already-empty ordinary FTS is rebuilt to discard stale postings. After final VACUUM, all three
FTS indexes receive integrity checks, including external-content comparison. Definition/item
retrieval still uses the same tokenization; context and annotation blocks remain outside that index.
No ranking weights, clinical gold, source wording or aliases were tuned.

The reader accepts only absent legacy layout or explicit `numeric-v1`; an unknown layout fails
closed. It still receives an already-owned SQL executor. There is no whole-corpus JS hydration
or new connection/worker in the reader. This does not yet replace the old app DEV JSON loader.

## Actual full-corpus result

| Quantity | Measured value |
| --- | ---: |
| Entries / shared sources / shared blocks | 18,133 / 9 / 23,809 |
| Logical navigation links preserved | 40,625 |
| Same-run baseline SQLite, with empty migration-007 structures | 159,154,176 bytes |
| Compact SQLite | 110,387,200 bytes |
| Installed-file saving | 48,766,976 bytes, approximately 30.6% |
| Same-run baseline gzip comparison | 30,475,154 bytes |
| Compact gzip comparison | 27,393,160 bytes |
| Integrity / foreign-key violations | ok / 0 |
| Post-VACUUM FTS integrity | ok |
| Complete logical table/link/annotation comparison | equal |

The same-run baseline is 28,672 bytes larger than the original R1 file because it includes empty
migration-007 structures. This difference is reported, not hidden in the improvement percentage.
The compact file is still about 110 MB installed: this pass does NOT qualify a small general phone
download. The compressed number is not installed size, and neither number is RAM usage.

Every row of the original documents, versions, sections, chunks, entities, names, facts, relations,
logical links and source-level annotations participates in the comparison. This proves the listed
source representation survives the transformation, not that the underlying medical claims are correct
or that unresolved optional owner-annotation references have already been semantically resolved.

See `definition-reference-r1b-compact-build-2026-09-21.json`: full before/after allocation, input/output
receipts and logical digests are retained. No database binary was uploaded.

## Executed checks and runtime boundaries

The successful locked run executed **34 Python tests** (20 prior plus 14 compact/profile cases),
**91 selected Vitest cases** (65 glossary, 10 excerpt, seven OPFS, eight layout-dispatch, one focused
existing storage projection), strict Pyright on the new Python modules/tests, strict TypeScript for
storage/storage-sqlite, scoped Ruff/Biome and schema generation/check. Earlier attempts stopped on
formatting/type-alias lint requirements; the checks were corrected, not relaxed.

Fresh Bun file-backed processes then exercised legacy-shaped and numeric-shaped synthetic editions,
with **21 reader assertions per edition**: ambiguity, aliases, source fidelity, role ordering,
context exclusion, membership isolation, invalid cursors/offsets, paging and lossless supplementary
Unicode reconstruction. The legacy-shaped synthetic edition is built by the current builder (with
empty newer schema structures); the additional mocked dispatch tests verify that an absent layout
never queries the newer view. This is not an exhaustive old-release compatibility matrix.

Full-corpus name availability remained **13,146 / 13,146**; at most 20 rows and 6,501 serialized
bytes were returned per adapter call in that audit. Exact-name host p50/p95 were 0.088/0.132 ms;
reader creation after file open was 0.696 ms. Current process RSS before open / after open / after
audit was 58,630,144 / 60,784,640 / 115,109,888 bytes. These are host whole-process measurements,
not Android PSS, peak allocation, isolated index memory or a claimed timing improvement.

Name availability is not a clinical relevance score, correct homonym ordering or reverse-search
qualification. The name audit enumerates inputs outside the reader in bounded batches. Large-corpus
card expansion latency, actual UI lifecycle and Android/native/WASM measurements remain pending.
Reports: `definition-reference-r1b-{legacy-fixture,compact-fixture,runtime}-2026-09-21.json`.

## Reproduction

With the repository-pinned Bun 1.2.3 and locked ingest environment installed, choose fresh outputs:

```bash
uv run --project tools/ingest pytest -q \
  tools/ingest/tests/test_definition_reference_pack.py \
  tools/ingest/tests/test_definition_reference_compact.py
bun run schema:check
bunx tsc --noEmit -p packages/storage-sqlite/tsconfig.json

uv run --project tools/ingest python -m localmed_ingest.definition_reference_compact_pack \
  --input-root . \
  --input content/definition-drafts/catalog.json \
    content/definition-drafts/ruwiktionary-2026.9.16.json \
    content/definition-drafts/prepared-source-excerpts-2026.09.21.json \
    content/definition-drafts/clinical-source-excerpts-2026.09.21.part-*.json \
  --output data/build/reference-compact-local.db \
  --report data/build/reference-compact-local-build.json \
  --edition-id minimed.definition.reference.local \
  --version local-r1b --built-at 2026-09-21 --profile

bun scripts/verify-definition-reference.ts \
  data/build/reference-compact-local.db data/build/reference-compact-local-runtime.json 18133 corpus
```

The actual CI run additionally validated every clinical shard against the checked-in manifest.
The two temporary write workflows were removed after successful delivery; normal builder, profiler,
migration, adapter, tests and numeric reports remain. Full repository CI, browser/app composition,
old-release installation/upgrade, Android and clinical validation are not claimed.

## Remaining plan

R1b still includes reducing measured chunk/provenance overhead and qualifying module-local annotation
maps on synthetic data; the original owner textbook is not uploaded. R2 will wire the reference through
the existing installer/database owner/core/UI with lazy card context and offline lifecycle tests.
The current app remains on its previous opt-in JSON preview until that integration is qualified.
R3–R5 and the SemIf evaluation remain pending. No model, private source, database release, APK or merge.
