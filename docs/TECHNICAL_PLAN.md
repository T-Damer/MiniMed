# LocalMed Search — техническое ТЗ и план развития

> **Статус:** рабочий проектный документ  
> **Версия документа:** 0.1  
> **Дата:** 16 июля 2026  
> **Целевая аудитория:** разработчик, coding-agent/LLM, data-agent/LLM  
> **Начальный режим:** личный продукт и закрытое тестирование у нескольких врачей  
> **Начальный корпус:** клинические рекомендации РФ, без книг  
> **Начальная архитектура:** offline-first, без собственного бэкенда

---

## 0. Как использовать этот документ

Этот файл является одновременно:

1. продуктовым описанием;
2. архитектурным контрактом;
3. инструкцией для coding-agent;
4. дорожной картой версий;
5. набором критериев приёмки.

Перед выполнением любой задачи агент должен:

1. прочитать корневой `AGENTS.md`;
2. определить, к какой версии и milestone относится задача;
3. прочитать релевантные документы из `docs/`;
4. проверить допустимое направление зависимостей;
5. изменить минимально необходимый набор файлов;
6. запустить форматирование, линтинг, typecheck и тесты;
7. обновить документацию, если изменился контракт, схема БД или пользовательское поведение.

Этот документ не заменяет отдельные ADR. Любое значимое отклонение от него оформляется в `docs/adr/`.

---

# 1. Цель продукта

## 1.1. Краткая цель

Создать локальное приложение для быстрого поиска по российским медицинским материалам, которое:

- работает без интернета;
- принимает свободный текстовый запрос любой разумной длины;
- ищет не только документ, но и конкретный раздел/абзац;
- открывает материал сразу на найденном месте;
- сохраняет соседний контекст;
- позднее поддерживает локальный семантический поиск;
- опционально использует облачную LLM для синтеза ответа;
- не зависит от облака для базовой навигации и поиска.

## 1.2. Продуктовый абстракт

Пользователь вводит в одно большое поле:

- название заболевания;
- препарат или торговое название;
- симптом;
- набор симптомов;
- клиническое описание;
- результаты обследований;
- вопрос по диагностике, ведению или лечению.

Система локально:

1. нормализует запрос;
2. выполняет полнотекстовый поиск;
3. позднее добавляет семантический поиск;
4. объединяет и ранжирует результаты;
5. показывает релевантные заболевания, документы и разделы;
6. позволяет перейти к конкретному фрагменту;
7. показывает контекст до и после найденного фрагмента;
8. предлагает необязательные уточнения под полем ввода.

При наличии ключа облачного провайдера пользователь может запросить краткий синтез по найденным материалам. Базовый поиск не должен зависеть от облака.

## 1.3. Главная проверяемая гипотеза

> Врач сможет найти нужное место в российских клинических рекомендациях быстрее и надёжнее, чем через обычный веб-поиск, ручное открытие PDF или поиск по одному документу.

## 1.4. Первый пользовательский сценарий

1. Пользователь открывает приложение без интернета.
2. Вводит:  
   `Мальчик 7 лет, боль справа внизу живота, однократная рвота, температура 37,8`.
3. Приложение показывает:
   - возможные релевантные темы;
   - несколько найденных разделов;
   - название КР;
   - заголовок раздела;
   - короткий фрагмент с подсветкой;
   - дополнительные уточнения, которые можно добавить.
4. Пользователь нажимает на результат.
5. Открывается текст КР на нужном абзаце с соседним контекстом.
6. При наличии облачного ключа пользователь нажимает «Собрать ответ по найденному».

---

# 2. Ограничение первоначального объёма

## 2.1. Входит в MVP

- Клинические рекомендации РФ.
- Локальная SQLite-база.
- Разделение документов на главы, разделы, абзацы и поисковые фрагменты.
- Стабильные якоря для перехода к найденному месту.
- FTS5-поиск.
- Русская нормализация текста.
- Одно свободное поле ввода.
- Результаты по документам и разделам.
- Просмотр полного контекста.
- Android как первая физическая мобильная платформа.
- Web-режим для разработки и демонстрации.
- iOS-оболочка и адаптеры без обязательного полного feature parity в первой полезной версии.
- Опциональный облачный RAG по пользовательскому API-ключу.
- Позднее — локальные embeddings пользовательского запроса.

## 2.2. Не входит до версии 1.0

- Собственный сервер.
- Авторизация и аккаунты.
- Синхронизация между устройствами.
- PostgreSQL и pgvector.
- Полный граф медицинских знаний.
- Автоматическая постановка окончательного диагноза.
- Автоматическое назначение лечения без показа исходных материалов.
- Хранение полноценной электронной медицинской карты.
- Фотоанализ.
- Постоянный веб-парсер медицинских новостей.
- Автоматический поиск в интернете.
- Обучение собственной LLM.
- OCR внутри мобильного приложения.
- Импорт сотен книг.
- Коммерческая публикация.
- Регуляторная сертификация.
- Переписывание ядра на Rust «на всякий случай».

## 2.3. Принцип сдерживания scope

Если новая функция не улучшает один из трёх показателей:

1. релевантность найденного материала;
2. скорость получения материала;
3. удобство перехода к исходному контексту,

то она не должна попадать в pre-1.0 без отдельного ADR.

---

# 3. Основные архитектурные принципы

## 3.1. Offline-first

Базовый путь должен работать без сети:

```text
запрос
→ локальная нормализация
→ локальный поиск
→ локальный документ
→ переход к нужному месту
```

Облако является усилителем, а не обязательной частью.

## 3.2. Retrieval before generation

Порядок всегда следующий:

```text
сначала поиск
→ затем выбор источников
→ затем, при необходимости, генерация
```

LLM не используется как замена поисковому индексу.

## 3.3. Исходный текст сохраняется

На ранних версиях система не переписывает содержание клинических рекомендаций. Она:

- извлекает текст;
- сохраняет структуру;
- режет на логические фрагменты;
- индексирует;
- добавляет технические метаданные.

Любые сгенерированные резюме или категории являются производными данными и могут быть пересобраны.

## 3.4. Реляционная БД — источник истины

SQLite хранит:

- документы;
- версии;
- разделы;
- абзацы;
- фрагменты;
- якоря;
- метаданные;
- алиасы;
- манифесты модулей.

FTS и векторный индекс являются производными индексами. Их можно удалить и пересобрать.

## 3.5. Векторный поиск — дополнительный индекс

Не использовать отдельную «векторную БД» в локальном MVP.

Семантический слой должен подключаться через интерфейс:

```text
SearchIndex
├── LexicalSearchIndex
└── SemanticSearchIndex
```

Конкретная реализация векторного поиска выбирается после измерений.

## 3.6. Логическое ядро, а не локальный HTTP-сервер

UI общается с `MedicalCore` как с сервисом, но в мобильном приложении это не отдельный процесс и не HTTP-порт.

```text
SolidJS UI
    ↓ типизированные команды
MedicalCore
    ↓ ports
SQLite / native model / cloud provider
```

Позднее тот же контракт можно реализовать как удалённый HTTP API, не меняя UI.

## 3.7. TypeScript сначала, Rust по факту

До появления измеренного узкого места:

- orchestration и бизнес-логика — TypeScript;
- SQLite — нативный SQLite;
- embeddings — нативный runtime;
- тяжёлый vector index — отдельный адаптер;
- PDF/ETL — Python.

Rust допускается после профилирования или при появлении требования общего desktop/mobile/server ядра.

## 3.8. Граница платформы обязательна

Никакой код UI не должен напрямую:

- выполнять SQL;
- вызывать модель;
- хранить API-ключ;
- открывать файлы нативной системой;
- знать формат векторного индекса.

---

# 4. Выбранный стек

## 4.1. Приложение

| Область | Выбор |
|---|---|
| Язык | TypeScript, `strict: true` |
| UI | SolidJS |
| Сборка | Vite |
| Роутинг | `@solidjs/router` |
| Мобильная оболочка | Capacitor 8 |
| Стили | CSS Modules + общие design tokens |
| Валидация границ | Zod |
| Пакетный менеджер | pnpm workspaces |
| Локальная БД | SQLite |
| Полнотекстовый поиск | SQLite FTS5 |
| Unit/integration tests | Vitest |
| E2E web | Playwright |
| Format/lint/imports | Biome |
| Typecheck | TypeScript compiler |
| CI/CD | GitHub Actions |
| Релизы данных | GitHub Releases или статические артефакты |
| Лендинг | Astro, static output |
| Хостинг лендинга | GitHub Pages |

Версии зависимостей должны быть зафиксированы lock-файлом. Не использовать диапазоны `*` или `latest` в committed manifest.

## 4.2. Пайплайн данных

| Область | Выбор |
|---|---|
| Язык | Python |
| Управление окружением | `uv` |
| PDF extraction | PyMuPDF как основной адаптер |
| Fallback extraction | pypdf/pdfplumber по необходимости |
| Форматирование и lint | Ruff |
| Typecheck | Pyright |
| Тесты | pytest |
| Схемы промежуточных данных | Pydantic |
| Выход | SQLite content pack + build report |
| OCR | вне первоначального MVP |

