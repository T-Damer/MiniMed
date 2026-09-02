# Оценка Giga-Embeddings для MiniMed

Дата проверки: 25 августа 2026 года. Выводы ниже относятся к зафиксированным ревизиям моделей и к текущему контракту MiniMed; обучение и скачивание весов не выполнялись.

## Короткий вывод

| Задача | Подходит? | Что модель реально может дать |
| --- | --- | --- |
| Свободный запрос → JSON/tool call | **Нет** | Это двунаправленный encoder, возвращающий embedding-вектор, а не токены. `instruct` здесь означает инструкцию для вычисления embedding, а не генеративное следование инструкциям. |
| Распознавание симптомов и прочих фактов | **Частично, как вспомогательный слой** | Подбор похожих терминов, intent/specialty classification и entity linking по кандидатам. Модель сама не извлекает spans и не гарантирует отрицание, время, дозировку, возраст или валидную JSON-схему. |
| Семантический поиск / RAG | **Да, кандидат для POC** | Это прямое назначение линейки. Для MiniMed ценность должна быть доказана на его корпусе и устройствах; lexical fallback остается обязательным. |

Поэтому не стоит заменять этой линейкой текущий детерминированный разбор запроса. Для JSON нужен отдельный генеративный model/tool-calling контур с валидацией схемы либо расширение детерминированного parser; для retrieval обучение Giga-Embeddings сначала вообще не требуется.

## Проверенные характеристики

| Модель | Архитектура | Вектор | Рабочий лимит | Параметры / официальные BF16-веса | ruMTEB Mean(Task) |
| --- | --- | ---: | ---: | --- | ---: |
| 480M | `Qwen3BidirectionalModel`, non-causal | 1024 | 8192 токенов | 483.7M / 0.967 GB | 70.96 |
| 3B | `Qwen3BidirectionalModel`, non-causal | 2048 | 8192 токенов | 3.151B / 6.301 GB | 74.57 |
| 10B-A1.8B | `DeepseekV3BidirectionalModel`, MoE, 64 routed experts, 4 active + 1 shared | 1536 | 8192 токенов в поставляемом SentenceTransformers recipe | 10.476B total, около 1.8B active / 20.952 GB | 74.99 |

Архитектура, размеры hidden state и non-causal режим зафиксированы в официальных конфигах [480M](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-480M-0826/blob/2d0c1a92716eef0e5b6972df85b5883eb5b4f57a/config.json), [3B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-3B-0826/blob/ed7db5c91b900b39381b27b6e9c0a3d31137cd29/config.json) и [10B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/blob/1cb3ad3374dbf0eb9130546ca38b262de5f60287/config.json). У 10B внутренний RoPE-limit равен 262144, но поставляемый SentenceTransformers-конфиг ограничивает последовательность 8192, поэтому именно 8192 следует считать проверенным integration contract: [480M](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-480M-0826/blob/2d0c1a92716eef0e5b6972df85b5883eb5b4f57a/sentence_bert_config.json), [3B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-3B-0826/blob/ed7db5c91b900b39381b27b6e9c0a3d31137cd29/sentence_bert_config.json), [10B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/blob/1cb3ad3374dbf0eb9130546ca38b262de5f60287/sentence_bert_config.json).

Все три модели используют **mean pooling по non-padding tokens**, затем L2-нормализацию; `CLS` или last-token pooling нарушит контракт. Размеры векторов и `include_prompt: true` заданы в pooling-конфигах [480M](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-480M-0826/blob/2d0c1a92716eef0e5b6972df85b5883eb5b4f57a/1_Pooling/config.json), [3B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-3B-0826/blob/ed7db5c91b900b39381b27b6e9c0a3d31137cd29/1_Pooling/config.json) и [10B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/blob/1cb3ad3374dbf0eb9130546ca38b262de5f60287/1_Pooling/config.json). Официальный query prompt одинаков:

```text
Instruct: Given a query, retrieve relevant passages
Query: {text}
```

Документ кодируется без prompt; cosine — заявленная similarity function. Это записано в SentenceTransformers-конфигах [480M](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-480M-0826/blob/2d0c1a92716eef0e5b6972df85b5883eb5b4f57a/config_sentence_transformers.json), [3B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-3B-0826/blob/ed7db5c91b900b39381b27b6e9c0a3d31137cd29/config_sentence_transformers.json) и [10B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/blob/1cb3ad3374dbf0eb9130546ca38b262de5f60287/config_sentence_transformers.json).

