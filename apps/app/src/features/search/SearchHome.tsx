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
  untrack,
} from 'solid-js';
import { toast } from 'solid-sonner';
import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PageHeroBand, remToPx, setLength, watchInsets } from '@/components/PageHero';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { SheetPopover } from '@/components/SheetPopover';
import { useStickySurface } from '@/components/sticky-surface';
import { ASSESSMENT_PACKS_EVENT } from '@/features/assessments/assessment-packs';
import { CALCULATOR_PACKS_EVENT } from '@/features/calculators/calculator-packs';
import {
  ECG_PHOTO_AGE_SCOPE,
  ECG_PHOTO_CALIPER_ID,
} from '@/features/calculators/calculator-registry';
import { EcgHomeEntry } from '@/features/calculators/EcgHomeEntry';
import { conversationSession } from '@/features/conversations/conversation-session';
import { DRUG_COMPARISON_TOOL } from '@/features/drug-comparison/drug-comparison-tool';
import { DRUG_INTERACTION_TOOL } from '@/features/drug-interactions/drug-interaction-tool';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { ICD11_COLLECTION, icd11ChapterDocuments } from '@/features/icd11/icd11-document';
import { preferReadableDocuments } from '@/features/library/document-display';
import { prepareDocumentLinksWhenIdle } from '@/features/library/document-link-prewarm';
import { ImagingViewerEntry } from '@/features/library/ImagingViewerEntry';
import {
  createUserLibraryDocuments,
  findExampleStudy,
  importAndOpenImagingFiles,
  openImagingStudy,
} from '@/features/library/imaging-entry';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { selectGraphNeighborhood } from '@/features/library/knowledge-graph-model';
import { MEDICATION_ATC_HASH } from '@/features/medications/medication-routing';
import { medicationDocumentGroups } from '@/features/medications/medicationGroups';
import { SECTION_DOCUMENT_COUNTS } from '@/features/modules/module-catalog-shell';
import { PRESCRIPTION_TOOL } from '@/features/prescription/prescription-tool';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import { sameDocumentList } from '@/features/search/document-list';
import { HomeFeatureCard } from '@/features/search/HomeFeatureCard';
import { homeDocumentOrder } from '@/features/search/homeDocumentOrder';
import { distinctNavigationDocuments } from '@/features/search/navigation-documents';
import {
  APP_FEATURE_AGE_SCOPE,
  APP_TOOL_IDS,
  type QuickTool,
  quickToolsFromCatalog,
} from '@/features/search/quick-tools';
import { pickRandomDocument } from '@/features/search/random-document';
import {
  documentMatchesConditionGroup,
  documentMatchesSearchScope,
  ScopedMedicalCore,
  type SearchScope,
  searchResultDocumentKind,
} from '@/features/search/ScopedMedicalCore';
import { SearchCoreStatusNote } from '@/features/search/SearchCoreStatusNote';
import { type HomeFeature, SearchHomeIntro } from '@/features/search/SearchHomeIntro';
import { SearchIcd11Offer } from '@/features/search/SearchIcd11Offer';
import { SearchNoResults } from '@/features/search/SearchNoResults';
import { SearchQuickAccess } from '@/features/search/SearchQuickAccess';
import { SearchResultModuleDownload } from '@/features/search/SearchResultModuleDownload';
import { SearchSectionPicker } from '@/features/search/SearchSectionPicker';
import { SearchSectionsOverview } from '@/features/search/SearchSectionsOverview';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
import {
  SEARCH_CORE_NOTE_DELAY_MS,
  type SearchCoreStatus,
  searchCoreStatusHomeNoteVisible,
} from '@/features/search/search-core-status';
import { packOfferOwners, pointerModuleOf } from '@/features/search/search-pack-offers';
import { isSearchHash } from '@/features/search/search-query-route';
import {
  SECTION_WAIT_NOTICE_ID,
  sectionGate,
  sectionWaitMark,
} from '@/features/search/search-section-gate';
import { searchSectionFromHash, searchSectionHash } from '@/features/search/search-section-route';
import {
  matchingCatalogTools,
  SEARCH_SECTIONS,
  searchCatalogSections,
  searchCatalogTools,
  toolsFollowResults,
  unifiedSearchSpecialty,
} from '@/features/search/searchCatalog';
import { searchSectionDownloadBlocks } from '@/features/search/searchSectionDownloads';
import { sectionShortcutRows, sectionsOverviewRows } from '@/features/search/sections-overview';
import { UnifiedSearchCatalog } from '@/features/search/UnifiedSearchCatalog';
import { hideUsefulFeatures, USEFUL_FEATURES_NOTICE_ID } from '@/features/search/useful-features';
import { useSearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';
import { settingsPageHash } from '@/features/settings/settings-routing';
import { FeatureTour } from '@/features/setup/FeatureTour';
import { SkinHomeEntry } from '@/features/skin/SkinHomeEntry';
import { SKIN_PHOTO_TOOL } from '@/features/skin/skin-tool';
import { VACCINATION_TOOL } from '@/features/vaccination/vaccination-tool';
import { getUsefulFeaturesHidden, subscribeAppPreferences } from '@/state/app-preferences';
import { openDocumentOverlay } from '@/state/document-navigation';
import { experimentalModulesEnabled } from '@/state/experimental-modules';
import {
  appendSearchHistory,
  replaySearch,
  SEARCH_EVERYWHERE_EVENT,
  type SearchEverywhereDetail,
  type SearchHistoryEntry,
} from '@/state/search-history';
import { USER_LIBRARY_EXAMPLE_MRI_FILE_NAME } from '@/state/user-library';

import '@/features/search/search-help-sheet.css';
import { RELEASE_VERSION } from '../../../../../release';

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
}

