# Бесплатные/open-source аналоги Firecrawl для MiniMed

Дата проверки: 3 сентября 2026 года. Только первичные источники: официальные репозитории, документация, LICENSE/релизы и changelog. Цель — локально собрать справочник `krasotaimedicina.ru` в Python 3.12 ingest, затем передать подготовленный Markdown/провенанс в существующий offline pack pipeline MiniMed. Платный API и hosted crawler не рассматриваются.

## Короткий вывод

Рекомендация: **Crawlee for Python + PlaywrightCrawler как основной сборщик**, с `RequestQueue`/persistent storage, ограничением домена, задержкой и явным сохранением raw HTML/response metadata. Markdown, нормализацию, provenance и SQLite оставить в существующем MiniMed preparer/pack builder.

Для JS-heavy страниц держать **Crawl4AI как точечный fallback/диагностический инструмент**. Его self-hosted Docker API MiniMed не нужен: in-process Python SDK проще, а Docker-поверхность имела заметную историю SSRF/RCE/file-write/XSS исправлений.

**Scrapling** хорош как быстрый Python fetch/parser и adaptive selectors, но как основной массовый site crawler уступает Crawlee: frontier, resume, dataset/export и orchestration больше придётся писать самим.

Новый сильный кандидат — **yomi** (`tamnd/yomi`): удачный CLI для «сайт → clean Markdown», sitemap, robots, изображений и resume. Но это Go-инструмент, не Python library; он лучше как comparator/fallback, а не основной ingestion engine.

