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
import { WindowVirtualizer } from 'virtua/solid';
import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { CountBadge } from '@/components/CountBadge';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import {
  CALCULATOR_SECTION_CATEGORY_IDS,
  CALCULATOR_SECTIONS,
} from '@/features/calculators/calculator-packs';
import { DocumentLibrary } from '@/features/library/DocumentLibrary';
import { ContentModuleCard } from '@/features/modules/ContentModuleCard';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { ModuleTaskStatus } from '@/features/modules/ModuleTaskStatus';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  contentModuleTaskProgress,
  formatModuleBytes,
  MODULE_RELEASE_LABELS,
  MODULE_TASK_LABELS,
  primaryModuleDocumentId,
} from '@/features/modules/module-display';
import { selectBulkDownloadModules } from '@/features/modules/module-download-selection';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import {
  modulesInCategory,
  recommendationCategoryDownloadProgress,
  recommendationCategoryStats,
} from '@/features/modules/recommendation-categories';
import {
  installPublishedCategoryModules,
  removeInstalledCategoryModules,
} from '@/features/modules/recommendation-category-operations';
import { collectionLabel, documentCountLabel, recommendationCountLabel } from '@/i18n/labels';
import { openDocumentOverlay } from '@/state/document-navigation';

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
const AUTO_UPDATES_PAUSED_KEY = 'minimed.module-auto-updates-paused.v1';