## 4.3. AI-адаптеры

До выбора конкретной модели должны существовать интерфейсы:

- `EmbeddingProvider`;
- `CaseExtractionProvider`;
- `ChatProvider`;
- `Reranker`;
- `ModelCapabilityDetector`.

Первый облачный провайдер может быть Gemini Flash-класса, но:

- model ID задаётся конфигурацией;
- UI не знает название конкретной модели;
- провайдер сменяемый;
- ключ вводит пользователь;
- ключ не хранится в репозитории;
- без ключа приложение полностью работает в режиме поиска.

## 4.4. Почему не Tauri/Rust на старте

Tauri остаётся допустимым будущим вариантом, но не является зависимостью MVP.

Причины:

- производительность FTS обеспечивается SQLite;
- inference выполняется нативным runtime;
- облачная задержка не зависит от языка ядра;
- ранняя миграция на Rust увеличит число систем сборки;
- мобильный AI всё равно потребует Kotlin/Swift-адаптеров;
- главные риски проекта лежат в качестве корпуса и retrieval.

---

# 5. Структура GitHub-репозитория

Рекомендуемое рабочее имя репозитория: `localmed-search`. Имя может быть изменено до публикации.

```text
localmed-search/
├── AGENTS.md
├── README.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── .editorconfig
├── .gitignore
├── .env.example
│
├── apps/
│   ├── app/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── routes/
│   │   │   ├── features/
│   │   │   ├── components/
│   │   │   ├── composition/
│   │   │   └── styles/
│   │   ├── android/
│   │   ├── ios/
│   │   ├── capacitor.config.ts
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── landing/
│       ├── src/
│       ├── public/
│       ├── astro.config.mjs
│       └── package.json
│
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   └── package.json
│   ├── domain/
│   ├── core/
│   ├── storage/
│   ├── storage-sqlite/
│   ├── search-lexical/
│   ├── search-semantic/
│   ├── ai/
│   ├── platform/
│   ├── ui/
│   └── test-fixtures/
│
├── native/
│   ├── capacitor-local-ai/
│   └── capacitor-secure-storage/
│
├── tools/
│   ├── ingest/
│   │   ├── pyproject.toml
│   │   ├── src/
│   │   ├── tests/
│   │   └── prompts/
│   ├── benchmarks/
│   ├── db-inspector/
│   └── release-content-pack/
│
├── content/
│   ├── manifests/
│   ├── overrides/
│   ├── fixtures/
│   └── README.md
│
├── data/
│   ├── raw/                # gitignored
│   ├── intermediate/       # gitignored
│   ├── build/              # gitignored
│   └── .gitkeep
│
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SEARCH.md
│   ├── INGESTION.md
│   ├── AI_ADAPTERS.md
│   ├── TESTING.md
│   ├── RELEASES.md
│   ├── ROADMAP.md
│   └── adr/
│       ├── 0001-typescript-core-first.md
│       ├── 0002-sqlite-as-source-of-truth.md
│       ├── 0003-capacitor-over-tauri-for-mvp.md
│       └── 0004-no-backend-before-1.0.md
│
└── .github/
    ├── workflows/
    │   ├── ci.yml
    │   ├── android-build.yml
    │   ├── ios-build.yml
    │   ├── landing-pages.yml
    │   └── release.yml
    ├── ISSUE_TEMPLATE/
    ├── pull_request_template.md
    ├── dependabot.yml
    └── CODEOWNERS
```

## 5.1. Что не коммитить

- реальные API-ключи;
- большие PDF;
- OCR-артефакты;
- production SQLite-файлы;
- модели;
- локальные логи;
- пользовательские клинические запросы;
- Xcode/Android build outputs.

Небольшие искусственные fixtures допускаются.

## 5.2. Как хранить corpus artifacts

Исходные PDF находятся локально в `data/raw/` и не входят в Git.

В Git хранятся:

- manifest;
- checksum;
- технические метаданные;
- overrides;
- схемы;
- тестовые fixtures.

Собранная БД публикуется как release artifact или копируется вручную в приложение для личной сборки.

---

# 6. Направление зависимостей

## 6.1. Допустимый граф

```text
apps/app
  ├── packages/ui
  ├── packages/contracts
  ├── packages/core
  └── concrete adapters

packages/ui
  └── packages/contracts

packages/core
  ├── packages/contracts
  ├── packages/domain
  └── abstract ports

packages/search-lexical
  ├── packages/contracts
  ├── packages/domain
  └── storage/search ports

packages/search-semantic
  ├── packages/contracts
  ├── packages/domain
  └── embedding/vector ports

packages/storage-sqlite
  ├── packages/domain
  └── storage ports

packages/ai
  ├── packages/contracts
  └── AI ports

packages/domain
  └── не зависит от UI, Capacitor, SQLite и provider SDK
```

## 6.2. Запрещённые зависимости

- `domain -> SolidJS`
- `core -> Capacitor`
- `core -> конкретный Gemini SDK`
- `ui -> SQLite`
- `ui -> SQL string`
- `ui -> native plugin`
- `storage-sqlite -> UI`
- `contracts -> app`
- `ingest Python -> runtime app implementation`

## 6.3. Composition root

Только `apps/app/src/composition/` знает конкретные реализации:

```ts
const core = createMedicalCore({
  documentRepository: createSqliteDocumentRepository(database),
  lexicalSearch: createFts5Search(database),
  semanticSearch: featureFlags.semanticSearch
    ? createSemanticSearch(embeddingProvider, vectorIndex)
    : createDisabledSemanticSearch(),
  chatProvider: cloudConfig
    ? createCloudChatProvider(cloudConfig)
    : createDisabledChatProvider(),
  clock: systemClock,
  logger: localLogger,
});
```

---

# 7. Контракты ядра

## 7.1. Основной интерфейс

```ts
export interface MedicalCore {
  initialize(request: InitializeRequest): Promise<Result<CoreStatus, CoreError>>;
  getCapabilities(): Promise<CoreCapabilities>;

  search(request: SearchRequest): Promise<Result<SearchResponse, SearchError>>;

  getDocument(
    request: GetDocumentRequest,
  ): Promise<Result<MedicalDocument, DocumentError>>;

  getSection(
    request: GetSectionRequest,
  ): Promise<Result<MedicalSection, DocumentError>>;

  getContext(
    request: GetContextRequest,
  ): Promise<Result<ChunkContext, DocumentError>>;

  ask(
    request: AskRequest,
  ): Promise<Result<AskResponse, AskError>>;

  installContentPack(
    request: InstallContentPackRequest,
  ): Promise<Result<InstallContentPackResponse, ContentPackError>>;

  close(): Promise<void>;
}
```

## 7.2. Запрос поиска

```ts
export const SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  mode: z.enum(['auto', 'lexical', 'hybrid']).default('auto'),
  filters: z
    .object({
      documentIds: z.array(z.string()).optional(),
      specialties: z.array(z.string()).optional(),
      ageGroups: z.array(z.string()).optional(),
      sectionTypes: z.array(z.string()).optional(),
    })
    .default({}),
  limit: z.number().int().min(1).max(100).default(20),
  includeSuggestions: z.boolean().default(true),
});
```

## 7.3. Ответ поиска

```ts
export interface SearchResponse {
  requestId: string;
  normalizedQuery: string;
  elapsedMs: number;
  modeUsed: 'lexical' | 'hybrid';
  suggestions: SearchSuggestion[];
  groups: SearchResultGroup[];
  diagnostics?: SearchDiagnostics;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  sectionId: string;
  anchor: string;

  title: string;
  sectionPath: string[];
  snippet: string;
  highlightedRanges: TextRange[];

  lexicalScore?: number;
  semanticScore?: number;
  finalScore: number;
  matchedTerms: string[];
}
```

## 7.4. Порты

```ts
export interface DocumentRepository {
  getDocument(id: string): Promise<MedicalDocument | null>;
  getSection(id: string): Promise<MedicalSection | null>;
  getChunk(id: string): Promise<MedicalChunk | null>;
  getChunkWindow(chunkId: string, radius: number): Promise<MedicalChunk[]>;
}

export interface LexicalSearchIndex {
  search(request: LexicalSearchRequest): Promise<LexicalHit[]>;
}

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimension: number;
  embedQuery(text: string): Promise<Float32Array>;
}

export interface VectorSearchIndex {
  readonly modelId: string;
  readonly dimension: number;
  search(vector: Float32Array, limit: number): Promise<VectorHit[]>;
}

export interface ChatProvider {
  readonly providerId: string;
  getCapabilities(): Promise<ChatCapabilities>;
  generate(request: ChatGenerationRequest): AsyncIterable<ChatEvent>;
}

export interface SecureSecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
```

## 7.5. Ошибки

Не передавать наружу необработанные исключения SDK/SQLite.

