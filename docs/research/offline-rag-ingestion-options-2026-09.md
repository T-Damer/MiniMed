# Локальное извлечение документов для offline RAG MiniMed

Дата проверки: 4 сентября 2026 года. Внешние факты ниже взяты только из официальной
документации, официальных репозиториев и model cards. Это исследование build-time ingestion, а не
предложение заменить существующий runtime-поиск.

## Архитектурные ограничения MiniMed

Текущий контракт уже задан в [техническом плане](../TECHNICAL_PLAN.md),
[ADR 0007](../adr/0007-private-source-preparation.md),
[ADR 0002](../adr/0002-sqlite-source-of-truth.md) и
[ADR 0003](../adr/0003-generated-content-packs.md):

```text
raw/private sources
  -> deterministic preparer
  -> extraction JSON + provenance-preserving Markdown
  -> validator
  -> pack builder
  -> read-only SQLite
```

Приложение должно оставаться полезным без сети и LLM. UI зависит от `MedicalCore`, а не от
парсера, Python-сервиса или vector database. SQLite/FTS5, aliases, детерминированные int8
feature-hash embeddings, hybrid fusion и локальный `llama.cpp` уже решают runtime retrieval;
исследуемые инструменты могут улучшить только предварительное извлечение исходников. Docker,
backend и новый Rust runtime не входят в допустимый путь без отдельного ADR.

## Минимальная рекомендация

**Провести один короткий spike с Docling как pinned внешним build-time extractor-адаптером.**
Авторитетным промежуточным артефактом должен быть нормализованный MiniMed extraction JSON с raw
SHA-256, page number, bbox, char span, block type и diagnostics; Markdown должен детерминированно
строиться из него. Существующий быстрый PyMuPDF-путь для качественных text-layer PDF оставить:
Docling включать только для OCR, таблиц и layout-случаев, где он измеримо выигрывает.

Не добавлять LangChain, LlamaIndex, RAGFlow или LightRAG. Они не закрывают отсутствующую границу
извлечения и дублируют уже работающий retrieval/runtime MiniMed.

## Сравнение специализированных extractors

### Сводка фактов из первичных источников

