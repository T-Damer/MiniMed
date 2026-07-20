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
  symptom: 'симптом',
  investigation: 'обследование',
  medication: 'препарат',
  location: 'локализация',
  epidemiology: 'эпиданамнез',
  'negative-finding': 'отрицается',
};

function resizeTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 128), 300)}px`;
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
  const [loading, setLoading] = createSignal(false);
  const [analysisLoading, setAnalysisLoading] = createSignal(false);
  const [contextLoading, setContextLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let textarea: HTMLTextAreaElement | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;

  const activeAnalysis = createMemo(() => {
    const searched = response();
    if (searched && searched.analysis.originalQuery === query().trim()) return searched.analysis;
    return draftAnalysis();
  });

  const resultCount = createMemo(
    () => response()?.groups.reduce((total, group) => total + group.results.length, 0) ?? 0,
  );

  const handleReplaySearch = (event: Event): void => {
    const replay = event as CustomEvent<string>;
    if (typeof replay.detail !== 'string' || !replay.detail.trim()) return;
    updateQuery(replay.detail);
    requestAnimationFrame(() => {
      if (textarea) resizeTextarea(textarea);
      void runSearch(replay.detail);
    });
  };

  onMount(() => window.addEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch));

  onCleanup(() => {
    window.removeEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    if (analysisTimer) clearTimeout(analysisTimer);
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
    setContext(undefined);

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
  }

  async function openResult(result: SearchResult): Promise<void> {
    setContextLoading(true);
    setError(undefined);
    const resolved = await props.core.getContext(result.chunkId, 1);
    setContextLoading(false);
    if (!resolved.ok) {
      setError(resolved.error.message);
      return;
    }
    setContext(resolved.value);
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
    setError(undefined);
    requestAnimationFrame(() => {
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
    });
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
        <header class="case-heading search-home-heading">
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

        <form
          class="query-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
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
            placeholder="Например: 5 лет, мальчик, второй день кашляет и температурит…"
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
                <span>{loading() ? 'Ищем…' : 'Найти в архиве'}</span>
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
              </details>
            </section>
          )}
        </Show>

        <Show when={!response() && query().length === 0}>
          <fieldset class="example-row">
            <legend>Примеры поиска</legend>
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
                  <span>РЕЗУЛЬТАТЫ</span>
                  <strong>{resultCount()} фрагментов</strong>
                </div>
                <div>
                  <span>ДОКУМЕНТЫ</span>
                  <strong>{searchResponse().groups.length}</strong>
                </div>
                <div>
                  <span>ВРЕМЯ</span>
                  <strong>{searchResponse().elapsedMs.toFixed(1)} мс</strong>
                </div>
                <div>
                  <span>РЕЖИМ</span>
                  <strong data-testid="search-mode">
                    {SEARCH_MODE_LABELS[searchResponse().modeUsed]}
                  </strong>
                </div>
              </div>

              <div class="results-list" data-testid="search-results">
                <For each={searchResponse().groups}>
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
                            <button
                              class="result-open"
                              type="button"
                              data-testid="search-result"
                              onClick={() => void openResult(result)}
                            >
                              <span class={`category-stamp category-${result.category}`}>
                                {CATEGORY_LABELS[result.category]}
                              </span>
                              <span class="result-path">{result.sectionPath.join(' / ')}</span>
                              <p>
                                <HighlightedText
                                  text={result.snippet}
                                  ranges={result.highlightedRanges}
                                />
                              </p>
                              <span class="result-link">Открыть источник →</span>
                            </button>
                          </article>
                        )}
                      </For>
                    </section>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>
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
          onClick={() => setContext(undefined)}
        >
          <AppGlyph name="close" />
        </button>
        <Show
          when={context()}
          fallback={
            <div class="reader-empty">
              <p class="archive-kicker">Контекст источника</p>
              <h2>{contextLoading() ? 'Открываем источник…' : 'Выберите результат'}</h2>
            </div>
          }
        >
          {(resolved) => (
            <article class="reader-card paper-sheet" data-testid="reader-context">
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

              <div class="document-text">
                <For each={resolved().chunks}>
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
            </article>
          )}
        </Show>
      </aside>
    </section>
  );
}