```ts
export type CoreError =
  | { code: 'DATABASE_UNAVAILABLE'; message: string; cause?: unknown }
  | { code: 'CONTENT_PACK_INCOMPATIBLE'; message: string }
  | { code: 'MODEL_UNAVAILABLE'; message: string }
  | { code: 'INVALID_REQUEST'; message: string }
  | { code: 'UNKNOWN'; message: string; cause?: unknown };
```

UI показывает дружелюбное сообщение, а техническая причина остаётся в локальном debug log.

---

# 8. Модель данных SQLite

## 8.1. Базовые таблицы

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE content_packs (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  checksum TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  content_pack_id TEXT NOT NULL,
  title TEXT NOT NULL,
  short_title TEXT,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  specialty_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (content_pack_id) REFERENCES content_packs(id)
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_label TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  source_checksum TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL,
  parent_section_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  section_type TEXT,
  depth INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  anchor TEXT NOT NULL UNIQUE,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY (parent_section_id) REFERENCES sections(id)
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  original_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  previous_chunk_id TEXT,
  next_chunk_id TEXT,
  anchor TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY (section_id) REFERENCES sections(id)
);

CREATE TABLE aliases (
  id TEXT PRIMARY KEY,
  canonical_term TEXT NOT NULL,
  alias TEXT NOT NULL,
  category TEXT,
  weight REAL NOT NULL DEFAULT 1.0
);
```

## 8.2. FTS5

Предпочтительно использовать external-content table, чтобы не дублировать полный текст без необходимости.

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  title,
  section_path,
  normalized_text,
  content='searchable_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);
```

Фактическая схема уточняется после smoke test конкретной мобильной SQLite-сборки.

## 8.3. Векторный слой

До выбора реализации в `chunks` не добавляется обязательная vector column.

Допустимые варианты:

1. отдельная таблица BLOB-векторов;
2. SQLite vector extension;
3. отдельный HNSW/USearch-файл;
4. brute-force SIMD для маленького корпуса.

Обязательные поля manifest:

```json
{
  "embedding_model_id": "provider/model/revision",
  "embedding_dimension": 384,
  "embedding_normalization": "l2",
  "chunking_version": 2,
  "index_format": "adapter-specific"
}
```

Корпус и запрос обязаны использовать одну и ту же embedding-модель и совместимый tokenizer. Нельзя заранее построить корпус моделью A, а пользовательский запрос кодировать моделью B.

## 8.4. Скрытое происхождение

Даже если пользователь не видит источники по умолчанию, БД должна хранить:

- документ;
- версию;
- страницу;
- раздел;
- диапазон символов;
- checksum исходника.

Это нужно для обновлений, диагностики ошибок и пересборки.

---

# 9. Разбиение текста

## 9.1. Термины

- `document` — одна клиническая рекомендация;
- `document_version` — конкретная редакция;
- `section` — логический раздел;
- `paragraph` — абзац исходного текста;
- `chunk` — поисковый фрагмент;
- `span` — точный диапазон внутри текста;
- `anchor` — стабильная ссылка для UI.

Не использовать слово «токен» для пользовательской навигации.

## 9.2. Правила chunking

Приоритет:

1. структура документа;
2. заголовки;
3. абзацы;
4. списки;
5. таблицы;
6. только затем ограничение длины.

Не резать текст по фиксированным 128 символам.

Начальные параметры:

- целевой chunk: 250–450 модельных токенов;
- мягкий максимум: 700–800 токенов;
- минимум: 80 токенов;
- overlap: не более одного соседнего абзаца;
- списки не разрывать без необходимости;
- заголовок и полный `section_path` добавлять в поисковое представление;
- исходный отображаемый текст не изменять.

Параметры являются конфигурацией и входят в `chunking_version`.

## 9.3. Стабильные идентификаторы

ID не должен зависеть от номера строки в БД.

Пример:

```text
document:
kr.pediatrics.community-acquired-pneumonia

version:
kr.pediatrics.community-acquired-pneumonia@2025

section:
sha256(document_version_id + normalized_heading_path)

chunk:
sha256(section_id + normalized_paragraph_text + local_order_key)
```

Якорь:

```text
kr.pediatrics.community-acquired-pneumonia@2025
  /diagnostics/laboratory
  #chunk-04f2a8
```

При повторной сборке неизменившийся chunk должен по возможности сохранить ID.

---

# 10. Пайплайн импорта клинических рекомендаций

## 10.1. Конвейер

```text
PDF
→ checksum и manifest
→ извлечение блоков
→ очистка технического мусора
→ восстановление заголовков
→ восстановление абзацев и списков
→ построение section tree
→ chunking
→ русская нормализация
→ SQLite
→ FTS5
→ build report
→ data tests
```

## 10.2. Принцип обработки

В первоначальном MVP LLM не переписывает медицинский текст.

LLM допускается только для:

- предложения типа раздела;
- классификации темы;
- поиска вероятного заголовка при плохой разметке;
- предложения синонимов;
- обнаружения подозрительных разрывов.

Каждое предложение LLM проходит детерминированную схему и может быть отклонено.

## 10.3. Промежуточный формат

```json
{
  "document_id": "kr.pediatrics.example",
  "source_checksum": "sha256:...",
  "pages": [
    {
      "page": 12,
      "blocks": [
        {
          "block_id": "p12-b03",
          "kind": "paragraph",
          "text": "Исходный текст...",
          "bbox": [72.0, 130.0, 510.0, 260.0]
        }
      ]
    }
  ]
}
```

После структурирования:

```json
{
  "section_id": "section...",
  "heading_path": [
    "Диагностика",
    "Лабораторные исследования"
  ],
  "paragraphs": [
    {
      "paragraph_id": "paragraph...",
      "source_blocks": ["p12-b03", "p12-b04"],
      "text": "Исходный текст..."
    }
  ]
}
```

## 10.4. Overrides

Плохие документы исправляются не ручной правкой generated JSON, а файлами:

```text
content/overrides/<document-id>.yaml
```

Пример:

```yaml
document_id: kr.pediatrics.example
operations:
  - type: merge_blocks
    block_ids: [p12-b03, p12-b04]
  - type: set_heading
    block_id: p13-b01
    level: 2
  - type: drop_block
    block_id: p13-b09
    reason: page_footer
```

## 10.5. Data lint

Сборка должна падать при:

- пустом document ID;
- дублирующемся anchor;
- chunk без section;
- section без document version;
- разорванной цепочке `previous/next`;
- пустом normalized text;
- недопустимом schema version;
- несовпадающем checksum;
- невозможном диапазоне страниц;
- FTS row без chunk;
- orphan row.

Сборка предупреждает, но не обязательно падает при:

- слишком длинном chunk;
- слишком коротком chunk;
- подозрительном количестве заголовков;
- повторяющемся абзаце;
- большом числе OCR-ошибок;
- таблице, превращённой в линейный текст.

---

# 11. Поисковый конвейер

## 11.1. Версия с FTS5

```text
raw query
→ trim
→ Unicode normalization
→ lowercase
→ ё → е для поисковой формы
→ punctuation normalization
→ alias expansion
→ FTS query builder
→ BM25
→ grouping
→ snippets
→ context preload
```

Оригинальный пользовательский запрос сохраняется отдельно от нормализованного.

## 11.2. Русская морфология

Не выполнять тяжёлую морфологию на каждом мобильном запросе без необходимости.

Начальный подход:

- при сборке корпуса создать `normalized_text`;
- привести слова к нормальной форме через Python;
- сохранить исходный текст отдельно;
- в runtime применять лёгкую нормализацию;
- использовать aliases и префиксный поиск;
- позднее добавить маленький runtime stemmer, если benchmark подтвердит пользу.

## 11.3. Алиасы и словари

Примеры:

```text
температурит → лихорадка
учащенно дышит → тахипноэ
не хватает воздуха → одышка
правый низ живота → правая подвздошная область
торговое название → действующее вещество
```

Алиасы являются данными, а не hardcoded `if` в UI.

## 11.4. BM25 weighting

Начальные веса:

- exact title match — высокий bonus;
- document title — 8;
- section title/path — 4;
- chunk text — 1;
- exact drug name — дополнительный rule bonus;
- устаревшая версия — penalty;
- disabled content pack — исключается.

Значения уточняются benchmark-ом.

## 11.5. Гибридный поиск

```text
FTS top 50
+
vector top 50
→ reciprocal rank fusion
→ rule boosts
→ deduplication
→ group by document/section
→ top 20
```

Начальный вариант fusion:

```ts
score = lexicalRrf + semanticRrf + exactMatchBoost + metadataBoost;
```

Не складывать сырые BM25 и cosine score напрямую без калибровки.

## 11.6. Длинный клинический запрос

Не сводить длинное описание к одному резюме.

После появления локального case parser строятся несколько представлений:

- исходный текст;
- симптомы;
- отрицательные признаки;
- временная линия;
- эпидемиология;
- лекарства;
- исследования;
- несколько поисковых формулировок.

Каждое представление ищется отдельно, результаты объединяются.