| Критерий | Docling | Unstructured OSS | Marker | MinerU |
|---|---|---|---|---|
| Локально после подготовки | Да; модели можно заранее скачать и передать через `artifacts_path`, remote services требуют явного opt-in | Да; `partition(...)` и local inference работают без hosted API | Да; GPU/CPU/MPS, но Surya поднимает локальный inference server | Да; после `mineru-models-download` можно выбрать `MINERU_MODEL_SOURCE=local`; есть CPU pipeline |
| Входы | PDF, изображения, Office/OpenDocument, HTML, Markdown, EPUB, XML и другие | PDF, изображения, Office/OpenDocument, HTML/XML/Markdown, email и другие | PDF/images; extra `full` добавляет DOCX/PPTX/XLSX/HTML/EPUB | PDF, images, DOCX, PPTX, XLSX |
| Выходы | Lossless Docling JSON, Markdown, HTML, text, DocTags/DocLang, JSONL chunks | `Element` records с text/type/metadata; JSON/NDJSON/CSV/text | Markdown, JSON tree, HTML, chunks, images | Markdown, `content_list*.json`, `middle.json`, `model.json`, images и debug PDF |
| Page/bbox provenance | `page_no`, `bbox`, `charspan` в provenance item; geometry — когда она доступна исходному backend | `page_number` и `coordinates` доступны по типу/strategy; последующий chunking может потерять часть координат | JSON организован по страницам, blocks имеют `polygon`; VLM OCR даёт block-level, не character-level geometry | `page_idx` + block bbox; `middle.json` сохраняет paragraph/line/span geometry; форматы pipeline и VLM различаются |
| Таблицы | TableFormer: структура строк, столбцов, ячеек и spans; lossless JSON сохраняет модель таблицы | Для PDF/image table extraction нужен `hi_res`; `Table` содержит HTML, но multi-column ordering — документированное ограничение | Таблицы в Markdown/HTML/JSON; cross-page/сложные таблицы улучшаются optional LLM, nested tables/forms ограничены | Table body/caption/footnote, HTML/Markdown и bbox; есть cross-page merge, но structured outputs backend-specific |
| Русский | EasyOCR cyrillic model включает `ru`; есть RapidOCR/Tesseract и другие OCR backends | Tesseract language pack задаётся через `languages`/`ocr_languages`; русский — отдельный `rus` pack | Surya заявляет 90+ языков и публикует собственный результат для `ru`; это не медицинская квалификация | Заявлены 109 OCR-языков; changelog отдельно включает русский PP-OCRv5 |
| Код / веса | Код MIT; основные layout/table weights имеют Apache-2.0 или CDLA-Permissive-2.0, OCR weights нужно проверять отдельно | Код `unstructured`/inference Apache-2.0; выбранные detection/OCR weights имеют собственные лицензии | Код Apache-2.0; weights под modified OpenRAIL-M, бесплатны лишь для research/personal и организаций ниже порога $5M funding/revenue | Custom MinerU license на базе Apache-2.0: отдельная лицензия нужна выше 100M MAU или $20M monthly revenue; online service требует attribution; веса проверяются отдельно |
| Системная поверхность | Python 3.10+, PyTorch; обычная установка кроссплатформенная; legacy Office требует LibreOffice, отдельные OCR backends — свои binaries/weights | Для полного PDF/OCR пути нужны `libmagic`, Poppler, Tesseract/lang packs; Office — LibreOffice; часть форматов — Pandoc | Python 3.10+, PyTorch и локальный Surya server; NVIDIA route требует Docker + NVIDIA toolkit, CPU/Apple — `llama-server` | Python 3.10–3.13; CPU pipeline, рекомендуются 16–32 GB RAM и 20+ GB disk; VLM/GPU/Docker — отдельная тяжёлая поверхность |
| Интеграционная сложность для MiniMed | **Средняя и локализованная:** Python adapter + pinned models + JSON normalization | **Средняя/высокая:** много native binaries и неполная однородность provenance между strategies | **Высокая:** отдельный inference server и ограничительная лицензия weights | **Высокая:** большой footprint, несколько несовместимых backend outputs и custom license |

### Docling

#### Факты из первичных источников

