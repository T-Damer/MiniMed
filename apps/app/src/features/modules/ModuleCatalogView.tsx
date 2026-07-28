import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleCategory,
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
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
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
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import {
  modulesInCategory,
  recommendationCategoryDownloadProgress,
  recommendationCategoryStats,
} from '@/features/modules/recommendation-categories';
import { buildRecommendationCategoryHelp } from '@/features/modules/recommendation-category-help';
import {
  installPublishedCategoryModules,
  removeInstalledCategoryModules,
} from '@/features/modules/recommendation-category-operations';
import { collectionLabel } from '@/i18n/labels';
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

function categoryInstallLabel(
  categoryBusy: boolean,
  downloadProgress: ReturnType<typeof recommendationCategoryDownloadProgress>,
): string {
  if (categoryBusy && downloadProgress.activeTaskCount === 0) return 'Подготовка…';
  if (downloadProgress.activeTaskCount > 0 && downloadProgress.byteProgress !== null) {
    return `Загрузка ${Math.round(downloadProgress.byteProgress * 100)}%`;
  }
  if (downloadProgress.activeTaskCount > 0) {
    return `Загружаем ${downloadProgress.activeTaskCount}…`;
  }
  if (categoryBusy) return 'Скачиваем…';
  return 'Скачать раздел';
}