/** A row of the «?» panel. Accessors keep the row's state live while the panel is open. */
interface HelpPanelAction {
  readonly id: string;
  readonly label: string;
  readonly icon: AppGlyphName;
  readonly onSelect: () => void;
  /** A line under the label, shown while the row is enabled. */
  readonly description?: string;
  readonly hidden?: () => boolean;
  readonly disabled?: () => boolean;
}

export function SearchHome(props: SearchHomeProps): JSX.Element {
  const [coreNoteDelayPassed, setCoreNoteDelayPassed] = createSignal(false);
  const coreNoteTimer = window.setTimeout(
    () => setCoreNoteDelayPassed(true),
    SEARCH_CORE_NOTE_DELAY_MS,
  );
  onCleanup(() => window.clearTimeout(coreNoteTimer));
  const noteCoreStatus = (): SearchCoreStatus | undefined =>
    props.coreStatus && searchCoreStatusHomeNoteVisible(props.coreStatus, coreNoteDelayPassed())
      ? props.coreStatus
      : undefined;
  /**
   * Why the medical core is not ready, or undefined once it is. A core that is absent without a
   * status (a moment between signals) counts as opening, so nothing opens onto an empty core.
   */
  const waitingCoreStatus = (): SearchCoreStatus | undefined =>
    props.coreStatus ??
    (props.baseCore === undefined ? { kind: 'opening', slow: false } : undefined);
  const sectionLocked = (next: SearchScope): boolean =>
    !sectionGate(next, waitingCoreStatus()).allowed;
  /** A section or scope that needs the core cannot be chosen yet: say so, stay where we are. */
  const allowSection = (next: SearchScope): boolean => {
    const gate = sectionGate(next, waitingCoreStatus());
    if (gate.allowed) return true;
    toast(gate.message, { id: SECTION_WAIT_NOTICE_ID });
    return false;
  };
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
  const sections = createMemo(() =>
    searchCatalogSections(documents(), toolRows(), SECTION_DOCUMENT_COUNTS),
  );
  const catalogQuickTools = createMemo(() => quickToolsFromCatalog(toolRows()));
  const downloads = useSearchSectionDownloads(
    () => props.active,
    () => props.onContentChanged(),
  );
  const documentsById = createMemo(
    () => new Map(documents().map((document) => [document.id, document])),
  );
  /** The first result is a drug card: a calculator that mentions the drug waits behind it. */
  const leadIsDrug = createMemo(() => {
    const first = resultDocumentIds()[0];
    const document = first === undefined ? undefined : documentsById().get(first);
    return document !== undefined && searchResultDocumentKind(document) === 'medication';
  });
  /** The result that carries each pack's download chip: a pack is offered once per list. */
  const packOffers = createMemo(() =>
    packOfferOwners(
      resultDocumentIds(),
      (documentId) => pointerModuleOf(documentsById().get(documentId), downloads.catalog())?.id,
    ),
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
  /** The «МКБ-11» section with no pack installed: the size of the download instead of an empty list. */
  const icd11Missing = createMemo(
    () =>
      scope() === 'icd11' &&
      catalogQuery().trim() === '' &&
      !catalogLoading() &&
      !catalogError() &&
      documents().every((entry) => !documentMatchesSearchScope(entry, 'icd11')),
  );
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
  // Search lists every tool; each card's age badge says whom it is for (owner 2026-10-25: no
  // «Дети / Взрослые / Все» filter inside search).
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
  /** Tools wait behind the documents for a bare disease name (searchCatalog `toolsFollowResults`). */
  const toolsAfterResults = createMemo(
    () => scope() === 'all' && toolsFollowResults(catalogQuery(), visibleTools(), leadIsDrug()),
  );
  const catalogView = (): JSX.Element => (
    <Show
      when={showSectionsOverview()}
      fallback={
        <div class="search-section-page">
          <Show when={icd11Missing()}>
            <SearchIcd11Offer
              modules={downloadBlocks().get('icd11/')?.modules ?? []}
              experimentalOff={
                !experimentalModulesEnabled() &&
                downloads
                  .catalog()
                  .modules.some(
                    (module) =>
                      module.collection === ICD11_COLLECTION && module.releaseState === 'preview',
                  )
              }
              downloads={downloads}
            />
          </Show>
          <UnifiedSearchCatalog
            core={props.baseCore}
            coreStatus={waitingCoreStatus()}
            scope={scope()}
            query={catalogQuery()}
            catalogOnly={catalogOnly()}
            hideDocuments={scope() === 'diagnosis' || icd11Missing()}
            documents={catalogDocuments()}
            tools={visibleTools()}
            onOpenTool={() => {
              if (catalogQuery().trim())
                appendSearchHistory(catalogQuery(), scope(), visibleTools().length, specialty());
            }}
            loading={catalogLoading()}
            error={catalogError()}
          />
        </div>
      }
    >
      <SearchSectionsOverview
        rows={sectionsOverviewRows(sourceSections())}
        shortcuts={sectionShortcutRows(downloads.catalog().modules)}
        locked={sectionLocked}
        waitMark={sectionWaitMark(waitingCoreStatus())}
        onSelect={(next) => openSection(next)}
      />
    </Show>
  );
  /** Default graph: the current results and their neighbours, not the whole scope. */
  const graphSelection = createMemo(() =>
    graphShowAll()
      ? { documents: visibleDocuments(), total: visibleDocuments().length, focused: false }
      : selectGraphNeighborhood(visibleDocuments(), { focusIds: new Set(resultDocumentIds()) }),
  );
  // «МКБ-11» opens on the 28 chapters: a flat list of tens of thousands of codes helps no one.
  const catalogDocuments = createMemo(() =>
    scope() === 'all'
      ? homeDocumentOrder(visibleDocuments())
      : scope() === 'icd11'
        ? icd11ChapterDocuments(visibleDocuments())
        : visibleDocuments(),
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
      ageScope: APP_FEATURE_AGE_SCOPE,
      group: 'reception',
      run: () => conversationSession.prepare(),
    },
    {
      id: APP_TOOL_IDS.ecgPhoto,
      title: 'ЭКГ по фото',
      kindLabel: 'Интервалы и QTc по снимку ленты',
      icon: 'heartbeat',
      ageScope: ECG_PHOTO_AGE_SCOPE,
      group: 'reception',
      href: `#/calculators/${ECG_PHOTO_CALIPER_ID}`,
    },
    // «Кожа по фото» is an experimental module.
    ...(experimentalModulesEnabled()
      ? [
          {
            id: SKIN_PHOTO_TOOL.id,
            title: SKIN_PHOTO_TOOL.title,
            kindLabel: SKIN_PHOTO_TOOL.kindLabel,
            icon: SKIN_PHOTO_TOOL.icon,
            ageScope: SKIN_PHOTO_TOOL.ageScope,
            group: 'reception' as const,
            href: SKIN_PHOTO_TOOL.href,
          },
        ]
      : []),
    {
      id: APP_TOOL_IDS.forms,
      title: 'Формы',
      kindLabel: 'Официальные формы',
      icon: 'file-text',
      ageScope: APP_FEATURE_AGE_SCOPE,
      group: 'reception',
      href: '#/notes/forms',
    },
    {
      id: VACCINATION_TOOL.id,
      title: VACCINATION_TOOL.title,
      kindLabel: VACCINATION_TOOL.kindLabel,
      icon: VACCINATION_TOOL.icon,
      ageScope: VACCINATION_TOOL.ageScope,
      group: 'reference',
      href: VACCINATION_TOOL.href,
    },
    {
      id: DRUG_INTERACTION_TOOL.id,
      title: DRUG_INTERACTION_TOOL.title,
      kindLabel: DRUG_INTERACTION_TOOL.kindLabel,
      icon: DRUG_INTERACTION_TOOL.icon,
      ageScope: DRUG_INTERACTION_TOOL.ageScope,
      group: 'reference',
      href: DRUG_INTERACTION_TOOL.href,
    },
    {
      id: 'minimed.app.atc-tree',
      title: 'Препараты по группам АТХ',
      kindLabel: 'Дерево АТХ: группа → вещество → препарат',
      icon: 'list-bullets',
      ageScope: APP_FEATURE_AGE_SCOPE,
      group: 'reference',
      href: MEDICATION_ATC_HASH,
    },
    {
      id: DRUG_COMPARISON_TOOL.id,
      title: DRUG_COMPARISON_TOOL.title,
      kindLabel: DRUG_COMPARISON_TOOL.kindLabel,
      icon: DRUG_COMPARISON_TOOL.icon,
      ageScope: DRUG_COMPARISON_TOOL.ageScope,
      group: 'reference',
      href: DRUG_COMPARISON_TOOL.href,
    },
    {
      id: PRESCRIPTION_TOOL.id,
      title: PRESCRIPTION_TOOL.title,
      kindLabel: PRESCRIPTION_TOOL.kindLabel,
      icon: PRESCRIPTION_TOOL.icon,
      ageScope: PRESCRIPTION_TOOL.ageScope,
      group: 'reference',
      href: PRESCRIPTION_TOOL.href,
    },
    {
      id: APP_TOOL_IDS.notes,
      title: 'Заметки',
      kindLabel: 'Заметки, PDF и исследования',
      icon: 'notes',
      ageScope: APP_FEATURE_AGE_SCOPE,
      group: 'files',
      href: '#/notes',
    },
    {
      id: APP_TOOL_IDS.imaging,
      title: 'Просмотр снимков',
      kindLabel: 'DICOM и NIfTI',
      icon: 'image',
      ageScope: APP_FEATURE_AGE_SCOPE,
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
      ageScope: APP_FEATURE_AGE_SCOPE,
      group: 'calculations',
      href: '#/calculators',
    },
    // No `group`: not listed in «Все инструменты», but a star from an older version still opens it.
    {
      id: APP_TOOL_IDS.patients,
      title: 'Пациенты',
      kindLabel: 'Карточки и дневники',
      icon: 'users',
      ageScope: APP_FEATURE_AGE_SCOPE,
      href: '#/notes/patients',
    },
    {
      id: APP_TOOL_IDS.assessments,
      title: 'Опросники',
      kindLabel: 'Шкалы и анкеты',
      icon: 'list-checks',
      ageScope: APP_FEATURE_AGE_SCOPE,
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
            ageScope: APP_FEATURE_AGE_SCOPE,
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
    ...(experimentalModulesEnabled()
      ? [{ id: 'skin-photo', render: () => <SkinHomeEntry /> }]
      : []),
    {
      id: 'imaging',
      render: () => (
        <HomeFeatureCard
          icon="image"
          title="Просмотр исследований"
          text="DICOM и NIfTI: срезы, 3D и контраст на устройстве"
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
          title="Запись беседы"
          text="Запись приёма в карточку пациента, только на устройстве"
          action={{
            label: 'Начать запись',
            icon: 'microphone',
            run: () => conversationSession.prepare(),
            ...(conversationSession.recorder() ? { unavailableReason: 'Запись уже идёт' } : {}),
          }}
          secondary={{ label: 'Пациенты', icon: 'users', href: '#/notes/patients' }}
        />
      ),
    },
    {
      id: 'drug-comparison',
      render: () => (
        <HomeFeatureCard
          icon={DRUG_COMPARISON_TOOL.icon}
          title={DRUG_COMPARISON_TOOL.title}
          text="Два–четыре препарата рядом, разделы инструкций дословно"
          action={{
            label: 'Сравнить',
            icon: DRUG_COMPARISON_TOOL.icon,
            href: DRUG_COMPARISON_TOOL.href,
          }}
          secondary={{
            label: 'Взаимодействие',
            icon: DRUG_INTERACTION_TOOL.icon,
            href: DRUG_INTERACTION_TOOL.href,
          }}
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
    // Only the first read is «loading»: a core swap (module install, pack attach) rereads the list
    // behind the catalog and the section counts already on screen, and replaces them only if they
    // changed — a background refresh never turns the page back into a loader.
    if (untrack(documents).length === 0) setCatalogLoading(true);
    if (!core) return;
    let current = true;
    void (core.listNavigationDocuments?.() ?? core.listDocuments()).then((result) => {
      if (!current) return;
      setCatalogLoading(false);
      if (result.ok) {
        const next = distinctNavigationDocuments(preferReadableDocuments(result.value));
        if (!sameDocumentList(untrack(documents), next)) setDocuments(next);
        setCatalogError(undefined);
        prepareDocumentLinksWhenIdle(result.value);
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
  /** The «?» panel, first part: where to learn the app and the search. */
  const helpActions: readonly HelpPanelAction[] = [
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
  /**
   * The «?» panel, second part: rare actions on the current section. They live here, not in the
   * top row, which has to keep room for the history button and the update notice on a phone.
   */
  const pageActions: readonly HelpPanelAction[] = [
    {
      id: 'random-record',
      label: 'Случайная запись',
      description: 'Из текущего раздела',
      icon: 'dice',
      disabled: () => !props.baseCore || catalogLoading() || visibleDocuments().length === 0,
      onSelect: () => {
        const document = pickRandomDocument(visibleDocuments());
        if (document) openDocumentOverlay(document.id);
      },
    },
    {
      id: 'knowledge-graph',
      label: 'Карта связей',
      description: 'Связи между документами раздела',
      icon: 'graph',
      hidden: () => catalogOnly() || scope() === 'diagnosis' || !experimentalModulesEnabled(),
      disabled: () => catalogLoading() || visibleDocuments().length === 0,
      onSelect: () => {
        setGraphShowAll(false);
        setGraphOpen(true);
      },
    },
  ];
  const renderHelpAction = (action: HelpPanelAction): JSX.Element => (
    <Show when={!action.hidden?.()}>
      <button
        type="button"
        class="search-help-sheet__item"
        disabled={action.disabled?.() ?? false}
        onClick={() => {
          setHelpMenuOpen(false);
          action.onSelect();
        }}
      >
        <AppGlyph name={action.icon} class="search-help-sheet__icon" />
        <span class="search-help-sheet__copy">
          <span class="search-help-sheet__label">{action.label}</span>
          <Show when={action.description}>
            {(description) => (
              <span class="search-help-sheet__hint">
                {action.disabled?.() ? 'Откроется, когда база будет готова' : description()}
              </span>
            )}
          </Show>
        </span>
      </button>
    </Show>
  );
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
    if (on && !allowSection('diagnosis')) return;
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
    if (!allowSection(next)) return;
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
      // The effect also runs when a signal the section reads changes without the section changing
      // (the groups being rewritten on the way to a section): that must not touch the address, or a
      // forward step onto a section entry bounces straight back off it.
      if (id === previous) return;
      if (!props.active) return;
      const current = searchSectionFromHash(window.location.hash, isSearchSection);
      if (id === undefined || id === 'all') {
        if (current) {
          if (ownsSectionEntry()) window.history.back();
          else window.history.replaceState(window.history.state, '', '#/search');
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
  /** The field has started sliding under the sticky row: the bar covers the row's side buttons. */
  const [fieldUnder, setFieldUnder] = createSignal(false);
  /**
   * The field's typing line has scrolled up behind the sticky row: the bar fills the row's middle
   * too and the row offers a way back to the field.
   */
  const [fieldAway, setFieldAway] = createSignal(false);
  let searchModeTools: HTMLElement | undefined;
  let searchScrollFrame: number | undefined;
  useStickySurface(() => searchModeTools);

  /** Scroll offsets of the bar's two stages (measured with the row, on resize). */
  let fieldUnderAt = Number.POSITIVE_INFINITY;
  let fieldAwayAt = Number.POSITIVE_INFINITY;
  const updateSearchScroll = (): void => {
    if (searchScrollFrame !== undefined) return;
    searchScrollFrame = requestAnimationFrame(() => {
      searchScrollFrame = undefined;
      const scrolled = window.scrollY;
      setHasSearchScroll(scrolled > 1);
      setFieldUnder(scrolled > fieldUnderAt);
      setFieldAway(scrolled > fieldAwayAt);
    });
  };

  createEffect(() => {
    const form = fieldForm();
    if (!form) return;
    // Measured on resize, never per scroll frame: where the row's middle cell sits (the bar's side
    // covers end there) and how far the page scrolls before the field's top reaches «MiniMed» (it
    // fades with the scroll over that whole distance, gone before the field passes under it).
    const measureRow = (): void => {
      const row = searchModeTools;
      const slot = row?.querySelector<HTMLElement>('.search-home__slot');
      const mark = row?.querySelector<HTMLElement>('.search-home__mark');
      if (!row || !form || !slot || !mark) return;
      const rowBox = row.getBoundingClientRect();
      // A hidden tab measures as zero; it measures again when shown (its size changes).
      if (rowBox.height === 0) return;
      const slotBox = slot.getBoundingClientRect();
      setLength(row, '--search-bar-middle-left', slotBox.left - rowBox.left);
      setLength(row, '--search-bar-middle-right', rowBox.right - slotBox.right);
      const stuckTop = Number.parseFloat(getComputedStyle(row).top) || 0;
      const fieldTop = form.getBoundingClientRect().top + window.scrollY;
      const markBottom = stuckTop + (mark.getBoundingClientRect().bottom - rowBox.top);
      setLength(row, '--search-mark-fade-end', Math.max(remToPx(1.5), fieldTop - markBottom));
      // The side covers slide in with the scroll from 2rem before the field's top reaches the
      // row's lower edge until 1.5rem after it (the field sits close under the row at rest).
      const reachRow = Math.max(0, fieldTop - (stuckTop + rowBox.height));
      setLength(row, '--search-bar-sides-start', Math.max(0, reachRow - remToPx(2)));
      setLength(row, '--search-bar-sides-end', reachRow + remToPx(1.5));
      // The two stages as scroll offsets, so the scroll handler reads no layout: under the row's
      // buttons once the field's top passes the stuck row's lower edge; the middle and the pill
      // once the typing line has risen 2rem past it (until then the field shows in the row's open
      // middle, framed by the covers' concave corners, owner 2026-10-29).
      const input = form.querySelector('[data-testid="search-input"]') ?? form;
      const inputBottom = input.getBoundingClientRect().bottom + window.scrollY;
      fieldUnderAt = reachRow;
      fieldAwayAt = Math.max(0, inputBottom - (stuckTop + rowBox.height) + remToPx(2));
      updateSearchScroll();
    };
    const rowObserver = new ResizeObserver(measureRow);
    if (searchModeTools) rowObserver.observe(searchModeTools);
    rowObserver.observe(form);
    const stopInsets = watchInsets(measureRow);
    onCleanup(() => {
      rowObserver.disconnect();
      stopInsets();
    });
  });

  onMount(() => {
    const refreshTools = () => setToolRevision((revision) => revision + 1);
    window.addEventListener(ASSESSMENT_PACKS_EVENT, refreshTools);
    window.addEventListener(CALCULATOR_PACKS_EVENT, refreshTools);
    onCleanup(() => {
      window.removeEventListener(ASSESSMENT_PACKS_EVENT, refreshTools);
      window.removeEventListener(CALCULATOR_PACKS_EVENT, refreshTools);
    });
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
      if (hash !== '' && !isSearchHash(hash)) return;
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
  // A reader's «Искать везде» (selection dictionary) searches its text across every source.
  onMount(() => {
    const searchEverywhere = (event: Event): void => {
      const query = (event as CustomEvent<SearchEverywhereDetail>).detail?.query.trim();
      if (!query) return;
      replayHistory({
        id: `reader-${Date.now()}`,
        query,
        scope: 'all',
        createdAt: new Date().toISOString(),
        resultCount: 0,
        modeUsed: 'lexical',
      });
    };
    window.addEventListener(SEARCH_EVERYWHERE_EVENT, searchEverywhere);
    onCleanup(() => window.removeEventListener(SEARCH_EVERYWHERE_EVENT, searchEverywhere));
  });

  return (
    <section class="search-home page-grain" aria-label="Поиск MiniMed">
      <PageHeroBand hero={PAGE_HEROES.search} class="page-hero--search" />
      <div
        class="search-home__backdrop-blur masked-backdrop-blur"
        classList={{ 'search-home__backdrop-blur--visible': hasSearchScroll() }}
        aria-hidden="true"
      />
      <div
        class="search-mode-tools route-sticky-chrome--transparent"
        classList={{ 'search-mode-tools--filled': fieldAway() }}
        ref={(element) => {
          searchModeTools = element;
        }}
      >
        {/* The band's bar behind the row in two stages: the side buttons once the field slides
            under them, the middle with the pill. */}
        <span
          class="search-mode-tools__bar"
          classList={{
            'search-mode-tools__bar--sides': fieldUnder(),
            'search-mode-tools__bar--on': fieldAway(),
          }}
          aria-hidden="true"
        >
          <span class="search-mode-tools__cover search-mode-tools__cover--start" />
          <span class="search-mode-tools__cover search-mode-tools__cover--end" />
        </span>
        <Show when={props.active}>
          <SearchHistoryPanel
            onReplay={replayHistory}
            back={sectionOpen() ? { label: 'Назад к разделам', onBack: backToSections } : undefined}
          />
        </Show>
        {/* The row's middle: «MiniMed» at rest, the field's pill once the field has scrolled
            away. Both stay in one cell, so the row never reflows. */}
        <span class="search-home__slot">
          <span
            class="search-home__mark"
            classList={{ 'search-home__mark--away': hasSearchScroll() }}
            aria-hidden="true"
          >
            MiniMed
          </span>
          <button
            class="search-field-pill"
            classList={{ 'search-field-pill--away': fieldAway() }}
            type="button"
            aria-label="Вернуться к поиску"
            tabIndex={fieldAway() ? 0 : -1}
            onClick={returnToField}
          >
            <AppGlyph name="search" class="search-field-pill__icon" />
            <span class="search-field-pill__label">{catalogQuery().trim() || 'Поиск'}</span>
          </button>
        </span>
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
            <For each={helpActions}>{(action) => renderHelpAction(action)}</For>
          </div>
          <div class="search-help-sheet__list search-help-sheet__list--page">
            <For each={pageActions}>{(action) => renderHelpAction(action)}</For>
          </div>
          <nav class="search-help-sheet__links" aria-label="Ссылки приложения">
            <ReleaseLinks linkClass="search-help-sheet__link" />
            <span class="search-help-sheet__version">v{RELEASE_VERSION}</span>
          </nav>
        </SheetPopover>
      </div>

      <div class="search-workspace-main">
        <SearchWorkspace
          core={scopedCore()}
          referenceCore={props.baseCore}
          onContentChanged={props.onContentChanged}
          scope={scope()}
          searchAllowed={props.baseCore !== undefined}
          searchPending={
            props.coreStatus !== undefined &&
            props.coreStatus.kind !== 'error' &&
            props.coreStatus.kind !== 'download-required' &&
            props.coreStatus.kind !== 'waiting'
          }
          fieldStatus={
            <Show when={noteCoreStatus()}>
              {(status) => (
                <SearchCoreStatusNote
                  variant="inline"
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
                offerOwners={packOffers()}
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
          toolStrip={<SearchQuickAccess tools={quickTools()} />}
          // An open section (calculators, questionnaires, ...) starts at its own list: the promo
          // carousel belongs to the section list only.
          intro={
            featuresHidden() || openSectionId() !== undefined ? undefined : (
              <SearchHomeIntro
                features={homeFeatures()}
                onHideFeatures={() =>
                  hideUsefulFeatures((message) =>
                    toast(message, {
                      id: USEFUL_FEATURES_NOTICE_ID,
                      action: {
                        label: 'Настройки',
                        onClick: () => {
                          window.location.hash = settingsPageHash('appearance');
                        },
                      },
                    }),
                  )
                }
              />
            )
          }
          catalog={toolsAfterResults() ? undefined : catalogView()}
          catalogAfterResults={toolsAfterResults() ? catalogView() : undefined}
          // The field stays usable while the core opens; its status is a line at the block's bottom.
          // One line on a 375 px phone: a textarea placeholder cannot end with «…».
          placeholder={
            scope() === 'diagnosis'
              ? 'Опишите случай: жалобы, анамнез, находки'
              : scope() === 'icd11'
                ? 'Код МКБ-11 или название'
                : 'Болезнь, код МКБ, препарат, фраза'
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
          </ul>
        </div>
      </OverlayDialog>
    </section>
  );
}
