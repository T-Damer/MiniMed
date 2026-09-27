import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { useStickySurface } from '@/components/sticky-surface';
import { ASSESSMENT_PACKS_EVENT } from '@/features/assessments/assessment-packs';
import { CALCULATOR_PACKS_EVENT } from '@/features/calculators/calculator-packs';
import { startConversation } from '@/features/conversations/conversation-session';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { preferReadableDocuments } from '@/features/library/document-display';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { selectGraphNeighborhood } from '@/features/library/knowledge-graph-model';
import { medicationDocumentGroups } from '@/features/medications/medicationGroups';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import { homeDocumentOrder } from '@/features/search/homeDocumentOrder';
import {
  APP_TOOL_IDS,
  featuredCatalogTools,
  type QuickTool,
  quickToolsFromCatalog,
} from '@/features/search/quick-tools';
import {
  documentMatchesConditionGroup,
  documentMatchesSearchScope,
  ScopedMedicalCore,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import { SearchCoreStatusNote } from '@/features/search/SearchCoreStatusNote';
import { SearchNoResults } from '@/features/search/SearchNoResults';
import { SearchQuickAccess } from '@/features/search/SearchQuickAccess';
import { SearchResultModuleDownload } from '@/features/search/SearchResultModuleDownload';
import { SearchSectionPicker } from '@/features/search/SearchSectionPicker';
import { SearchWelcome } from '@/features/search/SearchWelcome';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
import { type SearchCoreStatus, searchCoreStatusLabel } from '@/features/search/search-core-status';
import {
  matchingCatalogTools,
  SEARCH_SECTIONS,
  searchCatalogSections,
  searchCatalogTools,
  unifiedSearchSpecialty,
} from '@/features/search/searchCatalog';
import { searchSectionDownloadBlocks } from '@/features/search/searchSectionDownloads';
import { UnifiedSearchCatalog } from '@/features/search/UnifiedSearchCatalog';
import { useSearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';
import { openDocumentOverlay } from '@/state/document-navigation';
import { experimentalModulesEnabled } from '@/state/experimental-modules';
import {
  ignoreAppUpdate,
  isHomeAppUpdateVisible,
  loadIgnoredAppUpdates,
} from '@/state/ignored-app-updates';
import { appendSearchHistory, replaySearch, type SearchHistoryEntry } from '@/state/search-history';

interface SearchHomeProps {
  /** Absent while the core opens, downloads or waits for another tab; the page stays usable. */
  readonly baseCore?: MedicalCore | undefined;
  /** Why search is not ready yet; undefined once it is. */
  readonly coreStatus?: SearchCoreStatus | undefined;
  readonly onRetryCore?: () => void;
  readonly onDownloadCore?: () => void;
  readonly onContentChanged: () => Promise<void>;
  readonly active: boolean;
  readonly splitNavigation?: boolean;
  readonly onOpenKnowledgeBase: () => void;
  readonly appUpdateVersion?: string;
  readonly onOpenAppUpdateSettings?: () => void;
}

export function SearchHome(props: SearchHomeProps): JSX.Element {
  const [graphOpen, setGraphOpen] = createSignal(false);
  const [graphShowAll, setGraphShowAll] = createSignal(false);
  const [resultDocumentIds, setResultDocumentIds] = createSignal<readonly string[]>([]);
  const [referenceOpen, setReferenceOpen] = createSignal(false);
  const [scope, setScope] = createSignal<SearchScope>('all');
  const [catalogQuery, setCatalogQuery] = createSignal('');
  const [groups, setGroups] = createSignal<Partial<Record<SearchScope, string>>>({});
  const specialty = () => groups()[scope()];
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = createSignal(true);
  const [catalogError, setCatalogError] = createSignal<string>();
  const [toolRevision, setToolRevision] = createSignal(0);
  const toolRows = createMemo(() => {
    toolRevision();
    return searchCatalogTools();
  });
  const sections = createMemo(() => searchCatalogSections(documents(), toolRows()));
  const catalogQuickTools = createMemo(() => quickToolsFromCatalog(toolRows()));
  const builtInTools = createMemo((): readonly QuickTool[] => [
    {
      id: APP_TOOL_IDS.conversation,
      title: 'Записать беседу',
      kindLabel: 'Запись и расшифровка',
      icon: 'microphone',
      run: () => void startConversation(),
    },
    // The draft definition reference is an experimental module.
    ...(experimentalModulesEnabled()
      ? [
          {
            id: APP_TOOL_IDS.reference,
            title: 'Словарь терминов',
            kindLabel: 'Черновой справочник',
            icon: 'book-open' as const,
            run: () => setReferenceOpen(true),
          },
        ]
      : []),
    ...featuredCatalogTools(catalogQuickTools()),
  ]);
  const quickTools = createMemo(() => [
    ...builtInTools().filter((tool) => !tool.href),
    ...catalogQuickTools(),
  ]);
  const downloads = useSearchSectionDownloads(
    () => props.active,
    () => props.onContentChanged(),
  );
  const documentsById = createMemo(
    () => new Map(documents().map((document) => [document.id, document])),
  );
  const downloadBlocks = createMemo(() => {
    downloads.preferenceRevision();
    return searchSectionDownloadBlocks(documents(), toolRows(), downloads.catalog());
  });
  /** Document sections of the current scope whose published modules are not installed yet. */
  const missingSections = createMemo(() => {
    const scopes =
      scope() === 'all'
        ? SEARCH_SECTIONS.filter(
            (section) =>
              section.id !== 'all' &&
              section.id !== 'diagnosis' &&
              section.id !== 'assessments' &&
              section.id !== 'calculators',
          )
        : SEARCH_SECTIONS.filter((section) => section.id === scope());
    return scopes.flatMap((section) => {
      const modules = downloadBlocks().get(`${section.id}/${specialty() ?? ''}`)?.modules ?? [];
      const installed = downloads.installedIds(modules);
      const pending = modules.filter((module) => !installed.has(module.id));
      return pending.length ? [{ id: section.id, label: section.label, modules: pending }] : [];
    });
  });
  const catalogOnly = createMemo(() => {
    if (scope() === 'calculators' || scope() === 'assessments') return true;
    const group = sections()
      .find((section) => section.id === scope())
      ?.groups.find((entry) => entry.id === specialty());
    return (
      scope() === 'all' &&
      !catalogLoading() &&
      !catalogError() &&
      group !== undefined &&
      group.documentCount === 0 &&
      group.count > 0
    );
  });
  const visibleTools = createMemo(() =>
    matchingCatalogTools(toolRows(), scope(), specialty(), catalogQuery()),
  );
  const visibleDocuments = createMemo(() =>
    documents().filter(
      (entry) =>
        documentMatchesSearchScope(entry, scope()) &&
        (!specialty() ||
          (scope() === 'conditions' && specialty()?.startsWith('kind:')
            ? documentMatchesConditionGroup(entry, specialty() ?? '')
            : scope() === 'medications'
              ? medicationDocumentGroups(entry).includes(specialty() ?? '')
              : entry.specialties.some(
                  (group) =>
                    (scope() === 'all' ? unifiedSearchSpecialty(group) : group) === specialty(),
                ))),
    ),
  );
  /** Default graph: the current results and their neighbours, not the whole scope. */
  const graphSelection = createMemo(() =>
    graphShowAll()
      ? { documents: visibleDocuments(), total: visibleDocuments().length, focused: false }
      : selectGraphNeighborhood(visibleDocuments(), { focusIds: new Set(resultDocumentIds()) }),
  );
  const catalogDocuments = createMemo(() =>
    scope() === 'all' ? homeDocumentOrder(visibleDocuments()) : visibleDocuments(),
  );
  createEffect(() => {
    const core = props.baseCore;
    setCatalogLoading(true);
    if (!core) return;
    let current = true;
    void (core.listNavigationDocuments?.() ?? core.listDocuments()).then((result) => {
      if (!current) return;
      setCatalogLoading(false);
      if (result.ok) {
        setDocuments(preferReadableDocuments(result.value));
        setCatalogError(undefined);
      } else setCatalogError(result.error.message);
    });
    onCleanup(() => {
      current = false;
    });
  });
  const filters = createMemo(() => {
    const selected = specialty();
    return selected &&
      !selected.startsWith('kind:') &&
      scope() !== 'diagnosis' &&
      scope() !== 'medications'
      ? {
          specialties:
            scope() === 'all' && selected === 'gynecology'
              ? ['gynecology', 'obstetrics']
              : [selected],
        }
      : {};
  });
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [hasSearchScroll, setHasSearchScroll] = createSignal(false);
  const [ignoredAppUpdates, setIgnoredAppUpdates] = createSignal(loadIgnoredAppUpdates());
  let searchModeTools: HTMLElement | undefined;
  let searchScrollFrame: number | undefined;
  useStickySurface(() => searchModeTools);

  onMount(() => {
    const refreshTools = () => setToolRevision((revision) => revision + 1);
    window.addEventListener(ASSESSMENT_PACKS_EVENT, refreshTools);
    window.addEventListener(CALCULATOR_PACKS_EVENT, refreshTools);
    onCleanup(() => {
      window.removeEventListener(ASSESSMENT_PACKS_EVENT, refreshTools);
      window.removeEventListener(CALCULATOR_PACKS_EVENT, refreshTools);
    });
    const updateSearchScroll = (): void => {
      if (searchScrollFrame !== undefined) return;
      searchScrollFrame = requestAnimationFrame(() => {
        searchScrollFrame = undefined;
        setHasSearchScroll(window.scrollY > 1);
      });
    };
    updateSearchScroll();
    window.addEventListener('scroll', updateSearchScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', updateSearchScroll));
  });

  onCleanup(() => {
    if (searchScrollFrame !== undefined) cancelAnimationFrame(searchScrollFrame);
  });

  const scopedCore = createMemo(() => {
    const core = props.baseCore;
    if (!core) return undefined;
    return new ScopedMedicalCore(
      core,
      scope(),
      (scope() === 'conditions' && specialty()?.startsWith('kind:')) ||
        (scope() === 'medications' && specialty())
        ? new Set(visibleDocuments().map((document) => document.id))
        : undefined,
    );
  });
  const replayHistory = (entry: SearchHistoryEntry): void => {
    const next = SEARCH_SECTIONS.some((section) => section.id === entry.scope)
      ? entry.scope
      : 'all';
    setGroups({ ...groups(), [next]: entry.specialty });
    setScope(next);
    replaySearch({ ...entry, scope: next });
  };

  return (
    <section class="search-home page-grain" aria-label="Поиск MiniMed">
      <div
        class="search-home__backdrop-blur masked-backdrop-blur"
        classList={{ 'search-home__backdrop-blur--visible': hasSearchScroll() }}
        aria-hidden="true"
      />
      <div
        class="search-mode-tools route-sticky-chrome--transparent"
        ref={(element) => {
          searchModeTools = element;
        }}
      >
        <Show when={props.active}>
          <SearchHistoryPanel onReplay={replayHistory} />
        </Show>
        <Show when={isHomeAppUpdateVisible(props.appUpdateVersion, ignoredAppUpdates())}>
          <button
            class="search-update-status"
            type="button"
            aria-label="Доступно обновление"
            title="Доступно обновление"
            onClick={() => {
              const version = props.appUpdateVersion;
              if (version) setIgnoredAppUpdates(ignoreAppUpdate(version));
              props.onOpenAppUpdateSettings?.();
            }}
          >
            <AppGlyph name="refresh" class="search-update-status__icon" />
            <span class="search-update-status__label">Доступно обновление</span>
          </button>
        </Show>
        <button
          class="search-mode-help"
          type="button"
          aria-label="Как работает поиск"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
      </div>

      <div class="search-workspace-main">
        <SearchWorkspace
          core={scopedCore()}
          scope={scope()}
          searchAllowed={props.baseCore !== undefined}
          fieldStatus={
            <Show when={props.coreStatus}>
              {(status) => (
                <SearchCoreStatusNote
                  status={status()}
                  {...(props.onRetryCore ? { onRetry: props.onRetryCore } : {})}
                  {...(props.onDownloadCore ? { onDownload: props.onDownloadCore } : {})}
                />
              )}
            </Show>
          }
          specialty={specialty()}
          catalogResultCount={visibleTools().length}
          filters={filters()}
          onQueryChange={setCatalogQuery}
          onResultDocuments={setResultDocumentIds}
          groupAction={(group) =>
            group.contentKind === 'pointer' ? (
              <SearchResultModuleDownload
                document={documentsById().get(group.documentId)}
                downloads={downloads}
              />
            ) : undefined
          }
          emptyResults={(query) => (
            <SearchNoResults
              query={query}
              downloads={downloads}
              missing={missingSections()}
              onSearchEverywhere={
                scope() === 'all'
                  ? undefined
                  : () => {
                      setScope('all');
                    }
              }
            />
          )}
          catalogOnly={catalogOnly()}
          showExamples
          welcome={
            <SearchWelcome
              coreReady={props.baseCore !== undefined}
              onOpenReference={() => setReferenceOpen(true)}
            />
          }
          quickAccess={<SearchQuickAccess tools={quickTools()} builtInTools={builtInTools()} />}
          searchActions={
            <Show when={!catalogOnly() && scope() !== 'diagnosis' && experimentalModulesEnabled()}>
              <button
                class="search-graph-button"
                type="button"
                aria-label="Карта связей"
                title="Карта связей"
                disabled={catalogLoading() || visibleDocuments().length === 0}
                onClick={() => {
                  setGraphShowAll(false);
                  setGraphOpen(true);
                }}
              >
                <AppGlyph name="graph" class="search-graph-button__icon" />
              </button>
            </Show>
          }
          catalog={
            <UnifiedSearchCatalog
              core={props.baseCore}
              scope={scope()}
              query={catalogQuery()}
              catalogOnly={catalogOnly()}
              hideDocuments={scope() === 'diagnosis'}
              documents={catalogDocuments()}
              tools={visibleTools()}
              onOpenTool={() => {
                if (catalogQuery().trim())
                  appendSearchHistory(catalogQuery(), scope(), visibleTools().length, specialty());
              }}
              loading={catalogLoading()}
              error={catalogError()}
            />
          }
          placeholder={
            props.coreStatus
              ? searchCoreStatusLabel(props.coreStatus)
              : scope() === 'diagnosis'
                ? 'Например: 5 лет, мальчик, второй день кашляет и температурит…'
                : 'Название, код МКБ, препарат или фраза из документа'
          }
          modePicker={
            <SearchSectionPicker
              loading={catalogLoading()}
              documents={documents()}
              tools={toolRows()}
              downloads={downloads}
              sections={sections()}
              scope={scope()}
              group={specialty()}
              onSelect={(next, group) => {
                setGroups({ ...groups(), [next]: group });
                setScope(next);
              }}
            />
          }
        />
      </div>

      <Show when={referenceOpen() && experimentalModulesEnabled() && props.baseCore}>
        {(core) => (
          <OverlayDialog
            open
            title="Словарь терминов"
            class="reference-dialog"
            onClose={() => setReferenceOpen(false)}
          >
            <DefinitionReferencePanel core={core()} onContentChanged={props.onContentChanged} />
          </OverlayDialog>
        )}
      </Show>
      <Show when={graphOpen()}>
        <OverlayDialog
          open
          title="Карта связей"
          class="knowledge-graph-dialog"
          onClose={() => setGraphOpen(false)}
        >
          <KnowledgeGraph
            variant="dialog"
            documents={graphSelection().documents}
            total={graphSelection().total}
            onShowAll={() => setGraphShowAll(true)}
            selectedId={undefined}
            onSelect={(id) => {
              setGraphOpen(false);
              openDocumentOverlay(id);
            }}
          />
        </OverlayDialog>
      </Show>
      <OverlayDialog
        open={helpOpen()}
        title="Как работает поиск"
        class="diagnosis-help-dialog"
        onClose={() => setHelpOpen(false)}
      >
        <div class="diagnosis-help-copy">
          <p>
            MiniMed локально ищет и ранжирует подходящие файлы в установленных источниках. Поиск не
            генерирует медицинский ответ и остаётся доступен без сети.
          </p>
          <ul>
            <li>В выдаче показываются только исходные документы и точные фрагменты.</li>
            <li>Для клинического случая сначала показываются клинические рекомендации.</li>
            <li>Личные данные ищутся отдельно и не смешиваются с официальными источниками.</li>
            <li>Результат не заменяет осмотр, клиническое мышление и ответственность врача.</li>
          </ul>
        </div>
      </OverlayDialog>
    </section>
  );
}