**Crawlit** (`arufian/Crawlit`) — self-hosted MIT Docker/Redis API с `/v1/crawl`, `/v1/map`, Playwright/stealth, Markdown/HTML/rawHtml и сохранением файлов ([README](https://github.com/arufian/crawlit#readme), [LICENSE](https://github.com/arufian/crawlit/blob/main/LICENSE)). Но на дату проверки репозиторий имеет 21 commit, 3 stars и не имеет опубликованного релиза ([репозиторий](https://github.com/arufian/crawlit)); README не описывает robots-политику, явные crawl checkpoints/resume или provenance/raw-response manifest ([архитектура](https://github.com/arufian/crawlit#architecture)). Значит, это полезный локальный comparator, но для массового staging-сбора уступает Crawlee по зрелости и доказанному frontier/resume-контракту.

**Jina Reader (`r.jina.ai`)** — single-page reader, а не site crawler: URL → LLM-friendly output; sitemap/frontier, crawl job и resume/checkpoints не входят в заявленный Reader API ([официальная страница](https://jina.ai/reader/), [OSS README](https://github.com/jina-ai/reader#readme)). Hosted API бесплатен, но квотирован: 20 RPM без ключа и 500 RPM с free API key; действуют RPM/TPM лимиты ([rate limits](https://jina.ai/reader/)). Он поддерживает auto/headless Chrome, Markdown, HTML, text, screenshot/pageshot и images ([architecture](https://github.com/jina-ai/reader/blob/main/architecture.md), [cookbooks](https://github.com/jina-ai/reader/blob/main/cookbooks.md)), но raw HTML/provenance MiniMed нужно сохранять самостоятельно. OSS-ветка Apache-2.0 запускается stateless локально с optional MinIO/S3 cache, однако это Node/Docker deployment, не offline Python 3.12 library ([OSS README](https://github.com/jina-ai/reader#readme)).

## Сравнительная матрица

| Критерий | Crawl4AI | Scrapling | Crawlee | yomi | Crawlit | Jina Reader |
|---|---|---|---|---|---|---|
| Self-hosted без платного API | Да: Python SDK; Docker optional | Да, Python library | Да, Python library; также JS/TS | Да, локальный Go CLI | Да, Docker + Redis, MIT | Да, OSS Docker; hosted free tier квотирован |
| JS rendering | Playwright/Chromium | Playwright fetchers | PlaywrightCrawler | Headless Chrome когда нужен | Playwright/stealth | Auto/headless Chrome |
| Crawl/map | Deep crawl BFS/DFS/best-first, sitemap/domain mapping | Spider framework; меньше orchestration-экосистема | RequestQueue, link enqueue, sitemap/crawlers | BFS site crawl, sitemap, scope/depth | BFS/depth/domain; sitemap-first map | Single URL; site frontier не заявлен |
| Markdown/HTML | Сильная Markdown generation; HTML/JSON/PDF APIs | HTML adaptor; Markdown не главный контракт | HTML/raw response и dataset; Markdown в preparer | Clean Markdown; JSON/JSONL/HTML | Markdown/HTML/rawHtml/frontmatter | Markdown/HTML/text/frontmatter |
| Images | Extract/download options | Resource/image handling, extraction вручную | Binary files, images/PDF/JPG/PNG | Remote URLs или download/inline | Image URLs; download/inline заявлены | Retain images / image output |
| Checkpoint/resume | `resume_state` + `on_state_change` | SQLite storage для adaptive elements; crawl resume собрать самому | Persistent queue/storage — естественный restart/resume | `.yomi-state.jsonl` + `--resume` | Redis queue/cache; явный resume contract не найден | Не найден для site crawl |
| Rate limiting | Dispatcher/concurrency/delay | Fetcher controls; policy собрать самому | Per-domain throttling, concurrency, retries | Workers; politeness менее богата | Vendor quota отсутствует; policy собрать самому | 20 RPM anonymous / 500 RPM free key; RPM+TPM |
| Robots controls | `check_robots_txt` | Не нашёл полноценного crawler-level contract | HTTP/crawler controls; включить и отдельно валидировать | Включены; `--no-robots` — явный opt-out | В README не заявлены | Отдельного crawl-policy contract нет |
| Python 3.12 | Нативно | Нативно, минимум Python 3.9 | Нативно | subprocess/Go binary | Node/Docker; Python boundary отсутствует | HTTP client или Node/Docker; Bun только client |
| Bun integration | subprocess/loopback API | subprocess/Python service | JS/TS под Node; Bun не считать гарантированным | subprocess | HTTP loopback API | HTTP client; OSS Node/Docker |
| Зрелость на 2026-09-03 | Большая, но быстро меняется; 0.9.x | Быстро растёт, 0.4.x; молодой | Самая зрелая crawling model, активные Python releases | Новый, узко сфокусированный | 21 commit, 3 stars, no releases | Активный OSS/API проект; SaaS и OSS различаются |
| Главный риск | Security history; attribution clause; browser cost | Меньше доказанной масштабной orchestration | Markdown/readability не встроены как Firecrawl; glue code | Go boundary; heuristic extraction | Очень молодой проект; нет robots/resume/provenance contract | Hosted quota/vendor dependency; не site crawler |

## 1. Crawl4AI

Официальные источники: [GitHub](https://github.com/unclecode/crawl4ai), [README](https://github.com/unclecode/crawl4ai/blob/main/README.md), [CHANGELOG](https://github.com/unclecode/crawl4ai/blob/main/CHANGELOG.md), [LICENSE](https://github.com/unclecode/crawl4ai/blob/main/LICENSE). На 2026-09-03 changelog содержит 0.9.x releases; лицензия Apache-2.0 с обязательным attribution clause.

Сильные стороны: Python-first API, Playwright browser, Markdown/HTML/structured output, deep crawl BFS/DFS/best-first, sitemap/domain mapping, crash recovery через `resume_state` и `on_state_change`, robots через `check_robots_txt`, dispatcher для concurrency/rate policy. In-process запуск не требует API key.

Ограничения: extracted Markdown нельзя считать source of truth — сохранять raw HTML, checksum и source spans отдельно. Changelog 2026 показывает SSRF, RCE в hooks, arbitrary file write, XSS и DoS fixes в Docker server. Поэтому не выставлять Docker API наружу; для MiniMed предпочтителен локальный SDK. Chromium включать только для JS-dependent URL.

Минимальная установка (не выполнялась):

```bash
python3.12 -m venv .venv-crawl4ai
source .venv-crawl4ai/bin/activate
pip install -U crawl4ai
crawl4ai-setup
```

## 2. Scrapling

Официальные источники: [GitHub](https://github.com/D4Vinci/Scrapling), [documentation](https://scrapling.readthedocs.io/), [CHANGELOG](https://github.com/D4Vinci/Scrapling/blob/main/CHANGELOG.md), [LICENSE](https://github.com/D4Vinci/Scrapling/blob/main/LICENSE). Лицензия BSD-3-Clause; changelog содержит 0.4.15 от 2026-08-23.

Сильные стороны: нативный Python, HTTP и Playwright fetchers, Stealthy/Browser options, adaptive element tracking, SQLite-backed storage. Хорош для точечного парсинга страниц, когда DOM меняется.

Ограничения: это прежде всего fetch/parser/adaptive extraction toolkit. Для массового справочника самостоятельно собрать frontier, deduplication, checkpoints, retries, manifest и audit. Stealth не должен означать обход правил сайта; MiniMed нужен разрешённый, медленный robots-aware crawl. Готовый Firecrawl-like Markdown/site-job contract не является его центральным API.

Минимальная установка (не выполнялась):

```bash
python3.12 -m venv .venv-scrapling
source .venv-scrapling/bin/activate
pip install scrapling
scrapling install
```

## 3. Crawlee

Официальные источники: [JS/TS GitHub](https://github.com/apify/crawlee), [Python GitHub](https://github.com/apify/crawlee-python), [Python docs](https://crawlee.dev/python/), [Python CHANGELOG](https://github.com/apify/crawlee-python/blob/master/CHANGELOG.md), [LICENSE](https://github.com/apify/crawlee-python/blob/master/LICENSE). Репозитории используют Apache-2.0; Python changelog показывает 1.9.3 от 2026-08-24.

Почему это лучший основной engine: `RequestQueue` даёт persistent frontier, deduplication, restart/resume и controlled enqueue; есть HTTP, BeautifulSoup/Parsel и Playwright crawlers; retries, session/error handling, per-domain throttling/concurrency и storage/dataset abstractions. Python 3.12 подходит напрямую. Bun app получает только подготовленные артефакты; ingest остаётся Python job.

Что добавить в MiniMed: HTML → provenance-preserving Markdown/prepared blocks; manifest URL/status/headers/fetch time/raw checksum/render mode/robots decision; image downloader с allowlist, размером, checksum и rights status; штатные lint/pack builder. Crawler не пишет production SQLite.

Минимальная установка (не выполнялась):

```bash
python3.12 -m venv .venv-crawlee
source .venv-crawlee/bin/activate
pip install 'crawlee[playwright]'
playwright install chromium
```

Для JS/TS есть `npm install crawlee`, но переносить ingest в Bun не рекомендую: это расширит runtime boundary без выигрыша.

## 4. Новый кандидат: yomi

[yomi GitHub](https://github.com/tamnd/yomi) — новый Go CLI. Он делает static fetch, при необходимости headless Chrome, main-content extraction, Markdown conversion, BFS site crawl, sitemap seed, scope/depth, robots, JSON/JSONL/HTML, image download/inline и resumable `.yomi-state.jsonl`.

Это сильный кандидат именно по output contract «site → clean Markdown + media + resume». Но для MiniMed нет Python library boundary, меньше crawler ecosystem/observability, а readability extraction нужно проверять на таблицах, предупреждениях и nested sections медицинского сайта. Роль — comparison tool или fallback CLI.

Минимальная установка (не выполнялась):

```bash
git clone https://github.com/tamnd/yomi
cd yomi
make build
```

Источники: [README](https://github.com/tamnd/yomi/blob/main/README.md), [MIT license](https://github.com/tamnd/yomi/blob/main/LICENSE).

## Рекомендованный pipeline MiniMed

### Два новых кандидата в решении

Для массового воспроизводимого сбора `krasotaimedicina.ru` порядок не меняется: **Crawlee Python — основной**, потому что его Python boundary, persistent queue, retries/throttling и отдельная работа с raw response лучше соответствуют private staging. **Crawlit — второй comparator**, если нужен Firecrawl-compatible локальный HTTP API: он закрывает crawl/map и browser-rendering, но требует собственного robots gate, rate policy, checkpoint/manifest и security review; LLM extraction не использовать для source preparation ([API и crawl/map](https://github.com/arufian/crawlit#api), [LLM extraction/config](https://github.com/arufian/crawlit#configuration)).

**Jina Reader — только page-level renderer/comparator**, когда URL уже известен и нужно сравнить extraction quality; hosted free quota, auth/key escalation, vendor availability и отсутствие site frontier делают его плохой основой полного воспроизводимого crawl ([официальные лимиты](https://jina.ai/reader/), [Reader API headers/options](https://github.com/jina-ai/reader/blob/main/cookbooks.md)). Self-hosted OSS-вариант возможен, но добавляет Node/Chrome/Redis-or-cache operational surface; он не делает сбор offline, пока сайт не был заранее сохранён локально. Для обоих вариантов сохранять raw HTML/response и source spans до Markdown; изображения — отдельно, с URL/checksum/rights status. Ни Crawlit, ни Jina Reader не дают MiniMed готового provenance contract.

1. Seed из sitemap и разрешённых разделов; перед каждым URL проверить host/scope и robots.
2. Crawlee HttpCrawler/BeautifulSoup crawler для static pass, persistent queue и low per-domain concurrency.
3. Только для JS shell/JS-dependent route — PlaywrightCrawler.
4. Сохранить raw response/HTML и binary images отдельно от prepared Markdown; каждому объекту дать URL, timestamp, status, render mode, SHA-256 и source locator.
5. Подготовить Markdown существующими MiniMed content tools, отметить tables/OCR/missing text/contradictions, провести lint и rights review.
6. Собрать SQLite только штатным pack builder; crawler не имеет права писать production pack.
7. Хранить crawl state/raw corpus в private ignored staging; не коммитить персональные данные и third-party assets.

### Приоритет выбора

**Crawlee Python — выбрать.** Лучший контроль над массовым crawl, resume, throttling и Python 3.12 boundary.

**Crawl4AI — fallback.** Для отдельных JS-heavy URL и сравнения Markdown; только in-process/loopback, pinned version, без открытого Docker API.

**Scrapling — точечный инструмент.** Для adaptive parsing, если DOM-селекторы меняются.

**yomi — comparator.** Для быстрой оценки clean Markdown и resume; не заменяет Python ingest contract.

**Crawlit — пока не брать.** Удобный API-клон, но Docker/Redis противоречат текущей архитектуре MiniMed, а crawler ещё слишком молодой.

**Jina Reader — внешний comparator.** Полезен для быстрой проверки извлечения отдельных сложных страниц, но не для основной массовой загрузки.

## Риски

- Лицензия crawler не лицензирует собранный медицинский сайт и изображения; redistribution rights нужны отдельно.
- Robots.txt — операционный минимум, не юридическое разрешение. Нужны условия сайта, rate limit и permission при массовом сборе.
- Наличие Markdown не доказывает качество: сравнить title, headings, tables, warnings, numeric text, references и images с raw HTML.
- Медицинские claims не должны появляться из LLM extraction: source → provenance → deterministic preparation → validation.
- Crawl state/raw corpus могут содержать персональные данные, query strings и third-party assets.

Open questions: exact page taxonomy, sitemap coverage, robots policy, redistribution rights и небольшой gold fixture set для extraction-quality comparison остаются к проверке до запуска crawl.