- Docling прямо заявляет local execution для sensitive/air-gapped данных. По умолчанию модели
  скачиваются при первом использовании, но официально поддержаны prefetch и локальный
  `artifacts_path`; отправка данных remote service запрещена без явного
  `enable_remote_services=True` ([offline usage](https://docling-project.github.io/docling/usage/advanced_options/#model-prefetching-and-offline-usage),
  [remote-service guard](https://docling-project.github.io/docling/usage/advanced_options/#using-remote-services)).
- Поддержаны PDF, изображения, современные и legacy Office, OpenDocument, HTML, Markdown, EPUB и
  другие форматы; legacy Office требует LibreOffice. Выходы включают lossless JSON, Markdown, HTML,
  text, DocTags/DocLang и JSONL chunks ([formats](https://docling-project.github.io/docling/usage/supported_formats/)).
- `DoclingDocument` хранит текст, таблицы, pictures, hierarchy, layout bbox и provenance; в
  provenance item доступны `page_no`, `bbox` и `charspan`, если backend располагает геометрией
  ([document model](https://docling-project.github.io/docling/concepts/docling_document/),
  [schema source](https://github.com/docling-project/docling-core/blob/main/docling_core/types/doc/base.py)).
- TableFormer распознаёт ячейки и структуру таблиц; сериализатор сохраняет row/column spans
  ([model catalog](https://docling-project.github.io/docling/usage/model_catalog/),
  [serialization](https://docling-project.github.io/docling/concepts/serialization/#table-cell-spans)).
- EasyOCR cyrillic checkpoint включает `ru`; доступные backends также включают Tesseract, RapidOCR,
  SuryaOCR и platform OCR ([OCR languages](https://docling-project.github.io/docling/concepts/OCR/#easyocr)).
- Код — MIT; лицензии моделей отдельны. Официальные default model cards указывают
  CDLA-Permissive-2.0/Apache-2.0 для `docling-models` и Apache-2.0 для layout Heron
  ([code](https://github.com/docling-project/docling/blob/1c2b794b00f45c16c33479f2b0e04cfceed19d94/LICENSE),
  [default models](https://huggingface.co/docling-project/docling-models),
  [Heron](https://huggingface.co/docling-project/docling-layout-heron)).

#### Вывод для MiniMed

Это единственный кандидат с достаточно полным typed document model и удобным lossless JSON, который
можно отобразить в уже существующий provenance contract без нового сервиса. Риск остаётся: ML
extraction сам по себе не гарантирует byte-for-byte determinism, поэтому версия кода, weights,
backend, OCR languages и normalization должны быть зафиксированы, а стабильность — проверена spike.

### Unstructured OSS

#### Факты из первичных источников

- OSS library локально разбивает документы на typed `Element` records. Hosted API — отдельный путь;
  local ingestion использует `partition_by_api=False`
  ([partitioning](https://docs.unstructured.io/open-source/core-functionality/partitioning),
  [configuration](https://docs.unstructured.io/open-source/ingestion/ingest-configuration/partition-configuration)).
- `Element.metadata` может содержать page number, bbox coordinates, hierarchy и table HTML, когда
  partitioner это поддерживает. Документация предупреждает, что chunking может потерять page/coordinate
  metadata, если несколько исходных элементов объединены
  ([metadata](https://docs.unstructured.io/open-source/concepts/document-elements),
  [chunking](https://docs.unstructured.io/open-source/core-functionality/chunking)).
- PDF strategies — `fast`, `hi_res`, `ocr_only`, `auto`. Table extraction для PDF/images требует
  `hi_res`; OCR использует Tesseract и настраиваемые language packs
  ([strategies](https://docs.unstructured.io/open-source/concepts/partitioning-strategies)).
- Полная локальная установка требует `libmagic`, Poppler, Tesseract и language packs; Office требует
  LibreOffice, некоторые конвертеры — Pandoc
  ([official README](https://github.com/Unstructured-IO/unstructured/blob/d68ab0fda9bcac317b7c033d42412d716ba1d790/README.md),
  [full installation](https://docs.unstructured.io/open-source/installation/full-installation)).
- Код `unstructured` и `unstructured-inference` — Apache-2.0; лицензии конкретных скачиваемых
  weights/backend dependencies нужно проверять отдельно
  ([library license](https://github.com/Unstructured-IO/unstructured/blob/d68ab0fda9bcac317b7c033d42412d716ba1d790/LICENSE.md),
  [inference repository](https://github.com/Unstructured-IO/unstructured-inference)).

#### Вывод для MiniMed

Подходит как comparator, но не как первый adapter: полный PDF/table/OCR path приносит больше
системных зависимостей, а однородный provenance зависит от file type и strategy. Его собственный
chunker не нужен — chunk IDs и source spans уже принадлежат MiniMed.

### Marker

#### Факты из первичных источников

- Marker конвертирует PDF/images, а extra `full` добавляет Office/HTML/EPUB; выдаёт Markdown, JSON,
  HTML и chunks. JSON — page/block tree с polygons
  ([pinned README](https://github.com/datalab-to/marker/blob/36b3947d05b16787937fc77db47422c9a6bc0e29/README.md)).
- Он работает на GPU, CPU и MPS, но текущий Surya VLM запускает локальный server: NVIDIA route требует
  Docker и NVIDIA Container Toolkit, CPU/Apple Silicon — `llama-server` из `llama.cpp`
  ([inference prerequisites](https://github.com/datalab-to/marker/blob/36b3947d05b16787937fc77db47422c9a6bc0e29/README.md#inference-backend-prerequisites)).
- OCR multilingual. Surya публикует внутренний multilingual benchmark для 91 языка, включая
  `ru=88.8%`; это не независимый тест и не benchmark русских медицинских документов
  ([Surya languages](https://github.com/datalab-to/surya/blob/master/static/docs/multilingual.md)).
- Tables выводятся как HTML/Markdown; для сложных cross-page tables и forms README предлагает
  optional LLM hybrid mode. JSON сохраняет block polygons, но VLM OCR не обещает character boxes
  ([tables and OCR](https://github.com/datalab-to/marker/blob/36b3947d05b16787937fc77db47422c9a6bc0e29/README.md#extract-tables),
  [output](https://github.com/datalab-to/marker/blob/36b3947d05b16787937fc77db47422c9a6bc0e29/README.md#output-formats)).
- Код Apache-2.0, но weights используют modified AI Pubs OpenRAIL-M: бесплатны для
  research/personal и компаний с funding/revenue ниже $5M; более широкое commercial use требует
  отдельной лицензии
  ([license summary](https://github.com/datalab-to/marker/blob/36b3947d05b16787937fc77db47422c9a6bc0e29/README.md#commercial-usage),
  [model license](https://github.com/datalab-to/marker/blob/36b3947d05b16787937fc77db47422c9a6bc0e29/MODEL_LICENSE)).

#### Вывод для MiniMed

Хороший quality comparator, но плохой default: отдельный inference-server усложняет build, Docker
route запрещён текущей архитектурой, optional LLM не должен участвовать в source preparation, а
лицензия weights создаёт лишний product risk.

### MinerU

#### Факты из первичных источников

- CLI принимает local PDF/images/DOCX/PPTX/XLSX. Pipeline может работать на CPU; официальный
  baseline — Python 3.10–3.13, минимум 16 GB RAM и 20+ GB disk для полного пути
  ([quick start](https://opendatalab.github.io/MinerU/quick_start/)).
- Модели можно заранее скачать, перенести и использовать с `MINERU_MODEL_SOURCE=local`
  ([model source](https://opendatalab.github.io/MinerU/usage/model_source/)).
- Помимо Markdown, выдаются `content_list.json`, новый `content_list_v2.json`, `middle.json`,
  `model.json`, images и visual diagnostics. Block records содержат `page_idx` и bbox;
  `middle.json` хранит nested line/span geometry. Документация прямо отмечает backend-specific и
  несовместимые structured-output изменения
  ([output files](https://opendatalab.github.io/MinerU/reference/output_files/)).
- MinerU извлекает tables/captions/footnotes и заявляет OCR 109 языков; changelog включает русский в
  PP-OCRv5 multilingual recognition
  ([features](https://opendatalab.github.io/MinerU/),
  [changelog](https://opendatalab.github.io/MinerU/reference/changelog/)).
- С 2026 года это не AGPL, а собственная MinerU Open Source License на базе Apache-2.0. Commercial
  use требует отдельной лицензии выше 100M MAU или $20M monthly revenue; online services должны
  атрибутировать MinerU. Лицензии скачиваемых weights не следуют автоматически из лицензии repo
  ([pinned license](https://github.com/opendatalab/MinerU/blob/4fe4bde114a23ee5dd637eae99b767f4669bf58c/LICENSE.md)).

#### Вывод для MiniMed

Сильный второй comparator для трудных scans/tables, но не минимальный dependency. Большой footprint,
несколько backend schemas и custom license ухудшают reproducibility и сопровождение. Docker/API/VLM
варианты не нужны; если Docling провалит spike, сравнивать только CPU pipeline + `middle.json`.

## Почему RAG frameworks не заменяют extraction

### LangChain

#### Факты из первичных источников

LangChain описывает retrieval как сборку из document loaders, text splitters, embeddings, vector
stores и retrievers. Loaders дают общий `Document` interface, но конкретное извлечение делегируют
PyPDF, Unstructured, Docling, cloud APIs и другим integrations
([retrieval](https://docs.langchain.com/oss/python/langchain/retrieval),
[loaders](https://docs.langchain.com/oss/python/integrations/document_loaders/index)). Код core — MIT
([license](https://github.com/langchain-ai/langchain/blob/79cab2dc7f58be720cac43db3677b4c1fd971f91/LICENSE)).

#### Вывод для MiniMed

Это orchestration layer, не extraction authority. Он добавляет второй chunking/indexing contract
поверх FTS5/hybrid retrieval и не даёт единого page/bbox/table provenance.

### LlamaIndex

#### Факты из первичных источников

LlamaIndex OSS — framework для agentic/LLM applications с readers, Nodes, transformations, indices
и vector stores. Собственный high-end OCR/parser вынесен в LlamaParse platform и требует account/API
key; integrations поставляются отдельно от core
([official README](https://github.com/run-llama/llama_index/blob/d2ac544a27c73d2a68e9c57efec4b2ac0ef99892/README.md),
[ingestion pipeline](https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/)).
Core — MIT ([license](https://github.com/run-llama/llama_index/blob/d2ac544a27c73d2a68e9c57efec4b2ac0ef99892/LICENSE)).

#### Вывод для MiniMed

OSS pipeline управляет nodes/indexing, но не устанавливает единый provenance-rich extraction
contract; LlamaParse cloud нарушает offline invariant. Существующие IDs, aliases, SQLite и fusion
делают framework избыточным.

### RAGFlow

#### Факты из первичных источников

RAGFlow включает document understanding, OCR, layout/table analysis и собственный RAG engine, но
официальный deployment собирает server и зависимости через Docker Compose. Base stack включает
Elasticsearch/Infinity, MySQL, MinIO и Redis
([official repository](https://github.com/infiniflow/ragflow/tree/2f13f103a0a4786508f1d1512373d4913c30df89),
[Docker stack](https://github.com/infiniflow/ragflow/blob/2f13f103a0a4786508f1d1512373d4913c30df89/docker/README.md)).
Код — Apache-2.0 ([license](https://github.com/infiniflow/ragflow/blob/2f13f103a0a4786508f1d1512373d4913c30df89/LICENSE)).

#### Вывод для MiniMed

Deep document parsing не компенсирует архитектурную цену: это mutable server/RAG platform с Docker
и собственной storage/chunking model. Он напрямую противоречит no-backend/no-Docker границе и не
должен писать или обслуживать MiniMed packs.

### LightRAG

#### Факты из первичных источников

LightRAG — graph-based RAG framework с LLM, embeddings и graph/vector storage. Его MinerU и Docling
parsers являются внешними HTTP services; официальная инструкция self-hosting использует upstream
Docker/model stacks. Даже offline parser debug вызывает external service при cache miss
([official README](https://github.com/HKUDS/LightRAG/blob/12ae7e36f1da3ee451eb4f0e47f128daf6719f0d/README.md),
[parser deployment](https://github.com/HKUDS/LightRAG/blob/12ae7e36f1da3ee451eb4f0e47f128daf6719f0d/docs/ParserServiceDeployment.md),
[debug CLI](https://github.com/HKUDS/LightRAG/blob/12ae7e36f1da3ee451eb4f0e47f128daf6719f0d/docs/ParserDebugCLI.md)).
Код — MIT ([license](https://github.com/HKUDS/LightRAG/blob/12ae7e36f1da3ee451eb4f0e47f128daf6719f0d/LICENSE)).

#### Вывод для MiniMed

Он делегирует нужную функцию тем же extractors и добавляет LLM/KG/vector/backend state. Значит,
LightRAG не сокращает интеграцию и нарушает retrieval-before-generation/offline runtime contract.

## Измеримый spike на 10–20 реальных документах

### Набор

Взять **16 owner-provided русскоязычных документов**, не коммитя raw files:

- 6 born-digital PDF с одним и несколькими столбцами;
- 4 scanned/mixed PDF с кириллицей, штампами и низким качеством;
- 4 table-heavy PDF с merged cells, multi-page tables и медицинскими числами;
- 2 DOCX/PPTX с headings, списками, таблицами и изображениями.

Для каждого сохранить raw SHA-256, тип, число страниц, ожидаемые сложные места и права. Вручную
разметить не весь документ, а фиксированный gold slice: не менее 200 текстовых строк, 30 таблиц,
100 headings/reading-order переходов и 200 source anchors суммарно.

### Один проверяемый вариант

Сравнить текущий PyMuPDF preparer с одной pinned конфигурацией Docling. Для OCR использовать один
явно выбранный Russian-capable backend; remote services, VLM enrichment, LLM и network access во
время прогона запретить. Зафиксировать commit/package version, hashes всех weights, Python/OS/CPU,
pipeline options и normalization version.

### Gate «принимать Docling adapter»

1. **Полнота:** 100% документов обработаны; 100% страниц представлены; 0 необъяснённых пропусков
   text/table blocks.
2. **Provenance:** 100% принятых text/table blocks имеют page number; не менее 99.5% имеют валидный
   bbox внутри page bounds; не менее 199 из 200 проверенных anchors открывают правильную область.
3. **Русский текст:** на gold slice CER не выше 0.5% для born-digital и 3% для scans; exact accuracy
   чисел, единиц, знаков `<`, `>`, `±`, десятичных разделителей и диапазонов — не ниже 99.5%.
4. **Структура:** heading/reading-order accuracy не ниже 95%; ни одна неверная перестановка не должна
   менять смысл предупреждения, противопоказания или условия применимости.
5. **Таблицы:** обнаружены все 30 gold tables; не менее 95% header/data cells стоят в правильной
   строке и колонке; exact numeric-cell accuracy не ниже 99.5%; merged/cross-page failures явно
   попадают в diagnostics, а не молча превращаются в prose.
6. **Воспроизводимость:** три offline cold runs на одинаковом окружении дают byte-identical
   normalized extraction JSON и derived Markdown; raw/model/config hashes входят в manifest.
7. **Регрессия:** на born-digital subset Docling не ухудшает ни один clinical/numeric gate относительно
   текущего PyMuPDF path. Иначе PyMuPDF остаётся default, Docling применяется только по diagnostics.
8. **Стоимость:** записать wall time, peak RAM и размер model cache. Предел для spike — не более 2x
   времени текущего полного private prepare на born-digital subset и не более 8 GB peak RAM на
   целевой CPU-машине; превышение допускается только для явно маршрутизированных OCR/table cases.
9. **Изоляция:** после prefetch прогон проходит с заблокированной сетью; extractor не пишет SQLite,
   не меняет raw sources и не попадает в browser/mobile runtime dependency graph.

Если любой safety/provenance/numeric gate не выполнен, не добавлять новый default path. Сохранить
Docling только как диагностический comparator либо перейти к одному ограниченному MinerU CPU
comparison на тех же 16 документах.

## Снимок источников и открытые вопросы

Для изменяемых репозиториев сравнение привязано к HEAD на дату проверки: Docling
`1c2b794b00f45c16c33479f2b0e04cfceed19d94`, Unstructured
`d68ab0fda9bcac317b7c033d42412d716ba1d790`, Marker
`36b3947d05b16787937fc77db47422c9a6bc0e29`, MinerU
`4fe4bde114a23ee5dd637eae99b767f4669bf58c`, LangChain
`79cab2dc7f58be720cac43db3677b4c1fd971f91`, LlamaIndex
`d2ac544a27c73d2a68e9c57efec4b2ac0ef99892`, RAGFlow
`2f13f103a0a4786508f1d1512373d4913c30df89`, LightRAG
`12ae7e36f1da3ee451eb4f0e47f128daf6719f0d`.

До внедрения остаются три проверки:

- юридически зафиксировать лицензии и redistribution conditions **всех** выбранных OCR/layout/table
  weights, а не только лицензии repo;
- измерить русский медицинский текст и таблицы на реальном private corpus: vendor benchmarks этого не
  доказывают;
- решить, какие diagnostics автоматически маршрутизируют документ из PyMuPDF fast path в Docling,
  только после получения spike data — не добавлять эвристику заранее.
