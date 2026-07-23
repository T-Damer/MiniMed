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
import { CATEGORY_VISUALS, ClinicalGlyph } from '../../components/ClinicalGlyph';
import { HighlightedText } from '../../components/HighlightedText';
import { openDocumentInArchive } from '../../state/document-navigation';
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

const INTENT_LABELS: Readonly<Record<NonNullable<QueryAnalysis['intent']>['primary'], string>> = {
  diagnosis: 'Клинический случай: ищем возможные диагнозы и источники',
  treatment: 'Тактика лечения: сначала учитываем диагноз, тяжесть и ограничения',
  medication: 'Запрос о препарате: показываем лекарственные источники и контекст применения',
  'disease-reference': 'Справочный запрос о заболевании',
  'care-guidance': 'Уход, профилактика или практические рекомендации',
  'administrative-reference': 'Нормативный и организационный запрос',
  mixed: 'Смешанный клинический запрос: разбираем его на несколько задач',
  unknown: 'Свободный медицинский запрос',
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

function normalized(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function SearchWorkspace(props: SearchWorkspaceProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [draftAnalysis, setDraftAnalysis] = createSignal<QueryAnalysis>();
  const [response, setResponse] = createSignal<SearchResponse>();
  const [context, setContext] = createSignal<ChunkContext>();
  const [expandedGroups, setExpandedGroups] = createSignal<readonly string[]>([]);
  const [contextExpanded, setContextExpanded] = createSignal(false);
  const [readerQuery, setReaderQuery] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [analysisLoading, setAnalysisLoading] = createSignal(false);
  const [contextLoading, setContextLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let textarea: HTMLTextAreaElement | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchGeneration = 0;

  const activeAnalysis = createMemo(() => {
    const searched = response();
    if (searched && searched.analysis.originalQuery === query().trim()) return searched.analysis;
    return draftAnalysis();
  });

  const resultCount = createMemo(
    () => response()?.groups.reduce((total, group) => total + group.results.length, 0) ?? 0,
  );

  const visibleContextChunks = createMemo(() => {
    const resolved = context();
    if (!resolved) return [];
    const localQuery = normalized(readerQuery());
    if (localQuery) {
      return resolved.chunks.filter((chunk) => normalized(chunk.originalText).includes(localQuery));
    }
    if (contextExpanded()) return resolved.chunks;
    return resolved.chunks.filter((chunk) => chunk.id === resolved.focusChunkId);
  });

  const handleReplaySearch = (event: Event): void => {
    const replay = event as CustomEvent<string>;
    if (typeof replay.detail !== 'string' || !replay.detail.trim()) return;
    updateQuery(replay.detail, false);
    requestAnimationFrame(() => {
      if (textarea) resizeTextarea(textarea);
      void runSearch(replay.detail, true);
    });
  };

  onMount(() => window.addEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch));

  onCleanup(() => {
    window.removeEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (searchTimer) clearTimeout(searchTimer);
    searchGeneration += 1;
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

  function scheduleSearch(value: string): void {
    if (searchTimer) clearTimeout(searchTimer);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      searchGeneration += 1;
      setResponse(undefined);
      setLoading(false);
      return;
    }
    searchTimer = setTimeout(() => void runSearch(trimmed, false), 500);
  }

  function updateQuery(value: string, debounce = true): void {
    setQuery(value);
    scheduleAnalysis(value);
    if (debounce) scheduleSearch(value);
  }

  async function runSearch(nextQuery = query(), recordHistory = true): Promise<void> {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;
    if (searchTimer) clearTimeout(searchTimer);

    const generation = ++searchGeneration;
    setQuery(trimmed);
    setLoading(true);
    setError(undefined);
    setContext(undefined);
    setContextExpanded(false);
    setReaderQuery('');

    const result = await props.core.search({
      query: trimmed,
      mode: 'auto',
      filters: {},
      limit: 28,
      includeSuggestions: true,
    });

    if (generation !== searchGeneration || query().trim() !== trimmed) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    setResponse(result.value);
    setDraftAnalysis(result.value.analysis);
    setExpandedGroups([]);
    if (recordHistory) appendSearchHistory(trimmed, result.value);
  }

  async function openResult(result: SearchResult): Promise<void> {
    setContextLoading(true);
    setError(undefined);
    setContextExpanded(false);
    setReaderQuery('');
    const resolved = await props.core.getContext(result.chunkId, 3);
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
    searchGeneration += 1;
    if (analysisTimer) clearTimeout(analysisTimer);
    if (searchTimer) clearTimeout(searchTimer);
    setQuery('');
    setDraftAnalysis(undefined);
    setResponse(undefined);
    setContext(undefined);
    setExpandedGroups([]);
    setError(undefined);
    setLoading(false);
    requestAnimationFrame(() => {
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runSearch(query(), true);
    }
  }

  function toggleGroup(documentId: string): void {
    setExpandedGroups((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  }

  function closeContext(): void {
    setContext(undefined);
    setContextExpanded(false);
    setReaderQuery('');
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
            void runSearch(query(), true);
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
              <span class="keyboard-only">Автопоиск через 500 мс · Ctrl / ⌘ + Enter — сразу</span>
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
                <span>{loading() ? 'Ищем…' : 'Найти сейчас'}</span>
                <b aria-hidden="true">↵</b>
              </button>
            </div>
          </div>
        </form>

        <Show when={activeAnalysis()}>
          {(analysis) => (
            <section class="query-index" aria-label="Разбор запроса">
              <Show when={analysis().intent}>
                {(intent) => (
                  <div class="clinical-plan-card paper-card">
                    <strong>{INTENT_LABELS[intent().primary]}</strong>
                    <span>
                      Уверенность {Math.round(intent().confidence * 100)}% · результаты уже
                      показаны, уточнения не блокируют поиск.
                    </span>
                  </div>
                )}
              </Show>

              <Show when={analysis().suggestions.length > 0}>
                <div class="index-row suggestions-row">
                  <div class="index-label">
                    <span>Полезно уточнить</span>
                    <small>не блокирует диагнозы</small>
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

              <Show when={analysis().warnings.length > 0}>
                <div class="query-warning-list">
                  <For each={analysis().warnings}>{(warning) => <p>{warning}</p>}</For>
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
                <button
                  type="button"
                  onClick={() => {
                    updateQuery(example, false);
                    void runSearch(example, true);
                  }}
                >
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
                  {(group, groupIndex) => {
                    const expanded = () => expandedGroups().includes(group.documentId);
                    const visibleResults = () =>
                      expanded() ? group.results.slice(0, 5) : group.results.slice(0, 1);
                    return (
                      <section class="result-group" classList={{ expanded: expanded() }}>
                        <div class="result-group-header">
                          <button
                            class="result-group-header-button"
                            type="button"
                            aria-expanded={expanded()}
                            onClick={() => toggleGroup(group.documentId)}
                          >
                            <span class="file-number">
                              {String(groupIndex() + 1).padStart(2, '0')}
                            </span>
                            <div>
                              <small>ДОКУМЕНТ</small>
                              <strong>{group.title}</strong>
                              <p class="result-minimal-note">
                                {group.results[0]?.sectionPath.join(' / ') ??
                                  'Релевантный источник'}
                              </p>
                            </div>
                            <span class="group-count">{group.results.length} совп.</span>
                          </button>
                        </div>
                        <For each={visibleResults()}>
                          {(result) => {
                            const visual = CATEGORY_VISUALS[result.category];
                            return (
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
                                  <span class="result-category-line">
                                    <span
                                      class={`result-category-icon tone-${visual.tone}`}
                                      aria-hidden="true"
                                    >
                                      <ClinicalGlyph name={visual.icon} />
                                    </span>
                                    <span class={`category-stamp category-${result.category}`}>
                                      {CATEGORY_LABELS[result.category]}
                                    </span>
                                    <span class="result-path">
                                      {result.sectionPath.join(' / ')}
                                    </span>
                                  </span>
                                  <p>
                                    <HighlightedText
                                      text={result.snippet}
                                      ranges={result.highlightedRanges}
                                    />
                                  </p>
                                  <span class="result-link">Открыть точный источник →</span>
                                </button>
                              </article>
                            );
                          }}
                        </For>
                      </section>
                    );
                  }}
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
        <Show when={context()}>
          {(resolved) => (
            <>
              <div class="reader-toolbar">
                <strong>{resolved().document.shortTitle ?? resolved().document.title}</strong>
                <input
                  value={readerQuery()}
                  onInput={(event) => setReaderQuery(event.currentTarget.value)}
                  placeholder="Поиск в открытом фрагменте"
                  aria-label="Поиск в открытом источнике"
                />
                <button
                  class="reader-close"
                  type="button"
                  aria-label="Закрыть источник"
                  onClick={closeContext}
                >
                  <AppGlyph name="close" />
                </button>
              </div>

              <article class="reader-card paper-sheet" data-testid="reader-context">
                <header class="reader-header">
                  <div>
                    <p class="archive-kicker">В клинических рекомендациях</p>
                    <h2>{resolved().section.sectionPath.join(' / ')}</h2>
                  </div>
                  <span class="source-stamp">
                    ИСТОЧНИК
                    <br />
                    ЛОКАЛЬНЫЙ
                  </span>
                </header>

                <div class="document-text">
                  <For each={visibleContextChunks()}>
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
                  <Show when={readerQuery().trim() && visibleContextChunks().length === 0}>
                    <div class="reader-empty">
                      <p>В загруженном контексте совпадений нет.</p>
                    </div>
                  </Show>
                </div>

                <Show when={resolved().chunks.length > 1 && !readerQuery().trim()}>
                  <div class="source-context-toggle">
                    <button type="button" onClick={() => setContextExpanded((value) => !value)}>
                      {contextExpanded() ? 'Скрыть окружающий контекст' : 'Показать текст вокруг'}
                    </button>
                  </div>
                </Show>

                <div class="source-reader-actions">
                  <button
                    type="button"
                    onClick={() => openDocumentInArchive(resolved().document.id)}
                  >
                    Открыть полный документ
                  </button>
                  <small>
                    Редакция {resolved().document.versionLabel} · {resolved().document.status}
                  </small>
                </div>
              </article>
            </>
          )}
        </Show>
        <Show when={!context()}>
          <div class="reader-empty">
            <p class="archive-kicker">Контекст источника</p>
            <h2>{contextLoading() ? 'Открываем источник…' : 'Выберите результат'}</h2>
          </div>
        </Show>
      </aside>
    </section>
  );
}
