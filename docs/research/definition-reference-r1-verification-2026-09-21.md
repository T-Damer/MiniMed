# Definition reference R1 — executed verification

Date: 2026-09-21. Implementation and measured reports were committed in
`9f9a05f54f335be4de506b696b3c024a0dde7141` on the existing PR #180 branch.
Successful run: https://github.com/T-Damer/MiniMed/actions/runs/35634470423
Active plan: [DEFINITION_REFERENCE_PLAN.md](../DEFINITION_REFERENCE_PLAN.md).

## Delivered, not merely proposed

`localmed_ingest.definition_reference_pack` converts the eight checked-in V1/V2/V3 input files
into the existing content/knowledge schema. It retains source-local IDs and proposed links,
creates no approved facts or relations, shares source metadata and blocks, and preserves their
text and locators. Migration 006 adds a reference external-content FTS view/index without a
second full FTS body copy; the generated schema is synchronized. The ordinary clinical ranking
code and clinical gold fixtures were not changed.

`packages/storage/src/definition-reference.ts` defines asynchronous reference operations.
`packages/storage-sqlite/src/definition-reference-reader.ts` implements them using a caller-owned
SQL executor. It does not create an OPFS worker or open/close a native database connection.
Search transfers at most 20 headers, not definition bodies. Context descriptors are paged eight
at a time; requested text is paged in 4,096 SQLite Unicode-code-point slices. This preserves
supplementary Unicode characters instead of confusing code-point offsets with JavaScript UTF-16.

The old DEV application loader is **not yet replaced**. R2 must supply the executor through the
existing database owner/installer/core and then qualify the actual UI and lifecycle. Therefore
this pass does not claim the existing app's memory use is already fixed.

## Actual results

| Check | Measured result |
| --- | ---: |
| Complete public input entries | 18,133 |
| Shared source records / shared blocks | 9 / 23,809 |
| SQLite file bytes after build compaction | 159,125,504 |
| SQLite integrity / foreign-key violations | ok / 0 |
| Source-name surfaces returning a result | 13,146 / 13,146 |
| Adapter creation after opening the file | 0.634 ms |
| Exact-name query p50 / p95 | 0.068 / 0.109 ms |
| Maximum rows returned by one adapter call in the corpus audit | 20 |
| Maximum serialized reply in the name audit | 6,501 bytes |
| Current RSS before open / after open / after audit | 57,942,016 / 60,227,584 / 115,838,976 bytes |

The 13,146 figure measures nonempty output for indexed name surfaces, not independent clinical
relevance, a particular homonym at Top-1, or reverse-definition quality. The audit enumerates
names outside the reader in batches of 256. The reader itself has no whole-corpus enumeration
API. Name timings exclude app rendering/native-bridge work; creation timing begins after opening
the file. RSS is current whole-process memory, not peak memory, pure index size or Android PSS.
The old JSON and new SQLite audits differ, so do not advertise an exact device speedup ratio.

The synthetic three-record file-backed test executed **21 additional assertions** covering exact
ambiguity, aliases, a descriptive text match, exclusion of context/annotations from search,
ordered block roles, preserved locators, source reads, membership isolation, malformed cursors,
invalid offsets, multi-page context and lossless reconstruction of a long supplementary-Unicode
string. Its maximum reply size was 11,251 bytes; it is separate from the corpus-name measurement.

Other actual checks: **20 Python tests**, **83 selected Vitest cases**, strict Pyright on the new
builder/tests, strict TypeScript checks for storage and storage-sqlite, Ruff/Biome on touched
files, schema generation/check. The selected Vitest count is 65 existing glossary + 10 excerpt +
7 OPFS contract + 1 focused existing SQLite projection test; it is not the entire repository suite.
The projection fixture was corrected to compare every document by ID, because the existing query
orders by title rather than seed-array position. No production ordering or expected text changed.
Earlier failures on line formatting and that fixture assumption remain in the workflow history.

Reports are adjacent: `definition-reference-sqlite-build-2026-09-21.json`,
`definition-reference-sqlite-fixture-2026-09-21.json`,
`definition-reference-sqlite-runtime-2026-09-21.json`.

## Reproduce from repository root

Use the repository-pinned Bun 1.2.3 and the locked ingest environment. Choose unused output/report
paths: the builder refuses to overwrite an edition. No source download, LLM or private PDF is
needed for this public-corpus conversion.

```bash
bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
bun run schema:check

uv run --project tools/ingest pytest -q \
  tools/ingest/tests/test_definition_reference_pack.py
bunx tsc --noEmit -p packages/storage/tsconfig.json
bunx tsc --noEmit -p packages/storage-sqlite/tsconfig.json

uv run --project tools/ingest python -m localmed_ingest.definition_reference_pack \
  --input-root . \
  --input content/definition-drafts/catalog.json \
    content/definition-drafts/ruwiktionary-2026.9.16.json \
    content/definition-drafts/prepared-source-excerpts-2026.09.21.json \
    content/definition-drafts/clinical-source-excerpts-2026.09.21.part-*.json \
  --output data/build/reference-local.db \
  --report data/build/reference-local-build.json \
  --edition-id minimed.definition.reference.local \
  --version local-r1 --built-at 2026-09-21

bun scripts/verify-definition-reference.ts \
  data/build/reference-local.db data/build/reference-local-runtime.json 18133 corpus
```

The original CI run also checked each clinical shard against the checked-in manifest's SHA-256.
Build reports retain receipts for every actual input and the output-file digest. A locally chosen
edition ID or SQLite version may change output bytes/digest; compare the actual reports rather
than asserting byte-identical files across environments.

## What remains blocked

**159 MB installed is not yet the requested small phone package.** R1b in the plan must measure
table/index/identifier/annotation allocation and reduce avoidable overhead without losing source
text or identity. That profiling has not run yet. A compressed JSON figure cannot replace this
installed-size result.

R2 still needs installer/owner/core/UI integration, offline restart/update/removal and native/WASM
and device measurements. R3 needs source-aware grouping/QA; R4 needs independent reverse-query
evaluation; R5 covers continued ingestion, etymology and history. No full application/browser or
Android verification is claimed by R1. Owner-only metadata mappings need their separate synthetic
qualification before private-module integration. The original owner PDF and extracted private
text were not uploaded to GitHub/CI.

The completed one-time write workflow was removed after delivery. The regular builder, tests,
reader, migration and verifier remain. No Actions artifacts, database binaries, APKs, model
weights, new release or merge were published. PR #180 remains draft.
