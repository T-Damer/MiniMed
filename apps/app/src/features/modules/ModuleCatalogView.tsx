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
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
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

const RELEASE_LABELS: Readonly<Record<ContentModuleCatalogEntry['releaseState'], string>> = {
  bundled: 'Уже в приложении',
  published: 'Можно скачать',
  preview: 'Готовится',
  planned: 'Запланировано',
};

const TASK_LABELS: Readonly<Record<ContentModuleDownloadTask['state'], string>> = {
  queued: 'Ожидает загрузки',
  downloading: 'Скачивается',
  verifying: 'Проверяется',
  installing: 'Устанавливается',
  completed: 'Установлено',
  failed: 'Ошибка установки',
  cancelled: 'Загрузка отменена',
};

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

function formatBytes(value: number | null): string {
  if (value === null) return 'размер пока не указан';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function capabilityLabels(module: ContentModuleCatalogEntry): readonly string[] {
  const labels: string[] = [];
  if (module.capabilities.fullText) labels.push('полный текст');
  if (module.capabilities.structuredTables) labels.push('таблицы');
  if (module.capabilities.originalPdf) labels.push('PDF отдельно');
  if (module.capabilities.structuredKnowledge) labels.push('связи и карточки');
  if (module.capabilities.calculations) labels.push('расчёты');
  return labels;
}

function installedValidationLabel(installed: InstalledContentModule): string {
  const validation = installed.lastValidation;
  if (!validation) return 'Проверка установки не записана';
  if (
    validation.valid &&
    validation.checksumValid &&
    validation.schemaCompatible &&
    validation.sqliteIntegrity === 'ok'
  ) {
    return 'SHA-256 и SQLite проверены';
  }
  return validation.message;
}

function availableCount(catalog: ContentModuleCatalog): number {
  return catalog.modules.filter(
    (module) =>
      module.releaseState === 'published' && !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
  ).length;
}

function taskProgress(task: ContentModuleDownloadTask): number | null {
  if (!task.totalBytes || task.totalBytes <= 0) return null;
  return Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
}

function primaryDocumentId(module: ContentModuleCatalogEntry): string | null {
  const activeDocument = module.documents.find((document) => document.status === 'active');
  return activeDocument?.documentId ?? module.documents[0]?.documentId ?? null;
}

function openModuleDocument(module: ContentModuleCatalogEntry): void {
  const documentId = primaryDocumentId(module);
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
      formatBytes,
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
    try {
      const task = runtime().install(module);
      setTasks(runtime().listTasks());
      const completed = await runtime().wait(task.id);
      setTasks(runtime().listTasks());
      setInstalled(runtime().listInstalled());
      if (completed.state === 'completed' && reconnect) await connectContentChanges();
      if (completed.state === 'failed') setWarning(completed.errorMessage);
      return completed.state === 'completed';
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : 'Не удалось установить набор.');
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
        if (result.errorMessage) setWarning(result.errorMessage);
        if (result.changed) await connectContentChanges();
      } catch (cause) {
        setWarning(cause instanceof Error ? cause.message : 'Не удалось скачать раздел целиком.');
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
      if (result.errorMessage) setWarning(result.errorMessage);
      if (result.changed) await connectContentChanges();
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : 'Не удалось скачать доступные наборы.');
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
              <div
                class="module-grid"
                classList={{ 'module-grid-two-columns': collection === 'shared' }}
              >
                <For each={regularModules().filter((module) => module.collection === collection)}>
                  {(module) => {
                    const installedValue = () => installedModule(module.id);
                    const task = () => moduleTask(module.id);
                    const progress = () =>
                      task() ? taskProgress(task() as ContentModuleDownloadTask) : null;
                    const working = () =>
                      task() && !['completed', 'failed', 'cancelled'].includes(task()?.state ?? '');
                    const updateAvailable = () =>
                      Boolean(
                        installedValue() &&
                          installedValue()?.version !== module.version &&
                          module.releaseState === 'published',
                      );
                    return (
                      <article
                        class="module-card paper-card"
                        classList={{ installed: Boolean(installedValue()) }}
                      >
                        <div class="module-card-topline">
                          <span class={`module-state state-${module.releaseState}`}>
                            {installedValue() ? 'Установлено' : RELEASE_LABELS[module.releaseState]}
                          </span>
                        </div>
                        <h3>{module.title}</h3>
                        <p>{module.description}</p>
                        <div class="module-facts doctor-module-facts">
                          <span>Версия {module.version}</span>
                          <span>
                            {module.previewDocumentCount || module.documents.length || '—'}{' '}
                            документов
                          </span>
                          <Show
                            when={installedValue()}
                            fallback={<span>{formatBytes(module.sizes.downloadBytes)}</span>}
                          >
                            {(installedModuleValue) => (
                              <>
                                <span>Версия {installedModuleValue().version}</span>
                                <span>
                                  На устройстве{' '}
                                  {formatBytes(installedModuleValue().installedSizeBytes)}
                                </span>
                                <span>{installedValidationLabel(installedModuleValue())}</span>
                              </>
                            )}
                          </Show>
                        </div>
                        <div class="module-capabilities">
                          <For each={capabilityLabels(module)}>
                            {(label) => <span>{label}</span>}
                          </For>
                        </div>

                        <Show when={task()}>
                          {(currentTask) => (
                            <div class="module-task-status">
                              <strong>{TASK_LABELS[currentTask().state]}</strong>
                              <Show when={progress() !== null}>
                                <div class="module-task-progress">
                                  <i style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                                </div>
                              </Show>
                              <Show when={currentTask().errorMessage}>
                                {(message) => <small>{message()}</small>}
                              </Show>
                            </div>
                          )}
                        </Show>

                        <Show
                          when={!module.required}
                          fallback={
                            <button type="button" onClick={() => setCoreOpen(true)}>
                              Открыть документы ядра
                            </button>
                          }
                        >
                          <Show
                            when={!installedValue()}
                            fallback={
                              <div class="module-card-actions">
                                <Show when={updateAvailable()}>
                                  <button
                                    type="button"
                                    disabled={Boolean(working())}
                                    onClick={() => void install(module)}
                                  >
                                    Обновить
                                  </button>
                                </Show>
                                <Show when={primaryDocumentId(module)}>
                                  <button type="button" onClick={() => openModuleDocument(module)}>
                                    Открыть
                                  </button>
                                </Show>
                                <button
                                  type="button"
                                  class="module-remove-button"
                                  onClick={() => void remove(module.id)}
                                >
                                  <AppGlyph name="trash" /> Удалить с устройства
                                </button>
                              </div>
                            }
                          >
                            <button
                              type="button"
                              disabled={module.releaseState !== 'published' || Boolean(working())}
                              onClick={() => void install(module)}
                            >
                              <Show
                                when={!working()}
                                fallback={<span class="module-action-spinner" />}
                              >
                                <AppGlyph name="download" />
                              </Show>
                              {working()
                                ? TASK_LABELS[task()?.state ?? 'queued']
                                : module.releaseState === 'published'
                                  ? 'Скачать документы'
                                  : 'Пока недоступно'}
                            </button>
                          </Show>
                        </Show>

                        <Show when={(installedValue()?.previousVersions.length ?? 0) > 0}>
                          <div class="module-version-history">
                            <span>Старые версии</span>
                            <For each={installedValue()?.previousVersions ?? []}>
                              {(version) => (
                                <button
                                  type="button"
                                  onClick={() => void activateVersion(module.id, version)}
                                >
                                  Открыть {version}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </article>
                    );
                  }}
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
                            {formatBytes(stats().downloadBytes)}
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
                    task() ? taskProgress(task() as ContentModuleDownloadTask) : null;
                  const working = () =>
                    task() && !['completed', 'failed', 'cancelled'].includes(task()?.state ?? '');
                  return (
                    <article class="recommendation-row paper-card recommendation-row-compact">
                      <div>
                        <Show
                          when={installedValue() && primaryDocumentId(module)}
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
                            : ` · ${formatBytes(module.sizes.downloadBytes)}`}
                        </span>
                        <Show when={working() && progress() !== null}>
                          <div class="recommendation-row-progress" role="progressbar">
                            <i style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                          </div>
                        </Show>
                      </div>
                      <Show
                        when={!installedValue()}
                        fallback={
                          <div class="recommendation-row-actions">
                            <Show when={primaryDocumentId(module)}>
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
                              : TASK_LABELS[task()?.state ?? 'queued']
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
                            disabled={!primaryDocumentId(module)}
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
