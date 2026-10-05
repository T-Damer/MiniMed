# Semantic retrieval — `0.3.0-alpha.1`

## Implemented path

```text
content build
  → one vector per searchable chunk
  → signed int8 BLOB + vector norm
  → immutable embedding profile descriptor
  → SQLite content pack

runtime query
  → deterministic clinical query plan
  → lexical branches → FTS5/BM25
  → local query embedder → int8 vector
  → exact cosine scan after SQL filters
  → bounded lexical and vector candidate lists
  → hybrid fusion
  → source chunk, section, anchor, and context
```

The same storage and orchestration contracts are implemented by the in-memory, SQLite WASM, and
Capacitor storage adapters. Web and tests execute the scan in TypeScript/SQLite WASM. Native plugins
expose a vector-search bridge so Android/iOS can return only top chunk IDs and scores rather than
copying the whole vector table into the WebView.

In the alpha native bridge, document and section filters are applied inside SQLite before the exact
scan. Specialty and age-group metadata are applied by the portable TypeScript adapter to an
intentionally wider native candidate window (at least 100, at most 500). This keeps behavior aligned
without duplicating JSON metadata rules in Swift and Kotlin/Java, but it is not the final large-pack
strategy. Real-corpus profiling must determine whether those filters move into native SQL or the
metadata is normalized into indexed relational columns.

## Current development profile

| Field | Value |
|---|---|
| Profile | `localmed.feature-hash.384.v1` |
| Dimensions | 384 |
| Storage | signed `int8` |
| Normalization | L2 |
| Query work | local and deterministic |
| Corpus work | precomputed by the content builder |
| Kind | `development`, not neural |

The algorithm combines normalized Russian word features, word bigrams, and character trigrams in a
fixed FNV-1a feature space. Python and TypeScript share golden vectors. This profile validates the
complete local vector pipeline, spelling/surface proximity, compact persistence, profile matching,
and fallback behavior. It is **not** evidence of medical semantic understanding.

## Neural profile: e5-small for clinical recommendations (STATE E2, 2026-10-05)

| Field | Value |
|---|---|
| Profile | `localmed.e5-small.384.int8.v1` (`E5_SMALL_PROFILE`) |
| Passage model | `intfloat/multilingual-e5-small` @ `614241f6…` (MIT), PyTorch fp32 |
| Query model | `Xenova/multilingual-e5-small` @ `761b726d…`, `onnx/model_quantized.onnx` (q8) |
| Passage text | `passage: ` + title + `. ` + section path + `. ` + chunk text, 1 200 chars, 256 tokens |
| Query text | `query: ` + the user's original wording (`QueryEmbedder.input = 'original-query'`) |
| Pooling | mean, L2, then the int8 quantisation above |
| Packs | the 774 single-КР modules, mirror tag `clinical-e5-2026.10.05` (95 827 chunks) |
| Download | optional, Settings → «Поиск по смыслу», 135 MB, IndexedDB, SHA-256 per file |

Build: `uv run tools/ingest/scripts/embed_clinical_modules_e5.py` (decodes the published modules,
checks their catalog SHA-256, replaces only `embedding_profiles`/`chunk_embeddings`), then
`bun scripts/reframe-clinical-e5.ts` (framed zstd, new tag, catalog URLs/checksums, version `.e5`).
The vectors add 31 MB (657 → 688 MB) to the whole КР download because dense e5 vectors compress
worse than the sparse feature-hash ones.

Parity: query vectors from the q8 ONNX export (transformers.js) and the fp32 reference model have
cosine 0.996–0.998 on five Russian clinical queries; tolerance ≥ 0.99.

Runtime: the query is embedded in a dedicated worker (`apps/app/src/features/semantic/e5.worker.ts`)
that reads only the pinned, verified files from IndexedDB and never fetches. Without the model the
embedder rejects with `semantic-model-not-installed` and search stays lexical.

Scanning hundreds of small packs is two-phase (`scoreVectors` → global top window →
`hydrateVectorHits`, `MultiMedicalStore`), and `SqliteMedicalStore` keeps each profile's vectors in
memory after the first query. Measured over all 774 packs in Bun: semantic stage 150–250 ms per
query (was 1.6–2.2 s with per-pack hydration).

