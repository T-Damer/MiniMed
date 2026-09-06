import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  CoreStatus,
  InstalledContentModule,
  MedicalCore,
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
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { CountBadge } from '@/components/CountBadge';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBackWithReturnTo } from '@/components/NavBackWithReturnTo';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { Heading } from '@/components/Text';
import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import {
  CALCULATOR_SECTION_CATEGORY_IDS,
  CALCULATOR_SECTIONS,
} from '@/features/calculators/calculator-packs';
import { buildConditionCatalog } from '@/features/conditions/condition-catalog';
import { DocumentLibrary } from '@/features/library/DocumentLibrary';
import { openUserLibraryCatalog } from '@/features/library/user-library-routing';
import { ContentModuleCard } from '@/features/modules/ContentModuleCard';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { LawsDocumentsView } from '@/features/modules/LawsDocumentsView';
import {
  isCompanionMedicationsMounted,
  isModuleReleased,
  isPreinstalledCatalogModule,
  mergePreinstalledModules,
  type PreinstalledCatalogModuleOptions,
} from '@/features/modules/local-packaged-modules';
import { ModuleTaskStatus } from '@/features/modules/ModuleTaskStatus';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  catalogSelectionFromLocation,
  lawsRouteForModule,
  regulatoryModuleForSpecialty,
} from '@/features/modules/module-catalog-routing';
import {
  contentModuleTaskProgress,
  formatModuleBytes,
  formatModuleCollectionSubtitle,
  formatOverviewCollectionSubtitle,
  MODULE_RELEASE_LABELS,
  MODULE_TASK_LABELS,
  moduleCollectionDocumentCount,
  moduleDocumentCountFact,
  moduleListedDocumentCount,
  primaryModuleDocumentId,
} from '@/features/modules/module-display';
import {
  estimateDownloadStorage,
  selectBulkDownloadModules,
} from '@/features/modules/module-download-selection';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import {
  countDocumentsByOverviewBucket,
  EMPTY_OVERVIEW_DOCUMENT_COUNTS,
} from '@/features/modules/overview-document-counts';
import {
  moduleCollectionStats,
  moduleGroupDownloadProgress,
  moduleGroupTaskState,
  modulesInCategory,
  recommendationCategoryStats,
} from '@/features/modules/recommendation-categories';
import {
  installPublishedCategoryModules,
  removeInstalledCategoryModules,
} from '@/features/modules/recommendation-category-operations';
import {
  collectionLabel,
  documentCountLabel,
  recommendationCountLabel,
  sectionCountLabel,
} from '@/i18n/labels';
import { getModuleAutoUpdatesEnabled, subscribeAppPreferences } from '@/state/app-preferences';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import {
  consumeAndRestoreReturnTo,
  peekReturnTo,
  RETURN_TO_EVENT,
  returnToControlIcon,
  returnToControlLabel,
} from '@/state/return-navigation';

interface ModuleCatalogViewProps {
  readonly status: CoreStatus;
  readonly core: MedicalCore;
  readonly active: boolean;
  readonly embedded?: boolean;
  readonly onBack?: () => void;
  readonly onContentChanged?: () => Promise<void>;
  readonly onAvailableUpdates?: (count: number) => void;
}

interface ModuleLoadError {
  readonly title: string;
  readonly message: string;
}

const INDIVIDUAL_RECOMMENDATION_TAG = 'individual-recommendation';

function downloadProgressPercent(progress: ReturnType<typeof moduleGroupDownloadProgress>): number {
  return Math.round((progress.byteProgress ?? progress.installedFraction) * 100);
}

function availableCount(catalog: ContentModuleCatalog): number {
  return catalog.modules.filter(
    (module) => isModuleReleased(module) && !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
  ).length;
}

function openModuleDocument(module: ContentModuleCatalogEntry): void {
  const documentId = primaryModuleDocumentId(module);
  if (!documentId) return;
  openDocumentOverlay(documentId, null, { preferSummary: true });
}

function relatedCalculatorSectionsForCategory(
  categoryId: string,
): readonly (typeof CALCULATOR_SECTIONS)[number][] {
  return CALCULATOR_SECTIONS.filter((section) =>
    CALCULATOR_SECTION_CATEGORY_IDS[section.id].includes(categoryId),
  );
}

function matchesCatalogQuery(query: string, values: readonly string[]): boolean {
  return matchesFuzzyQuery(query, values);
}

function openCalculatorSection(sectionId: string): void {
  window.location.hash = `#/calculators/section/${sectionId}`;
}