## 11.7. Выдача

Результат должен отвечать на вопросы:

- что найдено;
- где найдено;
- почему результат показан;
- куда перейдёт пользователь;
- какой контекст будет открыт.

Нельзя показывать только «вероятность диагноза 84%» без привязанного материала.

---

# 12. Пользовательский интерфейс

## 12.1. Основной экран

```text
┌───────────────────────────────────────────────────────┐
│ Опишите препарат, симптом или клиническую ситуацию…   │
│                                                       │
└───────────────────────────────────────────────────────┘

Распознано / полезно уточнить:
[возраст] [пол] [длительность] [температура] [лекарства]

Результаты:
1. Документ → Диагностика → Клинические критерии
2. Документ → Дифференциальная диагностика
3. Документ → Маршрутизация
```

Поле ввода не ограничивается обязательной формой.

## 12.2. Режимы layout

Desktop/tablet:

```text
поиск и результаты | документ | чат/уточнения
```

Телефон:

```text
экран поиска
→ экран результатов
→ экран документа
→ bottom sheet чата
```

## 12.3. Документ

Обязательно:

- breadcrumb;
- название КР;
- заголовок раздела;
- найденный chunk;
- соседние абзацы;
- подсветка;
- переход к предыдущему/следующему разделу;
- кнопка «показать весь раздел»;
- кнопка «использовать в чате»;
- возможность вернуться к той же позиции.

## 12.4. Подсказки под полем

В ранних версиях подсказки могут быть:

- статическими;
- rule-based;
- зависящими от найденных категорий;
- необязательными.

Позднее `CaseExtractionProvider` формирует:

- извлечённые данные;
- неопределённые данные;
- недостающие данные;
- альтернативные поисковые ветки.

## 12.5. Состояния

Каждый экран обязан иметь:

- loading;
- empty;
- error;
- offline;
- database not installed;
- content pack incompatible;
- model unavailable;
- cloud key missing.

Нельзя оставлять silent failure.

---

# 13. Облачное усиление без собственного сервера

## 13.1. BYOK

Для личного MVP пользователь вводит собственный API-ключ.

Ключ:

- хранится через `SecureSecretStore`;
- никогда не попадает в localStorage;
- никогда не логируется;
- никогда не коммитится;
- может быть удалён из настроек;
- проверяется отдельной тестовой командой.

## 13.2. Провайдерный интерфейс

```ts
export interface CloudModelConfig {
  provider: 'gemini' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKeyRef: string;
}
```

Не создавать отдельный `GeminiChatComponent`.

UI работает только с `ChatProvider`.

## 13.3. RAG-контекст

В облако отправляется:

- запрос пользователя;
- выбранные локальные chunks;
- section path;
- внутренние anchor IDs;
- краткая инструкция по формату ответа.

Не отправляется весь корпус.

## 13.4. Формат ответа

Модель должна возвращать:

```json
{
  "answer_markdown": "...",
  "used_anchor_ids": ["..."],
  "insufficient_context": false,
  "suggested_follow_up": ["..."]
}
```

После ответа приложение проверяет, что все `used_anchor_ids` реально присутствовали в переданном контексте.

## 13.5. Поведение без облака

- кнопка чата скрыта или сообщает о необходимости ключа;
- результаты поиска остаются доступными;
- документ открывается;
- история поиска работает;
- никакого обязательного network call при старте.

---

# 14. Локальные модели

## 14.1. Порядок внедрения

1. Без локальной LLM.
2. Локальный query embedder.
3. Локальный case extractor.
4. Опциональное короткое локальное резюме.
5. Полноценный локальный chat — только после отдельного benchmark.

## 14.2. Локальный embedder

Требования:

- русский или multilingual benchmark;
- одна модель для corpus и query;
- фиксированная revision;
- квантованная мобильная сборка;
- CPU fallback;
- capability detection;
- измерение cold/warm latency;
- отсутствие обязательного NPU.

## 14.3. Локальная LLM

Её первая задача:

```text
свободный клинический текст
→ структурированный JSON
```

Не:

```text
свободный клинический текст
→ окончательный диагноз и лечение
```

Пример schema:

```ts
export const StructuredCaseSchema = z.object({
  patient: z.object({
    age: z.string().optional(),
    sex: z.enum(['male', 'female', 'unknown']).default('unknown'),
  }),
  symptoms: z.array(ClinicalFactSchema),
  negativeFindings: z.array(ClinicalFactSchema),
  medications: z.array(MedicationFactSchema),
  investigations: z.array(InvestigationFactSchema),
  epidemiology: z.array(ClinicalFactSchema),
  timeline: z.array(TimelineEventSchema),
  uncertainties: z.array(z.string()),
  searchQueries: z.array(z.string()).max(8),
  missingDataSuggestions: z.array(z.string()).max(12),
});
```

## 14.4. Fallback chain

```text
system local model
→ bundled local model
→ rule-based parser
→ cloud parser
→ raw-query search
```

Raw-query search должен работать всегда.

---

# 15. Форматирование, линтинг и правила кода

## 15.1. TypeScript

Обязательно:

- `strict: true`;
- `noUncheckedIndexedAccess: true`;
- `exactOptionalPropertyTypes: true`;
- `useUnknownInCatchVariables: true`;
- `noImplicitOverride: true`;
- project references для packages;
- `tsc --noEmit` в CI.

## 15.2. Biome

Biome отвечает за:

- форматирование;
- lint;
- import organization;
- базовые correctness/style rules.

Рекомендуемые правила:

- indentation: 2 spaces;
- line width: 100;
- single quotes в TS/JS;
- trailing commas where valid;
- semicolons;
- LF;
- final newline;
- организованные импорты;
- запрет неиспользуемых imports/variables;
- запрет явного `any` без локального disable и комментария;
- запрет `console.log` в production-коде;
- запрет non-null assertion без объяснения.

Команды:

```bash
pnpm format
pnpm lint
pnpm check
pnpm typecheck
```

`pnpm check` должен быть read-only в CI. Автоисправление выполняется локально отдельной командой.

## 15.3. Python

```bash
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest
```

## 15.4. Именование

| Объект | Стиль |
|---|---|
| TS files | `kebab-case.ts` |
| Solid components | `PascalCase.tsx` допустим внутри feature |
| Functions/variables | `camelCase` |
| Types/interfaces | `PascalCase` |
| Constants | `UPPER_SNAKE_CASE` только для настоящих constants |
| SQL tables/columns | `snake_case` |
| Package names | `@localmed/<name>` |
| Feature folders | `kebab-case` |
| Python modules | `snake_case.py` |
| Document IDs | lowercase dot-separated |
| Anchors | stable lowercase path |

## 15.5. Кодовые ограничения

- Бизнес-логика не живёт в Solid-компонентах.
- Компонент не выполняет SQL.
- Компонент не знает provider SDK.
- Функция, меняющая persistent state, имеет явное имя и тест.
- Схема БД изменяется только migration.
- Public API package экспортируется через один явный `index.ts`.
- Избегать глубины вложенности более трёх уровней.
- Предпочитать early return.
- Не создавать абстракцию до второго реального использования, кроме архитектурных ports.
- Не использовать dependency injection framework.
- Не использовать глобальный mutable singleton.
- Не использовать barrel imports внутри одного package, если они создают циклы.
- Не использовать `any` для JSON от модели: сначала `unknown`, затем schema validation.
- Не сохранять generated LLM output без schema version.

## 15.6. Комментарии

Комментарий объясняет:

- почему;
- ограничение;
- инвариант;
- ссылку на ADR;
- технический debt.

Комментарий не повторяет очевидный код.

---

# 16. Тестирование

## 16.1. Пирамида

```text
много unit tests
→ integration tests с реальной SQLite
→ contract tests adapters
→ search relevance benchmarks
→ немного E2E
→ native smoke tests
```

## 16.2. Unit tests

Покрывают:

- query normalization;
- alias expansion;
- FTS query builder;
- result fusion;
- grouping;
- score boosts;
- schema validation;
- stable IDs;
- error mapping;
- content pack compatibility;
- cloud context selection.

Не mock-ать чистые функции без причины.

## 16.3. Integration tests

Используют временную реальную SQLite-БД.

Проверяют:

- migrations;
- FTS5 availability;
- insert/query;
- snippets;
- anchors;
- foreign keys;
- content pack install;
- transaction rollback;
- повторную установку той же версии;
- несовместимый schema version.

## 16.4. Contract tests

Один и тот же набор тестов запускается для:

- in-memory storage;
- desktop SQLite adapter;
- mobile SQLite adapter;
- disabled semantic adapter;
- реального semantic adapter.

## 16.5. E2E

Playwright:

- запуск приложения;
- установка test content pack;
- ввод запроса;
- показ результатов;
- открытие документа;
- переход к anchor;
- возврат назад;
- offline mode;
- cloud feature disabled;
- mobile viewport.

Не проверять детали реализации через CSS selectors. Использовать roles, labels и стабильные test IDs только там, где role недостаточна.

