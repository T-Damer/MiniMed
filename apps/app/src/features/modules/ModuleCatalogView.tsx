import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  CoreStatus,
  InstalledContentModule,
} from '@localmed/contracts';
import type { ContentModuleCatalogSource } from '@localmed/core';
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

import { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';

interface ModuleCatalogViewProps {
  readonly status: CoreStatus;
  readonly active: boolean;
  readonly onContentChanged?: () => Promise<void>;
  readonly onAvailableUpdates?: (count: number) => void;
}

const COLLECTION_TITLES: Readonly<Record<string, string>> = {
  core: 'Всегда доступно',
  pediatrics: 'Клиническая педиатрия',
  shared: 'Лекарства, документы и нормы',
};

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

export function ModuleCatalogView(props: ModuleCatalogViewProps): JSX.Element {
  const [catalog, setCatalog] = createSignal<ContentModuleCatalog>(MODULE_CATALOG);
  const [source, setSource] = createSignal<ContentModuleCatalogSource>('bundled');
  const [warning, setWarning] = createSignal<string | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const [runtime, setRuntime] = createSignal(new BrowserContentModuleRuntime(MODULE_CATALOG));
  const [installed, setInstalled] = createSignal<readonly InstalledContentModule[]>(
    runtime().listInstalled(),
  );
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  const [contentChangePending, setContentChangePending] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [recommendationQuery, setRecommendationQuery] = createSignal('');
  const [recommendationCategory, setRecommendationCategory] = createSignal('');
  const [bulkInstalling, setBulkInstalling] = createSignal(false);
  let refreshedOnce = false;
  let unsubscribeTask: (() => void) | undefined;

  const bindRuntime = (nextCatalog: ContentModuleCatalog): void => {
    unsubscribeTask?.();
    const nextRuntime = new BrowserContentModuleRuntime(nextCatalog);
    setRuntime(nextRuntime);
    setInstalled(nextRuntime.listInstalled());
    setTasks(nextRuntime.listTasks());
    unsubscribeTask = nextRuntime.subscribe(() => {
      setTasks(nextRuntime.listTasks());
      setInstalled(nextRuntime.listInstalled());
    });
  };

  onMount(() => bindRuntime(MODULE_CATALOG));
  onCleanup(() => unsubscribeTask?.());

  const recommendationModules = createMemo(() =>
    catalog().modules.filter((module) => module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG)),
  );
  const regularModules = createMemo(() =>
    catalog().modules.filter((module) => !module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG)),
  );
  const collections = createMemo(() => [
    ...new Set(regularModules().map((module) => module.collection)),
  ]);
  const filteredRecommendations = createMemo(() => {
    const query = recommendationQuery().trim().toLocaleLowerCase('ru-RU');
    const category = recommendationCategory();
    return recommendationModules()
      .filter(
        (module) =>
          (!category || module.collection === category || module.tags.includes(category)) &&
          (!query ||
            [module.title, module.description, ...module.specialties, ...module.tags]
              .join(' ')
              .toLocaleLowerCase('ru-RU')
              .includes(query)),
      )
      .slice(0, 50);
  });

  const refresh = async (): Promise<void> => {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      const result = await refreshContentModuleCatalog();
      setCatalog(result.catalog);
      setSource(result.source);
      setWarning(result.warning);
      bindRuntime(result.catalog);
    } finally {
      setRefreshing(false);
    }
  };

  const connectContentChanges = async (): Promise<void> => {
    if (connecting()) return;
    if (!props.onContentChanged) {
      setContentChangePending(true);
      return;
    }
    setConnecting(true);
    setWarning(null);
    try {
      await props.onContentChanged();
      setContentChangePending(false);
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

  const installCategory = async (): Promise<void> => {
    const category = recommendationCategory();
    if (!category || bulkInstalling()) return;
    const modules = recommendationModules().filter(
      (module) =>
        (module.collection === category || module.tags.includes(category)) &&
        module.releaseState === 'published' &&
        !installedModule(module.id),
    );
    setBulkInstalling(true);
    let changed = false;
    try {
      for (const module of modules) {
        if (await install(module, false)) changed = true;
      }
      if (changed) await connectContentChanges();
    } finally {
      setBulkInstalling(false);
    }
  };

  const remove = async (moduleId: string): Promise<void> => {
    try {
      await runtime().remove(moduleId);
      setInstalled(runtime().listInstalled());
      await connectContentChanges();
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : 'Не удалось удалить набор.');
    }
  };

  createEffect(() => {
    props.onAvailableUpdates?.(availableCount(catalog()));
  });

  createEffect(() => {
    if (!props.active || refreshedOnce) return;
    refreshedOnce = true;
    void refresh();
  });

  return (
    <section class="module-page page-surface">
      <header class="subpage-heading module-heading">
        <div>
          <p class="archive-kicker">Документы на устройстве</p>
          <h1>База знаний</h1>
          <p>
            Скачивайте нужные разделы. После проверки они работают без интернета и участвуют в общем
            поиске MiniMed.
          </p>
        </div>
      </header>

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

      <For each={collections()}>
        {(collection) => (
          <section class="module-collection">
            <div class="module-collection-heading">
              <h2>{COLLECTION_TITLES[collection] ?? collection}</h2>
              <span>
                {regularModules().filter((module) => module.collection === collection).length}
              </span>
            </div>
            <div class="module-grid">
              <For each={regularModules().filter((module) => module.collection === collection)}>
                {(module) => {
                  const installedValue = () => installedModule(module.id);
                  const task = () => moduleTask(module.id);
                  const progress = () =>
                    task() ? taskProgress(task() as ContentModuleDownloadTask) : null;
                  const working = () =>
                    task() && !['completed', 'failed', 'cancelled'].includes(task()?.state ?? '');
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
                        <span>
                          {module.previewDocumentCount || module.documents.length || '—'} документов
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
                        <For each={capabilityLabels(module)}>{(label) => <span>{label}</span>}</For>
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
                          <button type="button" disabled>
                            Всегда доступно
                          </button>
                        }
                      >
                        <Show
                          when={!installedValue()}
                          fallback={
                            <button type="button" onClick={() => void remove(module.id)}>
                              Удалить с устройства
                            </button>
                          }
                        >
                          <button
                            type="button"
                            disabled={module.releaseState !== 'published' || Boolean(working())}
                            onClick={() => void install(module)}
                          >
                            {working()
                              ? TASK_LABELS[task()?.state ?? 'queued']
                              : module.releaseState === 'published'
                                ? 'Скачать документы'
                                : 'Пока недоступно'}
                          </button>
                        </Show>
                      </Show>

                      <details class="doctor-technical-details module-technical-details">
                        <summary>Сведения о наборе</summary>
                        <p>
                          Версия {module.version}. После загрузки MiniMed проверяет размер, SHA-256
                          и целостность SQLite перед подключением.
                        </p>
                      </details>
                    </article>
                  );
                }}
              </For>
            </div>
          </section>
        )}
      </For>

      <Show when={recommendationModules().length > 0}>
        <section class="module-collection recommendation-browser">
          <div class="module-collection-heading">
            <h2>Клинические рекомендации</h2>
            <span>{recommendationModules().length}</span>
          </div>
          <div class="recommendation-controls paper-card">
            <label>
              <span>Поиск по названию, коду или специальности</span>
              <input
                type="search"
                value={recommendationQuery()}
                onInput={(event) => setRecommendationQuery(event.currentTarget.value)}
                placeholder="Например: пневмония, J18, кардиология"
              />
            </label>
            <label>
              <span>Категория</span>
              <select
                value={recommendationCategory()}
                onChange={(event) => setRecommendationCategory(event.currentTarget.value)}
              >
                <option value="">Все категории</option>
                <For each={catalog().categories}>
                  {(category) => (
                    <option value={category.id}>
                      {category.title} · {category.recommendationCount}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <Show when={recommendationCategory()}>
              <button
                type="button"
                disabled={bulkInstalling()}
                onClick={() => void installCategory()}
              >
                {bulkInstalling() ? 'Загружаем категорию…' : 'Скачать всю категорию'}
              </button>
            </Show>
          </div>
          <p class="recommendation-result-note">
            Показано {filteredRecommendations().length}
            {filteredRecommendations().length === 50 ? ' первых результатов' : ''}
          </p>
          <div class="recommendation-list">
            <For each={filteredRecommendations()}>
              {(module) => {
                const installedValue = () => installedModule(module.id);
                const task = () => moduleTask(module.id);
                const working = () =>
                  task() && !['completed', 'failed', 'cancelled'].includes(task()?.state ?? '');
                return (
                  <article class="recommendation-row paper-card">
                    <div>
                      <strong>{module.title}</strong>
                      <span>
                        {module.tags.find((tag) => /^\d+_\d+$/u.test(tag))} ·{' '}
                        {formatBytes(module.sizes.downloadBytes)}
                      </span>
                    </div>
                    <Show
                      when={!installedValue()}
                      fallback={
                        <button type="button" onClick={() => void remove(module.id)}>
                          Удалить
                        </button>
                      }
                    >
                      <button
                        type="button"
                        disabled={
                          module.releaseState !== 'published' ||
                          Boolean(working()) ||
                          bulkInstalling()
                        }
                        onClick={() => void install(module)}
                      >
                        {working() ? TASK_LABELS[task()?.state ?? 'queued'] : 'Скачать'}
                      </button>
                    </Show>
                  </article>
                );
              }}
            </For>
          </div>
        </section>
      </Show>

      <details class="module-catalog-status doctor-technical-details">
        <summary>Обновление списка наборов</summary>
        <p>
          Источник: {source()}. Текущий встроенный пакет: {props.status.contentPackIds.join(', ')}.
        </p>
        <button type="button" disabled={refreshing()} onClick={() => void refresh()}>
          {refreshing() ? 'Проверяем…' : 'Проверить обновления'}
        </button>
      </details>
    </section>
  );
}
