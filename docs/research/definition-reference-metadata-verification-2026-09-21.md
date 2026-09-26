# Definition reference — verbatim metadata pass

Date: 2026-09-21. Same draft PR #180, no merge or release.
Verified implementation and reports: `81f81f72731ba7af931b8f15d845cec2bf8df0c2`.
Successful run: https://github.com/T-Damer/MiniMed/actions/runs/35651708320
Plan: [DEFINITION_REFERENCE_PLAN.md](../DEFINITION_REFERENCE_PLAN.md).

## Decision

The additional R1b metadata representation is implemented and verified as an **explicit opt-in**
(`--compact-metadata`). It saves installed bytes but makes the gzip comparison larger. It is not
an unconditional improvement and is not enabled by default. The existing numeric-link edition
remains the default builder output and the simpler R2 integration baseline. Do not delay the real
application path for another round of speculative compression. The phone delivery gate still needs
actual installer/backend/lifecycle measurements. Owner-annotation binding remains a separate gate
before enabling the owner overlay, not a claim established by preserving its raw JSON.

## What changed

Migration `008_definition_reference_metadata.sql` adds a small shared table of verbatim JSON string
tokens, per-chunk reconstruction arrays, and the `definition_reference_chunks` read view. The arrays
contain literal string spans or integer references to complete quoted tokens. Original punctuation,
whitespace, escapes, numeric spellings and nested structures are preserved byte for byte after
reconstruction. Neither definitions nor clinical wording are rewritten. Nonprofitable, oversized or
excessively fragmented metadata stays inline.

This is a physical representation within the existing immutable reference pack. It does not introduce
a new medical graph, database owner, worker, extension, UDF or provider. The raw `chunks` table retains
all original IDs, text, order, anchors and source relationships. Only selected `metadata_json` cells
use the explicit storage marker. Ordinary search and block-listing do not decode metadata; the
reference reader resolves only a requested block through the view. A supported layout must be
explicitly declared as `metadataLayout: fragments-v1` with `linkLayout: numeric-v1`. Legacy/numeric-only
editions retain their old read path. Unknown layouts, missing fragments/programs and unresolved
storage markers fail rather than becoming empty or partial source citations.

The builder works on a newly staged file, uses savepoints and refuses to overwrite existing output.
The numeric layout, optional metadata layout, complete logical table comparison, final VACUUM and
FTS integrity checks run before publication of that local edition. This does not mutate an installed
or released database. The view preserves the logical chunk-column shape; a generic consumer of raw
chunk metadata is NOT silently redirected. R2 must use the declared reference capability.

## Full-corpus results and tradeoff

Both variants were rebuilt in the same environment from the same eight receipt-checked public
inputs: editorial catalog, Russian dictionary, prepared excerpts and the five clinical shards.
All **18,133 entries, nine source records, 23,809 blocks and 40,625 logical links** remain.

| Representation | Same-run numeric baseline | Optional metadata variant |
| --- | ---: | ---: |
| SQLite bytes | 110,395,392 | 105,783,296 |
| Gzip comparison bytes | 27,393,572 | 28,112,736 |

Installed-file saving: **4,612,096 bytes (4.18%)**. Gzip increases by **719,164 bytes (2.63%)**.
These are different measurements; do not report the smaller installed file while hiding the larger
transport representation. The numeric baseline includes 8,192 bytes of empty migration-008
structures compared with the prior 110,387,200-byte result. This is not a runtime or phone-memory
saving measurement.

The encoder chose 13,663 metadata cells and 3,620 shared string fragments. Original logical metadata
was 18,008,329 bytes; programs, used dictionary strings, markers and untouched metadata total
15,894,289 logical bytes. Logical column bytes and physical SQLite page allocation are not identical.
The same-run before/after DBSTAT accounting remains in the build report.

## Source fidelity and executed checks

Every logical row of documents, document versions, sections, chunks, entities, names, empty
facts/relations, reference links and source-level annotations participates in the ordered before/after
comparison. The raw metadata digest also matches exactly across all 23,809 chunks, not merely parsed
object equality. Post-VACUUM FTS checks, database integrity and foreign-key checks passed. This proves
source representation survives the encoding, not that the underlying medical statements have been
clinically reviewed or that unresolved local references in optional annotations are usable.