export function ModuleCatalogView(props: ModuleCatalogViewProps): JSX.Element {
  const [catalog, setCatalog] = createSignal<ContentModuleCatalog>(MODULE_CATALOG);
  const [warning, setWarning] = createSignal<string | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const [runtime, setRuntime] = createSignal(getContentModuleRuntime(MODULE_CATALOG));
  const [installed, setInstalled] = createSignal<readonly InstalledContentModule[]>(
    runtime().listInstalled(),
  );
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  const [contentChangePending, setContentChangePending] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [recommendationQuery, setRecommendationQuery] = createSignal('');
  const [recommendationCategory, setRecommendationCategory] = createSignal('');
  const [recommendationBrowserOpen, setRecommendationBrowserOpen] = createSignal(false);
  const [regularCollection, setRegularCollection] = createSignal('');
  const [showAllCategories, setShowAllCategories] = createSignal(false);
  const [busyCategories, setBusyCategories] = createSignal<ReadonlySet<string>>(new Set());
  const [installingAll, setInstallingAll] = createSignal(false);
  const [helpCategory, setHelpCategory] = createSignal<ContentModuleCategory | null>(null);
  const [detailsModule, setDetailsModule] = createSignal<ContentModuleCatalogEntry | null>(null);
  const [loadErrorDetails, setLoadErrorDetails] = createSignal<ModuleLoadError | null>(null);
  const [installErrors, setInstallErrors] = createSignal<Readonly<Record<string, string>>>({});
  const [coreOpen, setCoreOpen] = createSignal(false);
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
    if (!selection) setRecommendationQuery('');
  };
  const openCollection = (collection: string): void => {
    window.location.hash = `#/modules/documents/collection/${encodeURIComponent(collection)}`;
  };
  const openCategory = (categoryId: string): void => {
    window.location.hash = `#/modules/documents/category/${encodeURIComponent(categoryId)}`;
  };
  const openRecommendations = (): void => {
    window.location.hash = '#/modules/documents/recommendations';
  };

  onMount(() => {
    bindRuntime(MODULE_CATALOG);
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
    catalog().modules.filter((module) => !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG)),
  );
  const collections = createMemo(() => [
    ...new Set(regularModules().map((module) => module.collection)),
  ]);
  const installedModuleIds = createMemo(
    () => new Set(installed().map((module) => module.moduleId)),
  );
  const categoryModules = (categoryId: string): readonly ContentModuleCatalogEntry[] =>
    modulesInCategory(recommendationModules(), categoryId);
  const filteredRecommendations = createMemo(() => {
    const query = recommendationQuery().trim().toLocaleLowerCase('ru-RU');
    const category = recommendationCategory();
    const queryTokens = query ? query.split(/\s+/u).filter((token) => token.length > 0) : [];
    const matchesQuery = (module: ContentModuleCatalogEntry): boolean =>
      queryTokens.length === 0 ||
      queryTokens.every((token) =>
        [module.title, module.description, ...module.specialties, ...module.tags]
          .join(' ')
          .toLocaleLowerCase('ru-RU')
          .includes(token),
      );

    if (queryTokens.length > 0) {
      return recommendationModules().filter(matchesQuery).slice(0, 50);
    }
    if (!category) return [];
    return categoryModules(category).filter(matchesQuery);
  });
  const activeCategory = createMemo(() =>
    catalog().categories.find((category) => category.id === recommendationCategory()),
  );
  const browsingSection = createMemo(
    () => Boolean(recommendationCategory()) && !recommendationQuery().trim(),
  );
  const activeCategoryHelp = createMemo(() => {
    const category = helpCategory();
    if (!category) return null;
    return buildRecommendationCategoryHelp(
      category,
      recommendationCategoryStats(recommendationModules(), category, installedModuleIds()),
      formatModuleBytes,
    );
  });
  const activeHelpModules = createMemo(() => {
    const category = helpCategory();
    return category ? categoryModules(category.id) : [];
  });
  const browsingSearch = createMemo(() => Boolean(recommendationQuery().trim()));
  const visibleCategories = createMemo(() =>
    showAllCategories() ? catalog().categories : catalog().categories.slice(0, 6),
  );
  const moduleDocumentTitle = (documentId: string): string => {
    const catalogDocumentId = documentId.match(/^kr\.rf\.\d+_\d+/u)?.[0] ?? documentId;
    return (
      catalog().modules.find(
        (module) =>
          module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG) &&
          module.documents.some((document) => document.documentId === catalogDocumentId),
      )?.title ?? documentId
    );
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
  const moduleTask = (moduleId: string): ContentModuleDownloadTask | undefined =>
    tasks()
      .filter((task) => task.moduleId === moduleId)
      .toSorted((left, right) => right.id.localeCompare(left.id))[0];

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

  const installAllRegular = async (): Promise<void> => {
    if (installingAll()) return;
    setInstallingAll(true);
    setWarning(null);
    try {
      const result = await installPublishedCategoryModules(
        runtime(),
        regularModules(),
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
          regularModules()
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

  const pendingRegularCount = createMemo(
    () =>
      regularModules().filter(
        (module) => module.releaseState === 'published' && !installedModuleIds().has(module.id),
      ).length,
  );

  const removeCategory = async (categoryId = recommendationCategory()): Promise<void> => {
    if (!categoryId) return;
    await withCategoryBusy(categoryId, async () => {
      const modules = categoryModules(categoryId);
      if (modules.length === 0) return;

      try {
        await removeInstalledCategoryModules(runtime(), modules, installedModuleIds());
        setInstalled(runtime().listInstalled());
        await connectContentChanges();
      } catch (cause) {
        setWarning(cause instanceof Error ? cause.message : 'Не удалось удалить раздел.');
      }
    });
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
          <Show when={pendingRegularCount() > 0}>
            <button
              type="button"
              class="module-download-all"
              disabled={installingAll()}
              onClick={() => void installAllRegular()}
            >
              {installingAll() ? 'Скачиваем…' : `Скачать все · ${pendingRegularCount()}`}
            </button>
          </Show>
        </header>
      </Show>
      <Show when={props.embedded}>
        <div class="knowledge-subroute-heading module-catalog-heading">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="Назад"
            onClick={props.onBack}
          >
            <AppGlyph name="arrow-left" />
          </button>
          <div class="module-catalog-actions">
            <Show when={pendingRegularCount() > 0}>
              <button
                type="button"
                class="module-download-all"
                disabled={installingAll()}
                onClick={() => void installAllRegular()}
              >
                {installingAll() ? 'Скачиваем…' : `Скачать все · ${pendingRegularCount()}`}
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
              <h2>Клинические рекомендации</h2>
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
              <h2>Наборы документов</h2>
              <span>{collections().length + 1}</span>
            </div>
            <div class="recommendation-section-grid recommendation-section-grid-compact">
              <For each={collections()}>
                {(collection) => {
                  const modules = () =>
                    regularModules().filter((module) => module.collection === collection);
                  const installedCount = () =>
                    modules().filter((module) => installedModuleIds().has(module.id)).length;
                  return (
                    <article class="recommendation-section-card paper-card recommendation-section-card-compact">
                      <button
                        type="button"
                        class="recommendation-section-select"
                        onClick={() => openCollection(collection)}
                      >
                        <strong>{collectionLabel(collection)}</strong>
                        <span>
                          {installedCount()}/{modules().length} на устройстве
                        </span>
                      </button>
                    </article>
                  );
                }}
              </For>
              <article class="recommendation-section-card paper-card recommendation-section-card-compact clinical-recommendations-entry">
                <button
                  type="button"
                  class="recommendation-section-select"
                  onClick={openRecommendations}
                >
                  <strong>Клинические рекомендации</strong>
                  <span>
                    {
                      recommendationModules().filter((module) =>
                        installedModuleIds().has(module.id),
                      ).length
                    }
                    /{recommendationModules().length} на устройстве
                  </span>
                </button>
              </article>
            </div>
          </section>
        </Show>

        <For each={collections().filter((collection) => collection === regularCollection())}>
          {(collection) => (
            <section class="module-collection">
              <div class="module-collection-heading">
                <h2>{collectionLabel(collection)}</h2>
                <span>
                  {regularModules().filter((module) => module.collection === collection).length}
                </span>
              </div>
              <div class="module-grid module-grid-two-columns">
                <For each={regularModules().filter((module) => module.collection === collection)}>
                  {(module) => (
                    <ContentModuleCard
                      module={module}
                      installed={installedModule(module.id)}
                      task={moduleTask(module.id)}
                      fallbackError={installErrors()[module.id]}
                      onInspect={() => setDetailsModule(module)}
                      onOpenError={(message) =>
                        setLoadErrorDetails({ title: module.title, message })
                      }
                      onInstall={() => void install(module)}
                      onOpenCore={() => setCoreOpen(true)}
                      onOpenDocument={() => openModuleDocument(module)}
                      onRemove={() => void remove(module.id)}
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
              <h2>Клинические рекомендации</h2>
              <span>{catalog().categories.length}</span>
            </div>

            <SearchField
              class="recommendation-search recommendation-search-compact"
              value={recommendationQuery()}
              onInput={setRecommendationQuery}
              label="Поиск по названию или коду"
              placeholder="Например: пневмония, J18"
            />

            <div class="recommendation-section-grid recommendation-section-grid-compact">
              <For each={visibleCategories()}>
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
                    <article class="recommendation-section-card paper-card recommendation-section-card-compact">
                      <div class="recommendation-section-card-header">
                        <button
                          type="button"
                          class="recommendation-section-select"
                          onClick={() => openCategory(category.id)}
                        >
                          <strong>{category.title}</strong>
                          <span>
                            {stats().installedCount}/{stats().publishedCount} ·{' '}
                            {formatModuleBytes(stats().downloadBytes)}
                          </span>
                        </button>
                        <button
                          type="button"
                          class="recommendation-section-help"
                          aria-label={`Что входит в раздел «${category.title}»`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setHelpCategory(category);
                          }}
                        >
                          ?
                        </button>
                      </div>
                      <div
                        class="recommendation-section-progress"
                        classList={{ complete: downloadProgress().installedFraction === 1 }}
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
                      <div class="recommendation-section-actions">
                        <Show
                          when={stats().pendingCount > 0}
                          fallback={
                            <button
                              type="button"
                              aria-label={`Удалить раздел «${category.title}»`}
                              disabled={stats().installedCount === 0 || categoryBusy()}
                              onClick={() => void removeCategory(category.id)}
                            >
                              <Show
                                when={!categoryBusy()}
                                fallback={<span class="module-action-spinner" />}
                              >
                                <AppGlyph name="trash" />
                              </Show>
                            </button>
                          }
                        >
                          <button
                            type="button"
                            disabled={categoryBusy()}
                            onClick={() => void installCategory(category.id)}
                          >
                            <Show
                              when={!categoryBusy()}
                              fallback={<span class="module-action-spinner" />}
                            >
                              <AppGlyph name="download" />
                            </Show>
                            {categoryInstallLabel(categoryBusy(), downloadProgress())}
                          </button>
                        </Show>
                      </div>
                    </article>
                  );
                }}
              </For>
            </div>
            <Show when={catalog().categories.length > 6}>
              <button
                type="button"
                class="module-show-all-sections"
                onClick={() => setShowAllCategories((current) => !current)}
              >
                {showAllCategories()
                  ? 'Свернуть список'
                  : `Все разделы · ${catalog().categories.length}`}
              </button>
            </Show>
          </Show>

          <Show when={browsingSection() || browsingSearch()}>
            <SearchField
              class="recommendation-search recommendation-search-compact"
              value={recommendationQuery()}
              onInput={setRecommendationQuery}
              label="Поиск по названию или коду"
              placeholder="Например: пневмония, J18"
            />

            <Show when={browsingSection()}>
              <div class="recommendation-list-heading recommendation-list-heading-compact">
                <h3>{activeCategory()?.title}</h3>
                <div class="recommendation-list-actions">
                  <button
                    type="button"
                    disabled={isCategoryBusy(recommendationCategory())}
                    onClick={() => void installCategory()}
                  >
                    <Show
                      when={!isCategoryBusy(recommendationCategory())}
                      fallback={<span class="module-action-spinner" />}
                    >
                      <AppGlyph name="download" />
                    </Show>
                    {categoryInstallLabel(
                      isCategoryBusy(recommendationCategory()),
                      recommendationCategoryDownloadProgress(
                        recommendationModules(),
                        recommendationCategory(),
                        installedModuleIds(),
                        tasks(),
                      ),
                    )}
                  </button>
                </div>
              </div>
            </Show>

            <Show when={browsingSearch()}>
              <div class="recommendation-list-heading recommendation-list-heading-compact">
                <h3>Результаты поиска</h3>
              </div>
            </Show>

            <p class="recommendation-result-note">
              {filteredRecommendations().length}
              {browsingSearch() && filteredRecommendations().length === 50 ? ' первых' : ''}{' '}
              рекомендаций
            </p>

            <div class="recommendation-list recommendation-list-compact">
              <For each={filteredRecommendations()}>
                {(module) => {
                  const installedValue = () => installedModule(module.id);
                  const task = () => moduleTask(module.id);
                  const progress = () =>
                    task() ? contentModuleTaskProgress(task() as ContentModuleDownloadTask) : null;
                  const installError = () =>
                    task()?.state === 'failed'
                      ? task()?.errorMessage || 'Не удалось скачать документ.'
                      : installErrors()[module.id] || null;
                  const working = () =>
                    task() && !['completed', 'failed', 'cancelled'].includes(task()?.state ?? '');
                  return (
                    <article class="recommendation-row paper-card recommendation-row-compact">
                      <div>
                        <Show
                          when={installedValue() && primaryModuleDocumentId(module)}
                          fallback={<strong>{module.title}</strong>}
                        >
                          <button
                            type="button"
                            class="recommendation-title-button"
                            onClick={() => openModuleDocument(module)}
                          >
                            {module.title}
                          </button>
                        </Show>
                        <span>
                          {module.tags.find((tag) => /^\d+_\d+$/u.test(tag))}
                          {installedValue()
                            ? ' · установлено'
                            : ` · ${formatModuleBytes(module.sizes.downloadBytes)}`}
                        </span>
                        <Show when={working() && progress() !== null}>
                          <div class="recommendation-row-progress" role="progressbar">
                            <i style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                          </div>
                        </Show>
                        <Show when={installError()}>
                          {(message) => (
                            <ModuleTaskStatus
                              label={MODULE_TASK_LABELS[task()?.state ?? 'failed']}
                              progress={null}
                              errorMessage={message()}
                              onOpenError={() =>
                                setLoadErrorDetails({ title: module.title, message: message() })
                              }
                            />
                          )}
                        </Show>
                      </div>
                      <Show
                        when={!installedValue()}
                        fallback={
                          <div class="recommendation-row-actions">
                            <Show when={primaryModuleDocumentId(module)}>
                              <button
                                type="button"
                                class="recommendation-open-button"
                                onClick={() => openModuleDocument(module)}
                              >
                                Выжимка
                              </button>
                            </Show>
                            <button
                              type="button"
                              class="module-remove-button"
                              onClick={() => void remove(module.id)}
                            >
                              <AppGlyph name="trash" /> Удалить
                            </button>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          disabled={module.releaseState !== 'published' || Boolean(working())}
                          onClick={() => void install(module)}
                        >
                          <Show when={!working()} fallback={<span class="module-action-spinner" />}>
                            <AppGlyph name="download" />
                          </Show>
                          {working()
                            ? progress() !== null
                              ? `${Math.round((progress() ?? 0) * 100)}%`
                              : MODULE_TASK_LABELS[task()?.state ?? 'queued']
                            : 'Скачать'}
                        </button>
                      </Show>
                    </article>
                  );
                }}
              </For>
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
                    ? `${module().previewDocumentCount || module().documents.length} документов`
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
                <details class="recommendation-section-document-list" open>
                  <summary>Документы · {module().documents.length}</summary>
                  <div>
                    <For each={module().documents}>
                      {(document) => (
                        <details>
                          <summary>{moduleDocumentTitle(document.documentId)}</summary>
                          <p>
                            {document.status === 'active'
                              ? 'Текущая редакция'
                              : document.status === 'historical'
                                ? 'Историческая редакция'
                                : 'Предыдущая редакция'}
                          </p>
                          <Show when={installedModule(module().id)}>
                            <button
                              type="button"
                              onClick={() => openDocumentOverlay(document.documentId)}
                            >
                              Открыть документ
                            </button>
                          </Show>
                        </details>
                      )}
                    </For>
                  </div>
                </details>
              </Show>
            </div>
          )}
        </Show>
      </OverlayDialog>

      <OverlayDialog
        open={helpCategory() !== null}
        title={helpCategory()?.title ?? 'Раздел'}
        class="recommendation-section-help-dialog"
        onClose={() => setHelpCategory(null)}
      >
        <Show when={activeCategoryHelp()}>
          {(help) => (
            <div class="recommendation-section-help-body">
              <p>{help().lead}</p>
              <ul class="recommendation-section-help-facts">
                <li>{help().recommendationLabel}</li>
                <li>{help().installedLabel}</li>
                <li>{help().sizeLabel}</li>
              </ul>
              <Show when={help().specialtyLabels.length > 0}>
                <div class="recommendation-section-help-specialties">
                  <strong>Направления</strong>
                  <div>
                    <For each={help().specialtyLabels}>{(label) => <span>{label}</span>}</For>
                  </div>
                </div>
              </Show>
              <p class="recommendation-section-help-note">{help().offlineNote}</p>
              <details class="recommendation-section-document-list">
                <summary>Полный список рекомендаций · {activeHelpModules().length}</summary>
                <div>
                  <For each={activeHelpModules()}>
                    {(module) => (
                      <details>
                        <summary>{module.title}</summary>
                        <p>{module.description}</p>
                        <Show
                          when={installedModule(module.id)}
                          fallback={
                            <button
                              type="button"
                              disabled={module.releaseState !== 'published'}
                              onClick={() => void install(module)}
                            >
                              {module.releaseState === 'published' ? 'Скачать' : 'Пока недоступно'}
                            </button>
                          }
                        >
                          <button
                            type="button"
                            disabled={!primaryModuleDocumentId(module)}
                            onClick={() => openModuleDocument(module)}
                          >
                            Открыть полный документ
                          </button>
                        </Show>
                      </details>
                    )}
                  </For>
                </div>
              </details>
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
    </section>
  );
}
