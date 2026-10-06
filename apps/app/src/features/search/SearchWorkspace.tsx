import { Popover } from '@kobalte/core/popover';
import type {
  ChunkContext,
  MedicalCore,
  MedicalDocumentSummary,
  QueryAnalysis,
  QueryFact,
  SearchFilters,
  SearchResponse,
  SearchResult,
  SearchResultGroup,
  SearchSuggestion,
} from '@localmed/contracts';
import {
  children,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  lazy,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DocumentText } from '@/components/DocumentText';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { QueryEmptyState } from '@/components/QueryEmptyState';
import { saveCalculatorLaunchDraft } from '@/features/calculators/calculator-launch-draft';
import {
  CALCULATOR_PACKS_EVENT,
  loadCalculatorInstallationState,
  setDatabaseCalculatorIds,
} from '@/features/calculators/calculator-packs';
import {
  clearDownloadedCalculators,
  getCalculatorRegistry,
  registerDownloadedCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';
import { ComparisonSuggestionCard } from '@/features/drug-comparison/ComparisonSuggestionCard';
import { parseComparisonQuery } from '@/features/drug-comparison/comparison-query';
import { InteractionSuggestionCard } from '@/features/drug-interactions/InteractionSuggestionCard';
import { parseInteractionQuery } from '@/features/drug-interactions/interaction-query';
import { resolveReadableDocumentId } from '@/features/library/document-display';
import {
  buildDocumentLinkPhrases,
  createDocumentLinkMatcher,
} from '@/features/library/document-medication-links';
import { MedicationSafetyCard } from '@/features/medication-safety/MedicationSafetyCard';
import { parseSafetyQuery } from '@/features/medication-safety/safety-query';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { PersonalNoteMatches } from '@/features/notes/PersonalNoteMatches';
import { CalculatorSuggestionCard } from '@/features/search/CalculatorSuggestionCard';
import { ClinicalAnalysisNote } from '@/features/search/ClinicalAnalysisNote';
import { CoreIdentityMatches } from '@/features/search/CoreIdentityMatches';
import {
  type CalculatorSchemaWithSearch,
  resolveCalculatorSuggestion,
} from '@/features/search/calculator-suggestion';
import {
  calculatorToolTrigger,
  parseCalculatorToolMention,
  replaceCalculatorToolTrigger,
} from '@/features/search/calculator-tool-mention';
import { type SearchScope, searchModeForScope } from '@/features/search/ScopedMedicalCore';
import { SearchExamples } from '@/features/search/SearchExamples';
import { type SearchMeaning, SearchMeaningChoices } from '@/features/search/SearchMeaningChoices';
import { SearchResultGroupCard } from '@/features/search/SearchResultGroupCard';
import { SearchResultsSkeleton } from '@/features/search/SearchResultsSkeleton';
import { createLingeringFlag } from '@/features/search/search-skeleton';
import '@/features/search/search-results-skeleton.css';
import { pluralRu } from '@/i18n/labels';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentInArchive } from '@/state/document-navigation';
import { motionMs } from '@/state/motion';
import {
  appendSearchHistory,
  SEARCH_REPLAY_EVENT,
  type SearchReplayDetail,
} from '@/state/search-history';

type ClinicalEditionsModule = typeof import('@/features/modules/clinical-editions');

interface SearchWorkspaceProps {
  /** Absent while the medical core opens; the field stays disabled until it arrives. */
  readonly core?: MedicalCore | undefined;
  readonly referenceCore?: MedicalCore | undefined;
  readonly onContentChanged?: () => Promise<void>;
  readonly scope: SearchScope;
  readonly searchAllowed?: boolean;
  /** Compact status under the field, e.g. while the core opens, downloads or failed to open. */
  readonly fieldStatus?: JSX.Element;
  readonly modePicker?: JSX.Element;
  readonly catalog?: JSX.Element;
  readonly catalogOnly?: boolean;
  readonly specialty?: string | undefined;
  readonly catalogResultCount?: number;
  readonly showExamples?: boolean;
  /** Greeting and shortcuts shown above an empty query; collapses once the user searches. */
  /** Receives the field's form, so the page can offer a way back to it once it scrolls away. */
  readonly onFieldElement?: (form: HTMLFormElement) => void;
  /** Empty-field content under the field (tools, capabilities); folds away once a search starts. */
  readonly intro?: JSX.Element;
  /** Document ids of the current result groups, e.g. to centre the knowledge graph on them. */
  readonly onResultDocuments?: (documentIds: readonly string[]) => void;
  readonly filters?: SearchFilters;
  readonly onQueryChange?: (query: string) => void;
  readonly placeholder?: string;
  readonly examples?: readonly string[];
  readonly onAnalysis?: (analysis: QueryAnalysis) => void;
  /** Collapse to a single-line bar until focused or typed into; used when embedded above a scrollable list. */
  readonly compact?: boolean;
  /** Next steps shown when a completed search has no document groups. */
  readonly emptyResults?: (query: string) => JSX.Element;
  /** Per-group action, e.g. downloading the full text behind a source pointer. */
  readonly groupAction?: (group: SearchResultGroup) => JSX.Element;
}