The successful run executed **48 Python cases** (20 projection, 14 numeric/profile, 14 metadata)
and **22 Vitest cases** (eight layout dispatch, 14 metadata boundaries), strict Pyright on the four
touched Python modules/tests, storage-sqlite TypeScript checking, scoped Ruff/Biome and generated
schema synchronization. Biome retained informational literal-key suggestions, which conflict with
the strict index-signature access conventions; no unsafe autofix or relaxed TypeScript setting was
used. This was a scoped run, not the entire repository CI.

Earlier attempts failed in temporary integration code: an indentation mistake in a patch and a
semicolon inside our new migration comment interacting with the existing schema assembler. Both
were corrected; schema/test gates were not removed. Raw and builder-filtered migration assembly
were also exercised locally, along with synthetic SQLite reconstruction and broken-reference checks.
Container GitHub/package-network resolution remained unavailable; locked repository execution was
performed by the linked Actions run, not represented as a local full checkout.

## Real bounded reader results

The file-backed Bun SQLite source-name audit returned results for **13,146 / 13,146** indexed name
surfaces. At most 20 rows / 6,501 bytes were returned per adapter call in that audit. Host p50/p95 were
0.0375/0.0617 ms; adapter creation after the caller opened the file was 0.470 ms. Current whole-process
RSS before open / after open / after audit was 57,712,640 / 59,998,208 / 117,911,552 bytes. Do not infer
an acceleration relative to another CI run, Android PSS, a measured peak, or reverse-search quality.

A second real-reader check selected **128 encoded blocks** deterministically. Each requested text
slice and decoded provenance object matched the inline baseline; an unrelated entry could not read
the same block. Read p50/p95 were 0.0437/0.0931 ms, at most one row / 6,561 bytes per adapter call.
That process held two caller-owned read-only databases for comparison. This is a structural host
smoke sample, not every-block UI evaluation, independent clinical gold or a device memory result.
The whole-corpus raw fidelity comparison above is separate from the 128-read sample.

Evidence:

- `definition-reference-metadata-build-2026-09-21.json`
- `definition-reference-metadata-runtime-2026-09-21.json`
- `definition-reference-metadata-reads-2026-09-21.json`

Reports contain numeric measurements, receipts and hashes, not private source content or queries.
No database binaries or Actions artifacts were uploaded. The completed temporary workflow was removed.

## Reproduce

Use repository-pinned Bun 1.2.3 and the locked ingest environment. Choose fresh output names.

```bash
uv run --project tools/ingest pytest -q \
  tools/ingest/tests/test_definition_reference_pack.py \
  tools/ingest/tests/test_definition_reference_compact.py \
  tools/ingest/tests/test_definition_reference_metadata.py
bunx vitest run \
  packages/storage-sqlite/tests/definition-reference-layout.test.ts \
  packages/storage-sqlite/tests/definition-reference-metadata.test.ts
bun run schema:check
bunx tsc --noEmit -p packages/storage-sqlite/tsconfig.json

# Add --compact-metadata only for the explicit experimental layout.
uv run --project tools/ingest python -m localmed_ingest.definition_reference_compact_pack \
  --input-root . \
  --input content/definition-drafts/catalog.json \
    content/definition-drafts/ruwiktionary-2026.9.16.json \
    content/definition-drafts/prepared-source-excerpts-2026.09.21.json \
    content/definition-drafts/clinical-source-excerpts-2026.09.21.part-*.json \
  --output data/build/reference-with-metadata.db \
  --report data/build/reference-with-metadata-build.json \
  --edition-id minimed.definition.reference.local \
  --version local-r1b --built-at 2026-09-21 --profile --compact-metadata

bun scripts/verify-definition-reference.ts \
  data/build/reference-with-metadata.db data/build/reference-with-metadata-runtime.json 18133 corpus
```

Build a separate baseline from identical inputs/options without `--compact-metadata`, then compare:

```bash
bun scripts/verify-definition-metadata.ts \
  data/build/reference-numeric-baseline.db data/build/reference-with-metadata.db \
  data/build/reference-metadata-reads.json
```

The successful workflow additionally checked every clinical shard's membership, length and checksum
against the existing manifest before building.

## What is not completed

The actual MiniMed UI still uses the old opt-in JSON preview. R2 installer/owned executor/core/worker
integration, offline restart/update/removal, whole-app/browser and Android/native/WASM qualification
have not been implemented by this pass. The private psychiatry PDF/derived package was not used in
public CI. Semantic binding of owner-local etymology/history annotations remains unresolved and must
be tested separately with synthetic data. Reverse-search ranking and source contents were not tuned.
SemIf remains a registered, disabled R4 candidate; no model was downloaded or evaluated. No release,
APK or merge was performed.
