# Composed core size and cold-read cost — 2026-09-24

Input: the bundled `core.db` restored on `main` (`d85750cf`), 422,838,272 bytes (403.2 MiB),
page size 65,536, 19,987 documents, 54,481 chunks. Host: macOS arm64, SQLite 3.51 CLI and
Python 3.13 `sqlite3`. Not an Android/WebView measurement.

## Where the bytes are (`dbstat`, MiB)

| Object | MiB | Notes |
| --- | ---: | --- |
| `chunks` | 81.8 | 12.7 original text, 16.9 `normalized_text`, 9.1 metadata, 16.1 text IDs |
| `chunks_fts_content` | 60.1 | a second copy of identity columns and indexed text |
| `documents` | 56.2 | 39.8 is metadata JSON of 19,972 catalog pointers (`classificationPath` 9.3, `canonicalDefinition` 6.9) |
| `chunks_fts_data` | 38.7 | inverted index with `prefix = '2 3 4'` |
| `sections` | 26.0 | |
| `knowledge_document_links` | 20.3 | |

## Change adopted (migration 010)

`chunks_fts` became an external-content FTS5 table over the `chunks_fts_source` view, with
`prefix = '2 3'`. Column names are unchanged. The composer now uses 16 KiB pages.

| Variant | Size (MiB) | Change |
| --- | ---: | ---: |
| current core | 403.2 | — |
| external content, prefix `2 3 4`, 64 KiB | 341.8 | −61.4 |
| external content, prefix `2 3`, 64 KiB | 334.2 | −69.0 |
| external content, prefix `3`, 64 KiB | 325.8 | −77.4 |
| external content, no prefix index, 64 KiB | 317.4 | −85.8 |
| **adopted: external content, prefix `2 3`, 16 KiB** | **342.0** | **−61.2 (−15.2%)** |

Dropping the 4-character prefix index kept warm FTS latency unchanged. `prefix = '3'` and no
prefix index were smaller but raised warm FTS p95 from ~61 ms to 72–90 ms on the 410 recorded
queries, so they were not adopted.

### Page size: file size versus cold reads

Cold cost is the number of pages a fresh connection reads for one FTS query plus hydration of
its top 100 chunks (`Page cache misses` from the SQLite CLI, times page size), over 103 of the
410 recorded queries. Every uncached page is one synchronous OPFS read in the browser.

| Page size | Size (MiB) | Cold read p50 | p95 |
| ---: | ---: | ---: | ---: |
| 64 KiB, current layout | 403.2 | 24.4 MB | 31.2 MB |
| 64 KiB, external content | 341.8 | 15.4 MB | 22.8 MB |
| 32 KiB | 342.4 | 10.3 MB | 14.5 MB |
| **16 KiB** | **349.4** | **7.0 MB** | **9.2 MB** |
| 8 KiB | 361.3 | 4.7 MB | 6.1 MB |
| 4 KiB | 377.6 | 3.2 MB | 4.2 MB |

(Rows 3–6 use prefix `2 3 4`. The adopted prefix `2 3` build at 16 KiB is 342.0 MiB.)
Long chunk rows overflow small pages, so the file grows as pages shrink. 16 KiB is ~2% larger than
64 KiB and reads ~2.2× fewer bytes per cold search. The app keeps `cache_size = -2000` (2 MB per
pack worker), which now holds 125 pages instead of 31.

## Equivalence checks

- The view reproduces the old FTS content for all 54,481 rows. With textual JSON joins, the
  `fts5vocab` instance table (term, chunk, column, token offset) is byte-identical to the current
  core: 2,675,153 token instances, so bm25 is unchanged.
- Raw FTS top-100 for 410 recorded production FTS expressions: identical except for ordering
  among equal bm25 scores at the cutoff.
- `benchmark:lookup-quality --max=1500`: identical metrics on both databases (strict Top-1 100%,
  strict Recall@20 100%, overall exact-surface Recall@20 94.87%, body-only intrusion 14.6%).
- Full `MedicalCore.search` over 337 lookup and clinical queries: Top-1 document unchanged in
  every query. Deeper order can differ where bm25 ties were previously broken by the old FTS
  rowid order (`chunks.id`) and are now broken by `chunks.rowid`.

## Query shape

The candidate query now ranks rowids first and reads `chunk_id` only for the bounded window.
Otherwise an external-content table resolves `chunk_id` through the view for every match.
This also speeds up old packs: warm FTS p50 went from 9.0 to 6.7 ms on the current core.

## Not changed, with reasons

- `normalized_text` (16.9 MiB) duplicates `original_text`, but SQLite cannot reproduce the
  Russian normalization without a custom tokenizer or function in every runtime.
- Integer surrogate IDs for chunks/sections (16 MiB of text IDs plus unique indexes) would break
  the stable document/section/chunk/anchor identifier contract.
- Catalog-pointer metadata (`classificationPath`, 9.3 MiB) repeats ancestor paths per node. A
  parent-pointer layout needs reader changes in navigation and is a separate content task.
- `sqlite_layout_migration_008.py` keeps its recorded 64 KiB target. It is a historical
  migration with receipts, not the current composer.

## Reproduce

Scripts used for this note were ad hoc (`dbstat`, `fts5vocab`, `.stats on`). To rebuild a
candidate from an existing core: apply the `chunks_fts` part of `010_compact_search_index.sql`,
run `INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')` and `'optimize'`, then
`PRAGMA page_size = 16384; VACUUM INTO 'candidate.db'`, and finally
`INSERT INTO chunks_fts(chunks_fts, rank) VALUES ('integrity-check', 1)` on the candidate.
