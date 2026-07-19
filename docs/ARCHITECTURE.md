# Архитектура LocalMed Search 0.3.0-alpha.1

## Состояние реализации

Версия 0.3.0-alpha.1 — локальный hybrid retrieval core с нативным мобильным хранилищем,
воспроизводимой границей подготовки частного корпуса и переносимым embedding-контрактом. Она принимает длинный
русскоязычный текст, строит проверяемую карточку случая, формирует несколько поисковых веток,
выполняет FTS5/BM25 retrieval, рассчитывает локальный query vector, объединяет lexical/vector
кандидатов и открывает исходный chunk с соседним контекстом. Генеративная модель в этом потоке не участвует.

Корпус в репозитории синтетический: он проверяет механику, но не является медицинской базой.

## Граница системы

```text
SolidJS UI
  │
  ▼
MedicalCore — публичный контракт
  ├─ analyzeQuery
  ├─ search
  ├─ list/get document and section
  └─ getContext
  │
  ├─ deterministic clinical query planner
  ├─ lexical/vector retrieval orchestration
  ├─ hybrid fusion and explainability
  └─ result grouping / snippets
  │
  ▼
MedicalStore — порт
  ├─ InMemoryMedicalStore  — unit/contract tests
  ├─ SqliteMedicalStore    — SQLite WASM + FTS5
  └─ CapacitorMedicalStore — Android/iOS native SQLite + FTS5
```

Подготовка корпуса находится вне runtime:

```text
private PDF / OCR TXT / Markdown
  → source registry + deterministic preparer
  → extraction blocks and diagnostics
  → source-preserving Markdown with hidden spans
  → validated hierarchy and chunks
  → stable IDs, anchors, and page ranges
  → original + normalized text
  → precompiled SQLite content pack
  → FTS5 index + integrity report
```

## Направление зависимостей

```text
apps/app
  ├─ packages/contracts
  ├─ packages/core
  │    ├─ packages/search-lexical
  ├─ packages/search-semantic
  │    └─ packages/storage (ports)
  ├─ packages/storage-sqlite (WASM adapter)
  └─ packages/storage-capacitor (native adapter)

packages/domain and packages/contracts do not import UI or platform SDKs.
```

Инварианты:

- UI не содержит SQL, FTS5 syntax и provider-specific model code;
- `core` не знает о SolidJS, WebView, Android, iOS или конкретном LLM;
- storage adapter не интерпретирует клинический смысл и не формирует пользовательский ответ;
- content builder не зависит от runtime приложения;
- generated SQLite/JSON не редактируются вручную;
- исходный текст хранится отдельно от нормализованного поискового текста.

## Runtime-поток

```text
original case text
  → Zod boundary validation
  → deterministic extraction with source ranges
  → negation-aware searchable concepts
  → aliases and lightweight Russian normalization
  → weighted branches:
       clinical / original / investigation / medication / clauses
  → parameterized FTS5 queries and BM25 candidates
  + compatible local query embedding and exact cosine candidates
  → hybrid fusion with explicit lexical fallback
  → document groups and result categories
  → exact chunk / section / anchor / neighboring context
```

Факты не заменяют исходник. Каждый факт хранит диапазон символов, поэтому UI может показать,
какая фраза была распознана. Отрицательные признаки исключаются из положительной clinical branch,
но остаются в исходной карточке и original branch.

## Публичный контракт

```ts
interface MedicalCore {
  initialize(): Promise<Result<CoreStatus, LocalMedError>>;
  getCapabilities(): Promise<Result<CoreCapabilities, LocalMedError>>;
  listDocuments(): Promise<Result<readonly MedicalDocumentSummary[], LocalMedError>>;
  analyzeQuery(request: AnalyzeQueryRequest): Promise<Result<QueryAnalysis, LocalMedError>>;
  search(request: SearchRequest): Promise<Result<SearchResponse, LocalMedError>>;
  getDocument(documentId: string): Promise<Result<MedicalDocument, LocalMedError>>;
  getSection(sectionId: string): Promise<Result<MedicalSection, LocalMedError>>;
  getContext(chunkId: string, radius?: number): Promise<Result<ChunkContext, LocalMedError>>;
  ask(request: AskRequest): Promise<Result<AskResponse, LocalMedError>>;
  installContentPack(request: InstallContentPackRequest): Promise<Result<InstallContentPackResponse, LocalMedError>>;
  close(): Promise<void>;
}
```

`ask` and dynamic `installContentPack` intentionally return `FEATURE_DISABLED` in 0.3.0-alpha.1. Their
presence freezes the boundary without pretending those subsystems are ready.


## Authoring provenance

The private preparer is outside `MedicalCore`. A registry resolves files only below an explicit
source root and emits a temporary build workspace. PDF blocks retain page/bounding-box IDs; TXT
blocks retain line ranges. Hidden `localmed:source` comments are parsed into `sourceSpans` and
removed from visible/searchable text. The original raw-file SHA-256 becomes the document-version
checksum.

Extraction diagnostics may request a spot review for low-text pages, missing headings, or
table-like layouts. They are parser-quality signals, not medical-content validation.

## SQLite content pack

Schema sources: `schema/sql/001_initial.sql` and `schema/sql/002_embeddings.sql`.

- `content_packs` — manifest and compatibility data;
- `documents` — logical documents;
- `document_versions` — editions;
- `sections` — heading hierarchy;
- `chunks` — original and normalized searchable fragments;
- `aliases` — colloquial phrases, abbreviations, and trade names;
- `chunks_fts` — rebuildable FTS5 index;
- `embedding_profiles` — immutable vector-space identity and compatibility metadata;
- `chunk_embeddings` — signed-int8 vectors tied to source chunks.

The web runtime opens the already-built `core-demo.db` with `sqlite3_deserialize`. It no longer has
to recreate the normal path from JSON. The JSON seed remains a recovery and test fixture.

## Web, mobile, and future Rust

Current adapters:

```text
Web
  └─ compiled pack → SQLite WASM

Android / iOS
  └─ compiled pack → CapacitorMedicalStore
       ├─ private persistent file → system SQLite + FTS5
       └─ incompatible/missing native path → SQLite WASM fallback
```

Both runtime adapters map the same SQL rows into the same domain records. `StorageHealth` exposes
which backend won so device tests can verify persistence explicitly.

The native plugin is deliberately read-only. It installs a checksum-addressed bundled pack through
a temporary file and backup, opens it in read-only mode, runs `PRAGMA quick_check`, and probes a real
FTS5 `MATCH` query. Dynamic signed modules will receive a separate installer contract later.

Rust should be introduced only after profiling shows a real need: shared native binary core,
custom ANN index, heavy reranking/graph traversal, signed-pack cryptography, or a proven TypeScript
orchestration bottleneck. The `MedicalCore` boundary allows such a replacement without changing UI
contracts.
