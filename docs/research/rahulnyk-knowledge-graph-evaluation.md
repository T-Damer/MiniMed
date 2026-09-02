# Оценка `rahulnyk/knowledge_graph` для MiniMed

Дата проверки: 1 сентября 2026 г.  
Проверенная ветка: `main`  
Проверенный commit: [`3447d58fcabc2ddf8cde21f01314db2c276adae9`](https://github.com/rahulnyk/knowledge_graph/commit/3447d58fcabc2ddf8cde21f01314db2c276adae9)

## Вывод

**Не интегрировать и не импортировать код или результаты графа в MiniMed.** Это небольшой
Jupyter-прототип для визуального исследования произвольного текста, а не evidence graph, поисковый
движок или воспроизводимый медицинский ETL. Он не добавляет источников, русской терминологии или
контрактов, которых нет в MiniMed, и слабее уже принятой схемы `source → assertion → review →
search projection`.

Максимум — держать репозиторий как необязательный референс идеи batch-прохода
`chunks → proposed relations → graph preview`. Отдельный spike сейчас не нужен.

## Что это за инструмент

- README описывает цепочку `text/PDF → chunks → LLM concepts/relations → graph`; соседство понятий
  в одном chunk автоматически считается связью, после чего пары агрегируются
  ([README, строки 30–53](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/README.md#L30-L53)).
- Notebook загружает документы через LangChain и режет их на фрагменты по 1500 символов с overlap
  150
  ([extract_graph.ipynb, строки 68–85](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L68-L85)).
- LLM через локальный Ollama возвращает свободные JSON-пары `node_1`, `node_2`, `edge`; prompt не
  задаёт медицинскую онтологию, тип отношения, применимость или evidence schema
  ([prompts.py, строки 42–69](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/helpers/prompts.py#L42-L69),
  [Ollama client, строки 5–25](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/ollama/client.py#L5-L25)).
- Явным LLM-рёбрам назначается вес `4`; co-occurrence строится self-join по `chunk_id`, получает
  подпись `contextual proximity`, а совпавшие пары суммируются
  ([extract_graph.ipynb, строки 348–368](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L348-L368),
  [строки 486–513](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L486-L513),
  [строки 712–718](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L712-L718)).
- Результат — `chunks.csv`, `graph.csv`, in-memory NetworkX и PyVis HTML, а не SQLite pack или API.
  PyVis задан с `cdn_resources="remote"`, поэтому визуализация не является самодостаточно offline
  ([CSV-запись, строки 348–361](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L348-L361),
  [NetworkX, строки 745–771](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L745-L771),
  [PyVis, строки 993–1014](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/extract_graph.ipynb#L993-L1014)).
- Стек — Python 3.11, старый LangChain `0.0.335`, pandas/NumPy, PyPDF/unstructured, NetworkX,
  PyVis, Seaborn и JupyterLab
  ([pyproject.toml, строки 8–21](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/pyproject.toml#L8-L21)).
  Docker запускает JupyterLab на `0.0.0.0:8888`
  ([Dockerfile, строки 26–27](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/Dockerfile#L26-L27)).

## Лицензия и состояние

- Код объявлен MIT
  ([LICENSE, строки 1–20](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/LICENSE#L1-L20)).
  Это не предоставляет автоматически права на вложенные документы, результаты их обработки или
  веса модели; per-source rights manifest в дереве проверенного commit отсутствует.
- В доступной git-истории 32 commit. HEAD от 15 августа 2026 г. — merge переименования
  `dockerfile → Dockerfile`; последние изменения `extract_graph.ipynb`, `prompts.py` и
  `df_helpers.py` относятся к ноябрю 2023 г.
  ([история до проверенного SHA](https://github.com/rahulnyk/knowledge_graph/commits/3447d58fcabc2ddf8cde21f01314db2c276adae9/),
  [изменение Dockerfile](https://github.com/rahulnyk/knowledge_graph/commit/6dc8f0a46aa0de6b5642ab7182663dd2aeb49696)).
- В проверенном дереве нет тестов, CI, версионированной схемы, benchmark или source-rights
  validation. Сам README оставляет deduplication, удаление шумных понятий и корректную настройку
  proximity weights как нерешённые задачи
  ([README, строки 111–122](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/README.md#L111-L122)).

## Несовместимость с MiniMed

| Требование MiniMed | Поведение upstream | Риск |
|---|---|---|
| Стабильные document/section/chunk/anchor IDs | Новый `uuid4` для каждого chunk при каждом проходе ([df_helpers.py, строки 8–19](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/helpers/df_helpers.py#L8-L19)) | Ссылки и диффы ломаются при rebuild |
| Версия, checksum, права и точный source span | `chunks.csv` хранит только `text`, путь `source`, случайный `chunk_id`; `graph.csv` — пару, свободный edge и chunk ID ([chunks.csv, строки 1–5](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/data_output/cureus/chunks.csv#L1-L5), [graph.csv, строки 1–8](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/data_output/cureus/graph.csv#L1-L8)) | Нельзя доказать версию и точное основание клинической связи |
| Typed assertion, authority, applicability, status и human review | LLM выдаёт свободный текст; код лишь удаляет пустые поля и приводит имена к lowercase ([df_helpers.py, строки 50–71](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/helpers/df_helpers.py#L50-L71)) | Упоминание может выглядеть как показание или рекомендация |
| Ошибки извлечения сохраняются как diagnostics | `bare except` печатает сырой ответ, возвращает `None`, затем строка отбрасывается ([prompts.py, строки 65–73](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/helpers/prompts.py#L65-L73), [df_helpers.py, строки 50–60](https://github.com/rahulnyk/knowledge_graph/blob/3447d58fcabc2ddf8cde21f01314db2c276adae9/helpers/df_helpers.py#L50-L60)) | Тихая неполнота; сырой клинический текст может попасть в notebook/log |
| Клинически безопасная связь | Любая совместная встречаемость в chunk создаёт ребро | Ложные связи из отрицаний, сравнений, разных популяций и соседних рекомендаций |
| Runtime без сети и LLM | Новый граф требует Ollama/model; HTML использует remote CDN | Не может быть release dependency или offline fallback |

## Что можно заимствовать

Только общие идеи промежуточного ETL: хранить `chunk_id` рядом с предложенной связью, не смешивать
явные LLM-рёбра с proximity-рёбрами до review и строить отдельный graph-preview для ручного аудита.
Код переносить нецелесообразно: MiniMed уже реализует более строгие proposed/reviewed records, exact
evidence links, source authority и SQLite projections.

## Условие повторной оценки

Возвращаться к этому подходу только для конкретного clinician-reviewed сценария навигации по
понятиям и сравнивать с текущим SQLite/FTS baseline. Минимальные gates: неизменные IDs при повторной
сборке; `100%` связей разрешаются в точный document version/checksum/anchor; `0` неподтверждённых
клинических связей, ошибок отрицания и применимости; Recall@5 не ниже `0.90`, MRR@5 не ниже `0.65`,
section recall не ниже `0.90`; измеримое улучшение хотя бы одной заранее выбранной метрики без
ухудшения остальных и без runtime-зависимости от LLM. До такого сценария — YAGNI.
