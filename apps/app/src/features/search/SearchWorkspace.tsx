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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { CATEGORY_VISUALS, ClinicalGlyph } from '@/components/ClinicalGlyph';
import { DocumentText } from '@/components/DocumentText';
import { HighlightedText } from '@/components/HighlightedText';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { resolveReadableDocumentId } from '@/features/library/document-display';
import { PersonalNoteMatches } from '@/features/notes/PersonalNoteMatches';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { SearchExamples } from '@/features/search/SearchExamples';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentInArchive } from '@/state/document-navigation';
import {
  appendSearchHistory,
  SEARCH_REPLAY_EVENT,
  type SearchReplayDetail,
} from '@/state/search-history';

/**
 * A minimal, core-agnostic view of a `GroundedMedicalCore`-style background enhancement, so this
 * component can upgrade its results in place without importing model-feature types directly.
 */
export interface SearchEnhancementState {
  readonly phase: 'running' | 'applied' | 'fallback';
  readonly query: string | null;
  readonly enhancedResponse: SearchResponse | null;
}

interface SearchWorkspaceProps {
  readonly core: MedicalCore;
  readonly scope: SearchScope;
  readonly searchAllowed?: boolean;
  readonly modePicker?: JSX.Element;
  readonly placeholder?: string;
  readonly examples?: readonly string[];
  readonly onAnalysis?: (analysis: QueryAnalysis) => void;
  /** Collapse to a single-line bar until focused or typed into; used when embedded above a scrollable list. */
  readonly compact?: boolean;
  /** Rendered between the search form and the results list — e.g. local-model assistant status. */
  readonly resultsHeader?: JSX.Element;
  /** Rendered in the query-actions row alongside "Очистить"/"Найти сейчас" — e.g. an AI-assist toggle. */
  readonly queryActionsExtra?: JSX.Element;
  /**
   * Reactive accessor for a background model enhancement of the current results. Deterministic
   * results are always shown first; when this reports a matching query and a reorder, it is
   * merged in place instead of blocking the initial render.
   */
  readonly enhancement?: () => SearchEnhancementState | undefined;
}

const EXAMPLES_BY_SCOPE: Readonly<Record<SearchScope, readonly string[]>> = {
  diagnosis: [
    'Ребёнок часто дышит и температурит второй день',
    'Боль справа внизу живота, тошнота и рвота',
    'Лихорадка без очага и рези при мочеиспускании',
  ],
  guidelines: [
    'Внебольничная пневмония у детей: диагностика и лечение',
    'Клинические рекомендации по острому аппендициту',
    'Тактика при анафилактическом шоке',
  ],
  medications: [
    'Цефтриаксон: показания и противопоказания',
    'Ибупрофен: официальная инструкция',
    'Осельтамивир: лекарственные формы и ограничения',
  ],
  legal: [
    'Порядок оказания медицинской помощи детям',
    'Информированное добровольное согласие',
    'Правила выписки рецептов на лекарственные препараты',
  ],
  all: [
    'Внебольничная пневмония у детей',
    'Цефтриаксон: официальная инструкция',
    'Порядок оказания медицинской помощи',
  ],
  personal: [
    'Напоминание о контрольном осмотре',
    'Мои записи о пневмонии',
    'Загруженная книга: лечение отита',
  ],
};

const SEARCH_QUERY_EMPTY_ERROR = 'Search query has no searchable terms.';

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

const CATEGORY_PATH_ALIASES: Readonly<Record<SearchResultCategory, readonly string[]>> = {
  overview: ['обзор', 'определение', 'классификация', 'введение'],
  'clinical-picture': ['клиника', 'клиническая картина', 'клинические проявления'],
  'differential-diagnosis': ['дифференциальный', 'дифференциальная диагностика'],
  diagnostics: ['диагностика', 'обследование'],
  treatment: ['лечение', 'терапия'],
  routing: ['маршрутизация', 'госпитализация', 'направление'],
  'follow-up': ['наблюдение', 'реабилитация', 'профилактика', 'диспансеризация'],
  other: [],
};