Fusion calibration lives on the embedder (`SemanticFusion`): e5 cosines sit in a narrow 0.8–0.9
band, so a hit's strength is its distance below the query's best cosine within `band`.

Quality, Q1 real-language queries with КР relevance, all 774 e5 packs mounted, through MedicalCore
(`bun tools/benchmarks/src/run-semantic-kr.ts`). Fusion chosen on dev; test is held out:

| Configuration | dev R@5 | test R@1 | test R@5 | test strict R@5 | test MRR@10 |
|---|---:|---:|---:|---:|---:|
| lookup, lexical | 0.090 | 0.061 | 0.117 | 0.098 | 0.088 |
| clinical, lexical | 0.096 | 0.067 | 0.123 | 0.104 | 0.090 |
| lookup, semantic only | 0.449 | 0.270 | 0.479 | 0.436 | 0.358 |
| clinical, hybrid, feature-hash constants | 0.138 | 0.092 | 0.166 | 0.141 | 0.118 |
| lookup, hybrid `E5_SMALL_FUSION` | 0.449 | 0.282 | 0.479 | 0.429 | 0.364 |
| **clinical, hybrid `E5_SMALL_FUSION`** | **0.467** | **0.294** | **0.497** | **0.448** | **0.379** |

Test R@5 by source, clinical hybrid: RuMedPrime complaints 0.038 → 0.278, RuCCoD diagnosis
phrases 0.202 → 0.702. Scope: КР only; complaint labels are the physician's final diagnosis; the
queries are not the owner's own phrasing, so ADR exit criterion 4 is met only by proxy.

## Search modes

- `lexical` — deterministic analysis, aliases, FTS5, and BM25 only;
- `semantic` — vector candidates only when the exact profile is available;
- `hybrid` — lexical and vector candidates fused;
- `auto` — hybrid when compatible vectors exist, otherwise lexical fallback.

Every response reports:

- requested and used mode;
- embedding profile ID;
- vector candidate count and elapsed time;
- explicit fallback reason;
- lexical, semantic, and final score per result;
- matched query branches and the exact source anchor.

The application exposes the active mode as `FTS5 + VECTOR` and records profile and scores in the
technical card.

## Profile compatibility

The runtime never silently compares vectors from different generators. Compatibility requires the
same:

- profile ID;
- model/generator identifier and revision;
- dimensions;
- normalization;
- vector format;
- fingerprint/checksum.

A missing profile, mismatch, malformed query vector, empty vector result, or adapter error leaves the
request in lexical mode and sets `diagnostics.semantic.fallbackReason`.

## Exact scan and future ANN

The alpha performs an exact cosine scan. At 384 bytes per chunk, 100,000 chunks need about 36.6 MiB
of raw vector payload before SQLite overhead. This is deliberately simple and correct for the first
real-corpus measurements.

ANN should be introduced only after benchmarking representative pack sizes. Compare:

- exact native scan;
- exact scan after lexical/document filters;
- compact HNSW or IVF-style side index;
- recall loss, cold-start cost, pack size, update behavior, and battery impact.

## Verification

```bash
bun run content:build
bun run test:unit
bun run benchmark:all
CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e
```

Current synthetic checks require:

- every chunk of the unit-test slice (`CORE_SLICE_PACK`) has a vector for the declared profile;
- Python/TypeScript golden vectors match;
- compatible profiles use hybrid mode;
- incompatible profiles fall back to lexical mode;
- the built browser application displays `FTS5 + VECTOR` and opens the expected source section.
- the Capacitor contract loads the declared embedding profile, serializes a 384-byte query vector,
  and hydrates native top-K chunk IDs back into portable source records.

The slice and the benchmark sets test mechanics, not medical quality. The released `core.db`
ships no vectors, so `benchmark:all` reports hybrid and semantic usage without gating them.

## Neural-profile exit criteria

A profile may be marked `neural` only after:

1. model files, tokenizer/preprocessing, revision, and checksums are frozen;
2. builder and mobile query vectors pass parity or a documented numerical tolerance;
3. latency, memory, package size, and battery are measured on a device matrix;
4. a physician-authored real-corpus benchmark shows a useful gain over lexical-only retrieval;
5. lexical fallback and source navigation remain fully functional when the model is unavailable.