Репозитории декларируют MIT в metadata model cards [480M](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-480M-0826/blob/2d0c1a92716eef0e5b6972df85b5883eb5b4f57a/README.md), [3B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-3B-0826/blob/ed7db5c91b900b39381b27b6e9c0a3d31137cd29/README.md), [10B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/blob/1cb3ad3374dbf0eb9130546ca38b262de5f60287/README.md). В официальных деревьях файлов доступны BF16 safetensors, но нет готовых ONNX, CoreML, GGUF или quantized mobile weights: [480M files](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-480M-0826/tree/2d0c1a92716eef0e5b6972df85b5883eb5b4f57a), [3B files](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-3B-0826/tree/ed7db5c91b900b39381b27b6e9c0a3d31137cd29), [10B files](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/tree/1cb3ad3374dbf0eb9130546ca38b262de5f60287).

## Проверка публичных заявлений

- **74.99 и первое место:** подтверждается по максимальному `Mean(Task)` в текущих данных [MTEB(rus, v1.1)](https://mteb-leaderboard-backend.hf.space/v1/benchmarks/MTEB%28rus%2C%20v1.1%29/scores). Интерфейс leaderboard при этом может показывать одинаковый Borda-rank 1 для 10B и 3B; 74.99 — именно лучший mean score, а не уникальный rank во всех вариантах сортировки. Карточка 3B указывает 74.57; прежнее значение 74.55 было округлением/старым срезом.
- **480M — лучшая модель до 500M:** подтверждается текущими строками того же [официального leaderboard](https://mteb-leaderboard.hf.space/benchmark/MTEB%28rus%2C%20v1.1%29); это меняющийся рейтинг, поэтому вывод датирован.
- **Код 62.37 → 76.93 (+14.56):** эти значения опубликованы в [официальной карточке 10B](https://huggingface.co/ai-sage/Giga-Embeddings-instruct-10B-A1.8B-0826/blob/1cb3ad3374dbf0eb9130546ca38b262de5f60287/README.md).
- **Скорость 1.6× / 2×:** в карточке 10B есть абсолютный throughput на H100, batch 16, через vLLM, но нет сопоставимого замера предыдущего Giga checkpoint; точные множители по доступным первичным материалам **не верифицируются** и ничего не говорят о CPU/mobile latency.
- **Nemotron, F2LLM, KALM; expert merging; distillation 480M:** карточки сообщают contrastive InfoNCE и `Paper soon`, но не раскрывают эти детали обучения. Официальные MTEB metadata также не содержат публичных training datasets/code. Считать эти детали подтвержденными пока нельзя.
- **Медицинское качество:** опубликованной medical-domain оценки нет. Официальный [описатель MTEB(rus, v1.1)](https://mteb-leaderboard-backend.hf.space/v1/benchmarks/MTEB%28rus%2C%20v1.1%29) перечисляет 23 общих task и домены без Medical/Healthcare; model cards отдельного медицинского набора не приводят. Это отсутствие доказательства, а не доказательство плохого качества.

## Runtime: что действительно готово

- **Transformers / SentenceTransformers:** официальный референс; нужен `trust_remote_code=True`, mean pooling и L2 normalization, либо готовый SentenceTransformers pipeline. Инструкции приведены в каждой model card.
- **vLLM:** карточки дают pooling-конфигурацию для Qwen3-моделей. Поддержка 10B вошла в upstream vLLM через [merged PR #52948](https://github.com/vllm-project/vllm/pull/52948). Это GPU/server runtime, не runtime для текущего browser/Capacitor приложения.
- **SGLang:** на дату проверки native-поддержка остается в открытых PR: [Qwen3 #35531](https://github.com/sgl-project/sglang/pull/35531) и [DeepSeek-V3 #35532](https://github.com/sgl-project/sglang/pull/35532). Карточки предлагают patch/nightly path; считать поддержку стабильным релизом пока нельзя.

## Соответствие текущему MiniMed

Текущий [`QueryEmbedder`](../packages/search-semantic/src/portable-hash.ts) возвращает L2-нормализованный signed-int8 vector и жестко связывает профиль с `id`, dimension, generator version и fingerprint. [`createMedicalCore`](../packages/core/src/create-medical-core.ts) сначала выполняет детерминированный clinical analysis, затем lexical retrieval и только при совместимом профиле добавляет semantic/hybrid; ошибки уже безопасно откатываются к lexical search. Это правильная граница интеграции.

Для корпуса из 92 320 chunks ([CURRENT_STATE.md](CURRENT_STATE.md)) одни int8-векторы без SQLite overhead займут ориентировочно: 480M — 94.5 MB, 3B — 189.1 MB, 10B — 141.8 MB. Но document vectors не решают runtime: модель все равно нужна на устройстве, чтобы кодировать каждый новый query.

Разбор симптомов, отрицаний и patient facts должен остаться у текущего parser. Embeddings можно добавить после него для:

- расширения запроса похожими нормализованными медицинскими терминами;
- intent/specialty classification по фиксированным labels;
- ранжирования кандидатов entity linking;
- retrieval chunks для последующей, отдельно контролируемой генерации.

## Рекомендация по моделям

- **GPU desktop / исследовательский локальный сервер:** начинать с **3B**. Она почти достигает 10B на ruMTEB (74.57 против 74.99), но BF16 weights примерно в 3.3 раза меньше. 10B прогнать один раз как quality ceiling только при уже доступной подходящей GPU; не делать ее default.
- **Offline mobile:** проверять только **480M**, и пока не включать в продукт. Даже ее официальные BF16 weights около 0.97 GB, а готового mobile runtime/кванта нет. Нужны отдельные conversion/parity, peak-RAM, latency, battery/thermal и physical-device gates. До этого сохранять portable hash + lexical fallback.
- **JSON/tool call:** усиливать детерминированный parser либо добавлять отдельный валидируемый генеративный контур. Не тренировать embedding-модель ради генерации JSON.

## Минимальный POC без обучения

1. Зафиксировать один из SHA выше, tokenizer и checksums. Начать с официального English retrieval prompt; один заранее объявленный Russian medical prompt можно сравнить только на dev split и затем заморозить до validation/hidden test. Documents кодировать без prompt.
2. Добавить отдельный neural `EmbeddingProfile`, не заменяя `localmed.feature-hash.384.v1`. Одинаково для builder и query применять mean pooling, L2 и детерминированную signed-int8 квантизацию; измерить отклонение top-k/cosine от BF16 reference. Fingerprint должен включать revision, tokenizer, prompt, pooling и quantization recipe.
3. Сделать существующие benchmark runners зависимыми от переданного `QueryEmbedder` вместо hard-coded `PortableHashEmbedder`. Сравнить `lexical`, текущий hash-hybrid, 480M-hybrid, 3B-hybrid и, при наличии GPU, 10B-hybrid.
4. Запустить существующие наборы: `pilot-rf` для точного document/section/anchor/source metadata, `curated-clinician`, весь `hard-medical-queries-1500` со срезами style/intent/specialty/answerability; `hidden_test` не использовать для выбора prompt/model. Затем повторить на требуемых [SEMANTIC_RETRIEVAL.md](SEMANTIC_RETRIEVAL.md) 200–300 clinician-authored real-corpus queries.
5. Для query understanding отдельно измерить intent/specialty macro-F1 и `required_entities` Recall@K/forbidden false-positive rate через nearest-label/entity candidates. Не выдавать это за span extraction: negation, temporality и числовые patient facts продолжает проверять детерминированный analyzer.
6. Применить release gates из [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md): Recall@5 ≥ 0.90, MRR@5 ≥ 0.65, section recall ≥ 0.90, exact context/source metadata = 1, zero-result rate ≤ 0.10; neural профиль принимается только при значимом выигрыше над lexical baseline без ухудшения forbidden rate. Параллельно измерить cold load, p50/p95 query latency, peak RAM, model/pack storage и battery/thermal на целевом устройстве.

## Блокеры до продуктовой интеграции

- нет опубликованного medical-domain benchmark и прозрачности по overlap обучающих данных;
- нет официального mobile runtime и готовых квантизованных artifacts;
- текущий TypeScript/browser stack не запускает Transformers, vLLM или SGLang без нового adapter/runtime;
- `trust_remote_code` требует vendoring/audit зафиксированного кода и checksum policy для offline release;
- H100 throughput нельзя переносить на desktop CPU или телефон;
- выбор prompt — часть модели поиска: его нельзя менять без перестроения профиля/benchmark evidence;
- полноценный результат зависит прежде всего от качества локального corpus и physician-authored retrieval fixtures, а не от ruMTEB alone.

Итоговое решение: **взять 3B и 480M в короткий retrieval-only POC; 10B использовать как необязательный ceiling; не связывать эту работу с JSON/tool calling и не начинать fine-tuning до доказанного retrieval gain.**