function catalogSelectionFromLocation():
  | { readonly kind: 'collection'; readonly id: string }
  | { readonly kind: 'category'; readonly id: string }
  | { readonly kind: 'recommendations' }
  | null {
  const route = window.location.hash.replace(/^#\/?/u, '');
  const collectionPrefix = 'modules/documents/collection/';
  const categoryPrefix = 'modules/documents/category/';
  try {
    if (route === 'modules/documents/recommendations') {
      return { kind: 'recommendations' };
    }
    if (route.startsWith(collectionPrefix)) {
      return { kind: 'collection', id: decodeURIComponent(route.slice(collectionPrefix.length)) };
    }
    if (route.startsWith(categoryPrefix)) {
      return { kind: 'category', id: decodeURIComponent(route.slice(categoryPrefix.length)) };
    }
  } catch {
    return null;
  }
  return null;
}

function availableCount(catalog: ContentModuleCatalog): number {
  return catalog.modules.filter(
    (module) =>
      module.releaseState === 'published' && !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
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
  const tokens = query
    .trim()
    .toLocaleLowerCase('ru-RU')
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return true;
  const searchableText = values.join(' ').toLocaleLowerCase('ru-RU');
  return tokens.every((token) => searchableText.includes(token));
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
  const [catalogQuery, setCatalogQuery] = createSignal('');
  const [recommendationCategory, setRecommendationCategory] = createSignal('');
  const [recommendationBrowserOpen, setRecommendationBrowserOpen] = createSignal(false);
  const [regularCollection, setRegularCollection] = createSignal('');
  const [busyCategories, setBusyCategories] = createSignal<ReadonlySet<string>>(new Set());
  const [installingAll, setInstallingAll] = createSignal(false);
  const [detailsModule, setDetailsModule] = createSignal<ContentModuleCatalogEntry | null>(null);
  const [loadErrorDetails, setLoadErrorDetails] = createSignal<ModuleLoadError | null>(null);
  const [installErrors, setInstallErrors] = createSignal<Readonly<Record<string, string>>>({});
  const [coreOpen, setCoreOpen] = createSignal(false);
  const [pendingRemoval, setPendingRemoval] = createSignal<{
    readonly kind: 'module' | 'category';
    readonly id: string;
    readonly title: string;
  } | null>(null);
  const [autoUpdatesPaused, setAutoUpdatesPaused] = createSignal(
    window.localStorage.getItem(AUTO_UPDATES_PAUSED_KEY) === 'true',
  );
  let refreshedOnce = false;
  let unsubscribeTask: (() => void) | undefined;
  let reconnectPending = false;

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
    setCatalogQuery('');
  };
  const openCollection = (collection: string): void => {
    window.location.hash = `#/modules/documents/collection/${encodeURIComponent(collection)}`;
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

  onMount(() => {
    bindRuntime(catalog());
    syncSelectionFromLocation();
    window.addEventListener('hashchange', syncSelectionFromLocation);
  });
  onCleanup(() => {
    unsubscribeTask?.();
    window.removeEventListener('hashchange', syncSelectionFromLocation);
  });

  const recommendationModules = createMemo(() =>
    catalog().modules.filter((module) => module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG)),
  );
  const regularModules = createMemo(() =>
    catalog().modules.filter(
      (module) =>
        module.kind !== 'clinical' && !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
    ),
  );
  const bulkDownloadModules = createMemo(() =>
    selectBulkDownloadModules(
      recommendationBrowserOpen(),
      recommendationModules(),
      regularModules(),
    ),
  );
  const regularSectionModules = (section: string): readonly ContentModuleCatalogEntry[] =>
    regularModules().filter((module) => module.kind === section || module.collection === section);
  const regularSectionLabel = (section: string): string =>
    ({
      core: 'Ядро',
      reference: 'Нормы и расчёты',
      regulatory: 'Законы и нормативные акты',
    })[section] ?? collectionLabel(section);
  const installedModuleIds = createMemo(
    () => new Set(installed().map((module) => module.moduleId)),
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
  const activeCategory = createMemo(() =>
    catalog().categories.find((category) => category.id === recommendationCategory()),
  );
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
  const moduleDocumentTitle = (documentId: string): string => {
    const catalogDocumentId = documentId.match(/^kr\.rf\.\d+_\d+/u)?.[0] ?? documentId;
    return (
      regulatoryTitles[documentId] ??
      catalog().modules.find(
        (module) =>
          module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG) &&
          module.documents.some((document) => document.documentId === catalogDocumentId),
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
    installed().find((item) => item.moduleId === moduleId);
  const moduleTask = (moduleId: string): ContentModuleDownloadTask | undefined => {
    const latest = tasks()
      .filter((task) => task.moduleId === moduleId)
      .toSorted((left, right) => right.id.localeCompare(left.id))[0];
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
      if (completed.state === 'completed' && reconnect) await connectContentChanges();
      return completed.state === 'completed';
    } catch (cause) {
      setInstallErrors((current) => ({
        ...current,
        [module.id]: cause instanceof Error ? cause.message : 'Не удалось установить набор.',
      }));
      return false;
    }
  };

  const installCategory = async (categoryId = recommendationCategory()): Promise<void> => {
    if (!categoryId) return;
    await withCategoryBusy(categoryId, async () => {
      const modules = categoryModules(categoryId);
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
              .filter(
                (module) =>
                  module.releaseState === 'published' && !installedModuleIds().has(module.id),
              )
              .map((module) => [module.id, message]),
          ),
        }));
      }
    });
  };

  const installAllAvailable = async (): Promise<void> => {
    if (installingAll()) return;
    setInstallingAll(true);
    setWarning(null);
    try {
      const result = await installPublishedCategoryModules(
        runtime(),
        bulkDownloadModules(),
        installedModuleIds(),
      );
      setTasks(runtime().listTasks());
      setInstalled(runtime().listInstalled());
      if (result.changed) await connectContentChanges();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Не удалось скачать доступные наборы.';
      setInstallErrors((current) => ({
        ...current,
        ...Object.fromEntries(
          bulkDownloadModules()
            .filter(
              (module) =>
                module.releaseState === 'published' && !installedModuleIds().has(module.id),
            )
            .map((module) => [module.id, message]),
        ),
      }));
    } finally {
      setInstallingAll(false);
    }
  };

  const pendingDownloadCount = createMemo(
    () =>
      bulkDownloadModules().filter(
        (module) => module.releaseState === 'published' && !installedModuleIds().has(module.id),
      ).length,
  );
  const bulkDownloadLabel = (): string =>
    recommendationBrowserOpen() ? 'Скачать все рекомендации' : 'Скачать все документы';

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
      if (reconnect) await connectContentChanges();
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
      await connectContentChanges();
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : 'Не удалось открыть старую версию.');
    }
  };

  const toggleAutoUpdates = (): void => {
    const next = !autoUpdatesPaused();
    setAutoUpdatesPaused(next);
    window.localStorage.setItem(AUTO_UPDATES_PAUSED_KEY, String(next));
  };

  createEffect(() => {
    props.onAvailableUpdates?.(availableCount(catalog()));
  });

  createEffect(() => {
    if (autoUpdatesPaused()) return;
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
        module.releaseState === 'published' &&
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
    <section class="module-page" classList={{ 'page-surface': !props.embedded }}>
      <Show when={!props.embedded}>
        <header class="subpage-heading module-heading">
          <div>
            <p class="archive-kicker">Документы на устройстве</p>
            <h1>База знаний</h1>
            <p>
              Скачивайте нужные разделы. После проверки они работают без интернета и участвуют в
              общем поиске MiniMed.
            </p>
          </div>
          <Show when={pendingDownloadCount() > 0}>
            <button
              type="button"
              aria-label={`${bulkDownloadLabel()}: ${pendingDownloadCount()}`}
              class="module-download-all"
              disabled={installingAll()}
              onClick={() => void installAllAvailable()}
            >
              <AppGlyph name="download" />
              <span>{installingAll() ? 'Скачиваем…' : 'Скачать всё'}</span>
            </button>
          </Show>
        </header>
      </Show>
      <Show when={props.embedded}>
        <div class="knowledge-subroute-heading knowledge-subroute-heading--blurred module-catalog-heading">
          <button
            type="button"
            class="knowledge-back-button knowledge-subroute-heading__control"
            aria-label="Назад"
            onClick={props.onBack}
          >
            <AppGlyph name="arrow-left" />
          </button>
          <SearchField
            class="route-search knowledge-subroute-heading__control"
            value={catalogQuery()}
            onInput={setCatalogQuery}
            label="Поиск по текущему разделу"
            hideLabel
            placeholder="Поиск в текущем разделе"
          />
        </div>
        <div class="module-catalog-actions module-catalog-actions--heading">
          <Show when={pendingDownloadCount() > 0}>
            <button
              type="button"
              aria-label={`${bulkDownloadLabel()}: ${pendingDownloadCount()}`}
              class="module-download-all"
              disabled={installingAll()}
              onClick={() => void installAllAvailable()}
            >
              <AppGlyph name="download" />
              <span>{installingAll() ? 'Скачиваем…' : 'Скачать всё'}</span>
            </button>
          </Show>
          <button
            type="button"
            class="module-auto-update-toggle"
            classList={{ paused: autoUpdatesPaused() }}
            aria-label={
              autoUpdatesPaused() ? 'Возобновить автообновление' : 'Приостановить автообновление'
            }
            onClick={toggleAutoUpdates}
          >
            <AppGlyph name="refresh" />
            <span>
              {autoUpdatesPaused() ? 'Автообновление выключено' : 'Автообновление включено'}
            </span>
          </button>
        </div>
      </Show>

      <Show when={contentChangePending() || connecting()}>
        <div class="module-reload-banner paper-card" aria-live="polite">
          <div>
            <strong>
              {connecting() ? 'Подключаем базу к поиску…' : 'Нужно повторить подключение'}
            </strong>
            <span>
              {connecting()
                ? 'Текущий поиск продолжает работать до готовности нового состава базы.'
                : 'Документы сохранены на устройстве, но поиск пока использует прежний состав.'}
            </span>
          </div>
          <button
            type="button"
            disabled={connecting()}
            onClick={() => void connectContentChanges()}
          >
            {connecting() ? 'Подключаем…' : 'Повторить'}
          </button>
        </div>
      </Show>

      <Show when={warning()}>
        {(message) => <div class="module-doctor-warning">{message()}</div>}
      </Show>

      <Show when={!recommendationBrowserOpen() && !browsingSection() && !browsingSearch()}>
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
              <CountBadge value={5} />
            </div>
            <div class="recommendation-section-grid recommendation-section-grid-compact">
              <Show
                when={matchesCatalogQuery(catalogQuery(), [
                  'Лекарства',
                  'Официальная инструкция и формы выпуска',
                ])}
              >
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact"
                  tabindex="0"
                  aria-label="Открыть набор «Лекарства»"
                  onClick={openMedications}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openMedications();
                  }}
                >
                  <AppGlyph name="notes" class="recommendation-section-card-icon" />
                  <div class="recommendation-section-select">
                    <strong>Лекарства</strong>
                    <span>Официальная инструкция и формы выпуска</span>
                  </div>
                </article>
              </Show>
              <For each={['reference', 'regulatory']}>
                {(section) => {
                  const modules = () => regularSectionModules(section);
                  const installedCount = () =>
                    modules().filter((module) => installedModuleIds().has(module.id)).length;
                  return (
                    <Show
                      when={matchesCatalogQuery(catalogQuery(), [regularSectionLabel(section)])}
                    >
                      <article
                        class="recommendation-section-card paper-card recommendation-section-card-compact"
                        tabindex="0"
                        aria-label={`Открыть набор «${regularSectionLabel(section)}»`}
                        onClick={() => openCollection(section)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') openCollection(section);
                        }}
                      >
                        <AppGlyph
                          name={section === 'reference' ? 'calculator' : 'archive'}
                          class="recommendation-section-card-icon"
                        />
                        <div class="recommendation-section-select">
                          <strong>{regularSectionLabel(section)}</strong>
                          <span>
                            {installedCount()}/{modules().length} на устройстве
                          </span>
                        </div>
                      </article>
                    </Show>
                  );
                }}
              </For>
              <Show when={matchesCatalogQuery(catalogQuery(), ['Клинические рекомендации'])}>
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact clinical-recommendations-entry"
                  tabindex="0"
                  aria-label="Открыть набор «Клинические рекомендации»"
                  onClick={openRecommendations}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openRecommendations();
                  }}
                >
                  <AppGlyph name="book-open" class="recommendation-section-card-icon" />
                  <div class="recommendation-section-select">
                    <strong>Клинические рекомендации</strong>
                    <span>
                      {
                        recommendationModules().filter((module) =>
                          installedModuleIds().has(module.id),
                        ).length
                      }
                      /{recommendationModules().length} на устройстве
                    </span>
                  </div>
                </article>
              </Show>
              <Show when={matchesCatalogQuery(catalogQuery(), ['Ядро'])}>
                <article
                  class="recommendation-section-card paper-card recommendation-section-card-compact"
                  tabindex="0"
                  aria-label="Открыть набор «Ядро»"
                  onClick={() => openCollection('core')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openCollection('core');
                  }}
                >
                  <AppGlyph name="modules" class="recommendation-section-card-icon" />
                  <div class="recommendation-section-select">
                    <strong>Ядро</strong>
                    <span>
                      {
                        regularSectionModules('core').filter((module) =>
                          installedModuleIds().has(module.id),
                        ).length
                      }
                      /{regularSectionModules('core').length} на устройстве
                    </span>
                  </div>
                </article>
              </Show>
            </div>
          </section>
        </Show>

        <For each={regularCollection() ? [regularCollection()] : []}>
          {(section) => (
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
                      onInspect={() => setDetailsModule(module)}
                      onOpenError={(message) =>
                        setLoadErrorDetails({ title: module.title, message })
                      }
                      onInstall={() => void install(module)}
                      onOpenCore={() => setCoreOpen(true)}
                      onRemove={() => requestRemove(module.id)}
                      onActivateVersion={(version) => void activateVersion(module.id, version)}
                    />
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>

      <Show
        when={
          recommendationModules().length > 0 && !regularCollection() && recommendationBrowserOpen()
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
                  const stats = () =>
                    recommendationCategoryStats(
                      recommendationModules(),
                      category,
                      installedModuleIds(),
                    );
                  const categoryBusy = () => isCategoryBusy(category.id);
                  const downloadProgress = () =>
                    recommendationCategoryDownloadProgress(
                      recommendationModules(),
                      category.id,
                      installedModuleIds(),
                      tasks(),
                    );
                  const showByteProgress = () => downloadProgress().byteProgress;
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
                        <div class="recommendation-section-select">
                          <strong>{category.title}</strong>
                          <span>
                            {stats().installedCount}/{stats().publishedCount} ·{' '}
                            {formatModuleBytes(stats().downloadBytes)}
                          </span>
                        </div>
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
                          when={stats().pendingCount > 0}
                          fallback={
                            <button
                              type="button"
                              class="module-remove-button recommendation-section-actions__remove"
                              aria-label={`Удалить раздел «${category.title}»`}
                              disabled={stats().installedCount === 0 || categoryBusy()}
                              onClick={(event) => {
                                event.stopPropagation();
                                requestRemoveCategory(category.id);
                              }}
                            >
                              <Show
                                when={!categoryBusy()}
                                fallback={<span class="module-action-spinner" />}
                              >
                                <AppGlyph
                                  name="trash"
                                  class="recommendation-section-actions__icon"
                                />
                              </Show>
                            </button>
                          }
                        >
                          <button
                            type="button"
                            class="recommendation-section-actions__download"
                            aria-label={`Скачать раздел «${category.title}»`}
                            title="Скачать раздел"
                            disabled={categoryBusy()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void installCategory(category.id);
                            }}
                          >
                            <Show
                              when={!categoryBusy()}
                              fallback={<span class="module-action-spinner" />}
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
                    aria-label="Скачать все"
                    title="Скачать все"
                    disabled={isCategoryBusy(recommendationCategory())}
                    onClick={() => void installCategory()}
                  >
                    <Show
                      when={!isCategoryBusy(recommendationCategory())}
                      fallback={<span class="module-action-spinner" />}
                    >
                      <AppGlyph name="download" class="recommendation-list-actions__icon" />
                    </Show>
                    <span>Скачать все</span>
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
              <WindowVirtualizer data={filteredRecommendations()} bufferSize={500}>
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
                  return (
                    <article
                      class="recommendation-row paper-card recommendation-row-compact"
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
                          {module.tags.find((tag) => /^\d+_\d+$/u.test(tag))}
                          {installedValue()
                            ? ' · установлено'
                            : ` · ${formatModuleBytes(module.sizes.downloadBytes)}`}
                        </span>
                        <Show when={!installedValue() && working() && progress() !== null}>
                          <div class="recommendation-row-progress" role="progressbar">
                            <i style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                          </div>
                        </Show>
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
                          <div class="recommendation-row-actions">
                            <button
                              type="button"
                              class="module-remove-button recommendation-row-actions__remove"
                              aria-label={`Удалить «${module.title}»`}
                              title="Удалить"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestRemove(module.id);
                              }}
                            >
                              <AppGlyph name="trash" class="recommendation-row-actions__icon" />
                            </button>
                          </div>
                        }
                      >
                        <Show when={!working()}>
                          <button
                            type="button"
                            class="recommendation-row-download-button"
                            aria-label={`Скачать «${module.title}»`}
                            title="Скачать"
                            disabled={module.releaseState !== 'published'}
                            onClick={(event) => {
                              event.stopPropagation();
                              void install(module);
                            }}
                          >
                            <AppGlyph
                              name="download"
                              class="recommendation-row-download-button__icon"
                            />
                          </button>
                        </Show>
                      </Show>
                    </article>
                  );
                }}
              </WindowVirtualizer>
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
          <p>{loadErrorDetails()?.message}</p>
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
              <p>{module().description}</p>
              <ul class="recommendation-section-help-facts">
                <li>
                  {module().previewDocumentCount || module().documents.length
                    ? documentCountLabel(module().previewDocumentCount || module().documents.length)
                    : 'Список документов уточняется'}
                </li>
                <li>{formatModuleBytes(module().sizes.downloadBytes)}</li>
              </ul>
              <Show
                when={module().documents.length > 0}
                fallback={
                  <p class="recommendation-section-help-note">
                    Полный список документов появится здесь после публикации набора.
                  </p>
                }
              >
                <div class="recommendation-section-document-list">
                  <For each={module().documents}>
                    {(document) => {
                      const canOpen = () => Boolean(installedModule(module().id));
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
                          <strong>{moduleDocumentTitle(document.documentId)}</strong>
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

      <OverlayDialog
        open={coreOpen()}
        title="Ядро MiniMed"
        subtitle={`${props.status.documentCount} встроенных документов`}
        class="core-document-dialog"
        onClose={() => setCoreOpen(false)}
      >
        <DocumentLibrary core={props.core} embedded />
      </OverlayDialog>

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
