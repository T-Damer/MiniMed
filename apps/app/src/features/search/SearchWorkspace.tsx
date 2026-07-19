import type {
  ChunkContext,
  MedicalCore,
  QueryAnalysis,
  QueryFact,
  SearchResponse,
  SearchResult,
  SearchResultCategory,
  SearchSuggestion,
} from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '../../components/AppGlyph';
import { HighlightedText } from '../../components/HighlightedText';
import { appendSearchHistory, SEARCH_REPLAY_EVENT } from '../../state/search-history';

interface SearchWorkspaceProps {
  readonly core: MedicalCore;
}

const EXAMPLES = [
  'Ребёнок часто дышит и температурит второй день',
  'Боль справа внизу живота, тошнота и рвота',
  'Лихорадка без очага и рези при мочеиспускании',
] as const;

const BOOKMARKS_KEY = 'localmed.search-bookmarks.v1';

const CATEGORY_LABELS: Readonly<Record<SearchResultCategory, string>> = {
  overview: 'Обзор',
  'clinical-picture': 'Клиника',
  'differential-diagnosis': 'Дифференциальный поиск',
  diagnostics: 'Диагностика',
  treatment: 'Лечение',
  routing: 'Маршрутизация',
  'follow-up': 'Наблюдение',
  other: 'Прочее',
};

const SEARCH_MODE_LABELS: Readonly<Record<SearchResponse['modeUsed'], string>> = {
  lexical: 'FTS5',
  semantic: 'VECTOR',
  hybrid: 'FTS5 + VECTOR',
};

const FACT_LABELS: Readonly<Record<QueryFact['kind'], string>> = {
  age: 'возраст',
  sex: 'пол',
  duration: 'срок',
  temperature: 't°',
  measurement: 'показатель',
  symptom: 'термин',
  investigation: 'обследование',
  medication: 'препарат',
  location: 'локализация',
  epidemiology: 'эпиданамнез',
  'negative-finding': 'отрицается',
};

function loadStringArray(key: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  } catch {
    return [];
  }
}


function saveBookmarks(bookmarks: ReadonlySet<string>): void {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks]));
}

function resizeTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 156), 340)}px`;
}

function factDisplayValue(fact: QueryFact): string {
  if (fact.kind === 'sex') return fact.normalizedValue;
  if (fact.kind === 'temperature') return `${fact.normalizedValue} °C`;
  if (fact.kind === 'measurement' && fact.unit) return `${fact.normalizedValue} ${fact.unit}`;
  return fact.value;
}

export function SearchWorkspace(props: SearchWorkspaceProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [draftAnalysis, setDraftAnalysis] = createSignal<QueryAnalysis>();
  const [response, setResponse] = createSignal<SearchResponse>();
  const [context, setContext] = createSignal<ChunkContext>();
  const [selectedResult, setSelectedResult] = createSignal<SearchResult>();
  const [loading, setLoading] = createSignal(false);
  const [contextLoading, setContextLoading] = createSignal(false);
  const [analysisLoading, setAnalysisLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [bookmarks, setBookmarks] = createSignal<ReadonlySet<string>>(new Set());
  const [activeCategory, setActiveCategory] = createSignal<SearchResultCategory | 'all'>('all');
  const [showFullSection, setShowFullSection] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let textarea: HTMLTextAreaElement | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const activeAnalysis = createMemo(() => {
    const searched = response();
    if (searched && searched.analysis.originalQuery === query().trim()) return searched.analysis;
    return draftAnalysis();
  });

  const categories = createMemo(() => {
    const values = response()?.groups.flatMap((group) => group.categories) ?? [];
    return [...new Set(values)];
  });

  const visibleGroups = createMemo(() => {
    const category = activeCategory();
    const groups = response()?.groups ?? [];
    if (category === 'all') return groups;
    return groups
      .map((group) => ({
        ...group,
        results: group.results.filter((item) => item.category === category),
      }))
      .filter((group) => group.results.length > 0);
  });

  const readerChunks = createMemo(() => {
    const resolved = context();
    if (!resolved) return [];
    return showFullSection() ? resolved.section.chunks : resolved.chunks;
  });

  const handleReplaySearch = (event: Event): void => {
    const replay = event as CustomEvent<string>;
    if (typeof replay.detail !== 'string' || !replay.detail.trim()) return;
    updateQuery(replay.detail);
    requestAnimationFrame(() => {
      if (textarea) resizeTextarea(textarea);
      void runSearch(replay.detail);
    });
  };

  onMount(() => {
    setBookmarks(new Set(loadStringArray(BOOKMARKS_KEY)));
    window.addEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
  });

  onCleanup(() => {
    window.removeEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (copyTimer) clearTimeout(copyTimer);
  });

  function scheduleAnalysis(value: string): void {
    if (analysisTimer) clearTimeout(analysisTimer);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setDraftAnalysis(undefined);
      setAnalysisLoading(false);
      return;
    }
    setAnalysisLoading(true);
    analysisTimer = setTimeout(async () => {
      const result = await props.core.analyzeQuery({ query: trimmed, includeSuggestions: true });
      if (query().trim() !== trimmed) return;
      setAnalysisLoading(false);
      if (result.ok) setDraftAnalysis(result.value);
    }, 180);
  }

  function updateQuery(value: string): void {
    setQuery(value);
    scheduleAnalysis(value);
  }

  async function runSearch(nextQuery = query()): Promise<void> {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    setError(undefined);
    setActiveCategory('all');
    const result = await props.core.search({
      query: trimmed,
      mode: 'auto',
      filters: {},
      limit: 28,
      includeSuggestions: true,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setResponse(result.value);
    setDraftAnalysis(result.value.analysis);
    appendSearchHistory(trimmed, result.value);
    setContext(undefined);
    setSelectedResult(undefined);
  }

  async function openResult(result: SearchResult): Promise<void> {
    setContextLoading(true);
    setError(undefined);
    setShowFullSection(false);
    const resolved = await props.core.getContext(result.chunkId, 1);
    setContextLoading(false);
    if (!resolved.ok) {
      setError(resolved.error.message);
      return;
    }
    setSelectedResult(result);
    setContext(resolved.value);
  }

  async function navigateToChunk(chunkId: string | null): Promise<void> {
    if (!chunkId) return;
    const resolved = await props.core.getContext(chunkId, 1);
    if (!resolved.ok) {
      setError(resolved.error.message);
      return;
    }
    setContext(resolved.value);
    setShowFullSection(false);
  }

  function insertSuggestion(suggestion: SearchSuggestion): void {
    const separator = query().trim() ? '\n' : '';
    const value = `${query().trimEnd()}${separator}${suggestion.insertion}`;
    updateQuery(value);
    requestAnimationFrame(() => {
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
    });
  }

  function clearQuery(): void {
    setQuery('');
    setDraftAnalysis(undefined);
    setResponse(undefined);
    setContext(undefined);
    setSelectedResult(undefined);
    setError(undefined);
    requestAnimationFrame(() => {
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
    });
  }

  function toggleBookmark(event: MouseEvent, result: SearchResult): void {
    event.stopPropagation();
    setBookmarks((current) => {
      const next = new Set(current);
      if (next.has(result.chunkId)) next.delete(result.chunkId);
      else next.add(result.chunkId);
      saveBookmarks(next);
      return next;
    });
  }

  async function copyFocusChunk(): Promise<void> {
    const resolved = context();
    if (!resolved) return;
    const focus = resolved.section.chunks.find((chunk) => chunk.id === resolved.focusChunkId);
    if (!focus) return;
    await navigator.clipboard.writeText(focus.originalText);
    setCopied(true);
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setCopied(false), 1_600);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runSearch();
    }
  }

  return (
    <section class="workspace archive-desk" aria-label="Локальный медицинский поиск">
      <div class="search-column case-folder">
        <div class="folder-tab" aria-hidden="true">
          ДЕЛО № 002 / ПОИСК
        </div>

        <header class="case-heading">
          <div>
            <p class="archive-kicker">Локально · быстро · с переходом к источнику</p>
            <h1>Что нужно найти?</h1>
          </div>
          <span class="offline-stamp">
            OFFLINE
            <br />
            READY
          </span>
        </header>

        <p class="case-lead">
          Ядро выделит измеримые данные, разложит длинное описание на поисковые ветки и откроет
          исходный материал на нужном абзаце.
        </p>

        <form
          class="query-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <div class="sheet-meta">
            <span>КАРТОЧКА КЛИНИЧЕСКОГО ЗАПРОСА</span>
            <span>ЛОКАЛЬНО / НЕ ОТПРАВЛЯЕТСЯ</span>
          </div>
          <label class="sr-only" for="clinical-query">
            Поисковый запрос
          </label>
          <textarea
            ref={(element) => {
              textarea = element;
              resizeTextarea(element);
            }}
            id="clinical-query"
            data-testid="search-input"
            value={query()}
            onInput={(event) => {
              updateQuery(event.currentTarget.value);
              resizeTextarea(event.currentTarget);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Например: мальчик 5 лет, второй день лихорадка до 39, часто дышит, кашля нет…"
            maxlength={20_000}
            autocomplete="off"
            autocapitalize="sentences"
            spellcheck={false}
          />
          <div class="query-actions">
            <div class="query-shortcuts">
              <span class="keyboard-only">Ctrl / ⌘ + Enter — поиск</span>
              <Show when={query().length > 16_000}>
                <strong>{query().length.toLocaleString('ru-RU')} / 20 000</strong>
              </Show>
            </div>
            <div class="query-buttons">
              <Show when={query().length > 0}>
                <button class="text-button" type="button" onClick={clearQuery}>
                  Очистить
                </button>
              </Show>
              <button
                class="search-button"
                data-testid="search-submit"
                type="submit"
                disabled={loading()}
              >
                <span>{loading() ? 'Индексируем запрос…' : 'Найти в архиве'}</span>
                <b aria-hidden="true">↵</b>
              </button>
            </div>
          </div>
        </form>

        <Show when={activeAnalysis()}>
{(analysis) => (
  <section class="query-index" aria-label="Разбор запроса">
    <Show when={analysis().suggestions.length > 0}>
      <div class="index-row suggestions-row">
        <div class="index-label">
          <span>Можно добавить</span>
          <small>необязательно</small>
        </div>
        <div class="suggestion-strip">
          <For each={analysis().suggestions}>
            {(suggestion) => (
              <button
                type="button"
                title={suggestion.detail}
                onClick={() => insertSuggestion(suggestion)}
              >
                <span>+</span> {suggestion.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>

    <details class="analysis-details">
      <summary>
        {analysisLoading()
          ? 'Обновляем разбор…'
          : `Распознано ${analysis().facts.length} полей · показать детали`}
      </summary>
      <div class="index-row">
        <div class="index-label">
          <span>Распознано</span>
          <small>{analysis().facts.length} полей</small>
        </div>
        <div class="fact-strip">
          <For each={analysis().facts}>
            {(fact) => (
              <span
                class="fact-tag"
                classList={{ negative: fact.polarity === 'negative' }}
                title={fact.label}
              >
                <small>{FACT_LABELS[fact.kind]}</small>
                {factDisplayValue(fact)}
              </span>
            )}
          </For>
          <Show when={analysis().facts.length === 0}>
            <span class="empty-index">Свободный текст сохранён без изменений.</span>
          </Show>
        </div>
      </div>
      <div class="branch-ledger">
        <span>Поисковые ветки</span>
        <For each={analysis().branches}>
          {(branch, index) => (
            <span class="branch-ticket">
              {String(index() + 1).padStart(2, '0')} · {branch.label}
            </span>
          )}
        </For>
      </div>
      <For each={analysis().warnings}>
        {(warning) => <p class="analysis-warning">Примечание: {warning}</p>}
      </For>
    </details>
  </section>
)}
        </Show>

        <Show when={!activeAnalysis()}>
          <fieldset class="example-row">
            <legend>Тестовые карточки</legend>
            <For each={EXAMPLES}>
              {(example, index) => (
                <button type="button" onClick={() => void runSearch(example)}>
                  <span>{String(index() + 1).padStart(2, '0')}</span>
                  {example}
                </button>
              )}
            </For>
          </fieldset>
        </Show>

        <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

        <Show when={response()}>
          {(searchResponse) => (
            <>
              <div class="result-summary">
                <div>
                  <span>ВЫБОРКА</span>
                  <strong>
                    {searchResponse().groups.length} документов /{' '}
                    {searchResponse().diagnostics.candidateCount} фрагментов
                  </strong>
                </div>
                <div>
                  <span>ВРЕМЯ</span>
                  <strong>{searchResponse().elapsedMs.toFixed(1)} мс</strong>
                </div>
                <div>
                  <span>ВЕТКИ</span>
                  <strong>{searchResponse().diagnostics.branches.length}</strong>
                </div>
                <div
                  title={
                    searchResponse().diagnostics.semantic.fallbackReason ??
                    searchResponse().diagnostics.semantic.profileId ??
                    'lexical retrieval'
                  }
                >
                  <span>РЕЖИМ</span>
                  <strong data-testid="search-mode">
                    {SEARCH_MODE_LABELS[searchResponse().modeUsed]}
                  </strong>
                </div>
              </div>

              <fieldset class="category-tabs">
                <legend class="sr-only">Фильтр по типу раздела</legend>
                <button
                  type="button"
                  classList={{ active: activeCategory() === 'all' }}
                  onClick={() => setActiveCategory('all')}
                >
                  Все разделы
                </button>
                <For each={categories()}>
                  {(category) => (
                    <button
                      type="button"
                      classList={{ active: activeCategory() === category }}
                      onClick={() => setActiveCategory(category)}
                    >
                      {CATEGORY_LABELS[category]}
                    </button>
                  )}
                </For>
              </fieldset>
            </>
          )}
        </Show>

        <div class="results-list" data-testid="search-results">
          <For each={visibleGroups()}>
            {(group, groupIndex) => (
              <section class="result-group">
                <div class="result-group-header">
                  <span class="file-number">{String(groupIndex() + 1).padStart(2, '0')}</span>
                  <div>
                    <small>ДОКУМЕНТ</small>
                    <strong>{group.title}</strong>
                  </div>
                  <span class="group-count">{group.results.length} совп.</span>
                </div>
                <For each={group.results.slice(0, 5)}>
                  {(result) => (
                    <article
                      class="result-card"
                      classList={{ selected: context()?.focusChunkId === result.chunkId }}
                    >
                      <div class="result-card-topline">
                        <span class={`category-stamp category-${result.category}`}>
                          {CATEGORY_LABELS[result.category]}
                        </span>
                        <button
                          class="bookmark-button"
                          classList={{ active: bookmarks().has(result.chunkId) }}
                          type="button"
                          aria-label={
                            bookmarks().has(result.chunkId)
                              ? 'Удалить из отложенных фрагментов'
                              : 'Отложить фрагмент'
                          }
                          onClick={(event) => toggleBookmark(event, result)}
                        >
                          {bookmarks().has(result.chunkId) ? '●' : '○'}
                        </button>
                      </div>
                      <button
                        class="result-open"
                        type="button"
                        data-testid="search-result"
                        onClick={() => void openResult(result)}
                      >
                        <span class="result-path">{result.sectionPath.join(' / ')}</span>
                        <p>
                          <HighlightedText
                            text={result.snippet}
                            ranges={result.highlightedRanges}
                          />
                        </p>
                        <span class="match-ledger">
                          <span>
                            Найдено через: {result.matchedBranches.slice(0, 2).join(' + ')}
                          </span>
                          <span class="result-link">Открыть лист →</span>
                        </span>
                      </button>
                    </article>
                  )}
                </For>
              </section>
            )}
          </For>

          <Show when={response() && visibleGroups().length === 0}>
            <div class="no-results-card">
              <span>НЕТ КАРТОЧЕК</span>
              <h2>В выбранной рубрике совпадений нет.</h2>
              <button type="button" onClick={() => setActiveCategory('all')}>
                Показать всю выборку
              </button>
            </div>
          </Show>
        </div>

      </div>

      <aside
        class="reader-column source-folder"
        classList={{ open: Boolean(context()) }}
        aria-live="polite"
        aria-hidden={!context()}
      >
        <button
          class="reader-close"
          type="button"
          aria-label="Закрыть источник"
          onClick={() => {
            setContext(undefined);
            setSelectedResult(undefined);
          }}
        >
          <AppGlyph name="close" />
        </button>
        <div class="folder-tab source-tab" aria-hidden="true">
          ИСТОЧНИК / ЛИСТ
        </div>
        <Show
          when={context()}
          fallback={
            <div class="reader-empty">
              <span class="empty-file-mark">LM–SRC</span>
              <p class="archive-kicker">Контекст источника</p>
              <h2>{contextLoading() ? 'Извлекаем лист…' : 'Выберите найденный фрагмент'}</h2>
              <p>
                Справа появится исходный раздел, найденный абзац и соседний контекст. Текст не
                переписывается и не пересказывается моделью.
              </p>
              <div class="empty-rules" aria-hidden="true" />
            </div>
          }
        >
          {(resolved) => (
            <article class="reader-card paper-sheet" data-testid="reader-context">
              <span class="paper-clip" aria-hidden="true" />
              <header class="reader-header">
                <div>
                  <p class="archive-kicker">
                    {resolved().document.shortTitle ?? resolved().document.title}
                  </p>
                  <h2>{resolved().section.sectionPath.join(' / ')}</h2>
                </div>
                <span class="source-stamp">
                  ИСТОЧНИК
                  <br />
                  ЛОКАЛЬНЫЙ
                </span>
              </header>

              <dl class="reader-meta">
                <div>
                  <dt>Редакция</dt>
                  <dd>{resolved().document.versionLabel}</dd>
                </div>
                <div>
                  <dt>Раздел</dt>
                  <dd>{resolved().section.sectionType ?? 'section'}</dd>
                </div>
                <div>
                  <dt>Режим</dt>
                  <dd>{showFullSection() ? 'весь раздел' : 'контекст ±1'}</dd>
                </div>
              </dl>

              <div class="reader-toolbar">
                <button
                  type="button"
                  disabled={!resolved().previousChunkId}
                  onClick={() => void navigateToChunk(resolved().previousChunkId)}
                >
                  ← предыдущий
                </button>
                <button type="button" onClick={() => setShowFullSection((value) => !value)}>
                  {showFullSection() ? 'Свернуть до контекста' : 'Показать весь раздел'}
                </button>
                <button type="button" onClick={() => void copyFocusChunk()}>
                  {copied() ? 'Скопировано' : 'Копировать абзац'}
                </button>
                <button
                  type="button"
                  disabled={!resolved().nextChunkId}
                  onClick={() => void navigateToChunk(resolved().nextChunkId)}
                >
                  следующий →
                </button>
              </div>

              <div class="document-text">
                <For each={readerChunks()}>
                  {(chunk) => (
                    <div
                      id={chunk.anchor}
                      class="source-paragraph"
                      classList={{ 'focus-chunk': chunk.id === resolved().focusChunkId }}
                    >
                      <Show when={chunk.id === resolved().focusChunkId}>
                        <span class="margin-note">НАЙДЕНО</span>
                      </Show>
                      <p>{chunk.originalText}</p>
                    </div>
                  )}
                </For>
              </div>

              <details class="technical-slip">
                <summary>Техническая карточка</summary>
                <dl>
                  <div>
                    <dt>chunk</dt>
                    <dd>{resolved().focusChunkId}</dd>
                  </div>
                  <div>
                    <dt>anchor</dt>
                    <dd>{selectedResult()?.anchor ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>ветки</dt>
                    <dd>{selectedResult()?.matchedBranches.join(', ') ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>режим</dt>
                    <dd>
                      {response() ? SEARCH_MODE_LABELS[response()?.modeUsed ?? 'lexical'] : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>профиль</dt>
                    <dd>{response()?.diagnostics.semantic.profileId ?? 'lexical fallback'}</dd>
                  </div>
                  <div>
                    <dt>score</dt>
                    <dd>
                      lexical {selectedResult()?.lexicalScore.toFixed(3) ?? '—'} · semantic{' '}
                      {selectedResult()?.semanticScore?.toFixed(3) ?? '—'}
                    </dd>
                  </div>
                </dl>
              </details>
            </article>
          )}
        </Show>
      </aside>
    </section>
  );
}
