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
pnpm content:build
pnpm test:unit
pnpm benchmark:search
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
```

Current synthetic checks require:

- 15/15 chunks have vectors for the declared profile;
- Python/TypeScript golden vectors match;
- compatible profiles use hybrid mode;
- incompatible profiles fall back to lexical mode;
- all 30 compact benchmark queries use the semantic path;
- the built browser application displays `FTS5 + VECTOR` and opens the expected source section.
- the Capacitor contract loads the declared embedding profile, serializes a 384-byte query vector,
  and hydrates native top-K chunk IDs back into portable source records.

Synthetic fixtures test mechanics, not medical quality.

## Neural-profile exit criteria

A profile may be marked `neural` only after:

1. model files, tokenizer/preprocessing, revision, and checksums are frozen;
2. builder and mobile query vectors pass parity or a documented numerical tolerance;
3. latency, memory, package size, and battery are measured on a device matrix;
4. a physician-authored real-corpus benchmark shows a useful gain over lexical-only retrieval;
5. lexical fallback and source navigation remain fully functional when the model is unavailable.