const SearchInlineCalculatorWorkspace = lazy(async () => {
  const calculatorModule = await import('@/features/calculators/CalculatorsView');
  return { default: calculatorModule.InlineCalculatorWorkspace };
});

const EXAMPLES_BY_SCOPE: Readonly<Record<SearchScope, readonly string[]>> = {
  conditions: ['J18', 'Головная боль', 'Отёк'],
  calculators: [],
  assessments: [],
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

function installedCalculatorSchemas(): readonly CalculatorSchemaWithSearch[] {
  const registry = getCalculatorRegistry();
  const installedIds = loadCalculatorInstallationState(registry).installedIds;
  return registry
    .filter((definition) => definition.state === 'available' && installedIds.has(definition.id))
    .map((definition) => getCalculatorSchema(definition.id))
    .filter((schema): schema is CalculatorSchemaWithSearch => schema !== undefined);
}

let downloadedCalculatorRefresh: Promise<void> | undefined;

function refreshDownloadedCalculatorDefinitions(): Promise<void> {
  if (downloadedCalculatorRefresh) return downloadedCalculatorRefresh;
  downloadedCalculatorRefresh = (async () => {
    const runtime = getContentModuleRuntime(await loadModuleCatalog());
    await runtime.whenLocalPackagedModulesReady();
    const definitions = await runtime.listInstalledToolDefinitions();
    clearDownloadedCalculators();
    definitions.forEach(registerDownloadedCalculator);
    setDatabaseCalculatorIds(
      definitions
        .filter((definition) => definition.kind === 'calculator')
        .map((definition) => definition.id),
    );
  })().finally(() => {
    downloadedCalculatorRefresh = undefined;
  });
  return downloadedCalculatorRefresh;
}

export function SearchWorkspace(props: SearchWorkspaceProps): JSX.Element {
  // Resolved once: reading the slot twice (class and content) would build two pickers and
  // rebuild the visible one, closing its open menu, whenever the class is re-evaluated.
  const modePicker = children(() => props.modePicker);
  const [query, setQuery] = createSignal('');
  const [draftAnalysis, setDraftAnalysis] = createSignal<QueryAnalysis>();
  const [response, setResponse] = createSignal<SearchResponse>();
  const [context, setContext] = createSignal<ChunkContext>();
  const [contextDocuments, setContextDocuments] = createSignal<readonly MedicalDocumentSummary[]>(
    [],
  );
  const contextDocumentsById = createMemo(
    () => new Map(contextDocuments().map((document) => [document.id, document])),
  );
  const contextLinkMatcher = createMemo(() =>
    createDocumentLinkMatcher(
      buildDocumentLinkPhrases(context() ? contextDocuments() : [], context()?.document.id),
    ),
  );
  const queryLinkMatcher = createMemo(() =>
    createDocumentLinkMatcher(buildDocumentLinkPhrases(contextDocuments())),
  );
  const ambiguousMeanings = createMemo((): readonly SearchMeaning[] => [
    ...new Map(
      queryLinkMatcher()
        .segment(response()?.analysis.originalQuery ?? '')
        .flatMap((segment): [string, SearchMeaning][] =>
          segment.kind === 'link' && segment.alternatives && segment.alternatives.length > 1
            ? [[segment.value, { phrase: segment.value, alternatives: segment.alternatives }]]
            : [],
        ),
    ).values(),
  ]);
  const [loading, setLoading] = createSignal(false);
  // A typed query waits 500 ms before it searches; the skeleton shows through that wait too.
  const [searchQueued, setSearchQueued] = createSignal(false);
  const [analysisLoading, setAnalysisLoading] = createSignal(false);
  const [contextLoading, setContextLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [focused, setFocused] = createSignal(false);
  const [toolPickerOpen, setToolPickerOpen] = createSignal(false);
  const [toolPickerQuery, setToolPickerQuery] = createSignal('');
  const [toolPickerActive, setToolPickerActive] = createSignal(0);
  const [calculatorPacksRevision, setCalculatorPacksRevision] = createSignal(0);
  const [requestedInlineCalculator, setRequestedInlineCalculator] = createSignal<{
    readonly id: string;
    readonly values: Readonly<Record<string, string | number>>;
  }>();
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
  const sectionState = new Map<
    SearchScope,
    {
      query: string;
      response: SearchResponse | undefined;
      scrollTop: number;
    }
  >();

  createEffect(() => props.onQueryChange?.(query()));
  createEffect(() => props.onResultDocuments?.(visibleGroups().map((group) => group.documentId)));

  createEffect(
    on(
      () => [props.filters, props.catalogOnly] as const,
      () => {
        lastSearchedQuery = '';
        if (query().trim()) scheduleSearch(query());
      },
      { defer: true },
    ),
  );

  const installedCalculatorDefinitions = createMemo(() => {
    calculatorPacksRevision();
    const registry = getCalculatorRegistry();
    const installedIds = loadCalculatorInstallationState(registry).installedIds;
    return registry.filter(
      (definition): definition is AvailableCalculatorDefinition =>
        definition.state === 'available' && installedIds.has(definition.id),
    );
  });
  const parsedToolMention = createMemo(() =>
    parseCalculatorToolMention(query(), installedCalculatorDefinitions()),
  );
  const searchableQuery = (value: string): string =>
    parseCalculatorToolMention(value, installedCalculatorDefinitions()).query;
  const explicitCalculator = createMemo(() =>
    installedCalculatorDefinitions().find(
      (definition) => definition.id === parsedToolMention().calculatorId,
    ),
  );
  const toolSuggestions = createMemo(() => {
    const installedIds = new Set(
      installedCalculatorDefinitions().map((definition) => definition.id),
    );
    return searchCalculators(toolPickerQuery())
      .filter(
        (definition): definition is AvailableCalculatorDefinition =>
          definition.state === 'available' && installedIds.has(definition.id),
      )
      .slice(0, 8);
  });

  const activeAnalysis = createMemo(() => {
    const searched = response();
    if (searched && searched.analysis.originalQuery === searchableQuery(query())) {
      return searched.analysis;
    }
    return draftAnalysis();
  });

  // The skeleton stands in for the groups from the first frame of a search (typed or submitted)
  // until the response, an error or an empty query replaces it.
  const resultsPending = createMemo(
    () =>
      props.scope !== 'personal' &&
      !props.catalogOnly &&
      !response() &&
      !error() &&
      (loading() || searchQueued()),
  );
  const skeletonMounted = createLingeringFlag(resultsPending, () => motionMs(180));

  // Clinical recommendation editions: a replaced edition shares its successor's title, so results
  // keep only the newest edition found. The edition sidecar (~60 kB gzip) loads after the page,
  // off the start-up path; until then results show as the core returned them.
  const [editions, setEditions] = createSignal<ClinicalEditionsModule>();
  onMount(() => {
    void import('@/features/modules/clinical-editions')
      .then((module) => setEditions(() => module))
      .catch((cause: unknown) => {
        console.error(
          `Clinical edition list did not load: ${cause instanceof Error ? cause.name : 'unknown'}`,
        );
      });
  });
  const visibleGroups = createMemo(() => {
    const groups = response()?.groups ?? [];
    const module = editions();
    if (!module) return groups;
    const documents = contextDocumentsById();
    return module.withoutOlderEditions(groups, (group) => {
      // A catalog pointer names the full record it stands for; the edition is in that id.
      const target = documents.get(group.documentId)?.metadata?.['targetDocumentId'];
      return module.clinicalEditionIdFromDocumentId(
        typeof target === 'string' ? target : group.documentId,
      );
    });
  });
  const resultCount = createMemo(() =>
    visibleGroups().reduce((total, group) => total + group.results.length, 0),
  );
  const visibleIdentities = createMemo(() =>
    (response()?.identities ?? []).filter((hit) => {
      const target = hit.target;
      if (target.type !== 'document') return true;
      const local = contextDocumentsById().get(target.documentId);
      return (
        local?.versionId !== target.documentVersionId ||
        local.sourceChecksum !== target.sourceChecksum ||
        !visibleGroups().some((group) => group.documentId === target.documentId)
      );
    }),
  );

  const calculatorSchemas = createMemo(() => {
    calculatorPacksRevision();
    return installedCalculatorSchemas();
  });
  // «варфарин взаимодействие с ибупрофеном»: the interaction tool opens with those drugs. Read from
  // the query the shown results were searched for, in the sections that hold drugs.
  const interactionQuery = createMemo(() => {
    const searched = response();
    if (!searched || (props.scope !== 'all' && props.scope !== 'medications')) return null;
    return parseInteractionQuery(searched.analysis.originalQuery);
  });
  // «ибупрофен или парацетамол», «чем отличается X от Y»: the comparison tool opens with those drugs.
  const comparisonQuery = createMemo(() => {
    const searched = response();
    if (!searched || (props.scope !== 'all' && props.scope !== 'medications')) return null;
    return parseComparisonQuery(searched.analysis.originalQuery);
  });
  // «ибупрофен при беременности», «X ребёнку 3 лет»: the instruction's own sentences on the topic.
  const safetyQuery = createMemo(() => {
    const searched = response();
    if (!searched || (props.scope !== 'all' && props.scope !== 'medications')) return null;
    return parseSafetyQuery(searched.analysis.originalQuery);
  });
  const calculatorSuggestion = createMemo(() => {
    const searched = response();
    if (
      explicitCalculator() ||
      !searched ||
      props.scope === 'personal' ||
      props.scope === 'legal'
    ) {
      return undefined;
    }
    return resolveCalculatorSuggestion(searched.analysis, calculatorSchemas());
  });
  const explicitCalculatorDraft = createMemo(() => {
    const calculator = explicitCalculator();
    const analysis = activeAnalysis();
    if (!calculator || !analysis) return {};
    const suggestion = resolveCalculatorSuggestion(analysis, calculatorSchemas());
    return (
      suggestion?.candidates.find((candidate) => candidate.calculatorId === calculator.id)
        ?.draftInputs ?? {}
    );
  });
  const inlineCalculatorDefinition = createMemo(
    () =>
      explicitCalculator() ??
      installedCalculatorDefinitions().find(
        (definition) => definition.id === requestedInlineCalculator()?.id,
      ),
  );
  const inlineCalculatorValues = createMemo(() =>
    explicitCalculator() ? explicitCalculatorDraft() : (requestedInlineCalculator()?.values ?? {}),
  );

  const visibleContextChunks = createMemo(() => {
    const resolved = context();
    if (!resolved) return [];
    return resolved.chunks.filter((chunk) => chunk.id === resolved.focusChunkId);
  });

  createEffect(() => {
    const allowed = props.searchAllowed !== false;
    const scopeChanged = activeScope !== props.scope;
    if (scopeChanged) {
      const previousScope = activeScope;
      sectionState.set(previousScope, {
        query: query(),
        response: response(),
        scrollTop: window.scrollY,
      });
      const saved = sectionState.get(props.scope);
      const clinicalToggle =
        (previousScope === 'all' && props.scope === 'diagnosis') ||
        (previousScope === 'diagnosis' && props.scope === 'all');
      activeScope = props.scope;
      searchGeneration += 1;
      if (searchTimer) clearTimeout(searchTimer);
      setSearchQueued(false);
      if (analysisTimer) clearTimeout(analysisTimer);
      setQuery(saved?.query ?? (clinicalToggle ? query() : ''));
      setResponse(saved?.response);
      setDraftAnalysis(saved?.response?.analysis);
      setContext(undefined);
      setLoading(false);
      setError(undefined);
      lastAnalyzedQuery = '';
      scheduleAnalysis(query());
      // Opening a section from the list and returning to it is a page change: SearchHome keeps the
      // list's scroll and starts the section at the top, so only the other switches restore here.
      const pageChange = !clinicalToggle && (previousScope === 'all' || props.scope === 'all');
      if (!pageChange)
        requestAnimationFrame(() =>
          window.scrollTo({ top: saved?.scrollTop ?? 0, behavior: 'instant' }),
        );
    }
    activeScope = props.scope;
    const trimmed = searchableQuery(query());
    if (allowed && trimmed.length >= 2) {
      const cached = response();
      const hasMatchingCache = Boolean(cached && cached.analysis.originalQuery === trimmed);
      if (hasMatchingCache) {
        lastSearchedQuery = trimmed;
      } else if (scopeChanged || !searchWasAllowed) {
        lastSearchedQuery = '';
        scheduleSearch(query());
      }
    }
    searchWasAllowed = allowed;
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
      lastSearchedQuery = searchableQuery(replayQuery);
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
    setContextDocuments([]);
    setError(undefined);
    const trimmed = query().trim();
    if (trimmed) void runSearch(trimmed, false);
  };
  const handleCalculatorPacksChanged = (): void => {
    setCalculatorPacksRevision((revision) => revision + 1);
  };
  const showCalculatorInline = (
    calculatorId: string,
    values: Readonly<Record<string, string | number>>,
  ): void => {
    if (!installedCalculatorDefinitions().some((definition) => definition.id === calculatorId)) {
      return;
    }
    setRequestedInlineCalculator({ id: calculatorId, values });
  };
  const openCalculatorPage = (
    calculatorId: string,
    values: Readonly<Record<string, string | number>>,
  ): void => {
    const definition = installedCalculatorDefinitions().find(
      (candidate) => candidate.id === calculatorId,
    );
    if (!definition) return;
    saveCalculatorLaunchDraft(calculatorId, values);
    window.location.hash = `#/calculators/${definition.slug}`;
  };
  const handleReaderKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && context()) closeContext();
  };

  onMount(() => {
    void refreshDownloadedCalculatorDefinitions()
      .then(handleCalculatorPacksChanged)
      .catch((cause: unknown) => {
        console.warn(
          'Installed calculator definitions are unavailable for search suggestions.',
          cause,
        );
      });
    window.addEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    window.addEventListener(CONTENT_CHANGED_EVENT, handleContentChanged);
    window.addEventListener(CALCULATOR_PACKS_EVENT, handleCalculatorPacksChanged);
    window.addEventListener('keydown', handleReaderKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener(SEARCH_REPLAY_EVENT, handleReplaySearch);
    window.removeEventListener(CONTENT_CHANGED_EVENT, handleContentChanged);
    window.removeEventListener(CALCULATOR_PACKS_EVENT, handleCalculatorPacksChanged);
    window.removeEventListener('keydown', handleReaderKeyDown);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (searchTimer) clearTimeout(searchTimer);
    searchGeneration += 1;
  });

  function scheduleAnalysis(value: string): void {
    if (analysisTimer) clearTimeout(analysisTimer);
    const trimmed = searchableQuery(value);
    if (trimmed.length < 2) {
      lastAnalyzedQuery = '';
      setDraftAnalysis(undefined);
      setAnalysisLoading(false);
      return;
    }
    // Clinical parsing is opt-in; ordinary source lookup never schedules the analyzer.
    if (props.scope !== 'diagnosis') {
      lastAnalyzedQuery = '';
      setDraftAnalysis(undefined);
      setAnalysisLoading(false);
      return;
    }
    // Whitespace-only edits (a trailing space, a newline) must not re-run the analyzer.
    if (trimmed === lastAnalyzedQuery) return;

    setAnalysisLoading(true);
    const core = props.core;
    if (!core) {
      setAnalysisLoading(false);
      return;
    }
    analysisTimer = setTimeout(async () => {
      const result = await core.analyzeQuery({ query: trimmed, includeSuggestions: true });
      if (searchableQuery(query()) !== trimmed) return;
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
    const trimmed = searchableQuery(value);
    if (trimmed.length < 2) {
      searchGeneration += 1;
      lastSearchedQuery = '';
      setResponse(undefined);
      setLoading(false);
      setSearchQueued(false);
      return;
    }
    // A trailing space used to schedule a full second search for the identical query — the whole
    // FTS5 + vector pass ran again on the main thread just to produce the same results.
    if (trimmed === lastSearchedQuery) {
      setSearchQueued(false);
      return;
    }
    setSearchQueued(true);
    searchTimer = setTimeout(() => void runSearch(trimmed, false), 500);
  }

  function updateQuery(value: string, debounce = true): void {
    if (searchableQuery(value) !== searchableQuery(query())) setRequestedInlineCalculator();
    setQuery(value);
    if (response()?.analysis.originalQuery !== searchableQuery(value)) {
      setResponse(undefined);
      setContext(undefined);
    }
    scheduleAnalysis(value);
    if (debounce) scheduleSearch(value);
  }

  async function runSearch(nextQuery = query(), recordHistory = true): Promise<void> {
    const rawQuery = nextQuery.trim();
    const trimmed = searchableQuery(nextQuery);
    setSearchQueued(false);
    if (props.catalogOnly) {
      if (recordHistory && rawQuery)
        appendSearchHistory(rawQuery, props.scope, props.catalogResultCount ?? 0, props.specialty);
      setResponse(undefined);
      setLoading(false);
      return;
    }
    if (!trimmed) {
      setResponse(undefined);
      setDraftAnalysis(undefined);
      setLoading(false);
      return;
    }
    const core = props.core;
    if (props.searchAllowed === false || !core) {
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

    const result = await core.search({
      query: trimmed,
      mode: searchModeForScope(props.scope),
      analysisMode: props.scope === 'diagnosis' ? 'clinical' : 'lookup',
      filters: props.filters ?? {},
      limit: 20,
      includeSuggestions: props.scope === 'diagnosis',
    });

    if (generation !== searchGeneration || searchableQuery(query()) !== trimmed) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    lastSearchedQuery = trimmed;
    setResponse(result.value);
    setDraftAnalysis(result.value.analysis);
    if (recordHistory) appendSearchHistory(rawQuery, props.scope, result.value, props.specialty);
    // Link labels use the compact projection; extraction metadata stays in the database.
    if (contextDocuments().length === 0) {
      const available = await (core.listNavigationDocuments?.() ?? core.listDocuments());
      if (generation !== searchGeneration || searchableQuery(query()) !== trimmed) return;
      if (available.ok) setContextDocuments(available.value);
      else setError(available.error.message);
    }
  }

  async function openResult(result: SearchResult): Promise<void> {
    // Results only exist once a core has answered a search.
    const core = props.core;
    if (!core) return;
    setContextLoading(true);
    setError(undefined);
    const [resolved, available] = await Promise.all([
      core.getSearchResultContext(result, 3),
      core.listNavigationDocuments?.() ?? core.listDocuments(),
    ]);
    setContextDocuments(available.ok ? available.value : []);
    if (!available.ok) setError(available.error.message);
    setContextLoading(false);
    if (!resolved.ok) {
      const documents = await (core.listNavigationDocuments?.() ?? core.listDocuments());
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
    setSearchQueued(false);
    requestAnimationFrame(() => {
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (toolPickerOpen()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const last = Math.max(0, toolSuggestions().length - 1);
        setActiveTool(Math.min(last, Math.max(0, toolPickerActive() + delta)));
        return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        const definition = toolSuggestions()[toolPickerActive()];
        if (definition?.state !== 'available') return;
        event.preventDefault();
        selectCalculatorTool(definition.slug);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setToolPickerOpen(false);
        return;
      }
    }
    // Source lookup is a one-line query, so Enter searches; a clinical case keeps Enter for new lines.
    const submits =
      event.key === 'Enter' &&
      !event.isComposing &&
      (event.ctrlKey || event.metaKey || (props.scope !== 'diagnosis' && !event.shiftKey));
    if (submits) {
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

  function syncToolPicker(value: string, caret: number): void {
    const trigger = calculatorToolTrigger(value, caret);
    if (trigger === undefined) {
      setToolPickerOpen(false);
      return;
    }
    setToolPickerQuery(trigger);
    setActiveTool(0);
    setToolPickerOpen(true);
  }

  function setActiveTool(index: number): void {
    setToolPickerActive(index);
    requestAnimationFrame(() => {
      document
        .getElementById(`search-calculator-tool-${index}`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  function selectCalculatorTool(slug: string): void {
    const caret = textarea?.selectionStart ?? query().length;
    const next = replaceCalculatorToolTrigger(query(), caret, slug);
    setRequestedInlineCalculator();
    updateQuery(next.value);
    setToolPickerOpen(false);
    requestAnimationFrame(() => {
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
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
        classList={{
          'has-search-content': query().length > 0,
          'case-folder--with-welcome': Boolean(props.intro),
        }}
      >
        <form
          ref={(element) => props.onFieldElement?.(element)}
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
              if (!props.compact) resizeTextarea(element);
            }}
            id="clinical-query"
            rows={1}
            data-testid="search-input"
            data-search-focus-target="true"
            aria-controls={toolPickerOpen() ? 'search-calculator-tools' : undefined}
            aria-activedescendant={
              toolPickerOpen() ? `search-calculator-tool-${toolPickerActive()}` : undefined
            }
            value={query()}
            onInput={(event) => {
              updateQuery(event.currentTarget.value);
              resizeTextarea(event.currentTarget);
              syncToolPicker(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length,
              );
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
            enterkeyhint={props.scope === 'diagnosis' ? 'enter' : 'search'}
            autocapitalize="sentences"
            spellcheck={false}
          />
          <Show when={query().length > 0}>
            <button
              class="query-sheet__clear"
              type="button"
              aria-label="Очистить запрос"
              title="Очистить"
              onClick={clearQuery}
            >
              <AppGlyph name="close" class="query-sheet__clear-icon" />
            </button>
          </Show>
          <Show when={expanded()}>
            <div class="query-actions">
              <Show when={query().length > 16_000}>
                <strong class="query-character-count">
                  {query().length.toLocaleString('ru-RU')} / 20 000
                </strong>
              </Show>
              <div
                class="query-buttons"
                classList={{ 'query-buttons--with-picker': modePicker.toArray().length > 0 }}
              >
                {modePicker()}
                <Popover
                  open={toolPickerOpen()}
                  onOpenChange={setToolPickerOpen}
                  placement="bottom-start"
                  gutter={8}
                  flip={false}
                  slide
                  fitViewport
                  overflowPadding={8}
                >
                  <Popover.Anchor class="search-tool-picker" />
                  <Popover.Portal>
                    <Popover.Content
                      class="search-tool-picker__menu"
                      id="search-calculator-tools"
                      role="listbox"
                      aria-label="Калькуляторы"
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      onFocusOutside={(event) => event.preventDefault()}
                    >
                      <p class="search-tool-picker__heading">Калькуляторы</p>
                      <For each={toolSuggestions()}>
                        {(definition, index) => (
                          <button
                            class="search-tool-picker__option"
                            classList={{
                              'search-tool-picker__option--active': toolPickerActive() === index(),
                            }}
                            id={`search-calculator-tool-${index()}`}
                            type="button"
                            role="option"
                            aria-selected={toolPickerActive() === index()}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setToolPickerActive(index())}
                            onClick={() =>
                              definition.state === 'available' &&
                              selectCalculatorTool(definition.slug)
                            }
                          >
                            <AppGlyph class="search-tool-picker__option-icon" name="calculator" />
                            <span class="search-tool-picker__option-copy">
                              <strong class="search-tool-picker__option-title">
                                {definition.shortTitle}
                              </strong>
                              <span class="search-tool-picker__option-detail">
                                {definition.title}
                              </span>
                            </span>
                          </button>
                        )}
                      </For>
                      <Show when={toolSuggestions().length === 0}>
                        <p class="search-tool-picker__empty">Установленный калькулятор не найден</p>
                      </Show>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover>
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
                      aria-label={loading() ? 'Ищем…' : 'Найти'}
                      title={loading() ? 'Ищем…' : 'Найти (Enter)'}
                      tabindex={props.searchAllowed === false ? -1 : undefined}
                      disabled={loading() || props.searchAllowed === false}
                    >
                      <AppGlyph
                        name={loading() ? 'refresh' : 'arrow-up'}
                        class={`search-button__icon${loading() ? ' search-button__icon--spinning' : ''}`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Show>
        </form>
        {props.fieldStatus}
        {/* The field leads the page; tools and capabilities follow it and fold away once a
            search starts, leaving results right under the field. */}
        <Show when={props.intro}>
          <div
            class="search-heading"
            classList={{ 'search-heading--hidden': query().length > 0 || Boolean(response()) }}
            inert={query().length > 0 || Boolean(response())}
          >
            {props.intro}
          </div>
        </Show>

        <Show when={ambiguousMeanings().length > 0}>
          <SearchMeaningChoices
            meanings={ambiguousMeanings()}
            documentsById={contextDocumentsById()}
            onOpen={(documentId) => openDocumentInArchive(documentId)}
          />
        </Show>

        {/* Holds the analysis row's place from the first keystroke, so the results slot below does
            not drop when the analysis arrives. */}
        <Show when={props.scope === 'diagnosis' && !activeAnalysis() && analysisLoading()}>
          <section class="query-index query-index--content-sized" aria-hidden="true">
            <div class="analysis-details query-index__details">
              <div class="analysis-details__summary query-index__summary">
                <span class="query-index__summary-main">
                  <span class="query-index__badge">Детали</span>
                  <span class="query-index__text query-index__text--pending">
                    Распознано 0 полей · показать детали
                  </span>
                </span>
              </div>
            </div>
          </section>
        </Show>

        <Show when={props.scope === 'diagnosis' && activeAnalysis()}>
          {(analysis) => (
            <section class="query-index query-index--content-sized" aria-label="Разбор запроса">
              <Show when={analysis().suggestions.length > 0}>
                <div class="index-row query-index__suggestions">
                  <div class="index-label query-index__label">
                    <span class="index-label__title">Полезно уточнить</span>
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
                  <For each={analysis().warnings}>
                    {(warning) => <p class="query-warning-list__item">{warning}</p>}
                  </For>
                </div>
              </Show>

              <details class="analysis-details query-index__details">
                <summary class="analysis-details__summary query-index__summary">
                  <span class="query-index__summary-main">
                    <span class="query-index__badge">Детали</span>
                    <span class="query-index__text">
                      {analysisLoading()
                        ? 'Обновляем разбор…'
                        : `Распознано ${analysis().facts.length} полей · показать детали`}
                    </span>
                  </span>
                </summary>
                <Show when={response()}>
                  {(searchResponse) => (
                    <div
                      class="result-summary result-summary--analysis"
                      classList={{ 'results-refreshing': loading() }}
                    >
                      <div class="result-summary__cell">
                        <span class="result-summary__label">РЕЗУЛЬТАТЫ</span>
                        <strong class="result-summary__value">
                          {resultCount()}{' '}
                          {pluralRu(resultCount(), 'фрагмент', 'фрагмента', 'фрагментов')}
                        </strong>
                      </div>
                      <div class="result-summary__cell">
                        <span class="result-summary__label">ДОКУМЕНТЫ</span>
                        <strong class="result-summary__value">{visibleGroups().length}</strong>
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
                  <span class="branch-ledger__label">Поисковые ветки</span>
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

        <Show when={inlineCalculatorDefinition()}>
          {(calculator) => (
            <section class="search-inline-calculator" aria-label="Калькулятор в поиске">
              <header class="search-inline-calculator__header">
                <div class="search-inline-calculator__heading">
                  <p class="search-inline-calculator__kicker">
                    {explicitCalculator() ? 'Выбран через @' : 'Инструмент поиска'}
                  </p>
                  <h2 class="search-inline-calculator__title">{calculator().shortTitle}</h2>
                  <p class="search-inline-calculator__summary">{calculator().summary}</p>
                </div>
                <Button
                  class="search-inline-calculator__open-page"
                  type="button"
                  variant="secondary"
                  onClick={() => openCalculatorPage(calculator().id, inlineCalculatorValues())}
                >
                  Открыть отдельно
                </Button>
              </header>
              <Suspense
                fallback={
                  <p class="search-inline-calculator__loading" role="status">
                    Открываем калькулятор…
                  </p>
                }
              >
                <SearchInlineCalculatorWorkspace
                  definition={calculator()}
                  initialValues={inlineCalculatorValues()}
                />
              </Suspense>
            </section>
          )}
        </Show>

        <Show when={props.scope === 'diagnosis'}>
          <ClinicalAnalysisNote />
        </Show>

        <Show
          when={
            (props.showExamples ?? !props.catalog) &&
            props.searchAllowed !== false &&
            !response() &&
            query().length === 0 &&
            (props.examples ?? EXAMPLES_BY_SCOPE[props.scope]).length > 0
          }
        >
          <SearchExamples
            examples={props.examples ?? EXAMPLES_BY_SCOPE[props.scope]}
            onSelect={(example) => {
              updateQuery(example, false);
              void runSearch(example, true);
            }}
          />
        </Show>

        {props.catalog}

        <PersonalNoteMatches query={searchableQuery(query())} scope={props.scope} />

        <Show when={error() === SEARCH_QUERY_EMPTY_ERROR}>
          <QueryEmptyState message="Недостаточно данных для поиска. Уточните запрос." />
        </Show>
        <Show when={error() && error() !== SEARCH_QUERY_EMPTY_ERROR}>
          {(message) => <div class="error-card">{message()}</div>}
        </Show>

        <div class="search-results-slot">
          <Show when={skeletonMounted()}>
            <SearchResultsSkeleton leaving={!resultsPending()} />
          </Show>
          <Show when={response()}>
            {(_searchResponse) => (
              <div class="search-results-slot__content search-results-slot__reveal">
                <Show when={loading() && props.scope !== 'personal'}>
                  <div class="results-refreshing-note" role="status">
                    Обновляем результаты по установленным документам…
                  </div>
                </Show>

                <Show when={props.scope !== 'personal' ? response()?.queryRewrite : undefined}>
                  {(rewrite) => (
                    <div
                      class="results-refreshing-note search-rewrite-note"
                      role="status"
                      data-testid="search-rewrite-note"
                    >
                      Показаны результаты по: «{rewrite().query}»
                    </div>
                  )}
                </Show>

                <Show when={interactionQuery()}>
                  {(asked) => <InteractionSuggestionCard names={asked().names} />}
                </Show>

                <Show when={interactionQuery() ? undefined : comparisonQuery()}>
                  {(asked) => <ComparisonSuggestionCard core={props.core} names={asked().names} />}
                </Show>

                <Show when={interactionQuery() ? undefined : safetyQuery()}>
                  {(asked) => (
                    <MedicationSafetyCard
                      core={props.core}
                      query={asked()}
                      onContentChanged={props.onContentChanged}
                    />
                  )}
                </Show>

                <Show when={requestedInlineCalculator() ? undefined : calculatorSuggestion()}>
                  {(suggestion) => (
                    <CalculatorSuggestionCard
                      suggestion={suggestion()}
                      schemas={calculatorSchemas()}
                      onCalculate={showCalculatorInline}
                    />
                  )}
                </Show>

                <Show when={props.scope !== 'personal'}>
                  <Show when={visibleIdentities().length ? props.referenceCore : undefined}>
                    {(referenceCore) => (
                      <CoreIdentityMatches
                        hits={visibleIdentities()}
                        core={referenceCore()}
                        onContentChanged={
                          props.onContentChanged ??
                          (async () => {
                            window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
                          })
                        }
                      />
                    )}
                  </Show>
                  <div
                    class="results-list"
                    classList={{ 'results-refreshing': loading() }}
                    data-testid="search-results"
                  >
                    <LayoutVirtualizedGrid data={visibleGroups()} bufferSize={400}>
                      {(group, groupIndex) => {
                        return (
                          <SearchResultGroupCard
                            group={group}
                            index={groupIndex}
                            specialties={
                              contextDocumentsById().get(group.documentId)?.specialties ?? []
                            }
                            selectedChunkId={context()?.focusChunkId}
                            action={props.groupAction?.(group)}
                            onOpenDocument={openDocumentInArchive}
                            onOpenResult={(result) => void openResult(result)}
                          />
                        );
                      }}
                    </LayoutVirtualizedGrid>
                  </div>
                </Show>

                <Show
                  when={
                    !loading() &&
                    visibleGroups().length === 0 &&
                    !response()?.identities?.length &&
                    props.scope !== 'personal'
                      ? props.emptyResults
                      : undefined
                  }
                >
                  {(emptyResults) => emptyResults()(searchableQuery(query()))}
                </Show>
              </div>
            )}
          </Show>
        </div>
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
                            core={props.core}
                            documentLinkMatcher={contextLinkMatcher()}
                            onDocumentLink={openDocumentInArchive}
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
    </section>
  );
}
