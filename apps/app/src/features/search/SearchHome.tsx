import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
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
import { toast } from 'solid-sonner';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { notifyWithOpen } from '@/components/notify';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SheetPopover } from '@/components/SheetPopover';
import { useStickySurface } from '@/components/sticky-surface';
import { ASSESSMENT_PACKS_EVENT } from '@/features/assessments/assessment-packs';
import { CALCULATOR_PACKS_EVENT } from '@/features/calculators/calculator-packs';
import { EcgHomeEntry } from '@/features/calculators/EcgHomeEntry';
import {
  conversationSession,
  startConversation,
} from '@/features/conversations/conversation-session';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { preferReadableDocuments } from '@/features/library/document-display';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { selectGraphNeighborhood } from '@/features/library/knowledge-graph-model';
import { medicationDocumentGroups } from '@/features/medications/medicationGroups';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import { HomeFeatureCard } from '@/features/search/HomeFeatureCard';
import { homeDocumentOrder } from '@/features/search/homeDocumentOrder';
import {
  APP_TOOL_IDS,
  featuredCatalogTools,
  type QuickTool,
  quickToolsFromCatalog,
} from '@/features/search/quick-tools';
import { pickRandomDocument } from '@/features/search/random-document';
import {
  documentMatchesConditionGroup,
  documentMatchesSearchScope,
  ScopedMedicalCore,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import { SearchCoreStatusNote } from '@/features/search/SearchCoreStatusNote';
import { type HomeFeature, SearchHomeIntro } from '@/features/search/SearchHomeIntro';
import { SearchNoResults } from '@/features/search/SearchNoResults';
import { SearchQuickAccess } from '@/features/search/SearchQuickAccess';
import { SearchResultModuleDownload } from '@/features/search/SearchResultModuleDownload';
import { SearchSectionPicker } from '@/features/search/SearchSectionPicker';
import { SearchSectionsOverview } from '@/features/search/SearchSectionsOverview';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
import {
  SEARCH_CORE_NOTE_DELAY_MS,
  type SearchCoreStatus,
  searchCoreStatusLabel,
  searchCoreStatusNoteVisible,
} from '@/features/search/search-core-status';
import {
  matchingCatalogTools,
  SEARCH_SECTIONS,
  searchCatalogSections,
  searchCatalogTools,
  unifiedSearchSpecialty,
} from '@/features/search/searchCatalog';
import { searchSectionDownloadBlocks } from '@/features/search/searchSectionDownloads';
import { sectionsOverviewRows } from '@/features/search/sections-overview';
import { UnifiedSearchCatalog } from '@/features/search/UnifiedSearchCatalog';
import { useSearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';
import { FeatureTour } from '@/features/setup/FeatureTour';
import { openDocumentOverlay } from '@/state/document-navigation';
import { experimentalModulesEnabled } from '@/state/experimental-modules';
import {
  ignoreAppUpdate,
  isHomeAppUpdateVisible,
  loadIgnoredAppUpdates,
} from '@/state/ignored-app-updates';
import { appendSearchHistory, replaySearch, type SearchHistoryEntry } from '@/state/search-history';

import '@/features/search/search-help-sheet.css';

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
  const [coreNoteDelayPassed, setCoreNoteDelayPassed] = createSignal(false);
  const coreNoteTimer = window.setTimeout(
    () => setCoreNoteDelayPassed(true),
    SEARCH_CORE_NOTE_DELAY_MS,
  );
  onCleanup(() => window.clearTimeout(coreNoteTimer));
  const noteCoreStatus = (): SearchCoreStatus | undefined =>
    props.coreStatus && searchCoreStatusNoteVisible(props.coreStatus, coreNoteDelayPassed())
      ? props.coreStatus
      : undefined;
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
  /** Why tools that read the corpus cannot open yet; undefined once they can. */
  const corpusUnavailable = (): string | undefined =>
    !props.baseCore || catalogLoading() || visibleDocuments().length === 0
      ? 'Откроется, когда база будет готова'
      : undefined;
  /** Everything in «Все инструменты»: app tools by section, plus the featured catalog tool. */
  const builtInTools = createMemo((): readonly QuickTool[] => [
    {
      id: APP_TOOL_IDS.conversation,
      title: 'Записать беседу',
      kindLabel: 'Запись и расшифровка',
      icon: 'microphone',
      group: 'reception',
      run: () => void startConversation(),
    },
    {
      id: APP_TOOL_IDS.patients,
      title: 'Пациенты',
      kindLabel: 'Карточки и дневники',
      icon: 'users',
      group: 'reception',
      href: '#/notes/patients',
    },
    {
      id: APP_TOOL_IDS.calculators,
      title: 'Калькуляторы',
      kindLabel: 'Все расчёты',
      icon: 'calculator',
      group: 'calculations',
      href: '#/calculators',
    },
    {
      id: APP_TOOL_IDS.assessments,
      title: 'Опросники',
      kindLabel: 'Шкалы и анкеты',
      icon: 'list-checks',
      group: 'calculations',
      href: '#/assessments',
    },
    ...featuredCatalogTools(catalogQuickTools()).map(
      (tool): QuickTool => ({ ...tool, group: 'calculations' }),
    ),
    // The draft dictionary and the relation map are experimental modules.
    ...(experimentalModulesEnabled()
      ? [
          {
            id: APP_TOOL_IDS.reference,
            title: 'Словарь терминов',
            kindLabel: 'Черновой справочник',
            icon: 'book-open' as const,
            group: 'reference' as const,
            run: () => setReferenceOpen(true),
            ...(props.baseCore ? {} : { unavailableReason: 'Откроется, когда база будет готова' }),
          },
          {
            id: APP_TOOL_IDS.graph,
            title: 'Карта связей',
            kindLabel: 'Связи источников',
            icon: 'graph' as const,
            group: 'reference' as const,
            run: () => {
              setGraphShowAll(false);
              setGraphOpen(true);
            },
            ...(corpusUnavailable() ? { unavailableReason: corpusUnavailable() as string } : {}),
          },
        ]
      : []),
    {
      id: APP_TOOL_IDS.randomRecord,
      title: 'Случайная запись',
      kindLabel: 'Из текущего раздела',
      icon: 'dice',
      group: 'reference',
      run: () => {
        const document = pickRandomDocument(visibleDocuments());
        if (document) openDocumentOverlay(document.id);
      },
      ...(corpusUnavailable() ? { unavailableReason: corpusUnavailable() as string } : {}),
    },
    {
      id: APP_TOOL_IDS.files,
      title: 'Мои файлы',
      kindLabel: 'PDF, заметки, исследования',
      icon: 'folder-open',
      group: 'files',
      href: '#/notes',
    },
    {
      id: APP_TOOL_IDS.noteTemplates,
      title: 'Шаблоны заметок',
      kindLabel: 'Готовые формы',
      icon: 'file-text',
      group: 'files',
      href: '#/notes/templates',
    },
    {
      id: APP_TOOL_IDS.ctExample,
      title: 'Пример КТ',
      kindLabel: 'Скачать в «Мои файлы»',
      icon: 'image',
      group: 'files',
      run: () => void addImagingExample('ct'),
    },
  ]);
  /** The CT and MRI examples (the tour offers the MRI one too); the user library loads on demand. */
  const addImagingExample = async (id: 'ct' | 'mri'): Promise<void> => {
    const label = id === 'ct' ? 'КТ' : 'МРТ';
    const [
      { downloadUserLibraryExample, USER_LIBRARY_EXAMPLE_SLOTS },
      { openUserLibraryDocument },
    ] = await Promise.all([
      import('@/state/user-library'),
      import('@/features/library/user-library-routing'),
    ]);
    const slot = USER_LIBRARY_EXAMPLE_SLOTS.find((entry) => entry.id === id);
    if (!slot) {
      toast.error(`Пример ${label} недоступен в этой сборке.`);
      return;
    }
    const pending = toast.loading(`Скачиваем пример ${label}…`);
    try {
      const saved = await downloadUserLibraryExample(slot);
      notifyWithOpen(
        `Пример ${label} добавлен в «Мои файлы».`,
        () => openUserLibraryDocument({ documentId: saved.id, title: saved.title }),
        { id: pending },
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : `Не удалось скачать пример ${label}.`, {
        id: pending,
      });
    }
  };
  /** «Полезные функции» above the empty search field, starting from today's capability. */
  const homeFeatures = createMemo((): readonly HomeFeature[] => [
    { id: 'ecg-photo', render: () => <EcgHomeEntry /> },
    {
      id: 'imaging',
      render: () => (
        <HomeFeatureCard
          icon="image"
          kicker="КТ и МРТ"
          title="Просмотр исследований"
          text="DICOM и NIfTI открываются на устройстве: срезы в трёх плоскостях, 3D и контраст. Попробуйте на примере МРТ головы."
          action={{
            label: 'Скачать пример МРТ',
            icon: 'download',
            run: () => void addImagingExample('mri'),
          }}
          secondary={{ label: 'Мои файлы', icon: 'folder-open', href: '#/notes' }}
        />
      ),
    },
    {
      id: 'conversation',
      render: () => (
        <HomeFeatureCard
          icon="microphone"
          kicker="Приём"
          title="Запись беседы"
          text="Запишите разговор на приёме и прикрепите запись к карточке пациента. Запись хранится только на устройстве."
          action={{
            label: 'Начать запись',
            icon: 'microphone',
            run: () => void startConversation(),
            ...(conversationSession.recorder() ? { unavailableReason: 'Запись уже идёт' } : {}),
          }}
          secondary={{ label: 'Пациенты', icon: 'users', href: '#/notes/patients' }}
        />
      ),
    },
    // The relation map is an experimental module.
    ...(experimentalModulesEnabled()
      ? [
          {
            id: 'graph',
            render: () => (
              <HomeFeatureCard
                icon="graph"
                kicker="Карта связей"
                title="Связи между источниками"
                text="Диагнозы, коды МКБ, рекомендации и препараты на одной карте: видно, что с чем связано."
                action={{
                  label: 'Открыть карту',
                  icon: 'graph',
                  run: () => {
                    setGraphShowAll(false);
                    setGraphOpen(true);
                  },
                  ...(corpusUnavailable()
                    ? { unavailableReason: corpusUnavailable() as string }
                    : {}),
                }}
              />
            ),
          },
        ]
      : []),
  ]);
  /** Every tool that can be starred: app tools first, then the whole catalog. */
  const quickTools = createMemo(() => {
    const builtIn = builtInTools();
    const builtInIds = new Set(builtIn.map((tool) => tool.id));
    return [...builtIn, ...catalogQuickTools().filter((tool) => !builtInIds.has(tool.id))];
  });
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
  const [tourOpen, setTourOpen] = createSignal(false);
  // One array for the component's lifetime: a literal in JSX would rebuild the open menu's items.
  const [helpMenuOpen, setHelpMenuOpen] = createSignal(false);
  /** The «?» panel: where to learn the app and the search. */
  const helpActions: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: AppGlyphName;
    readonly onSelect: () => void;
  }[] = [
    {
      id: 'feature-tour',
      label: 'Что умеет MiniMed',
      icon: 'question',
      onSelect: () => setTourOpen(true),
    },
    {
      id: 'search-help',
      label: 'Как работает поиск',
      icon: 'search',
      onSelect: () => setHelpOpen(true),
    },
  ];
  /** The source the clinical-analysis switch returns to when it is turned off. */
  const [sourceScope, setSourceScope] = createSignal<SearchScope>('all');
  const clinicalAnalysis = () => scope() === 'diagnosis';
  /** The empty home lists sections instead of the endless all-sources catalog. */
  const showSectionsOverview = () =>
    scope() === 'all' && !specialty() && catalogQuery().trim().length === 0;
  // Clinical analysis is a way of reading any source, so it is a switch, not a source.
  const sourceSections = createMemo(() =>
    sections().filter((section) => section.id !== 'diagnosis'),
  );
  const setClinicalAnalysis = (on: boolean): void => {
    if (on === clinicalAnalysis()) return;
    if (on) setSourceScope(scope());
    setScope(on ? 'diagnosis' : sourceScope());
  };
  const [hasSearchScroll, setHasSearchScroll] = createSignal(false);
  const [fieldForm, setFieldForm] = createSignal<HTMLFormElement>();
  /** The field has scrolled up behind the sticky row: the row offers a way back to it. */
  const [fieldAway, setFieldAway] = createSignal(false);
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
        // Measured live: the row's height changes with its contents and the safe area.
        const form = fieldForm();
        const rowBottom = searchModeTools?.getBoundingClientRect().bottom ?? 0;
        setFieldAway(form ? form.getBoundingClientRect().bottom < rowBottom : false);
      });
    };
    updateSearchScroll();
    window.addEventListener('scroll', updateSearchScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', updateSearchScroll));
  });

  onCleanup(() => {
    if (searchScrollFrame !== undefined) cancelAnimationFrame(searchScrollFrame);
  });

  const returnToField = (): void => {
    const form = fieldForm();
    if (!form) return;
    form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    form.querySelector('textarea')?.focus({ preventScroll: true });
  };

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
        <Show when={fieldAway()}>
          <button
            class="search-field-pill"
            type="button"
            aria-label="Вернуться к поиску"
            onClick={returnToField}
          >
            <AppGlyph name="search" class="search-field-pill__icon" />
            <span class="search-field-pill__label">{catalogQuery().trim() || 'Поиск'}</span>
          </button>
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
        <Button
          class="search-random-record"
          variant="icon"
          aria-label="Случайная запись"
          title={
            props.baseCore
              ? 'Случайная запись из текущего раздела'
              : 'Откроется, когда база будет готова'
          }
          disabled={!props.baseCore || catalogLoading() || visibleDocuments().length === 0}
          onClick={() => {
            const document = pickRandomDocument(visibleDocuments());
            if (document) openDocumentOverlay(document.id);
          }}
          icon={<AppGlyph name="dice" class="search-random-record__icon" />}
        />
        {/* A rare action: the relation map sits with the other page actions, not in the field. */}
        <Show when={!catalogOnly() && scope() !== 'diagnosis' && experimentalModulesEnabled()}>
          <Button
            class="search-graph-shortcut"
            variant="icon"
            aria-label="Карта связей"
            title={
              catalogLoading() || visibleDocuments().length === 0
                ? 'Откроется, когда база будет готова'
                : 'Карта связей'
            }
            disabled={catalogLoading() || visibleDocuments().length === 0}
            onClick={() => {
              setGraphShowAll(false);
              setGraphOpen(true);
            }}
            icon={<AppGlyph name="graph" class="search-graph-shortcut__icon" />}
          />
        </Show>
        <SheetPopover
          open={helpMenuOpen()}
          onOpenChange={setHelpMenuOpen}
          title="Справка"
          placement="bottom-end"
          triggerClass="search-mode-help"
          triggerLabel="Справка"
          triggerTitle="Справка"
          trigger="?"
          contentClass="search-help-sheet"
        >
          <div class="search-help-sheet__list">
            <For each={helpActions}>
              {(action) => (
                <button
                  type="button"
                  class="search-help-sheet__item"
                  onClick={() => {
                    setHelpMenuOpen(false);
                    action.onSelect();
                  }}
                >
                  <AppGlyph name={action.icon} class="search-help-sheet__icon" />
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </SheetPopover>
      </div>

      <div class="search-workspace-main">
        <SearchWorkspace
          core={scopedCore()}
          referenceCore={props.baseCore}
          onContentChanged={props.onContentChanged}
          scope={scope()}
          searchAllowed={props.baseCore !== undefined}
          fieldStatus={
            <Show when={noteCoreStatus()}>
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
          onFieldElement={setFieldForm}
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
          intro={
            <SearchHomeIntro
              quickAccess={<SearchQuickAccess tools={quickTools()} />}
              features={homeFeatures()}
            />
          }
          catalog={
            <Show
              when={showSectionsOverview()}
              fallback={
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
                      appendSearchHistory(
                        catalogQuery(),
                        scope(),
                        visibleTools().length,
                        specialty(),
                      );
                  }}
                  loading={catalogLoading()}
                  error={catalogError()}
                />
              }
            >
              <SearchSectionsOverview
                rows={sectionsOverviewRows(sourceSections(), catalogLoading())}
                onSelect={(next) => {
                  setGroups({ ...groups(), [next]: undefined });
                  setSourceScope(next);
                  setScope(next);
                }}
              />
            </Show>
          }
          // The core's status shows in one place: in the field only until the note below appears.
          placeholder={
            props.coreStatus && !noteCoreStatus()
              ? searchCoreStatusLabel(props.coreStatus)
              : scope() === 'diagnosis'
                ? 'Например: 5 лет, мальчик, второй день кашляет и температурит…'
                : 'Название, код МКБ, препарат или фраза из документа'
          }
          modePicker={
            <div class="search-source-controls">
              <SearchSectionPicker
                loading={catalogLoading()}
                documents={documents()}
                tools={toolRows()}
                downloads={downloads}
                sections={sourceSections()}
                scope={clinicalAnalysis() ? sourceScope() : scope()}
                group={specialty()}
                onSelect={(next, group) => {
                  setGroups({ ...groups(), [next]: group });
                  setSourceScope(next);
                  setScope(next);
                }}
              />
              {/* One compact row under the field: the clinical analysis is an icon toggle. */}
              <button
                type="button"
                class="search-clinical-toggle"
                classList={{ 'search-clinical-toggle--on': clinicalAnalysis() }}
                aria-pressed={clinicalAnalysis()}
                aria-label="Клинический разбор"
                title={
                  clinicalAnalysis()
                    ? 'Клинический разбор включён: вопросы уточняют случай'
                    : 'Клинический разбор выключен'
                }
                onClick={() => setClinicalAnalysis(!clinicalAnalysis())}
              >
                <AppGlyph
                  name={clinicalAnalysis() ? 'brain-fill' : 'brain'}
                  class="search-clinical-toggle__icon"
                />
              </button>
            </div>
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
          presentation="screen"
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
        open={tourOpen()}
        title="Что умеет MiniMed"
        class="feature-tour-dialog"
        onClose={() => setTourOpen(false)}
      >
        <FeatureTour />
      </OverlayDialog>
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