export function ModuleCatalogView(props: ModuleCatalogViewProps): JSX.Element {
  const initialRuntime = peekContentModuleRuntime() ?? getContentModuleRuntime(MODULE_CATALOG);
  const [catalog, setCatalog] = createSignal<ContentModuleCatalog>(initialRuntime.getCatalog());
  const [warning, setWarning] = createSignal<string | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const [runtime, setRuntime] = createSignal(initialRuntime);
  const [installed, setInstalled] = createSignal<readonly InstalledContentModule[]>(
    runtime().listInstalled(),
  );
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  const [contentChangePending, setContentChangePending] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  // Tracks which single module (outside the category/bulk install paths, which already show their own
  // busy spinner throughout the reconnect) triggered the current connectContentChanges() call, so its
  // card can show an inline "connecting" loader instead of a page-wide banner.
  const [reconnectingModuleId, setReconnectingModuleId] = createSignal<string | null>(null);
  const [catalogQuery, setCatalogQuery] = createSignal('');
  const [recommendationCategory, setRecommendationCategory] = createSignal('');
  const [recommendationBrowserOpen, setRecommendationBrowserOpen] = createSignal(false);
  const [regularCollection, setRegularCollection] = createSignal('');
  const [busyCategories, setBusyCategories] = createSignal<ReadonlySet<string>>(new Set());
  const [installingAll, setInstallingAll] = createSignal(false);
  const [bulkInstallingModuleIds, setBulkInstallingModuleIds] = createSignal<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [detailsModule, setDetailsModule] = createSignal<ContentModuleCatalogEntry | null>(null);
  const [loadErrorDetails, setLoadErrorDetails] = createSignal<ModuleLoadError | null>(null);
  const [installErrors, setInstallErrors] = createSignal<Readonly<Record<string, string>>>({});
  const [coreLibraryOpen, setCoreLibraryOpen] = createSignal(false);
  const [lawsSpecialty, setLawsSpecialty] = createSignal('');
  const [pendingRemoval, setPendingRemoval] = createSignal<{
    readonly kind: 'module' | 'category';
    readonly id: string;
    readonly title: string;
  } | null>(null);
  const [moduleAutoUpdatesEnabled, setModuleAutoUpdatesEnabled] = createSignal(
    getModuleAutoUpdatesEnabled(),
  );
  const [pendingBulkDownload, setPendingBulkDownload] = createSignal<
    readonly ContentModuleCatalogEntry[] | null
  >(null);
  const pendingStorage = createMemo(() => estimateDownloadStorage(pendingBulkDownload() ?? []));
  const [returnTo, setReturnTo] = createSignal(peekReturnTo());
  const catalogSearchHasBack = (): boolean =>
    coreLibraryOpen() ||
    recommendationBrowserOpen() ||
    Boolean(regularCollection()) ||
    Boolean(returnTo());
  const catalogOverviewVisible = (): boolean =>
    !coreLibraryOpen() && !lawsSpecialty() && !recommendationBrowserOpen() && !regularCollection();
  const [overviewDocumentCounts, setOverviewDocumentCounts] = createSignal(
    EMPTY_OVERVIEW_DOCUMENT_COUNTS,
  );
  let refreshedOnce = false;
  let unsubscribeTask: (() => void) | undefined;
  let reconnectPending = false;
  let moduleCatalogHeading: HTMLDivElement | undefined;

  useStickySurface(() => moduleCatalogHeading);

  const bindRuntime = (nextCatalog: ContentModuleCatalog): void => {
    unsubscribeTask?.();
    const nextRuntime = getContentModuleRuntime(nextCatalog);
    setRuntime(nextRuntime);
    setInstalled(nextRuntime.listInstalled());
    setTasks(nextRuntime.listTasks());
    unsubscribeTask = nextRuntime.subscribe(() => {
      setTasks(nextRuntime.listTasks());
      setInstalled(nextRuntime.listInstalled());
    });
  };

  const syncSelectionFromLocation = (): void => {
    const selection = catalogSelectionFromLocation();
    setRegularCollection(selection?.kind === 'collection' ? selection.id : '');
    setRecommendationCategory(selection?.kind === 'category' ? selection.id : '');
    setRecommendationBrowserOpen(
      selection?.kind === 'recommendations' || selection?.kind === 'category',
    );
    setCoreLibraryOpen(selection?.kind === 'core-library');
    setLawsSpecialty(selection?.kind === 'laws' ? selection.specialty : '');
    setCatalogQuery('');
  };
  const openCollection = (collection: string): void => {
    window.location.hash = `#/modules/documents/collection/${encodeURIComponent(collection)}`;
    syncSelectionFromLocation();
  };
  const openCoreLibrary = (): void => {
    window.location.hash = '#/modules/documents/core-library';
    syncSelectionFromLocation();
  };
  const closeCoreLibrary = (): void => {
    window.location.hash = '#/modules/documents';
    syncSelectionFromLocation();
  };
  const openCategory = (categoryId: string): void => {
    window.location.hash = `#/modules/documents/category/${encodeURIComponent(categoryId)}`;
    syncSelectionFromLocation();
  };
  const openRecommendations = (): void => {
    window.location.hash = '#/modules/documents/recommendations';
    syncSelectionFromLocation();
  };
  const openMedications = (): void => {
    window.location.hash = '#/modules/documents/medications';
  };
  const openConditions = (): void => {
    window.location.hash = '#/modules/documents/conditions';
  };
  const [overviewConditionCount, setOverviewConditionCount] = createSignal(0);

  const refreshOverviewDocumentCounts = (): void => {
    void props.core.listDocuments().then((result) => {
      if (!result.ok) return;
      setOverviewDocumentCounts(countDocumentsByOverviewBucket(result.value));
      setOverviewConditionCount(buildConditionCatalog(result.value).length);
    });
  };

  const overviewSubtitle = (
    countLabel: string | null,
    stats: { readonly downloadBytes: number; readonly installedBytes: number },
  ): string | null => {
    return formatOverviewCollectionSubtitle({
      countLabel,
      downloadBytes: stats.downloadBytes,
      installedBytes: stats.installedBytes,
    });
  };

  onMount(() => {
    bindRuntime(catalog());
    onCleanup(
      subscribeAppPreferences((preferences) =>
        setModuleAutoUpdatesEnabled(preferences.moduleAutoUpdatesEnabled),
      ),
    );
    syncSelectionFromLocation();
    const initialCountsFrame = requestAnimationFrame(refreshOverviewDocumentCounts);
    window.addEventListener('hashchange', syncSelectionFromLocation);
    window.addEventListener(CONTENT_CHANGED_EVENT, refreshOverviewDocumentCounts);
    const syncReturnTo = () => {
      setReturnTo(peekReturnTo());
    };
    window.addEventListener(RETURN_TO_EVENT, syncReturnTo);
    onCleanup(() => {
      cancelAnimationFrame(initialCountsFrame);
      window.removeEventListener(RETURN_TO_EVENT, syncReturnTo);
    });
  });
  onCleanup(() => {
    unsubscribeTask?.();
    window.removeEventListener('hashchange', syncSelectionFromLocation);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refreshOverviewDocumentCounts);
  });

  const recommendationModules = createMemo(() =>
    catalog().modules.filter((module) => module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG)),
  );
  const recommendationSectionModules = createMemo(() =>
    catalog().modules.filter(
      (module) =>
        module.kind === 'clinical' && !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
    ),
  );
  const regularModules = createMemo(() =>
    catalog().modules.filter(
      (module) =>
        module.kind !== 'clinical' && !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
    ),
  );
  const regularSectionModules = (section: string): readonly ContentModuleCatalogEntry[] =>
    regularModules().filter((module) => module.kind === section || module.collection === section);
  const singleRegularSectionModule = (section: string): ContentModuleCatalogEntry | null => {
    const modules = regularSectionModules(section);
    return modules.length === 1 ? (modules[0] ?? null) : null;
  };
  const activeLawsModule = createMemo(() => {
    const specialty = lawsSpecialty();
    if (!specialty) return null;
    return regulatoryModuleForSpecialty(regularModules(), specialty) ?? null;
  });
  const regularSectionLabel = (section: string): string =>
    ({
      core: 'Ядро',
      reference: 'Нормы и расчёты',
      regulatory: 'Законы и нормативные акты',
      tool: 'Калькуляторы и опросники',
    })[section] ?? collectionLabel(section);
  const preinstallOptions = createMemo(
    (): PreinstalledCatalogModuleOptions => ({
      companionMedicationsMounted: isCompanionMedicationsMounted(overviewDocumentCounts()),
    }),
  );
  const installedWithBundled = createMemo(() =>
    mergePreinstalledModules(catalog(), installed(), preinstallOptions()),
  );
  const installedById = createMemo(
    () => new Map(installedWithBundled().map((module) => [module.moduleId, module])),
  );
  const installedModuleIds = createMemo(
    () => new Set(installedWithBundled().map((module) => module.moduleId)),
  );
  const medicationCatalogModules = createMemo(() =>
    catalog().modules.filter((module) => module.kind === 'medication'),
  );
  const conditionCatalogModules = createMemo(() =>
    catalog().modules.filter((module) => module.collection === 'conditions'),
  );
  const medicationCollectionStats = createMemo(() =>
    moduleCollectionStats(medicationCatalogModules(), installedById()),
  );
  const recommendationCollectionStats = createMemo(() =>
    moduleCollectionStats(recommendationModules(), installedById()),
  );
  const coreCollectionStats = createMemo(() =>
    moduleCollectionStats(regularSectionModules('core'), installedById()),
  );
  const categoryModules = (categoryId: string): readonly ContentModuleCatalogEntry[] =>
    modulesInCategory(recommendationModules(), categoryId);
  const filteredRecommendations = createMemo(() => {
    const query = catalogQuery().trim();
    const category = recommendationCategory();
    const matchesQuery = (module: ContentModuleCatalogEntry): boolean =>
      matchesCatalogQuery(query, [
        module.title,
        module.description,
        ...module.specialties,
        ...module.tags,
      ]);

    if (query.trim()) {
      return recommendationModules().filter(matchesQuery).slice(0, 50);
    }
    if (!category) return [];
    return categoryModules(category).filter(matchesQuery);
  });
  const bulkDownloadModules = createMemo(() =>
    selectBulkDownloadModules({
      coreLibraryOpen: coreLibraryOpen(),
      regularCollection: regularCollection(),
      recommendationBrowserOpen: recommendationBrowserOpen(),
      recommendationCategory: recommendationCategory(),
      catalogQuery: catalogQuery(),
      recommendationModules: recommendationModules(),
      regularModules: regularModules(),
      filteredRecommendationModules: filteredRecommendations(),
      regularSectionModules,
      categoryModules,
    }),
  );
  const bulkDownloadProgress = createMemo(() =>
    moduleGroupDownloadProgress(bulkDownloadModules(), installedModuleIds(), tasks()),
  );
  const bulkDownloadPercent = createMemo(() => downloadProgressPercent(bulkDownloadProgress()));
  const activeCategory = createMemo(() =>
    catalog().categories.find((category) => category.id === recommendationCategory()),
  );
  const activeCategoryModules = createMemo(() => categoryModules(recommendationCategory()));
  const activeCategoryDownloadProgress = createMemo(() =>
    moduleGroupDownloadProgress(activeCategoryModules(), installedModuleIds(), tasks()),
  );
  const activeCategoryTaskState = createMemo(() =>
    moduleGroupTaskState(activeCategoryModules(), tasks()),
  );
  const activeCategoryWorking = createMemo(
    () =>
      busyCategories().has(recommendationCategory()) ||
      activeCategoryTaskState() !== null ||
      activeCategoryModules().some((module) => bulkInstallingModuleIds().has(module.id)),
  );
  const activeCategoryComplete = (): boolean => {
    const category = activeCategory();
    return Boolean(
      category &&
        (() => {
          const stats = recommendationCategoryStats(
            recommendationModules(),
            category,
            installedById(),
          );
          return stats.installedCount > 0 && stats.pendingCount === 0;
        })(),
    );
  };
  const browsingSection = createMemo(
    () => Boolean(recommendationCategory()) && !catalogQuery().trim(),
  );
  const browsingSearch = createMemo(
    () => recommendationBrowserOpen() && Boolean(catalogQuery().trim()),
  );
  const visibleRegularSectionModules = (section: string): readonly ContentModuleCatalogEntry[] =>
    regularSectionModules(section).filter((module) =>
      matchesCatalogQuery(catalogQuery(), [module.title, module.description, ...module.tags]),
    );
  const regulatoryTitles: Readonly<Record<string, string>> = {
    'regulatory.rf.minzdrav.192n-2025':
      'Порядок диспансерного наблюдения несовершеннолетних — приказ № 192н',
    'regulatory.rf.minzdrav.211n-2025':
      'Профилактические медицинские осмотры несовершеннолетних — приказ № 211н',
    'regulatory.rf.minzdrav.302n-2019':
      'Диспансерное наблюдение несовершеннолетних — приказ № 302н (утратил силу)',
  };
  // "reference.<assessment id>" reference documents explain a specific assessment tool — resolve their
  // title from the same assessment catalog the tool itself uses, instead of falling back to the raw id.
  const referenceAssessmentTitle = (documentId: string): string | undefined => {
    const assessmentId = documentId.match(/^reference\.(minimed\.assessment\.[\w-]+)$/u)?.[1];
    if (!assessmentId) return undefined;
    return getAssessmentCatalog().find((assessment) => assessment.id === assessmentId)?.title;
  };
  const moduleDocumentTitle = (document: {
    readonly documentId: string;
    readonly title?: string | null;
  }): string => {
    const documentId = document.documentId;
    const catalogDocumentId = documentId.match(/^kr\.rf\.\d+_\d+/u)?.[0] ?? documentId;
    return (
      document.title ??
      regulatoryTitles[documentId] ??
      referenceAssessmentTitle(documentId) ??
      catalog().modules.find(
        (module) =>
          module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG) &&
          module.documents.some((entry) => entry.documentId === catalogDocumentId),
      )?.title ??
      documentId
    );
  };
  const moduleDocumentDate = (versionId: string): string => {
    const match = versionId.match(/(\d{4})-(\d{2})-(\d{2})(?:$|[-])/u);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : 'Дата редакции не указана';
  };

  const refresh = async (): Promise<void> => {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      const result = await refreshContentModuleCatalog();
      setCatalog(result.catalog);
      setWarning(result.warning);
      bindRuntime(result.catalog);
    } finally {
      setRefreshing(false);
    }
  };

  const connectContentChanges = async (): Promise<void> => {
    if (!props.onContentChanged) {
      setContentChangePending(true);
      return;
    }
    if (connecting()) {
      reconnectPending = true;
      return;
    }
    setConnecting(true);
    setWarning(null);
    try {
      do {
        reconnectPending = false;
        await props.onContentChanged();
        setContentChangePending(false);
      } while (reconnectPending);
    } catch (cause) {
      setContentChangePending(true);
      setWarning(
        cause instanceof Error
          ? cause.message
          : 'Новые документы сохранены, но пока не подключены к поиску.',
      );
    } finally {
      setConnecting(false);
    }
  };

  const isCategoryBusy = (categoryId: string): boolean => busyCategories().has(categoryId);

  const withCategoryBusy = async (
    categoryId: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    if (isCategoryBusy(categoryId)) return;
    setBusyCategories((current) => new Set([...current, categoryId]));
    try {
      await operation();
    } finally {
      setBusyCategories((current) => {
        const next = new Set(current);
        next.delete(categoryId);
        return next;
      });
    }
  };

  const installedModule = (moduleId: string): InstalledContentModule | undefined =>
    installedById().get(moduleId);
  const moduleTask = (moduleId: string): ContentModuleDownloadTask | undefined => {
    const latest = tasks().findLast((task) => task.moduleId === moduleId);
    return latest && !['completed', 'cancelled'].includes(latest.state) ? latest : undefined;
  };
  const moduleRetryScheduled = (moduleId: string): boolean => {
    const task = moduleTask(moduleId);
    return Boolean(task && runtime().isRetryScheduled(task));
  };

  const install = async (module: ContentModuleCatalogEntry, reconnect = true): Promise<boolean> => {
    setWarning(null);
    setInstallErrors((current) => ({ ...current, [module.id]: '' }));
    try {
      const task = runtime().install(module);
      setTasks(runtime().listTasks());
      const completed = await runtime().wait(task.id);
      setTasks(runtime().listTasks());
      setInstalled(runtime().listInstalled());
      if (completed.state === 'completed' && reconnect) {
        setReconnectingModuleId(module.id);
        try {
          await connectContentChanges();
        } finally {
          setReconnectingModuleId((current) => (current === module.id ? null : current));
        }
      }
      return completed.state === 'completed';
    } catch (cause) {
      setInstallErrors((current) => ({
        ...current,
        [module.id]: cause instanceof Error ? cause.message : 'Не удалось установить набор.',
      }));
      return false;
    }
  };

  const installModuleGroup = async (
    groupId: string,
    modules: readonly ContentModuleCatalogEntry[],
  ): Promise<void> => {
    await withCategoryBusy(groupId, async () => {
      if (modules.length === 0) return;

      setWarning(null);
      try {
        const result = await installPublishedCategoryModules(
          runtime(),
          modules,
          installedModuleIds(),
        );
        setTasks(runtime().listTasks());
        setInstalled(runtime().listInstalled());
        if (result.changed) await connectContentChanges();
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Не удалось скачать раздел целиком.';
        setInstallErrors((current) => ({
          ...current,
          ...Object.fromEntries(
            modules
              .filter((module) => isModuleReleased(module) && !installedModuleIds().has(module.id))
              .map((module) => [module.id, message]),
          ),
        }));
      }
    });
  };

  const installCategory = async (categoryId = recommendationCategory()): Promise<void> => {
    if (!categoryId) return;
    await installModuleGroup(categoryId, categoryModules(categoryId));
  };

  const installAllAvailable = async (
    modules: readonly ContentModuleCatalogEntry[],
  ): Promise<void> => {
    if (installingAll()) return;
    const pendingModules = modules.filter(
      (module) => isModuleReleased(module) && !installedModuleIds().has(module.id),
    );
    setInstallingAll(true);
    setBulkInstallingModuleIds(new Set(pendingModules.map((module) => module.id)));
    setWarning(null);
    try {
      const result = await installPublishedCategoryModules(
        runtime(),
        modules,
        installedModuleIds(),
      );
      setTasks(runtime().listTasks());
      setInstalled(runtime().listInstalled());
      if (result.changed) await connectContentChanges();
      if (result.errorMessage) setWarning(result.errorMessage);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Не удалось скачать доступные наборы.';
      setInstallErrors((current) => ({
        ...current,
        ...Object.fromEntries(
          modules
            .filter((module) => isModuleReleased(module) && !installedModuleIds().has(module.id))
            .map((module) => [module.id, message]),
        ),
      }));
    } finally {
      setBulkInstallingModuleIds(new Set<string>());
      setInstallingAll(false);
    }
  };

  const pendingDownloadCount = createMemo(
    () =>
      bulkDownloadModules().filter(
        (module) => isModuleReleased(module) && !installedModuleIds().has(module.id),
      ).length,
  );
  const bulkDownloadLabel = (): string =>
    recommendationBrowserOpen() ? 'Скачать все рекомендации' : 'Скачать все документы';

  const sectionDownloadControls = (
    groupId: string,
    title: string,
    modules: () => readonly ContentModuleCatalogEntry[],
  ): JSX.Element => {
    const installableModules = () => modules().filter(isModuleReleased);
    const progress = () => moduleGroupDownloadProgress(modules(), installedModuleIds(), tasks());
    const taskState = () => moduleGroupTaskState(modules(), tasks());
    const selectedByBulk = () =>
      modules().some((module) => bulkInstallingModuleIds().has(module.id));
    const working = () => isCategoryBusy(groupId) || taskState() !== null || selectedByBulk();
    const pendingCount = () =>
      installableModules().filter((module) => !installedModuleIds().has(module.id)).length;
    const availableModulesInstalled = () => installableModules().length > 0 && pendingCount() === 0;
    const unavailableLabel = () =>
      modules().some((module) => module.releaseState === 'preview')
        ? 'Включите Experimental в настройках'
        : 'Раздел пока не опубликован';
    const progressValue = () => progress().byteProgress ?? progress().installedFraction;
    const percent = () => Math.round(progressValue() * 100);

    return (
      <>
        <Show when={pendingCount() > 0 || working()}>
          <div class="recommendation-section-actions recommendation-section-card__actions">
            <button
              type="button"
              class="recommendation-section-actions__download"
              classList={{ 'recommendation-section-actions__download--busy': working() }}
              aria-label={
                working()
                  ? taskState() === 'queued'
                    ? `Раздел «${title}» в очереди на скачивание`
                    : `Скачивается раздел «${title}»: ${percent()}%`
                  : `Скачать раздел «${title}»`
              }
              title={
                working()
                  ? taskState() === 'queued'
                    ? 'В очереди'
                    : `Скачивается ${percent()}%`
                  : 'Скачать раздел'
              }
              disabled={working()}
              onClick={(event) => {
                event.stopPropagation();
                void installModuleGroup(groupId, modules());
              }}
            >
              <Show
                when={!working()}
                fallback={
                  <Show
                    when={taskState() === 'queued'}
                    fallback={<span class="module-action-spinner" />}
                  >
                    <AppGlyph name="clock" class="recommendation-section-actions__icon" />
                  </Show>
                }
              >
                <AppGlyph name="download" class="recommendation-section-actions__icon" />
              </Show>
            </button>
          </div>
        </Show>
        <Show when={working()}>
          <div
            class="recommendation-section-progress recommendation-section-card__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent()}
          >
            <i class="recommendation-section-progress__fill" style={{ width: `${percent()}%` }} />
          </div>
        </Show>
        <Show when={!working() && pendingCount() === 0}>
          <div class="recommendation-section-actions recommendation-section-card__actions">
            <Show
              when={availableModulesInstalled()}
              fallback={
                <button
                  type="button"
                  class="recommendation-section-actions__download recommendation-section-actions__download--unavailable"
                  aria-label={`Раздел «${title}» недоступен для скачивания: ${unavailableLabel()}`}
                  title={unavailableLabel()}
                  disabled
                >
                  <AppGlyph name="download" class="recommendation-section-actions__icon" />
                </button>
              }
            >
              <span
                class="recommendation-section-actions__state recommendation-section-actions__state--installed"
                title="Доступные наборы загружены"
              >
                <AppGlyph name="check" class="recommendation-section-actions__icon" />
                <span class="sr-only">Доступные наборы раздела «{title}» загружены</span>
              </span>
            </Show>
          </div>
        </Show>
      </>
    );
  };

  const removeCategory = async (categoryId = recommendationCategory()): Promise<void> => {
    if (!categoryId) return;
    let removed = false;
    await withCategoryBusy(categoryId, async () => {
      const modules = categoryModules(categoryId);
      if (modules.length === 0) return;

      try {
        await removeInstalledCategoryModules(runtime(), modules, installedModuleIds());
        setInstalled(runtime().listInstalled());
        removed = true;
      } catch (cause) {
        setWarning(cause instanceof Error ? cause.message : 'Не удалось удалить раздел.');
      }
    });
    if (removed) await connectContentChanges();
  };

  const remove = async (moduleId: string, reconnect = true): Promise<void> => {
    try {
      await runtime().remove(moduleId);
      setInstalled(runtime().listInstalled());
      if (reconnect) {
        setReconnectingModuleId(moduleId);
        try {
          await connectContentChanges();
        } finally {
          setReconnectingModuleId((current) => (current === moduleId ? null : current));
        }
      }
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : 'Не удалось удалить набор.');
    }
  };

  const requestRemoveCategory = (categoryId: string): void => {
    const title = catalog().categories.find((category) => category.id === categoryId)?.title;
    setPendingRemoval({ kind: 'category', id: categoryId, title: title ?? categoryId });
  };
  const requestRemove = (moduleId: string): void => {
    const title = catalog().modules.find((module) => module.id === moduleId)?.title;
    setPendingRemoval({ kind: 'module', id: moduleId, title: title ?? moduleId });
  };
  const confirmRemoval = async (): Promise<void> => {
    const pending = pendingRemoval();
    setPendingRemoval(null);
    if (!pending) return;
    if (pending.kind === 'category') await removeCategory(pending.id);
    else await remove(pending.id);
  };

  const activateVersion = async (moduleId: string, version: string): Promise<void> => {
    try {
      await runtime().rollback(moduleId, version);
      setInstalled(runtime().listInstalled());
      setReconnectingModuleId(moduleId);
      try {
        await connectContentChanges();
      } finally {
        setReconnectingModuleId((current) => (current === moduleId ? null : current));
      }
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : 'Не удалось открыть старую версию.');
    }
  };

  createEffect(() => {
    props.onAvailableUpdates?.(availableCount(catalog()));
  });

  createEffect(() => {
    if (!moduleAutoUpdatesEnabled()) return;
    const activeTasks = new Set(
      tasks()
        .filter((task) => !['completed', 'failed', 'cancelled'].includes(task.state))
        .map((task) => task.moduleId),
    );
    for (const module of catalog().modules) {
      const current = installedModule(module.id);
      if (
        current &&
        current.version !== module.version &&
        isModuleReleased(module) &&
        !activeTasks.has(module.id)
      ) {
        void install(module);
      }
    }
  });

  createEffect(() => {
    if (!props.active || refreshedOnce) return;
    refreshedOnce = true;
    void refresh();
  });

  return (
    <section
      class="module-page"
      classList={{ 'page-surface': !props.embedded, 'page-grain': !props.embedded }}
    >
      <Show when={!props.embedded || catalogOverviewVisible()}>
        <Page
          class="module-page-header"
          icon={<AppGlyph name="folder-open" class="page__icon-glyph" />}
          title={<Heading depth={1}>База знаний</Heading>}
          description="Скачивайте нужные разделы. После проверки они работают без интернета и участвуют в общем поиске MiniMed."
          actions={
            <Show when={!props.embedded && pendingDownloadCount() > 0}>
              <button
                type="button"
                aria-label={
                  installingAll()
                    ? `${bulkDownloadLabel()}: ${bulkDownloadPercent()}%`
                    : `${bulkDownloadLabel()}: ${pendingDownloadCount()}`
                }
                class="module-download-all"
                disabled={installingAll()}
                onClick={() =>
                  setPendingBulkDownload(
                    bulkDownloadModules().filter(
                      (module) => isModuleReleased(module) && !installedModuleIds().has(module.id),
                    ),
                  )
                }
              >
                <Show when={!installingAll()} fallback={<span class="module-action-spinner" />}>
                  <AppGlyph name="download" class="module-download-all__icon" />
                </Show>
                <span>
                  {installingAll() ? `Скачиваем ${bulkDownloadPercent()}%` : 'Скачать всё'}
                </span>
              </button>
            </Show>
          }
        />
      </Show>
      <Show
        when={
          props.embedded && !lawsSpecialty() && !singleRegularSectionModule(regularCollection())
        }
      >
        <div
          ref={moduleCatalogHeading}
          class="module-catalog-toolbar knowledge-subroute-heading--blurred route-sticky-chrome route-sticky-chrome--transparent"
        >
          <div class="knowledge-subroute-heading module-catalog-heading module-catalog-heading--in-toolbar">
            <Show
              when={catalogQuery().length > 0 && catalogSearchHasBack()}
              fallback={
                <>
                  <Show
                    when={
                      coreLibraryOpen() ||
                      recommendationBrowserOpen() ||
                      Boolean(regularCollection())
                    }
                  >
                    <NavBackWithReturnTo
                      catalogLabel="Назад"
                      catalogDetail="К предыдущему разделу"
                      catalogAriaLabel="Назад"
                      buttonClass="knowledge-back-button knowledge-subroute-heading__control"
                      onBackToCatalog={() =>
                        coreLibraryOpen() ? closeCoreLibrary() : props.onBack?.()
                      }
                    />
                  </Show>
                  <Show when={returnTo()}>
                    {(location) => (
                      <Show
                        when={
                          !coreLibraryOpen() && !recommendationBrowserOpen() && !regularCollection()
                        }
                      >
                        <Button
                          type="button"
                          variant="icon"
                          class="knowledge-back-button return-navigation-button knowledge-subroute-heading__control"
                          aria-label={returnToControlLabel(location())}
                          title={returnToControlLabel(location())}
                          onClick={() => consumeAndRestoreReturnTo()}
                          icon={<AppGlyph name={returnToControlIcon(location())} />}
                        />
                      </Show>
                    )}
                  </Show>
                </>
              }
            >
              <Button
                type="button"
                variant="icon"
                class="knowledge-back-button knowledge-subroute-heading__control"
                aria-label="Очистить поиск"
                title="Очистить поиск"
                onClick={() => setCatalogQuery('')}
                icon={<AppGlyph name="close" />}
              />
            </Show>
            <SearchField
              class="route-search knowledge-subroute-heading__control"
              value={catalogQuery()}
              onInput={setCatalogQuery}
              onClear={catalogSearchHasBack() ? undefined : () => setCatalogQuery('')}
              label="Поиск по текущему разделу"
              hideLabel
              placeholder="Поиск в текущем разделе"
            />
            <Show
              when={!coreLibraryOpen() && pendingDownloadCount() > 0 && !recommendationCategory()}
            >
              <button
                type="button"
                aria-label={
                  installingAll()
                    ? `${bulkDownloadLabel()}: ${bulkDownloadPercent()}%`
                    : `${bulkDownloadLabel()}: ${pendingDownloadCount()}`
                }
                class="module-download-all module-download-all--toolbar"
                disabled={installingAll()}
                onClick={() =>
                  setPendingBulkDownload(
                    bulkDownloadModules().filter(
                      (module) => isModuleReleased(module) && !installedModuleIds().has(module.id),
                    ),
                  )
                }
              >
                <Show when={!installingAll()} fallback={<span class="module-action-spinner" />}>
                  <AppGlyph name="download" class="module-download-all__icon" />
                </Show>
                <span>
                  {installingAll() ? `Скачиваем ${bulkDownloadPercent()}%` : 'Скачать всё'}
                </span>
              </button>
            </Show>
          </div>
        </div>
      </Show>

      {/* Active reconnects show an inline loader on the card that triggered them (ContentModuleCard's
         `connecting` prop, or the existing per-category busy spinner) instead of a page-wide banner.
         A reconnect that failed — or that has no in-view card to attach to — still needs a way to
         retry, so that stays here alongside any other warning. */}
      <Show when={warning() || (contentChangePending() && !connecting())}>
        <div class="module-doctor-warning paper-card">
          <span class="module-doctor-warning__message">
            {warning() ??
              'Документы сохранены на устройстве, но поиск пока использует прежний состав.'}
          </span>
          <Show when={contentChangePending() && !connecting()}>
            <button
              type="button"
              class="module-doctor-warning__action"
              onClick={() => void connectContentChanges()}
            >
              Повторить
            </button>
          </Show>
        </div>
      </Show>

      <Show when={activeLawsModule()}>
        {(module) => (
          <LawsDocumentsView
            module={module()}
            installed={Boolean(installedModule(module().id))}
            downloadAvailable={isModuleReleased(module())}
            task={moduleTask(module().id)}
            installError={installErrors()[module().id] || undefined}
            documentTitle={moduleDocumentTitle}
            documentDate={moduleDocumentDate}
            onInstall={() => install(module())}
            onRemove={() => requestRemove(module().id)}
            onBack={() => {
              window.location.hash = '#/modules/documents/collection/regulatory';
              syncSelectionFromLocation();
            }}
          />
        )}
      </Show>

      <Show when={coreLibraryOpen()}>
        <section class="module-page core-library-page">
          <DocumentLibrary core={props.core} embedded query={catalogQuery()} />
        </section>
      </Show>

      <Show
        when={
          !coreLibraryOpen() &&
          !lawsSpecialty() &&
          !recommendationBrowserOpen() &&
          !browsingSection() &&
          !browsingSearch()
        }
      >
        <Show when={!regularCollection()}>
          <div class="recommendation-section-grid recommendation-section-grid-compact user-library-catalog-card-slot">
            <article
              class="recommendation-section-card paper-card recommendation-section-card-compact recommendation-section-card--user-library"
              tabindex="0"
              aria-label="Открыть личные документы"
              onClick={openUserLibraryCatalog}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') openUserLibraryCatalog();
              }}
            >
              <AppGlyph name="folder-open" class="recommendation-section-card-icon" />
              <strong class="recommendation-section-card-title">Ваши документы</strong>
              <span class="recommendation-section-card-meta">
                Личные документы · только на этом устройстве
              </span>
            </article>
          </div>
        </Show>

        <Show when={recommendationModules().length === 0}>
          <section class="module-collection recommendation-browser">
            <div class="module-collection-heading">
              <h2 class="module-collection-heading__title">Клинические рекомендации</h2>
            </div>
            <p class="recommendation-result-note">
              Отдельные клинические рекомендации (около 700) появятся здесь после публикации снимка
              канала preview. Сейчас для скачивания доступны только тематические наборы ниже — у них
              статус «Можно скачать».
            </p>
          </section>
        </Show>

        <Show when={!regularCollection()}>
          <section class="module-collection">
            <div class="module-collection-heading">
              <h2 class="module-collection-heading__title">Наборы документов</h2>
              <CountBadge value={6 + (regularSectionModules('tool').length > 0 ? 1 : 0)} />
            </div>
            <div class="recommendation-section-grid recommendation-section-grid-compact">
              <Show
                when={matchesCatalogQuery(catalogQuery(), [
                  'Заболевания и состояния',
                  'Заболевания',
                  'Состояния',
                  'Синдромы',
                  'Симптомы',
                  'МКБ-10',
                ])}
              >
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact recommendation-section-card--downloadable"
                  tabindex="0"
                  aria-label="Открыть перечень заболеваний и состояний"
                  onClick={openConditions}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openConditions();
                  }}
                >
                  <AppGlyph name="book-open" class="recommendation-section-card-icon" />
                  <strong class="recommendation-section-card-title">Заболевания и состояния</strong>
                  <span class="recommendation-section-card-meta">
                    {overviewConditionCount() > 0
                      ? `${overviewConditionCount()} записей · МКБ-10, рекомендации и справочники`
                      : 'МКБ-10, рекомендации и справочники'}
                  </span>
                  {sectionDownloadControls(
                    'conditions',
                    'Заболевания и состояния',
                    conditionCatalogModules,
                  )}
                </article>
              </Show>
              <Show
                when={matchesCatalogQuery(catalogQuery(), [
                  'Лекарства',
                  'Официальная инструкция и формы выпуска',
                ])}
              >
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact recommendation-section-card--downloadable"
                  tabindex="0"
                  aria-label="Открыть набор «Лекарства»"
                  onClick={openMedications}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openMedications();
                  }}
                >
                  <AppGlyph name="notes" class="recommendation-section-card-icon" />
                  <strong class="recommendation-section-card-title">Лекарства</strong>
                  <Show
                    when={overviewSubtitle(
                      overviewDocumentCounts().medications > 0
                        ? documentCountLabel(overviewDocumentCounts().medications)
                        : null,
                      medicationCollectionStats(),
                    )}
                  >
                    {(subtitle) => (
                      <span class="recommendation-section-card-meta">{subtitle()}</span>
                    )}
                  </Show>
                  {sectionDownloadControls('medications', 'Лекарства', medicationCatalogModules)}
                </article>
              </Show>
              <For each={['reference', 'regulatory', 'tool']}>
                {(section) => {
                  const modules = () => regularSectionModules(section);
                  const stats = () => moduleCollectionStats(modules(), installedById());
                  const countLabel = (): string | null => {
                    if (section !== 'reference' && section !== 'regulatory') return null;
                    const count = moduleCollectionDocumentCount(modules());
                    return count > 0 ? documentCountLabel(count) : null;
                  };
                  return (
                    <Show
                      when={matchesCatalogQuery(catalogQuery(), [regularSectionLabel(section)])}
                    >
                      <article
                        class="recommendation-section-card paper-card recommendation-section-card-compact recommendation-section-card--downloadable"
                        tabindex="0"
                        aria-label={`Открыть набор «${regularSectionLabel(section)}»`}
                        onClick={() => openCollection(section)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') openCollection(section);
                        }}
                      >
                        <AppGlyph
                          name={
                            section === 'reference'
                              ? 'calculator'
                              : section === 'regulatory'
                                ? 'folder-open'
                                : 'archive'
                          }
                          class="recommendation-section-card-icon"
                        />
                        <strong class="recommendation-section-card-title">
                          {regularSectionLabel(section)}
                        </strong>
                        <Show when={overviewSubtitle(countLabel(), stats())}>
                          {(subtitle) => (
                            <span class="recommendation-section-card-meta">{subtitle()}</span>
                          )}
                        </Show>
                        {sectionDownloadControls(section, regularSectionLabel(section), modules)}
                      </article>
                    </Show>
                  );
                }}
              </For>
              <Show when={matchesCatalogQuery(catalogQuery(), ['Клинические рекомендации'])}>
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact recommendation-section-card--downloadable clinical-recommendations-entry"
                  tabindex="0"
                  aria-label="Открыть набор «Клинические рекомендации»"
                  onClick={openRecommendations}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openRecommendations();
                  }}
                >
                  <AppGlyph name="book-open" class="recommendation-section-card-icon" />
                  <strong class="recommendation-section-card-title">
                    Клинические рекомендации
                  </strong>
                  <Show
                    when={overviewSubtitle(
                      sectionCountLabel(recommendationSectionModules().length),
                      recommendationCollectionStats(),
                    )}
                  >
                    {(subtitle) => (
                      <span class="recommendation-section-card-meta">{subtitle()}</span>
                    )}
                  </Show>
                  {sectionDownloadControls(
                    'recommendations',
                    'Клинические рекомендации',
                    recommendationModules,
                  )}
                </article>
              </Show>
              <Show when={matchesCatalogQuery(catalogQuery(), ['Ядро'])}>
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact"
                  tabindex="0"
                  aria-label="Открыть набор «Ядро»"
                  onClick={openCoreLibrary}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openCoreLibrary();
                  }}
                >
                  <AppGlyph name="modules" class="recommendation-section-card-icon" />
                  <strong class="recommendation-section-card-title">Ядро</strong>
                  <Show
                    when={overviewSubtitle(
                      overviewDocumentCounts().core > 0
                        ? documentCountLabel(overviewDocumentCounts().core)
                        : null,
                      coreCollectionStats(),
                    )}
                  >
                    {(subtitle) => (
                      <span class="recommendation-section-card-meta">{subtitle()}</span>
                    )}
                  </Show>
                </article>
              </Show>
            </div>
          </section>
        </Show>

        <For each={regularCollection() ? [regularCollection()] : []}>
          {(section) => (
            <Show
              when={singleRegularSectionModule(section)}
              fallback={
                <section class="module-collection">
                  <div class="module-collection-heading">
                    <h2 class="module-collection-heading__title">{regularSectionLabel(section)}</h2>
                    <CountBadge value={regularSectionModules(section).length} />
                  </div>
                  <div class="module-grid module-grid-two-columns">
                    <For each={visibleRegularSectionModules(section)}>
                      {(module) => (
                        <ContentModuleCard
                          module={module}
                          installed={installedModule(module.id)}
                          task={moduleTask(module.id)}
                          retryScheduled={moduleRetryScheduled(module.id)}
                          fallbackError={installErrors()[module.id]}
                          connecting={reconnectingModuleId() === module.id && connecting()}
                          preinstallOptions={preinstallOptions()}
                          onInspect={() => {
                            const route = lawsRouteForModule(module);
                            if (route) {
                              window.location.hash = route;
                              syncSelectionFromLocation();
                              return;
                            }
                            setDetailsModule(module);
                          }}
                          onOpenError={(message) =>
                            setLoadErrorDetails({ title: module.title, message })
                          }
                          onInstall={() => void install(module)}
                          onOpenCore={openCoreLibrary}
                          onRemove={() => requestRemove(module.id)}
                          onActivateVersion={(version) => void activateVersion(module.id, version)}
                        />
                      )}
                    </For>
                  </div>
                </section>
              }
            >
              {(module) => (
                <LawsDocumentsView
                  module={module()}
                  installed={Boolean(installedModule(module().id))}
                  downloadAvailable={isModuleReleased(module())}
                  task={moduleTask(module().id)}
                  installError={installErrors()[module().id] || undefined}
                  documentTitle={moduleDocumentTitle}
                  documentDate={moduleDocumentDate}
                  onInstall={() => install(module())}
                  onRemove={() => requestRemove(module().id)}
                  onBack={() => props.onBack?.()}
                />
              )}
            </Show>
          )}
        </For>
      </Show>

      <Show
        when={
          !coreLibraryOpen() &&
          !lawsSpecialty() &&
          recommendationModules().length > 0 &&
          !regularCollection() &&
          recommendationBrowserOpen()
        }
      >
        <section class="module-collection recommendation-browser recommendation-browser-nested">
          <Show when={!browsingSection() && !browsingSearch()}>
            <div class="module-collection-heading recommendation-browser-heading">
              <h2 class="module-collection-heading__title">Клинические рекомендации</h2>
              <CountBadge value={catalog().categories.length} />
            </div>

            <div class="recommendation-section-grid recommendation-section-grid-compact">
              <For each={catalog().categories}>
                {(category) => {
                  const modules = () => categoryModules(category.id);
                  const stats = () =>
                    recommendationCategoryStats(recommendationModules(), category, installedById());
                  const categoryBusy = () => isCategoryBusy(category.id);
                  const downloadProgress = () =>
                    moduleGroupDownloadProgress(modules(), installedModuleIds(), tasks());
                  const taskState = () => moduleGroupTaskState(modules(), tasks());
                  const selectedByBulk = () =>
                    modules().some((module) => bulkInstallingModuleIds().has(module.id));
                  const categoryWorking = () =>
                    categoryBusy() || taskState() !== null || selectedByBulk();
                  const showByteProgress = () => downloadProgress().byteProgress;
                  const categoryDownloadPercent = () => downloadProgressPercent(downloadProgress());
                  return (
                    <article
                      class="recommendation-section-card paper-card recommendation-section-card-compact recommendation-section-card--category"
                      tabindex="0"
                      aria-label={`Открыть раздел «${category.title}»`}
                      onClick={(event) => {
                        if (!(event.target instanceof HTMLButtonElement)) openCategory(category.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') openCategory(category.id);
                      }}
                    >
                      <div class="recommendation-section-card-header">
                        <strong class="recommendation-section-card-title">{category.title}</strong>
                        <Show
                          when={formatModuleCollectionSubtitle(
                            stats().installedCount,
                            stats().publishedCount,
                            stats().downloadBytes,
                            stats().installedBytes,
                          )}
                        >
                          {(subtitle) => (
                            <span class="recommendation-section-card-meta recommendation-section-card-meta--stats">
                              {subtitle()}
                            </span>
                          )}
                        </Show>
                      </div>
                      <Show when={downloadProgress().installedFraction < 1}>
                        <div
                          class="recommendation-section-progress"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(
                            (showByteProgress() ?? downloadProgress().installedFraction) * 100,
                          )}
                        >
                          <i
                            class="recommendation-section-progress__fill"
                            style={{
                              width: `${Math.round(
                                (showByteProgress() ?? downloadProgress().installedFraction) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                      </Show>
                      <div class="recommendation-section-actions">
                        <Show
                          when={stats().pendingCount > 0 || categoryWorking()}
                          fallback={
                            <Button
                              type="button"
                              variant="primary"
                              class="recommendation-delete-button"
                              aria-label={`Удалить раздел «${category.title}»`}
                              title="Удалить раздел"
                              disabled={stats().installedCount === 0 || categoryBusy()}
                              onClick={(event) => {
                                event.stopPropagation();
                                requestRemoveCategory(category.id);
                              }}
                              icon={
                                <Show
                                  when={!categoryBusy()}
                                  fallback={<span class="module-action-spinner" />}
                                >
                                  <AppGlyph
                                    name="trash"
                                    class="recommendation-delete-button__icon"
                                  />
                                </Show>
                              }
                            />
                          }
                        >
                          <button
                            type="button"
                            class="recommendation-section-actions__download"
                            classList={{
                              'recommendation-section-actions__download--busy': categoryWorking(),
                            }}
                            aria-label={
                              categoryWorking()
                                ? taskState() === 'queued'
                                  ? `Раздел «${category.title}» в очереди на скачивание`
                                  : `Скачивается раздел «${category.title}»: ${categoryDownloadPercent()}%`
                                : `Скачать раздел «${category.title}»`
                            }
                            title={
                              categoryWorking()
                                ? taskState() === 'queued'
                                  ? 'В очереди'
                                  : `Скачивается ${categoryDownloadPercent()}%`
                                : 'Скачать раздел'
                            }
                            disabled={categoryWorking()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void installCategory(category.id);
                            }}
                          >
                            <Show
                              when={!categoryWorking()}
                              fallback={
                                <Show
                                  when={taskState() === 'queued'}
                                  fallback={
                                    <>
                                      <span class="module-action-spinner" />
                                      <span class="recommendation-section-actions__progress">
                                        {categoryDownloadPercent()}%
                                      </span>
                                    </>
                                  }
                                >
                                  <AppGlyph
                                    name="clock"
                                    class="recommendation-section-actions__icon"
                                  />
                                </Show>
                              }
                            >
                              <AppGlyph
                                name="download"
                                class="recommendation-section-actions__icon"
                              />
                            </Show>
                          </button>
                        </Show>
                      </div>
                    </article>
                  );
                }}
              </For>
            </div>
          </Show>

          <Show when={browsingSection() || browsingSearch()}>
            <Show when={browsingSection()}>
              <div class="recommendation-list-heading recommendation-list-heading-compact">
                <h3>{activeCategory()?.title}</h3>
                <div class="recommendation-list-actions">
                  <button
                    type="button"
                    class="recommendation-list-actions__download"
                    aria-label={
                      activeCategoryWorking()
                        ? activeCategoryTaskState() === 'queued'
                          ? 'Раздел в очереди на скачивание'
                          : `Скачивается раздел: ${downloadProgressPercent(
                              activeCategoryDownloadProgress(),
                            )}%`
                        : activeCategoryComplete()
                          ? 'Удалить раздел'
                          : 'Скачать раздел'
                    }
                    title={activeCategoryComplete() ? 'Удалить раздел' : 'Скачать раздел'}
                    disabled={activeCategoryWorking()}
                    onClick={() =>
                      void (activeCategoryComplete() ? removeCategory() : installCategory())
                    }
                  >
                    <Show
                      when={!activeCategoryWorking()}
                      fallback={
                        <Show
                          when={activeCategoryTaskState() === 'queued'}
                          fallback={<span class="module-action-spinner" />}
                        >
                          <AppGlyph name="clock" class="recommendation-list-actions__icon" />
                        </Show>
                      }
                    >
                      <AppGlyph
                        name={activeCategoryComplete() ? 'trash' : 'download'}
                        class="recommendation-list-actions__icon"
                      />
                    </Show>
                    <span>
                      {activeCategoryWorking()
                        ? activeCategoryTaskState() === 'queued'
                          ? 'В очереди'
                          : `Скачиваем ${downloadProgressPercent(activeCategoryDownloadProgress())}%`
                        : activeCategoryComplete()
                          ? 'Удалить раздел'
                          : 'Скачать раздел'}
                    </span>
                  </button>
                </div>
              </div>
              <Show
                when={relatedCalculatorSectionsForCategory(recommendationCategory()).length > 0}
              >
                <div class="recommendation-related-calculators">
                  <span>Калькуляторы по теме:</span>
                  <For each={relatedCalculatorSectionsForCategory(recommendationCategory())}>
                    {(section) => (
                      <button type="button" onClick={() => openCalculatorSection(section.id)}>
                        {section.title}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>

            <Show when={browsingSearch()}>
              <div class="recommendation-list-heading recommendation-list-heading-compact">
                <h3>Результаты поиска</h3>
              </div>
            </Show>

            <p class="recommendation-result-note">
              {recommendationCountLabel(filteredRecommendations().length)}
              {browsingSearch() && filteredRecommendations().length === 50
                ? ' · показаны первые'
                : ''}
            </p>

            <div class="recommendation-list recommendation-list-compact">
              <LayoutVirtualizedGrid
                data={filteredRecommendations()}
                bufferSize={500}
                maxColumns={3}
              >
                {(module) => {
                  const installedValue = () => installedModule(module.id);
                  const task = () => moduleTask(module.id);
                  const retryScheduled = () => moduleRetryScheduled(module.id);
                  const progress = () =>
                    task() ? contentModuleTaskProgress(task() as ContentModuleDownloadTask) : null;
                  const installError = () =>
                    task()?.state === 'failed' && !retryScheduled()
                      ? task()?.errorMessage || 'Не удалось скачать документ.'
                      : installErrors()[module.id] || null;
                  const working = () =>
                    retryScheduled() ||
                    (task() && !['completed', 'failed', 'cancelled'].includes(task()?.state ?? ''));
                  const queued = () => task()?.state === 'queued';
                  return (
                    <article
                      class="recommendation-row paper-card recommendation-row-compact medication-product-card"
                      classList={{
                        'recommendation-row-openable': Boolean(
                          installedValue() && primaryModuleDocumentId(module),
                        ),
                      }}
                      tabindex={installedValue() && primaryModuleDocumentId(module) ? 0 : undefined}
                      aria-label={
                        installedValue() && primaryModuleDocumentId(module)
                          ? `Открыть «${module.title}»`
                          : undefined
                      }
                      onClick={(event) => {
                        if (
                          installedValue() &&
                          primaryModuleDocumentId(module) &&
                          !(event.target instanceof HTMLButtonElement)
                        ) {
                          openModuleDocument(module);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.key === 'Enter' || event.key === ' ') &&
                          installedValue() &&
                          primaryModuleDocumentId(module)
                        ) {
                          event.preventDefault();
                          openModuleDocument(module);
                        }
                      }}
                    >
                      <div class="recommendation-row__content recommendation-row-compact__content">
                        <strong class="recommendation-row__title recommendation-row-compact__title">
                          {module.title}
                        </strong>
                        <span class="recommendation-row__meta">
                          {[
                            module.tags.find((tag) => /^\d+_\d+$/u.test(tag)),
                            formatModuleBytes(module.sizes.downloadBytes),
                            installedValue()
                              ? `загружено ${formatModuleBytes(
                                  installedValue()?.installedSizeBytes ?? null,
                                )}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <Show when={retryScheduled() || installError()}>
                          <ModuleTaskStatus
                            label={
                              retryScheduled()
                                ? 'Повторим автоматически'
                                : MODULE_TASK_LABELS[task()?.state ?? 'failed']
                            }
                            progress={null}
                            errorMessage={retryScheduled() ? null : installError()}
                            onOpenError={() =>
                              setLoadErrorDetails({
                                title: module.title,
                                message: installError() ?? 'Не удалось скачать документ.',
                              })
                            }
                          />
                        </Show>
                      </div>
                      <Show
                        when={!installedValue()}
                        fallback={
                          <div class="recommendation-row-actions recommendation-row-actions--compact">
                            <Button
                              type="button"
                              variant="primary"
                              class="recommendation-delete-button"
                              aria-label={`Удалить «${module.title}»`}
                              title="Удалить"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestRemove(module.id);
                              }}
                              icon={
                                <AppGlyph name="trash" class="recommendation-delete-button__icon" />
                              }
                            />
                          </div>
                        }
                      >
                        <Button
                          type="button"
                          variant="icon"
                          class="recommendation-row-download-button"
                          aria-label={
                            working()
                              ? `Скачивается «${module.title}»: ${Math.round(
                                  (progress() ?? 0) * 100,
                                )}%`
                              : `Скачать «${module.title}»`
                          }
                          title={working() ? 'Скачивается' : 'Скачать'}
                          disabled={working() || !isModuleReleased(module)}
                          onClick={(event) => {
                            event.stopPropagation();
                            void install(module);
                          }}
                          icon={
                            <Show
                              when={!working()}
                              fallback={
                                <Show
                                  when={queued()}
                                  fallback={<span class="module-action-spinner" />}
                                >
                                  <AppGlyph
                                    name="clock"
                                    class="recommendation-row-download-button__icon"
                                  />
                                </Show>
                              }
                            >
                              <AppGlyph
                                name="download"
                                class="recommendation-row-download-button__icon"
                              />
                            </Show>
                          }
                        />
                      </Show>
                      <Show when={!installedValue() && working() && progress() !== null}>
                        <div
                          class="recommendation-row-progress recommendation-row-progress--card"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round((progress() ?? 0) * 100)}
                        >
                          <i
                            class="recommendation-row-progress__fill"
                            style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }}
                          />
                        </div>
                      </Show>
                    </article>
                  );
                }}
              </LayoutVirtualizedGrid>
            </div>
          </Show>
        </section>
      </Show>

      <OverlayDialog
        open={loadErrorDetails() !== null}
        title="Ошибка при загрузке"
        subtitle={loadErrorDetails()?.title ?? ''}
        class="module-error-dialog"
        onClose={() => setLoadErrorDetails(null)}
      >
        <div class="module-error-details">
          <p class="module-error-details__text">{loadErrorDetails()?.message}</p>
        </div>
      </OverlayDialog>

      <OverlayDialog
        open={detailsModule() !== null}
        title={detailsModule()?.title ?? 'Набор документов'}
        subtitle={`${MODULE_RELEASE_LABELS[detailsModule()?.releaseState ?? 'planned']} · ${
          detailsModule()?.version ?? ''
        }`}
        class="recommendation-section-help-dialog"
        onClose={() => setDetailsModule(null)}
      >
        <Show when={detailsModule()}>
          {(module) => (
            <div class="recommendation-section-help-body">
              <Show
                when={
                  isModuleReleased(module()) &&
                  !installedModule(module().id) &&
                  !isPreinstalledCatalogModule(module(), preinstallOptions())
                }
              >
                <Button
                  type="button"
                  class="recommendation-section-help-download"
                  disabled={Boolean(
                    moduleTask(module().id) && moduleTask(module().id)?.state !== 'failed',
                  )}
                  onClick={() => void install(module())}
                >
                  {moduleTask(module().id)?.state === 'queued'
                    ? 'В очереди'
                    : moduleTask(module().id)?.state === 'downloading'
                      ? 'Скачиваем…'
                      : 'Скачать'}
                </Button>
              </Show>
              <p>{module().description}</p>
              <ul class="recommendation-section-help-facts">
                <li>{moduleDocumentCountFact(module())}</li>
                <li>{formatModuleBytes(module().sizes.downloadBytes)}</li>
              </ul>
              <Show
                when={module().documents.length > 0}
                fallback={
                  <Show when={moduleListedDocumentCount(module()) === 0}>
                    <p class="recommendation-section-help-note">
                      Полный список документов появится здесь после публикации набора.
                    </p>
                  </Show>
                }
              >
                <div class="recommendation-section-document-list">
                  <For each={module().documents}>
                    {(document) => {
                      const canOpen = () =>
                        isPreinstalledCatalogModule(module(), preinstallOptions()) ||
                        Boolean(installedModule(module().id));
                      return (
                        <button
                          type="button"
                          class="module-document-row"
                          classList={{ 'module-document-row-openable': canOpen() }}
                          disabled={!canOpen()}
                          onClick={() => {
                            if (canOpen()) openDocumentOverlay(document.documentId);
                          }}
                          onKeyDown={(event) => {
                            if (canOpen() && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault();
                              openDocumentOverlay(document.documentId);
                            }
                          }}
                        >
                          <strong>{moduleDocumentTitle(document)}</strong>
                          <span>
                            {moduleDocumentDate(document.documentVersionId)} ·{' '}
                            {document.status === 'active'
                              ? 'действующая редакция'
                              : document.status === 'historical'
                                ? 'историческая редакция'
                                : 'предыдущая редакция'}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </OverlayDialog>

      <ConfirmationDialog
        open={pendingBulkDownload() !== null}
        title="Скачать всё"
        description={
          pendingStorage().incomplete
            ? `Хотите скачать все пакеты знаний${catalogOverviewVisible() ? '' : ' этого раздела'}? Для пакетов с известным размером потребуется примерно ${formatModuleBytes(pendingStorage().bytes)} на вашем устройстве. Размер остальных пакетов пока не указан.`
            : `Хотите скачать все пакеты знаний${catalogOverviewVisible() ? '' : ' этого раздела'}? Это займёт примерно ${formatModuleBytes(pendingStorage().bytes)} на вашем устройстве.`
        }
        confirmLabel="Скачать всё"
        onConfirm={() => {
          const modules = pendingBulkDownload();
          setPendingBulkDownload(null);
          if (modules) void installAllAvailable(modules);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingBulkDownload(null);
        }}
      />

      <ConfirmationDialog
        open={pendingRemoval() !== null}
        title="Удалить с устройства?"
        description={`«${pendingRemoval()?.title ?? ''}» будет удалён с устройства. Сохранённые результаты не изменятся.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => void confirmRemoval()}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      />
    </section>
  );
}