## 16.6. Native smoke

На Android:

- приложение запускается;
- Capacitor bridge работает;
- БД открывается;
- FTS5 query проходит;
- asset DB копируется;
- deep link внутри приложения работает;
- background/foreground не ломает соединение;
- cold start повторяем.

На iOS аналогично после подключения платформы.

## 16.7. Data tests

Golden fixtures для нескольких PDF:

- ожидаемое число разделов;
- конкретные heading paths;
- конкретные chunks;
- отсутствие колонтитулов;
- сохранение списка;
- стабильность ID;
- детерминированность сборки.

Одинаковый input + одинаковая версия pipeline должны давать одинаковый checksum output.

## 16.8. Retrieval benchmark

Формат:

```json
{
  "id": "query-001",
  "query": "ребенок часто дышит и температурит",
  "expected": [
    {
      "document_id": "kr.pediatrics.pneumonia",
      "section_type": "diagnostics",
      "relevance": 3
    }
  ],
  "query_class": "lay-symptom-description"
}
```

Классы запросов:

- точное название диагноза;
- препарат;
- торговое название;
- точный медицинский термин;
- бытовая формулировка симптома;
- несколько симптомов;
- длинный клинический случай;
- отрицания;
- опечатка;
- аббревиатура;
- вопрос по анализам;
- маршрутизация;
- дифференциальная диагностика.

Метрики:

- Recall@5;
- Recall@10;
- MRR@10;
- nDCG@10;
- zero-result rate;
- p50/p95 latency;
- число дублей в top 10.

## 16.9. Coverage

Не гнаться за общим процентом ради числа.

Обязательное покрытие:

- 90% branches для query normalization;
- 90% branches для result fusion;
- 100% migrations integration-tested;
- 100% critical error mappings;
- E2E для главного пользовательского пути.

---

# 17. Производительность

## 17.1. Измерять на reference devices

Зафиксировать:

- один средний Android;
- один high-end Android;
- один iPhone после появления iOS;
- desktop browser.

Без указания устройства цифры не считаются benchmark.

## 17.2. Целевые показатели

Для версии 0.1.0:

- cold start приложения: целевой p95 менее 3 секунд;
- FTS search: целевой p95 менее 200 мс;
- открытие chunk context: целевой p95 менее 100 мс;
- отсутствие network request в offline search path;
- 20 последовательных поисков без роста памяти более установленного budget;
- scrolling документа без заметных блокировок UI.

Для версии 0.3.0:

- warm query embedding: целевой p95 менее 800 мс на reference mid-range device;
- hybrid search после embedding: менее 300 мс;
- полный локальный поиск: целевой p95 менее 1,2 секунды;
- fallback на lexical при ошибке модели.

Цифры являются целями, а не предположением о готовой производительности.

## 17.3. Профилирование перед Rust

Rust рассматривается только если profiler показывает, что:

- JS fusion/grouping занимает существенную долю p95;
- corpus слишком велик для текущего vector adapter;
- WebView memory становится ограничением;
- нужен общий binary core для CLI/server;
- нативный search core заметно снижает latency или размер памяти.

---

# 18. Инструкции для coding-agent

Корневой `AGENTS.md` должен содержать сокращённую обязательную версию этого раздела.

## 18.1. До изменения кода

Агент обязан:

1. прочитать issue;
2. определить затрагиваемые packages;
3. проверить dependency direction;
4. найти существующие interfaces;
5. проверить тесты;
6. проверить ADR;
7. не добавлять новую библиотеку, если задача решается текущим стеком.

## 18.2. Во время работы

- Делать минимальный вертикальный slice.
- Не рефакторить несвязанный код.
- Не переименовывать public contracts без migration plan.
- Не менять schema version молча.
- Не создавать mock production behavior.
- Не делать network calls из UI.
- Не добавлять telemetry.
- Не хранить clinical query в логах.
- Не использовать placeholder в acceptance path.
- Не скрывать ошибку пустым `catch`.
- Не добавлять Rust, Tauri, Postgres, Docker или backend без ADR.

## 18.3. После работы

Агент обязан выполнить:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Если изменён pipeline:

```bash
cd tools/ingest
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest
```

Если изменена схема:

```bash
pnpm db:migrate:test
pnpm db:integrity:test
```

Если изменён поиск:

```bash
pnpm benchmark:search --fixture small
```

## 18.4. Формат отчёта агента

```markdown
## Что изменено
- ...

## Почему
- ...

## Контракты/схема
- ...

## Проверки
- `pnpm check`
- `pnpm typecheck`
- `pnpm test`

## Риски и ограничения
- ...
```

## 18.5. Запрещённые утверждения агента

Агент не должен писать «готово», если:

- tests не запускались;
- native build не проверен;
- migration не проверена на чистой и существующей БД;
- UI использует hardcoded fixture вместо реального core;
- acceptance criteria не выполнены.

---

# 19. Инструкции для data-agent/LLM

## 19.1. Назначение

Data-agent помогает:

- классифицировать разделы;
- обнаруживать заголовки;
- предлагать алиасы;
- находить потенциальные дубликаты;
- обнаруживать конфликтующие версии;
- формировать draft metadata.

Он не изменяет исходный медицинский текст.

## 19.2. Доступные операции

```text
read_source_blocks(ids)
read_section_tree(document_id)
propose_section_type(data)
propose_alias(data)
propose_metadata(data)
report_extraction_issue(data)
report_possible_conflict(data)
```

Нет операции:

```text
execute_sql(...)
rewrite_source_text(...)
delete_document(...)
publish_content_pack(...)
```

## 19.3. Формат результата

Только JSON по schema.

```json
{
  "operation": "propose_section_type",
  "target_id": "section...",
  "value": "diagnostics",
  "confidence": 0.91,
  "evidence_block_ids": ["p12-b03"],
  "notes": "Заголовок и содержание относятся к диагностике"
}
```

## 19.4. Правила

- Не выдумывать отсутствующее.
- Не разрешать противоречие самостоятельно.
- Не объединять взрослые и детские данные без явного основания.
- Не переносить отрицание.
- Не изменять числовые значения.
- Не нормализовать дозу без сохранения оригинала.
- Всегда возвращать evidence IDs.
- При сомнении использовать `needs_review`.
- Не публиковать изменения напрямую.

## 19.5. Prompt directory

```text
tools/ingest/prompts/
├── README.md
├── detect-headings.md
├── classify-section.md
├── propose-aliases.md
├── detect-duplicates.md
├── detect-conflicts.md
└── validate-structure.md
```

Каждый prompt имеет:

- purpose;
- input schema;
- output schema;
- positive example;
- negative example;
- forbidden behavior;
- model parameters;
- prompt version.

---

# 20. GitHub-процесс

## 20.1. Репозиторий

На старте — private GitHub repository.

Обязательно:

- `main`;
- branch protection;
- pull requests;
- CI required;
- запрет force push в `main`;
- secrets только в GitHub Secrets;
- Dependabot для dependency alerts;
- GitHub Releases для версий.

## 20.2. Ветки

```text
feat/issue-123-short-name
fix/issue-124-short-name
docs/issue-125-short-name
chore/issue-126-short-name
```

## 20.3. Commits

Conventional Commits:

```text
feat(search): add FTS result grouping
fix(storage): preserve anchors during migration
docs(architecture): describe vector adapter
test(ingest): add golden fixture for nested headings
```

Один commit не обязан соответствовать одному файлу, но должен соответствовать одной логической причине изменения.

## 20.4. Issues

Labels:

- `area:app`
- `area:search`
- `area:storage`
- `area:ingest`
- `area:native`
- `area:landing`
- `area:docs`
- `type:feature`
- `type:bug`
- `type:spike`
- `type:debt`
- `priority:p0`
- `priority:p1`
- `priority:p2`
- `blocked`
- `needs-benchmark`

Milestone соответствует версии.

## 20.5. Pull request template

```markdown
## Задача
Closes #

## Изменения
- ...

## Архитектура
- [ ] Направление зависимостей сохранено
- [ ] Public contract не изменён
- [ ] Schema migration добавлена при необходимости
- [ ] ADR добавлен при значимом решении

## Проверки
- [ ] Biome
- [ ] TypeScript
- [ ] Vitest
- [ ] Build
- [ ] Search benchmark
- [ ] Native smoke

## Данные и приватность
- [ ] Нет секретов
- [ ] Нет пользовательских медицинских данных в fixtures/logs
```

## 20.6. Release artifacts

Release может включать:

- web demo;
- Android APK;
- checksum;
- core content pack;
- changelog;
- benchmark report;
- known limitations.

---

# 21. Лендинг

## 21.1. Технология

- Astro;
- static output;
- GitHub Pages;
- отдельный `apps/landing`;
- общий пакет design tokens;
- без backend;
- без analytics на старте.

## 21.2. Структура

1. Hero:
   - «Локальный поиск по российским клиническим рекомендациям».
2. Проблема:
   - PDF и каталог документов не дают быстрого перехода к нужному месту.