function normalizePathSegment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCategoryPathSegment(category: SearchResultCategory, segment: string): boolean {
  const normalized = normalizePathSegment(segment);
  const label = normalizePathSegment(CATEGORY_LABELS[category]);
  if (normalized === label || normalized.includes(label) || label.includes(normalized)) {
    return true;
  }
  return CATEGORY_PATH_ALIASES[category].some(
    (alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized),
  );
}

function supplementalSectionPath(
  category: SearchResultCategory,
  sectionPath: readonly string[],
): string | null {
  const extra = sectionPath.filter((segment) => !isCategoryPathSegment(category, segment));
  return extra.length > 0 ? extra.join(' / ') : null;
}

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
  diagnosis: 'Диагностический запрос',
  treatment: 'Тактика лечения',
  medication: 'Запрос о препарате',
  'disease-reference': 'Справка о заболевании',
  'care-guidance': 'Уход и профилактика',
  'administrative-reference': 'Нормативный запрос',
  mixed: 'Смешанный клинический запрос',
  unknown: 'Свободный медицинский запрос',
};

function resizeTextarea(element: HTMLTextAreaElement): void {
  const maxHeight = 260;
  element.style.height = 'auto';
  const contentHeight = Math.max(element.scrollHeight, 56);
  element.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  element.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
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
  const [focused, setFocused] = createSignal(false);
  const expanded = createMemo(() => !props.compact || focused() || query().length > 0);
  let textarea: HTMLTextAreaElement | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchGeneration = 0;
  // Last trimmed queries that completed, so whitespace-only edits skip the heavy work entirely.
  let lastSearchedQuery = '';
  let lastAnalyzedQuery = '';
  let searchWasAllowed = props.searchAllowed !== false;
  let activeScope = props.scope;

  const activeAnalysis = createMemo(() => {
    const searched = response();
    if (searched && searched.analysis.originalQuery === query().trim()) return searched.analysis;
    return draftAnalysis();
  });

  const resultCount = createMemo(
    () => response()?.groups.reduce((total, group) => total + group.results.length, 0) ?? 0,
  );
  const visibleGroups = createMemo(() => response()?.groups ?? []);

  const visibleContextChunks = createMemo(() => {
    const resolved = context();
    if (!resolved) return [];
    return resolved.chunks.filter((chunk) => chunk.id === resolved.focusChunkId);
  });

  createEffect(() => {
    const allowed = props.searchAllowed !== false;
    const scopeChanged = activeScope !== props.scope;
    activeScope = props.scope;
    if (allowed && (scopeChanged || !searchWasAllowed) && query().trim().length >= 2) {
      lastSearchedQuery = '';
      void runSearch(query(), false);
    }
    searchWasAllowed = allowed;
  });

  // Deterministic results render immediately; when a background model enhancement reports a
  // reorder for the query currently on screen, swap it in without re-running the search.
  createEffect(() => {
    const enhancement = props.enhancement?.();
    if (!enhancement?.enhancedResponse) return;
    if (enhancement.query !== response()?.analysis.originalQuery) return;
    setResponse(enhancement.enhancedResponse);
  });

  const aiRefining = createMemo(() => {
    const enhancement = props.enhancement?.();
    return Boolean(
      enhancement &&
        enhancement.phase === 'running' &&
        enhancement.query === response()?.analysis.originalQuery,
    );
  });

  createEffect(() => {
    if (expanded() && textarea) resizeTextarea(textarea);
  });

  const handleReplaySearch = (event: Event): void => {
    const replay = event as CustomEvent<SearchReplayDetail>;
    const replayQuery = replay.detail?.entry.query;
    if (!replayQuery?.trim() || replay.detail.entry.scope !== props.scope) return;
    updateQuery(replayQuery, false);
    if (replay.detail.cachedResponse) {
      lastSearchedQuery = replayQuery.trim();
      setResponse(replay.detail.cachedResponse);
      setDraftAnalysis(replay.detail.cachedResponse.analysis);
    }
    requestAnimationFrame(() => {
      if (textarea) resizeTextarea(textarea);
      void runSearch(replayQuery, false);
    });
  };

  const handleContentChanged = (): void => {
    setContext(undefined);
    setError(undefined);
    const trimmed = query().trim();
    if (trimmed) void runSearch(trimmed, false);
  };
  const handleReaderKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && context()) closeContext();
  };

  onMount(() => {
    window.addEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    window.addEventListener(CONTENT_CHANGED_EVENT, handleContentChanged);
    window.addEventListener('keydown', handleReaderKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    window.removeEventListener(CONTENT_CHANGED_EVENT, handleContentChanged);
    window.removeEventListener('keydown', handleReaderKeyDown);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (searchTimer) clearTimeout(searchTimer);
    searchGeneration += 1;
  });

  function scheduleAnalysis(value: string): void {
    if (analysisTimer) clearTimeout(analysisTimer);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      lastAnalyzedQuery = '';
      setDraftAnalysis(undefined);
      setAnalysisLoading(false);
      return;
    }
    // The "Разбор запроса" panel (facts, suggestions, intent) is a clinical-case-parsing feature.
    // A drug-name lookup in the medications scope has no use for it, and running the clinical NLP
    // pipeline here duplicates the analysis search() already does internally — pure wasted latency
    // between the doctor typing and the medication results appearing.
    if (props.scope === 'medications') {
      lastAnalyzedQuery = '';
      setDraftAnalysis(undefined);
      setAnalysisLoading(false);
      return;
    }
    // Whitespace-only edits (a trailing space, a newline) must not re-run the analyzer.
    if (trimmed === lastAnalyzedQuery) return;

    setAnalysisLoading(true);
    analysisTimer = setTimeout(async () => {
      const result = await props.core.analyzeQuery({ query: trimmed, includeSuggestions: true });
      if (query().trim() !== trimmed) return;
      setAnalysisLoading(false);
      if (result.ok) {
        lastAnalyzedQuery = trimmed;
        setDraftAnalysis(result.value);
        props.onAnalysis?.(result.value);
      }
    }, 180);
  }

  function scheduleSearch(value: string): void {
    if (searchTimer) clearTimeout(searchTimer);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      searchGeneration += 1;
      lastSearchedQuery = '';
      setResponse(undefined);
      setLoading(false);
      return;
    }
    // A trailing space used to schedule a full second search for the identical query — the whole
    // FTS5 + vector pass ran again on the main thread just to produce the same results.
    if (trimmed === lastSearchedQuery) return;
    searchTimer = setTimeout(() => void runSearch(trimmed, false), 500);
  }

  function updateQuery(value: string, debounce = true): void {
    setQuery(value);
    if (response()?.analysis.originalQuery !== value.trim()) {
      setResponse(undefined);
      setContext(undefined);
    }
    scheduleAnalysis(value);
    if (debounce) scheduleSearch(value);
  }

  async function runSearch(nextQuery = query(), recordHistory = true): Promise<void> {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;
    if (props.searchAllowed === false) {
      setLoading(false);
      return;
    }
    if (searchTimer) clearTimeout(searchTimer);

    const generation = ++searchGeneration;
    // Search normalizes its own input; writing the trimmed text back into the field deleted the
    // space or newline the doctor had just typed mid-sentence.
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

    if (generation !== searchGeneration || query().trim() !== trimmed) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    lastSearchedQuery = trimmed;
    setResponse(result.value);
    setDraftAnalysis(result.value.analysis);
    if (recordHistory) appendSearchHistory(trimmed, props.scope, result.value);
  }

  async function openResult(result: SearchResult): Promise<void> {
    setContextLoading(true);
    setError(undefined);
    const resolved = await props.core.getSearchResultContext(result, 3);
    setContextLoading(false);
    if (!resolved.ok) {
      const documents = await props.core.listDocuments();
      const documentId =
        documents.ok && documents.value.length > 0
          ? resolveReadableDocumentId(
              result.documentId,
              new Set(documents.value.map((document) => document.id)),
            )
          : result.documentId;
      openDocumentInArchive(documentId, result.anchor);
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
    lastSearchedQuery = '';
    lastAnalyzedQuery = '';
    setQuery('');
    setDraftAnalysis(undefined);
    setResponse(undefined);
    setContext(undefined);
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

  function closeContext(): void {
    setContext(undefined);
  }

  function searchReference(reference: string): void {
    closeContext();
    updateQuery(reference, false);
    void runSearch(reference, true);
  }

  return (
    <section
      class="workspace archive-desk"
      classList={{
        'workspace-compact': props.compact ?? false,
        'workspace-expanded': expanded(),
      }}
      aria-label="Локальный медицинский поиск"
    >
      <div
        class="search-column case-folder"
        classList={{ 'has-search-content': query().length > 0 }}
      >
        {/* The page heading lives in SearchHome; repeating a second hero here doubled the height
            a doctor scrolls past before the first result. */}
        <form
          class="query-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch(query(), true);
          }}
        >
          <Show when={expanded()}>
            <div class="query-actions query-mode-actions">
              <HorizontalScroller
                class="query-shortcuts"
                controls
                hideScrollbar
                controlLabel="режимы поиска"
              >
                {props.modePicker}
              </HorizontalScroller>
            </div>
          </Show>
          <label class="sr-only" for="clinical-query">
            Поисковый запрос
          </label>
          <textarea
            ref={(element) => {
              textarea = element;
              if (!props.compact) resizeTextarea(element);
            }}
            id="clinical-query"
            data-testid="search-input"
            data-search-focus-target="true"
            value={query()}
            onInput={(event) => {
              updateQuery(event.currentTarget.value);
              resizeTextarea(event.currentTarget);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              props.placeholder ?? 'Например: 5 лет, мальчик, второй день кашляет и температурит…'
            }
            disabled={props.searchAllowed === false}
            maxlength={20_000}
            autocomplete="off"
            autocapitalize="sentences"
            spellcheck={false}
          />
          <Show when={expanded()}>
            <div class="query-actions">
              <Show when={query().length > 16_000}>
                <strong class="query-character-count">
                  {query().length.toLocaleString('ru-RU')} / 20 000
                </strong>
              </Show>
              <div class="query-buttons">
                {props.queryActionsExtra}
                <Show when={query().length > 0}>
                  <button class="text-button clear-query-button" type="button" onClick={clearQuery}>
                    <AppGlyph name="trash" />
                    <span>Очистить</span>
                  </button>
                </Show>
                <div
                  class="search-submit-reveal"
                  classList={{ visible: props.searchAllowed !== false }}
                  aria-hidden={props.searchAllowed === false}
                >
                  <div
                    class="search-submit-reveal__content"
                    classList={{
                      'search-submit-reveal__content--visible': props.searchAllowed !== false,
                    }}
                  >
                    <button
                      class="search-button"
                      data-testid="search-submit"
                      data-haptic="medium"
                      type="submit"
                      tabindex={props.searchAllowed === false ? -1 : undefined}
                      disabled={loading() || props.searchAllowed === false}
                    >
                      <span>{loading() ? 'Ищем…' : 'Найти сейчас'}</span>
                      <b aria-hidden="true">↵</b>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Show>
        </form>

        <Show when={activeAnalysis()}>
          {(analysis) => (
            <section class="query-index" aria-label="Разбор запроса">
              <Show when={analysis().suggestions.length > 0}>
                <div class="index-row suggestions-row query-index__suggestions">
                  <div class="index-label query-index__label">
                    <span>Полезно уточнить</span>
                    <small class="index-label__hint">не блокирует диагнозы</small>
                  </div>
                  <div class="suggestion-strip">
                    <For each={analysis().suggestions}>
                      {(suggestion) => (
                        <button
                          class="suggestion-strip__button"
                          type="button"
                          title={suggestion.detail}
                          onClick={() => insertSuggestion(suggestion)}
                        >
                          <span class="suggestion-strip__marker">+</span> {suggestion.label}
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
                <Show when={response()}>
                  {(searchResponse) => (
                    <div
                      class="result-summary result-summary--analysis"
                      classList={{ 'results-refreshing': loading() }}
                    >
                      <div class="result-summary__cell">
                        <span class="result-summary__label">РЕЗУЛЬТАТЫ</span>
                        <strong class="result-summary__value">{resultCount()} фрагментов</strong>
                      </div>
                      <div class="result-summary__cell">
                        <span class="result-summary__label">ДОКУМЕНТЫ</span>
                        <strong class="result-summary__value">
                          {searchResponse().groups.length}
                        </strong>
                      </div>
                      <div class="result-summary__cell">
                        <span class="result-summary__label">ВРЕМЯ</span>
                        <strong class="result-summary__value">
                          {searchResponse().elapsedMs.toFixed(1)} мс
                        </strong>
                      </div>
                      <div class="result-summary__cell">
                        <span class="result-summary__label">РЕЖИМ</span>
                        <strong class="result-summary__value" data-testid="search-mode">
                          {SEARCH_MODE_LABELS[searchResponse().modeUsed]}
                        </strong>
                      </div>
                    </div>
                  )}
                </Show>
                <div class="fact-strip">
                  <Show when={analysis().intent}>
                    {(intent) => (
                      <span
                        class="fact-tag query-mode-tag"
                        title={`Уверенность ${Math.round(intent().confidence * 100)}%`}
                      >
                        <small class="fact-tag__label">режим поиска</small>
                        {INTENT_LABELS[intent().primary]}
                      </span>
                    )}
                  </Show>
                  <For each={analysis().facts}>
                    {(fact) => (
                      <span
                        class="fact-tag"
                        classList={{
                          negative: fact.polarity === 'negative',
                          'fact-tag--negative': fact.polarity === 'negative',
                        }}
                        title={fact.label}
                      >
                        <small class="fact-tag__label">{FACT_LABELS[fact.kind]}</small>
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

        {props.resultsHeader}

        <Show when={props.searchAllowed !== false && !response() && query().length === 0}>
          <SearchExamples
            examples={props.examples ?? EXAMPLES_BY_SCOPE[props.scope]}
            onSelect={(example) => {
              updateQuery(example, false);
              void runSearch(example, true);
            }}
          />
        </Show>

        <Show when={loading() && !response() && props.scope !== 'personal'}>
          <div class="search-results-skeleton" role="status" aria-label="Loading search results">
            <For each={[0, 1, 2]}>
              {() => (
                <div class="search-results-skeleton__row">
                  <span class="search-results-skeleton__marker" aria-hidden="true" />
                  <div class="search-results-skeleton__copy">
                    <span class="search-results-skeleton__line search-results-skeleton__line--long" />
                    <span class="search-results-skeleton__line" />
                  </div>
                  <span class="search-results-skeleton__tail" aria-hidden="true" />
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={error() === SEARCH_QUERY_EMPTY_ERROR}>
          <div class="search-empty-state paper-card" role="status">
            <AppGlyph name="binoculars" class="search-empty-state__icon" />
            <p class="search-empty-state__text">
              Search has not enough data, please provide more info
            </p>
          </div>
        </Show>
        <Show when={error() && error() !== SEARCH_QUERY_EMPTY_ERROR}>
          {(message) => <div class="error-card">{message()}</div>}
        </Show>

        <Show when={response()}>
          {(_searchResponse) => (
            <>
              <Show when={loading() && props.scope !== 'personal'}>
                <div class="results-refreshing-note" role="status">
                  Обновляем результаты по установленным документам…
                </div>
              </Show>

              <PersonalNoteMatches query={query()} scope={props.scope} />

              <Show when={props.scope !== 'personal'}>
                <div
                  class="results-list"
                  classList={{ 'results-refreshing': loading() }}
                  data-testid="search-results"
                >
                  <LayoutVirtualizedGrid data={visibleGroups()} bufferSize={400}>
                    {(group, groupIndex) => (
                      <section class="result-group">
                        <button
                          type="button"
                          class="result-group-header"
                          onClick={() => openDocumentInArchive(group.documentId)}
                        >
                          <span class="result-group-header__index" aria-hidden="true">
                            {String(groupIndex + 1).padStart(2, '0')}
                          </span>
                          <span class="result-group-header__body">
                            <strong class="result-group-header__title">{group.title}</strong>
                            <span class="result-group-header__note result-minimal-note">
                              {group.results[0]?.sectionPath.join(' / ') ?? 'Релевантный источник'}
                            </span>
                          </span>
                        </button>
                        <div class="result-group__snippets">
                          <For each={group.results}>
                            {(result) => {
                              const visual = CATEGORY_VISUALS[result.category];
                              const pathSuffix = supplementalSectionPath(
                                result.category,
                                result.sectionPath,
                              );
                              return (
                                <article
                                  class="result-card"
                                  classList={{
                                    selected: context()?.focusChunkId === result.chunkId,
                                  }}
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
                                      <span class={`category-stamp tone-${visual.tone}`}>
                                        {CATEGORY_LABELS[result.category]}
                                      </span>
                                      <Show when={pathSuffix}>
                                        <span class="result-path">{pathSuffix}</span>
                                      </Show>
                                    </span>
                                    <p class="result-snippet">
                                      <HighlightedText
                                        text={result.snippet}
                                        ranges={result.highlightedRanges}
                                      />
                                    </p>
                                  </button>
                                </article>
                              );
                            }}
                          </For>
                        </div>
                      </section>
                    )}
                  </LayoutVirtualizedGrid>
                </div>
              </Show>
              <Show when={aiRefining()}>
                <div
                  class="search-results-skeleton search-results-skeleton--inline"
                  role="status"
                  aria-label="Локальная модель уточняет порядок источников"
                >
                  <div class="search-results-skeleton__row">
                    <span class="search-results-skeleton__marker" aria-hidden="true" />
                    <div class="search-results-skeleton__copy">
                      <span class="search-results-skeleton__line search-results-skeleton__line--long" />
                      <span class="search-results-skeleton__line" />
                    </div>
                    <span class="search-results-skeleton__tail" aria-hidden="true" />
                  </div>
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>

      <Show when={context() || contextLoading()}>
        <Portal>
          <aside
            class="reader-column source-folder open"
            role="dialog"
            aria-modal="true"
            aria-label="Фрагмент источника"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) closeContext();
            }}
          >
            <Show
              when={context()}
              fallback={
                <article class="reader-card paper-card">
                  <div class="reader-empty">
                    <p class="archive-kicker">Контекст источника</p>
                    <h2>Открываем источник…</h2>
                  </div>
                </article>
              }
            >
              {(resolved) => (
                <article class="reader-card paper-card" data-testid="reader-context">
                  <header class="reader-header">
                    <div class="reader-header__content">
                      <p class="archive-kicker">В клинических рекомендациях</p>
                      <h2 class="reader-header__title">{resolved().document.title}</h2>
                    </div>
                    <div class="reader-header__actions">
                      <Button
                        class="reader-header__open-document"
                        variant="primary"
                        type="button"
                        onClick={() => {
                          closeContext();
                          openDocumentInArchive(resolved().document.id);
                        }}
                      >
                        Открыть полный документ
                      </Button>
                      <button
                        class="reader-header__close"
                        type="button"
                        aria-label="Закрыть источник"
                        onClick={closeContext}
                      >
                        <AppGlyph name="close" class="reader-header__close-icon" />
                      </button>
                    </div>
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
                          <DocumentText
                            text={chunk.originalText}
                            paragraphClass="document-text__paragraph"
                            onReference={searchReference}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </article>
              )}
            </Show>
          </aside>
        </Portal>
      </Show>

      <Show when={aiRefining()}>
        <div class="ai-refine-toast" role="status" aria-live="polite">
          <span class="ai-refine-toast__spinner" aria-hidden="true" />
          Локальная модель уточняет порядок источников…
        </div>
      </Show>
    </section>
  );
}
