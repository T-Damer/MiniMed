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

## Current neural profile: KD1 — strong build-time model, distilled query model (2026-10-11)

| Field | Value |
|---|---|
| Profile | `localmed.kd1-giga480m.384.int8.v1` (`KD1_PROFILE`, `KD1_FUSION`) |
| Passage model | `ai-sage/Giga-Embeddings-instruct-480M-0826` @ `1763d603` (MIT; own modelling code read and pinned), bf16 on the build machine |
| Projection | 1024 → 384, leading uncentred principal directions of the КР passage vectors, `giga480m-projection-384.npy` (SHA-256 `097ec035…`, part of the fingerprint) |
| Query model | `minimed/kd1-query-encoder` (student v4c: multilingual-e5-small distilled from Giga plus a supervised term on train-split complaint/diagnosis → КР pairs, 384×384 head folded into the graph), int8 ONNX, mirror branch `datasets/kd1-query-encoder-2026.10.11.2` |
| Passage text | title + `. ` + section path + `. ` + chunk text, 1 200 chars, 256 tokens, no prefix |
| Query text | `query: ` + the user's original wording |
| Pooling | passages: Giga mean, L2, projection, L2; queries: mean, L2; then the int8 quantisation above |
| Packs | the 774 single-КР modules (96 095 chunks, tag `clinical-kd1-2026.10.11`) and the indication sections of the 15 ГРЛС instruction modules + Allmed (14 116 chunks, tags `…-kd1`) |
| Download | **Android: bundled in the APK** (owner 2026-10-15, below), no download. Web / iOS: optional, Settings → «Поиск по смыслу», 130 MB (the ONNX graph in two verified parts, joined and checked again before it is stored); files of an earlier model revision are deleted on install |

### Bundled in the Android APK (owner decision 2026-10-15)

«Under 300 MB apps are fine»: the Android build carries the query model, so meaning search works right
after install. Nothing is committed to `main` (blobs stay under 100 MB); the model enters the APK at
build time.

- **Build**: `bun run native:sync:android` (= `cap sync android`, then
  `bun scripts/fetch-query-model.ts --stage android`) downloads the pinned files from the
  `datasets/kd1-query-encoder-2026.10.11.2` mirror into a gitignored cache (`.cache/localmed/query-model`
  of the main checkout, shared by worktrees; `MINIMED_QUERY_MODEL_CACHE` overrides), checks every part and
  every joined file against the size and SHA-256 pinned in `apps/app/src/features/semantic/e5-model.ts`
  (the only copy of the checksums; a mismatch exits non-zero and writes nothing), joins the ONNX parts, and
  copies the verified files plus a `manifest.json` into
  `android/app/src/main/assets/public/models/kd1-query-encoder/` (gitignored). `android-release.yml` and
  `android-build.yml` run the same command and cache the directory by the hash of `e5-model.ts`;
  `scripts/fetch-query-model.ts --check-apk <apk>` fails the job when the finished APK lacks a model file or
  carries a wrong size. `build.gradle` stores `*.onnx` uncompressed (`androidResources.noCompress`); the JSON
  files compress (the tokenizer is 17 MB). Expected APK: 81 MB (0.6.60) + 119 MB graph + a few MB of
  compressed tokenizer, about 205 MB.
- **Runtime**: `e5-model-source.ts` picks the source with `Capacitor.getPlatform() === 'android'` plus a
  manifest probe (`<app>/models/kd1-query-encoder/manifest.json` must name the pinned revision and
  checksums). A bundled model counts as installed (`isE5ModelInstalled()`), so the plan of «Скачать всё», the
  onboarding offer, the `model-missing` offer in search and the download queue never list it on a build
  that carries it; `installE5Model()` does nothing there and a leftover `semantic-model` task of an older
  version is dropped by the restorer. A developer build synced without the model (probe fails) falls back
  to the optional download instead of silently searching without meaning. Settings → «Поиск по смыслу»
  reads «Встроено в приложение», with no download, cancel or delete.
- **Loading** stays lazy: the worker is created, and the files are read through the app's own web server
  (`https://localhost/models/…`, streamed from the APK; the 119 MB graph becomes one Blob like the
  IndexedDB copy did), on the first query that needs a vector. Nothing is read at start-up.
- **Trust**: the build verifies every SHA-256; at run time the app checks the manifest and the file sizes
  only. Re-hashing 119 MB on a phone at every cold start would cost time and a second 119 MB buffer, and the
  bytes are part of the signed APK (Android refuses an APK altered after signing), so the build-time check
  is the chain of trust.
- **Cleanup**: after the first query answered by the bundled model, the IndexedDB database of the earlier
  download (`minimed-semantic-model-v1`, about 130 MB) is deleted (`discardDownloadedE5Model`; skipped when
  the database does not exist; a failure is logged and retried on the next query).