3. Как работает:
   - ввод запроса → поиск → точный раздел → опциональный чат.
4. Offline-first:
   - базовые функции без сети.
5. Возможности текущей версии.
6. Архитектура.
7. Roadmap.
8. Скриншоты/GIF.
9. Ограничения.
10. GitHub repository.
11. FAQ.
12. Статус сборки и последняя версия.

## 21.3. Ограничения текста лендинга

До появления валидации не использовать формулировки:

- «ставит диагноз»;
- «назначает лечение»;
- «заменяет врача»;
- «гарантирует правильный ответ».

Использовать:

- «помогает найти»;
- «показывает релевантные разделы»;
- «собирает материалы»;
- «поддерживает клинический поиск».

---

# 22. Версионирование

Используется Semantic Versioning.

- `0.0.x` — фундамент и технические spikes;
- `0.x.0` — законченный пользовательский milestone;
- `1.0.0` — стабильная личная версия для ограниченного круга врачей.

Не дробить каждую небольшую задачу на релиз. Patch-релиз нужен для исправления или ограниченного дополнения уже выпущенного milestone.

---

# 23. План по версиям

## 23.1. Версия 0.0.1 — Repository & Integration Skeleton

### Цель

Доказать, что выбранный стек собирается и все ключевые границы существуют.

### Должно быть

#### GitHub

- Создан private repository.
- Добавлены `README.md`, `AGENTS.md`, `CONTRIBUTING.md`.
- Настроен pnpm workspace.
- Настроена защита `main`.
- Создан milestone `0.0.1`.
- Добавлен CI.

#### App

- SolidJS + TypeScript + Vite.
- Capacitor 8 инициализирован.
- Android project добавлен.
- iOS project добавлен, если доступен macOS; иначе issue с явным blocker.
- Web app запускается.
- Android debug app запускается на emulator/device.
- Есть экран статуса.

#### Core

```ts
interface MedicalCore {
  initialize(...): ...;
  getCapabilities(): ...;
  close(): ...;
}
```

- Есть `InMemoryMedicalCore`.
- UI получает core через composition root.
- UI не импортирует implementation напрямую из feature-компонентов.

#### SQLite spike

Нужно выбрать мобильный SQLite adapter только после smoke test:

- открыть БД;
- выполнить migration;
- создать FTS5 virtual table;
- вставить строку;
- выполнить `MATCH`;
- закрыть/повторно открыть БД;
- проверить Android lifecycle.

Если выбранный community plugin не проходит FTS5 test, создать минимальный custom Capacitor plugin.

#### Landing

- Astro app создан.
- Есть hero, краткое описание и roadmap placeholder.
- GitHub Pages workflow собирается.

#### Tooling

- Biome.
- TypeScript strict.
- Vitest.
- Playwright skeleton.
- Ruff/Pyright/pytest skeleton для ingest.
- `.env.example`.
- no secrets check.

### Acceptance criteria

- `pnpm install --frozen-lockfile` проходит.
- `pnpm check` проходит.
- `pnpm typecheck` проходит.
- `pnpm test` проходит.
- `pnpm build` проходит.
- Android debug build проходит.
- UI показывает `Core status: ready`.
- FTS5 smoke test проходит на Android.
- Landing собирается.
- CI зелёный на чистом clone.

### Не входит

- реальные КР;
- полноценная schema;
- пользовательский поиск;
- cloud LLM;
- embeddings.

---

## 23.2. Версия 0.0.2 — Contracts, Data Model & Document Viewer

### Цель

Зафиксировать интерфейсы и доказать полный путь «БД → core → UI».

### Должно быть

#### Contracts

- `SearchRequestSchema`.
- `SearchResponseSchema`.
- `MedicalDocument`.
- `MedicalSection`.
- `MedicalChunk`.
- `ChunkContext`.
- typed errors.
- content pack manifest schema.

#### Storage

- migrations v1;
- таблицы documents/versions/sections/chunks;
- repository interfaces;
- SQLite implementation;
- in-memory implementation;
- transaction helper;
- integrity checker.

#### Test content pack

Искусственный content pack:

- 2 документа;
- 6 разделов;
- 20–30 chunks;
- стабильные anchors;
- не содержит реальных медицинских рекомендаций.

#### UI

- список документов;
- экран документа;
- section tree;
- открытие по anchor;
- previous/next chunk;
- сохранение scroll position в session state.

#### Tests

- contract tests repository;
- migration tests;
- anchor navigation E2E;
- corrupted DB error screen.

### Acceptance criteria

- Один и тот же repository contract проходит для memory и SQLite.
- Чистая установка создаёт БД.
- Повторный запуск не повреждает данные.
- Документ открывается по deep internal link.
- После возврата сохраняется позиция.
- Нет прямого SQL в UI.
- Schema описана в `docs/DATA_MODEL.md`.

### Не входит

- PDF import;
- FTS;
- semantic search;
- cloud chat.

---

## 23.3. Версия 0.0.3 — Clinical Recommendation Ingestion Pipeline

### Цель

Автоматически построить валидный content pack из небольшого набора КР.

### Корпус

- 3–5 клинических рекомендаций;
- предпочтительно текстовые PDF;
- документы с разной структурой;
- минимум один документ с таблицей;
- минимум один с вложенными заголовками.

### Должно быть

#### CLI

```bash
uv run medbase import data/raw
uv run medbase inspect <document-id>
uv run medbase build --pack core-demo
uv run medbase lint --pack core-demo
uv run medbase report --pack core-demo
```

#### Extraction

- checksum;
- metadata;
- page blocks;
- headings;
- paragraphs;
- lists;
- section tree;
- chunks;
- anchors.

#### Overrides

- YAML override format;
- минимум один реальный override test.

#### Build report

```json
{
  "documents": 5,
  "sections": 184,
  "chunks": 621,
  "warnings": [],
  "errors": [],
  "output_checksum": "..."
}
```

#### Inspection

Простой локальный HTML/CLI inspector:

- document tree;
- raw block;
- resulting paragraph;
- chunk boundaries;
- page number.

### Acceptance criteria

- Build детерминирован.
- Все documents открываются в app.
- У каждого chunk есть document/section/anchor.
- Нет колонтитулов в golden samples.
- Минимум 90% целевых заголовков в fixture-наборе распознаны.
- Ошибка одного документа не создаёт частично валидный production pack.
- Build report сохраняется.

### Не входит

- LLM-переписывание;
- полный автоматический парсинг любых PDF;
- OCR;
- embeddings.

---

## 23.4. Версия 0.1.0 — Первый полезный offline MVP: FTS5 Search

### Цель

Получить продукт, которым уже можно пользоваться как быстрым локальным поиском по КР.

### Корпус

- 10–20 КР;
- одна предметная область или связанный набор;
- актуальные версии явно помечены;
- устаревшие версии либо исключены, либо имеют penalty.

### Должно быть

#### Search

- FTS5 index;
- normalized search text;
- query normalization;
- basic aliases;
- BM25;
- snippets;
- highlighted terms;
- grouping;
- filters по документу/разделу;
- zero-results state.

#### UI

- одно большое свободное поле;
- submit по Enter с поддержкой Shift+Enter;
- история последних локальных запросов;
- результаты по разделам;
- open exact anchor;
- «показать соседний контекст»;
- «показать весь раздел».

#### Offline

- airplane mode test;
- content pack bundled или устанавливается из локального файла;
- no network request при поиске.

#### Benchmark

Минимум 50 curated queries:

- 20 exact medical;
- 10 drugs;
- 10 lay phrases;
- 10 multi-term.

### Acceptance criteria

- Recall@5 не ниже 0,75 на точных и терминологических запросах.
- FTS p95 соответствует performance budget на reference Android.
- 95% результатов открываются на корректном anchor.
- Поиск работает после kill/restart.
- Нет локальной LLM.
- Нет cloud dependency.
- Три заранее заданных реальных сценария выполняются быстрее ручного открытия PDF в контрольном тесте.

### Release artifact

- Android APK;
- web demo с fixture corpus;
- `core-demo.db`;
- benchmark report;
- landing с реальными скриншотами.

---

## 23.5. Версия 0.2.0 — Clinical Query UX

### Цель

Сделать поиск удобным для длинного естественного описания, не добавляя обязательную LLM.

### Должно быть

#### Query editor

- многострочное поле;
- 20 000 символов;
- autosize;
- clear;
- paste;
- сохранение draft только локально и только при явной настройке;
- character indicator только около лимита.

#### Suggestions

Rule-based предложения:

- возраст;
- пол;
- длительность;
- температура;
- лекарства;
- анализы;
- эпидемиология.

Нажатие на chip не открывает обязательную анкету, а добавляет структурированный optional field или шаблон в текст.

#### Search branching

Для длинного запроса без LLM:

- выделение чисел/возраста/температуры/duration regex;
- поиск исходного текста;
- поиск ключевых терминов;
- alias expansion;
- объединение результатов.

#### Results UX

