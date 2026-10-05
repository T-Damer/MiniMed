import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SheetPopover } from '@/components/SheetPopover';
import { useStickySurface } from '@/components/sticky-surface';
import { ASSESSMENT_PACKS_EVENT } from '@/features/assessments/assessment-packs';
import { CALCULATOR_PACKS_EVENT } from '@/features/calculators/calculator-packs';
import { ECG_PHOTO_CALIPER_ID } from '@/features/calculators/calculator-registry';
import { EcgHomeEntry } from '@/features/calculators/EcgHomeEntry';
import {
  conversationSession,
  startConversation,
} from '@/features/conversations/conversation-session';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { preferReadableDocuments } from '@/features/library/document-display';
import { ImagingViewerEntry } from '@/features/library/ImagingViewerEntry';
import {
  createUserLibraryDocuments,
  findExampleStudy,
  importAndOpenImagingFiles,
  openImagingStudy,
} from '@/features/library/imaging-entry';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { selectGraphNeighborhood } from '@/features/library/knowledge-graph-model';
import { medicationDocumentGroups } from '@/features/medications/medicationGroups';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import { HomeFeatureCard } from '@/features/search/HomeFeatureCard';
import { homeDocumentOrder } from '@/features/search/homeDocumentOrder';
import { APP_TOOL_IDS, type QuickTool, quickToolsFromCatalog } from '@/features/search/quick-tools';
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
import { searchSectionFromHash, searchSectionHash } from '@/features/search/search-section-route';
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
import {
  getUsefulFeaturesHidden,
  setUsefulFeaturesHidden,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import { openDocumentOverlay } from '@/state/document-navigation';
import { experimentalModulesEnabled } from '@/state/experimental-modules';
import {
  ignoreAppUpdate,
  isHomeAppUpdateVisible,
  loadIgnoredAppUpdates,
} from '@/state/ignored-app-updates';
import { appendSearchHistory, replaySearch, type SearchHistoryEntry } from '@/state/search-history';
import { USER_LIBRARY_EXAMPLE_MRI_FILE_NAME } from '@/state/user-library';

import '@/features/search/search-help-sheet.css';

const isSearchSection = (value: string): value is SearchScope =>
  SEARCH_SECTIONS.some((section) => section.id === value);

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
  const [featuresHidden, setFeaturesHidden] = createSignal(getUsefulFeaturesHidden());
  onCleanup(
    subscribeAppPreferences((preferences) => setFeaturesHidden(preferences.usefulFeaturesHidden)),
  );
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
  /** Library documents: they tell whether the MRI example is already in «Мои файлы». */
  const libraryDocuments = createUserLibraryDocuments();
  const mriExample = createMemo(() =>
    findExampleStudy(libraryDocuments(), 'mri', USER_LIBRARY_EXAMPLE_MRI_FILE_NAME),
  );
  const [imagingOpen, setImagingOpen] = createSignal(false);
  /** Everything in «Все инструменты»: the app's real features by section, nothing else. */
  const builtInTools = createMemo((): readonly QuickTool[] => [
    {
      id: APP_TOOL_IDS.conversation,
      title: 'Запись беседы',
      kindLabel: 'Запись и расшифровка',
      icon: 'microphone',
      group: 'reception',
      run: () => void startConversation(),
    },
    {
      id: APP_TOOL_IDS.ecgPhoto,
      title: 'ЭКГ по фото',
      kindLabel: 'Интервалы и QTc по снимку ленты',
      icon: 'heartbeat',
      group: 'reception',
      href: `#/calculators/${ECG_PHOTO_CALIPER_ID}`,
    },
    {
      id: APP_TOOL_IDS.forms,
      title: 'Формы',
      kindLabel: 'Официальные формы',
      icon: 'file-text',
      group: 'reception',
      href: '#/notes/forms',
    },
    {
      id: APP_TOOL_IDS.notes,
      title: 'Заметки',
      kindLabel: 'Заметки, PDF и исследования',
      icon: 'notes',
      group: 'files',
      href: '#/notes',
    },
    {
      id: APP_TOOL_IDS.imaging,
      title: 'Просмотр снимков',
      kindLabel: 'DICOM и NIfTI',
      icon: 'image',
      group: 'files',
      run: () => setImagingOpen(true),
      dropFiles: (files) =>
        void importAndOpenImagingFiles(files).then((problem) => {
          if (problem) toast.error(problem);
        }),
    },
    {
      id: APP_TOOL_IDS.calculators,
      title: 'Калькуляторы',
      kindLabel: 'Все расчёты',
      icon: 'calculator',
      group: 'calculations',
      href: '#/calculators',
    },
    // No `group`: not listed in «Все инструменты», but a star from an older version still opens it.
    {
      id: APP_TOOL_IDS.patients,
      title: 'Пациенты',
      kindLabel: 'Карточки и дневники',
      icon: 'users',
      href: '#/notes/patients',
    },
    {
      id: APP_TOOL_IDS.assessments,
      title: 'Опросники',
      kindLabel: 'Шкалы и анкеты',
      icon: 'list-checks',
      href: '#/assessments',
    },
    // The draft dictionary is an experimental module.
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
        ]
      : []),
  ]);
  /** «Полезные функции» above the empty search field, starting from today's capability. The relation
   * map and the random record are not repeated here: both have buttons in the page header. */
  const homeFeatures = createMemo((): readonly HomeFeature[] => [
    { id: 'ecg-photo', render: () => <EcgHomeEntry /> },
    {
      id: 'imaging',
      render: () => (
        <HomeFeatureCard
          icon="image"
          kicker="КТ и МРТ"
          title="Просмотр исследований"
          text="DICOM и NIfTI открываются на устройстве: срезы в трёх плоскостях, 3D и контраст. Откройте свой снимок или перетащите файл."
          action={
            mriExample()
              ? {
                  label: 'Открыть пример МРТ',
                  icon: 'image',
                  run: () => {
                    const example = mriExample();
                    if (example) openImagingStudy(example);
                  },
                }
              : { label: 'Просмотр снимков', icon: 'image', run: () => setImagingOpen(true) }
          }
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
  /** A section (or one of its groups) is open and the field is empty: the way up is the section list. */
  const sectionOpen = () =>
    scope() !== 'diagnosis' &&
    (scope() !== 'all' || Boolean(specialty())) &&
    catalogQuery().trim().length === 0;
  /**
   * An open section is a page of its own: `#/search/section/<id>` holds a history entry, so the back
   * arrow, the system back and Android back all return to the section list, which stays mounted
   * (hidden pages are not rebuilt) and gets its scroll position back.
   */
  const openSectionId = (): SearchScope | undefined =>
    scope() !== 'diagnosis' && (scope() !== 'all' || Boolean(specialty())) ? scope() : undefined;
  let listScroll = 0;
  /** The current history entry is one this page pushed for a section (not one a tool return made). */
  const ownsSectionEntry = (): boolean =>
    (window.history.state as { readonly searchSection?: unknown } | null)?.searchSection === true;
  /** The list is laid out over a few frames after it returns, so retry until the page is tall enough. */
  const restoreScroll = (top: number): void => {
    let frames = 30;
    let cancelled = false;
    const cancel = (): void => {
      cancelled = true;
    };
    window.addEventListener('wheel', cancel, { once: true, passive: true });
    window.addEventListener('touchstart', cancel, { once: true, passive: true });
    const step = (): void => {
      if (cancelled || frames-- <= 0) return;
      window.scrollTo({ top, behavior: 'instant' });
      if (Math.abs(window.scrollY - top) > 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const resetToSections = (): void => {
    setGroups({});
    setSourceScope('all');
    setScope('all');
  };
  const backToSections = (): void => {
    if (ownsSectionEntry() && searchSectionFromHash(window.location.hash, isSearchSection)) {
      // The hashchange listener below resets the section; the effect restores the list's scroll.
      window.history.back();
      return;
    }
    resetToSections();
  };
  const openSection = (next: SearchScope, group?: string): void => {
    if (openSectionId() === undefined) listScroll = window.scrollY;
    setGroups({ ...groups(), [next]: group });
    setSourceScope(next);
    setScope(next);
  };
  // Keep the address and the scroll in step with the open section: opening pushes an entry and
  // starts the page at the top, switching section replaces it, closing leaves it and puts the
  // section list back where the user left it.
  createEffect(
    on(openSectionId, (id, previous) => {
      if (!props.active) return;
      const current = searchSectionFromHash(window.location.hash, isSearchSection);
      if (id === undefined || id === 'all') {
        if (current) {
          if (ownsSectionEntry()) window.history.back();
          else window.history.replaceState(null, '', '#/search');
        }
        if (previous !== undefined && id === undefined) {
          restoreScroll(listScroll);
        }
        return;
      }
      if (previous === undefined) window.scrollTo({ top: 0, behavior: 'instant' });
      if (current === id) return;
      if (current) {
        window.history.replaceState(window.history.state, '', searchSectionHash(id));
      } else {
        window.history.pushState({ searchSection: true }, '', searchSectionHash(id));
      }
    }),
  );
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
    // Escape does what the back arrow does, unless something above the page owns the key.
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !props.active || !sectionOpen())
        return;
      if (document.querySelector('[aria-modal="true"], .search-history-drawer-backdrop')) return;
      event.preventDefault();
      backToSections();
    };
    window.addEventListener('keydown', handleEscape);
    onCleanup(() => window.removeEventListener('keydown', handleEscape));
    const handleHashChange = (): void => {
      const hash = window.location.hash;
      // Other tabs own their routes; only react to the search page's own addresses.
      if (hash !== '' && !/^#\/search(\/|$)/u.test(hash)) return;
      const section = searchSectionFromHash(hash, isSearchSection);
      if (section) {
        if (openSectionId() !== section) {
          if (openSectionId() === undefined) listScroll = window.scrollY;
          setGroups({ ...groups(), [section]: undefined });
          setSourceScope(section);
          setScope(section);
        }
        return;
      }
      // A group of «Все источники» has no address of its own: leaving a section address keeps it.
      const open = openSectionId();
      if (open !== undefined && open !== 'all') resetToSections();
    };
    window.addEventListener('hashchange', handleHashChange);
    onCleanup(() => window.removeEventListener('hashchange', handleHashChange));
    // A page loaded or restored on a section address opens that section.
    handleHashChange();
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
          <SearchHistoryPanel
            onReplay={replayHistory}
            back={sectionOpen() ? { label: 'Назад к разделам', onBack: backToSections } : undefined}
          />
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
          triggerClass="ui-button ui-button--icon search-mode-help"
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
              featuresHidden={featuresHidden()}
              onHideFeatures={() => setUsefulFeaturesHidden(true)}
            />
          }
          catalog={
            <Show
              when={showSectionsOverview()}
              fallback={
                <div class="search-section-page">
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
                </div>
              }
            >
              <SearchSectionsOverview
                rows={sectionsOverviewRows(sourceSections(), catalogLoading())}
                onSelect={(next) => openSection(next)}
              />
            </Show>
          }
          // The core's status shows in one place: in the field only until the note below appears.
          placeholder={
            props.coreStatus && !noteCoreStatus()
              ? searchCoreStatusLabel(props.coreStatus)
              : scope() === 'diagnosis'
                ? 'Опишите случай своими словами: жалобы, анамнез, находки'
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
                  if (next === 'all' && !group) {
                    if (openSectionId() !== undefined) backToSections();
                    return;
                  }
                  openSection(next, group);
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
        <Show when={featuresHidden() && showSectionsOverview()}>
          <Button
            variant="quiet"
            class="useful-features-restore"
            onClick={() => setUsefulFeaturesHidden(false)}
          >
            Показать полезные функции
          </Button>
        </Show>
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
        open={imagingOpen()}
        title="Просмотр снимков"
        class="imaging-entry-dialog"
        onClose={() => setImagingOpen(false)}
      >
        <ImagingViewerEntry onOpened={() => setImagingOpen(false)} />
      </OverlayDialog>
      <OverlayDialog
        open={tourOpen()}
        title="Что умеет MiniMed"
        class="feature-tour-dialog"
        onClose={() => setTourOpen(false)}
      >
        <FeatureTour onNavigate={() => setTourOpen(false)} />
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