- **Web (GitHub Pages) and iOS** keep the optional download exactly as before; the Pages deploy carries no
  model. iOS is left alone on purpose: Capacitor's iOS scheme handler is not verified to stream a 119 MB
  asset without loading it whole, and `ios-build.yml` is a simulator smoke build.

Build: `uv run tools/ingest/scripts/embed_modules.py --projection data/build/kd1/giga480m-projection-384.npy
--family clinical|medications …` (≈ 1 h for the КР on an M2 Max, batch 16 — larger Metal command
buffers were aborted by macOS), then `bun scripts/reframe-modules.ts --marker kd1 …`. The student is
trained with `tools/benchmarks/embedding_distill.py` (`texts`, `targets`, `project`, `train`,
`evaluate`, `export`) and published with `scripts/publish-query-model-mirror.sh`.

Through MedicalCore (`run-semantic-kr.ts`, `run-semantic-drugs.ts`), the same 2026-10-09 modules,
e5 vs KD1; fusion chosen on the Q1 dev split:

| Q1 КР, clinical hybrid | R@1 | R@5 | MRR@10 | complaints R@5 | diagnoses R@5 |
|---|---:|---:|---:|---:|---:|
| e5-small, test (163) | 0.301 | 0.497 | 0.383 | 0.278 | 0.702 |
| KD1 student v3, test (163) | 0.344 | 0.564 | 0.441 | 0.430 | 0.690 |
| **KD1 student v4c, test (163)** | **0.454** | **0.718** | **0.568** | **0.633** | **0.798** |
| e5-small, all (330) | 0.267 | 0.473 | 0.356 | 0.285 | 0.661 |
| KD1 student v3, all (330) | 0.318 | 0.561 | 0.426 | 0.430 | 0.691 |
| **KD1 student v4c, all (330)** | **0.436** | **0.727** | **0.555** | **0.636** | **0.818** |

v4c's pair labels share Q1's ICD mapping (on unseen patients and phrases), so its Q1 numbers measure
that mapping, not independent relevance; uncovered recommendations lose a little (self-retrieval
probe R@1 −0.024). The owner's own queries are the independent check
(`run-semantic-kr.ts --set=owner`):

| Owner queries naming a КР (45), clinical hybrid | R@1 | R@5 | MRR | thoughtful R@5 (21) | rush R@5 (24) |
|---|---:|---:|---:|---:|---:|
| e5 | 0.400 | 0.667 | 0.499 | 0.571 | 0.750 |
| KD1 v3 | 0.533 | 0.844 | 0.674 | 0.762 | 0.917 |
| **KD1 v4c** | **0.578** | 0.822 | **0.682** | 0.714 | 0.917 |

Drug search (medications scope, hybrid, 45 indication queries): hit@1 / hit@5 e5 0.600 / 0.911,
v3 0.600 / 0.844, v4c 0.578 / 0.867 (also with the confidence gate below).

`KD1_FUSION.confidence` (0.25–0.35) scales semantic strength by the query's best cosine: the student
peaks at 0.22–0.24 for «от молочницы», below the 10th percentile of every real query set
(0.31–0.41), and such a query now ranks by its lexical evidence (fluconazole found); Q1 dev −1 query
at R@5, owner queries unchanged, Q1 test R@1 0.454 → 0.460. Most of e5's hits that KD1 lost were a single weak match at
rank 3–5; the one real loss is «от молочницы», where the model ranks mastopathy and lactation
products above fluconazole. Trade-name top-1 1.00 throughout. Query encoder: 3.7 ms p50 on one CPU thread (e5 4.3 ms). Method,
variants and every number: [`research/embedding-distillation-2026-10-09.md`](research/embedding-distillation-2026-10-09.md).

## Previous neural profile: e5-small for clinical recommendations (STATE E2, 2026-10-05 – 2026-10-11)

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

Build: `uv run tools/ingest/scripts/embed_modules_e5.py` (decodes the published modules,
checks their catalog SHA-256, replaces only `embedding_profiles`/`chunk_embeddings`), then
`bun scripts/reframe-modules-e5.ts` (framed zstd, new tag, catalog URLs/checksums, version `.e5`).
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

Measured and rejected (2026-10-05, Q1 dev): embedding each clause of a complaint separately and
favouring documents that cover several clauses lowered complaint R@5 (0.326 one vector → 0.291 /
0.267 / 0.267 with coverage weight 0.3 / 0.5 / 0.7); RuMedPrime complaints often list symptoms
unrelated to the final diagnosis, and coverage pulls towards them. The code was removed.

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