- группировка «заболевания/темы», «диагностика», «лечение», «маршрутизация» на основе section type;
- pin result;
- compare two sections;
- локальные bookmarks;
- copy excerpt.

### Acceptance criteria

- Длинный запрос не блокирует UI.
- Исходный текст не теряется при навигации.
- Rule parser корректно обрабатывает fixture-набор с возрастом, температурой, длительностью и отрицаниями.
- Suggestions можно полностью игнорировать.
- Нет обязательного modal questionnaire.
- Поиск остаётся полностью offline.

---

## 23.6. Версия 0.3.0 — Hybrid Semantic Search

### Цель

Находить релевантные разделы, когда формулировка пользователя не совпадает с терминологией КР.

### Предварительный benchmark моделей

Сравнить минимум три multilingual/Russian embedding candidate на одном corpus/query set.

Измерять:

- Recall@5/10;
- MRR;
- размер модели;
- Android cold/warm latency;
- RAM;
- экспортируемость;
- одинаковую работу corpus/query.

Выбор модели фиксируется ADR.

### Corpus embeddings

- вычисляются при сборке content pack;
- входят в release artifact;
- имеют model ID/revision;
- имеют checksum;
- пересобираются при изменении chunking или модели.

### On-device query embedding

- Android native adapter;
- CPU fallback;
- capability report;
- timeout;
- lexical fallback;
- warm-up policy.

### Vector index

Сначала benchmark:

1. brute-force для малого корпуса;
2. SQLite vector adapter;
3. HNSW sidecar.

Выбирается самый простой вариант, выполняющий performance budget.

### Hybrid ranking

- top K lexical;
- top K semantic;
- RRF;
- exact term boost;
- dedup;
- result explanation.

### Acceptance criteria

- Hybrid Recall@5 не ниже 0,85 на полном benchmark-наборе.
- Hybrid лучше lexical минимум на 15% по lay/semantic subset.
- Exact drug/title queries не ухудшены более чем на допустимый порог.
- При недоступной модели автоматически используется lexical.
- Query embedding работает без сети.
- Model mismatch блокирует semantic index с понятной ошибкой.
- UI показывает, какой режим был использован.

### Platform note

Android является первым обязательным target. iOS adapter может выйти как `0.3.1`, но contract должен быть платформенно нейтральным.

---

## 23.7. Версия 0.4.0 — Optional Cloud RAG Chat

### Цель

Добавить удобный синтез по найденным фрагментам без собственного backend.

### Должно быть

#### Settings

- provider;
- model;
- API key;
- test connection;
- delete key;
- max context;
- cloud usage warning.

#### Chat

- чат привязан к текущему query;
- пользователь может выбрать результаты;
- система автоматически берёт top chunks с diversity;
- streaming;
- stop generation;
- regenerate;
- view used sections;
- copy answer.

#### RAG policy

- модель получает только выбранный контекст;
- обязана возвращать internal anchors;
- ответ без валидных anchors помечается;
- при недостатке контекста это показывается явно;
- raw model output не сохраняется как медицинская база.

#### Provider abstraction

- один рабочий provider;
- mock provider;
- OpenAI-compatible adapter допускается вторым.

### Acceptance criteria

- Без ключа приложение работает как раньше.
- Ключ не виден в logs/storage dump.
- Все ссылки ответа ведут к переданным chunks.
- При hallucinated anchor UI не показывает его как источник.
- Network timeout не повреждает сессию.
- Пользователь может отменить stream.
- Cloud request payload доступен в debug preview без secret.

---

## 23.8. Версия 0.5.0 — Structured Case Extraction

### Цель

Локально разбирать длинное текстовое описание в поисковые аспекты.

### Должно быть

#### Interface

```ts
interface CaseExtractionProvider {
  extract(text: string): Promise<StructuredCase>;
}
```

#### Implementations

- rule-based baseline;
- local model adapter;
- optional cloud adapter;
- disabled adapter.

#### Output

- возраст;
- пол;
- симптомы;
- отрицательные признаки;
- сроки;
- лекарства;
- исследования;
- эпидемиология;
- uncertainties;
- missing data suggestions;
- search query variants.

#### Verification UI

Показывать распознанное как editable chips. Пользователь может удалить неверный факт до повторного поиска.

#### Search integration

Поиск выполняется по:

- raw text;
- extracted symptom query;
- medication query;
- investigation query;
- epidemiology query.

### Acceptance criteria

- Raw query всегда участвует в поиске.
- Модель не может незаметно удалить исходный текст.
- Каждый извлечённый факт хранит source range, если adapter это поддерживает.
- Invalid JSON отклоняется schema validator.
- На fixture-наборе корректно обрабатываются отрицания и неопределённость в установленном пороге.
- При model failure используется rule-based/raw search.
- Полный offline путь доступен на поддерживаемых устройствах.

---

## 23.9. Версия 0.6.0 — Content Packs & Updates

### Цель

Разделить ядро и специальности, не вводя backend.

### Content packs

```text
core
pediatrics
infectious-diseases
surgery
diagnostics
laws-rf-later
```

### Должно быть

- pack manifest;
- schema compatibility;
- checksum;
- install/uninstall;
- enable/disable;
- atomic update;
- rollback;
- storage usage;
- version display;
- static update manifest;
- download from GitHub Release/static host;
- local file import.

### Core pack

Минимум:

- базовая терминология;
- красные флаги;
- общие симптомы;
- базовая маршрутизация;
- справочник препаратов/aliases в ограниченном виде.

### Acceptance criteria

- Неудачное обновление не ломает текущую БД.
- Pack можно удалить без удаления bookmarks других packs.
- Search respects enabled packs.
- Version mismatch обрабатывается до миграции.
- Pack checksum проверяется.
- Есть rollback на предыдущую установленную версию.
- Приложение работает с одним core pack.

---

## 23.10. Версия 0.7.0 — Corpus Scale & Search Quality

### Цель

Увеличить корпус и доказать, что качество не деградирует.

### Корпус

- 30–50 КР;
- несколько смежных направлений;
- лекарства и торговые aliases;
- актуальные версии;
- document metadata.

### Должно быть

- расширенный benchmark 150+ запросов;
- query classes;
- relevance judgments;
- regression dashboard;
- duplicate detection;
- stale version warnings;
- extraction quality report;
- search result explanations;
- cache policy;
- DB vacuum/analyze pipeline.

### Acceptance criteria

- Hybrid Recall@5 не ниже установленного release threshold.
- Ни один critical benchmark query не имеет zero results.
- p95 остаётся в budget.
- DB integrity проходит после install/update/remove packs.
- Regression report прикладывается к release.
- Corpus build полностью воспроизводим.

---

## 23.11. Версия 0.8.0 — Local-First Hardening

### Цель

Сделать приложение устойчивым к реальному мобильному использованию.

### Должно быть

- background/foreground lifecycle;
- low-memory recovery;
- model unload/reload;
- interrupted content download;
- disk-space check;
- offline indicator;
- export local debug report;
- crash-safe migrations;
- accessibility pass;
- keyboard/navigation pass;
- large font support;
- dark mode;
- iOS feature parity для ключевого пути;
- native smoke suite.

### Acceptance criteria

- 100 последовательных search/open/back operations без crash.
- Убийство приложения во время update не повреждает pack.
- После low-memory event lexical search работает.
- Model unavailable не блокирует приложение.
- Все основные действия доступны с screen reader labels.
- Search и document viewer работают на Android и iOS reference devices.

---

## 23.12. Версия 0.9.0 — Private Beta

### Цель

Проверить продукт на нескольких врачах и исправить UX/quality gaps.

### Должно быть

- onboarding;
- content disclaimer как продуктовый текст, без юридического scope;
- tutorial из трёх шагов;
- local feedback export;
- bookmark export/import;
- opt-in diagnostic bundle;
- known limitations page;
- release notes;
- beta survey;
- минимум 20 практических заданий для user test.

### Критерии продуктового успеха

- минимум 3 врача выполняют сценарии;
- в 70% задач нужный материал находится быстрее контрольного способа;
- минимум 80% найденных top-5 наборов оцениваются как полезные;
- не более установленного числа критических retrieval failures;
- пользователи понимают разницу между исходным текстом и cloud synthesis;
- offline сценарий используется без инструкции.

---

## 23.13. Версия 1.0.0 — Personal Stable Release

### Обязательные функции

- локальная установка;
- core content pack;
- минимум один specialty pack;
- FTS5;
- hybrid semantic search на поддерживаемых устройствах;
- lexical fallback;
- свободное поле ввода;
- suggestions;
- точный переход к section/chunk;
- document context;
- bookmarks/history;
- опциональный BYOK cloud chat;
- content pack update/rollback;
- Android и iOS;
- статический лендинг;
- GitHub release;
- документация;
- benchmark report.

### Необязательные для 1.0

- полноценная локальная генерация;
- книги;
- фото;
- patient database;
- custom hospital protocols;
- Rust core;
- server sync.

### Release gate

1. Все CI checks зелёные.
2. Android/iOS smoke зелёные.
3. No P0/P1 bugs.
4. Corpus checksum зафиксирован.
5. Search benchmark соответствует threshold.
6. Offline mode проверен.
7. Cloud disabled mode проверен.
8. API keys не попадают в logs.
9. Migration с предыдущей beta проверена.
10. Landing и docs соответствуют поведению приложения.

---

# 24. После 1.0

## 1.1 — Книги как отдельные content packs

- import pipeline для книг;
- OCR-aware extraction;
- библиографические metadata;
- поиск по томам/главам;
- пользовательский локальный импорт.

## 1.2 — Пользовательские модули

- draft database;
- personal notes;
- local aliases;
- local protocol overlays;
- export/import pack;
- separate trust layer.

## 1.3 — Knowledge enrichment

- entities;
- relations;
- drug/substance mapping;
- condition–investigation links;
- materialized topic cards;
- provenance-backed claims.

## 1.4 — Локальные случаи

- обезличенные local cases;
- structured timeline;
- local encryption;
- explicit export/delete.

## 2.0 — Optional backend

Только при доказанной необходимости:

- accounts;
- sync;
- team packs;
- centralized updates;
- Postgres;
- pgvector;
- server inference;
- organization deployment.

---

# 25. План возможного переноса ядра на Rust

## 25.1. Не начинать до триггера

Триггеры:

- профилирование показало узкое место в TS;
- нужен общий CLI/mobile/server binary;
- нужен собственный HNSW/SIMD search;
- размер corpus превышает текущий adapter;
- бизнес-логика стабилизирована.

## 25.2. Сохраняемые контракты

UI продолжает использовать:

```ts
interface MedicalCore
```

Новая реализация:

```text
MedicalCoreTs
MedicalCoreRust
MedicalCoreRemote
```

## 25.3. Возможное разделение crates

```text
crates/
├── localmed-domain
├── localmed-query
├── localmed-ranking
├── localmed-storage
├── localmed-storage-sqlite
├── localmed-ffi
└── localmed-wasm
```

## 25.4. FFI

- UniFFI для Kotlin/Swift;
- wasm-bindgen для web;
- C ABI только при необходимости;
- никакой передачи больших tensors через JS bridge;
- модель и vector index остаются по возможности в native process.

## 25.5. Миграционная стратегия

1. Golden tests фиксируют поведение TS.
2. Rust implementation проходит те же contract tests.
3. Feature flag переключает implementation.
4. Сравниваются результаты и latency.
5. TS implementation удаляется только после parity.

---

# 26. Критерии успешности проекта

## 26.1. Технические

- Полностью локальный основной search path.
- Детерминированная сборка content pack.
- Stable anchors.
- FTS5 на реальном Android/iOS.
- Semantic fallback.
- Отсутствие обязательного backend.
- Изолированные provider adapters.
- Воспроизводимый benchmark.
- Атомарные content updates.
- Нет secrets в repository/logs.

## 26.2. Поисковые

Для релиза 1.0 целевые значения утверждаются после baseline, но обязательно измеряются:

- Recall@5;
- MRR@10;
- nDCG@10;
- zero-result rate;
- p95 latency;
- top-5 usefulness by physician review.

## 26.3. Пользовательские

- Пользователь не обязан знать точное название КР.
- Пользователь не обязан заполнять анкету.
- Пользователь видит материал до обращения к LLM.
- Пользователь может работать без сети.
- Пользователь открывает нужный абзац, а не только PDF.
- Пользователь понимает, когда ответ сгенерирован облачной моделью.
- Пользователь может обойти LLM полностью.

## 26.4. Главный stop/go test

После версии 0.1.0 задать 20 реальных вопросов и сравнить:

1. обычный веб-поиск;
2. ручной поиск по каталогу КР;
3. LocalMed FTS5.

Если LocalMed не выигрывает по скорости или качеству, не добавлять LLM сразу. Сначала исправить corpus, chunking и ranking.

После версии 0.3.0 сравнить lexical и hybrid на одном benchmark. Если embeddings не дают измеримого улучшения, не усложнять production path.

---

# 27. Риски и способы снижения

| Риск | Снижение |
|---|---|
| Плохой PDF extraction | fixtures, overrides, inspector |
| FTS5 нет в мобильной сборке | spike 0.0.1, custom plugin fallback |
| Русская морфология ухудшает поиск | build-time normalization + benchmark |
| Embedding плохо понимает русский медицинский язык | candidate benchmark до выбора |
| Semantic model слишком тяжёлая | lexical fallback, smaller model, platform capability |
| Векторный индекс усложняет сборку | adapter + brute-force baseline |
| LLM теряет важную деталь | raw query всегда участвует |
| Cloud key раскрывается | secure storage, no logs, BYOK |
| Corpus update ломает anchors | stable IDs, migration tests |
| Новая версия КР смешивается со старой | document versions + status/penalty |
| Scope уходит в «всю медицину» | milestones и explicit non-goals |
| Rust замедляет MVP | profile-first ADR gate |
| UI зависит от concrete provider | contracts + composition root |
| Агент меняет generated DB напрямую | immutable build artifacts |
| Regression поиска незаметен | benchmark в CI/release gate |

---

# 28. Первоначальный backlog для GitHub

## Milestone 0.0.1

1. `chore(repo): initialize pnpm monorepo`
2. `feat(app): create SolidJS application shell`
3. `feat(native): initialize Capacitor 8 Android project`
4. `spike(storage): verify SQLite and FTS5 on Android`
5. `feat(core): add MedicalCore health contract`
6. `test(core): add Vitest skeleton`
7. `chore(tooling): configure Biome and TypeScript strict`
8. `chore(ci): add GitHub Actions CI`
9. `feat(landing): create Astro landing skeleton`
10. `docs: add architecture and agent instructions`
11. `chore(security): add secret scanning and env example`
12. `test(e2e): add Playwright app boot test`

## Milestone 0.0.2

1. domain schemas;
2. SQLite migrations;
3. repositories;
4. test content pack;
5. document viewer;
6. anchor routing;
7. contract tests;
8. integrity checker;
9. schema docs.

## Milestone 0.0.3

1. Python CLI;
2. PDF block extraction;
3. section detection;
4. chunking;
5. stable IDs;
6. overrides;
7. SQLite builder;
8. build report;
9. golden fixtures;
10. inspector.

## Milestone 0.1.0

1. FTS schema;
2. normalization;
3. aliases;
4. BM25 search;
5. snippets;
6. results UI;
7. exact anchor open;
8. search history;
9. benchmark;
10. Android offline release.

---

# 29. Команды проекта

Предлагаемый root `package.json`:

```json
{
  "scripts": {
    "dev": "pnpm --filter @localmed/app dev",
    "dev:landing": "pnpm --filter @localmed/landing dev",
    "build": "pnpm -r build",
    "format": "biome format --write .",
    "lint": "biome lint .",
    "check": "biome check .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:e2e": "playwright test",
    "db:migrate:test": "pnpm --filter @localmed/storage-sqlite test:migrations",
    "db:integrity:test": "pnpm --filter @localmed/storage-sqlite test:integrity",
    "benchmark:search": "pnpm --filter @localmed/benchmarks search",
    "android:sync": "pnpm --filter @localmed/app cap:sync:android",
    "android:open": "pnpm --filter @localmed/app cap:open:android",
    "landing:build": "pnpm --filter @localmed/landing build"
  }
}
```

Python:

```bash
cd tools/ingest
uv sync
uv run medbase --help
uv run pytest
```

---

# 30. Definition of Done

Задача считается завершённой, когда:

- acceptance criteria issue выполнены;
- code formatted;
- lint зелёный;
- typecheck зелёный;
- tests зелёные;
- build зелёный;
- public contract документирован;
- migration добавлена при schema change;
- benchmark обновлён при search change;
- нет секретов;
- нет реальных пользовательских медицинских данных в tests;
- нет новых TODO без issue;
- PR описывает ограничения;
- релевантный milestone обновлён.

---

# 31. Итоговое решение

Для первого MVP использовать:

```text
SolidJS + TypeScript + Vite
Capacitor 8
SQLite + FTS5
Python ingestion pipeline
Biome + tsc + Vitest + Playwright
Astro + GitHub Pages
GitHub Actions + Releases
```

Архитектура:

```text
UI
→ MedicalCore contract
→ TypeScript orchestration
→ SQLite / FTS5
→ позже local embedding adapter
→ опционально cloud chat adapter
```

Главный порядок реализации:

```text
сначала стабильный импорт
→ затем точный локальный FTS-поиск
→ затем удобный клинический input
→ затем embeddings
→ затем cloud RAG
→ затем локальная LLM
→ затем modules и масштабирование corpus
```

Ключевой принцип:

> Не начинать с «медицинского ChatGPT». Сначала построить быстрый локальный навигатор, который по свободному описанию приводит пользователя к правильному месту в клинических рекомендациях. Генерация подключается после доказанной релевантности retrieval.
