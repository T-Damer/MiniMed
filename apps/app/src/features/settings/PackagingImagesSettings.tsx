import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  MEDICATION_PACKAGING_IMAGES_MODULE_ID,
  medicationPackagingImagesDownloadBytes,
} from '@/features/medications/medication-packaging-images';
import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { contentModuleTaskProgress, formatModuleBytes } from '@/features/modules/module-display';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { getExperimentalModulesEnabled, subscribeAppPreferences } from '@/state/app-preferences';

export type PackagingImagesModuleVisibility = 'hidden' | 'available' | 'disabled';

export function packagingImagesModuleVisibility(
  module: Pick<ContentModuleCatalogEntry, 'releaseState'> | undefined,
  experimentalEnabled: boolean,
): PackagingImagesModuleVisibility {
  if (!module) return 'hidden';
  if (module.releaseState === 'preview' && !experimentalEnabled) return 'hidden';
  return module.releaseState === 'published' || module.releaseState === 'preview'
    ? 'available'
    : 'disabled';
}

export function packagingImagesModule(
  catalog: ContentModuleCatalog,
  experimentalEnabled: boolean,
): ContentModuleCatalogEntry | null {
  const module = catalog.modules.find((item) => item.id === MEDICATION_PACKAGING_IMAGES_MODULE_ID);
  return packagingImagesModuleVisibility(module, experimentalEnabled) === 'hidden'
    ? null
    : (module ?? null);
}

function installable(module: ContentModuleCatalogEntry): boolean {
  return module.artifacts.some((artifact) => artifact.kind === 'index' && Boolean(artifact.url));
}

function taskIsActive(task: ContentModuleDownloadTask | undefined): boolean {
  return Boolean(task && !['completed', 'failed', 'cancelled'].includes(task.state));
}

interface PackagingImagesSettingsProps {
  readonly catalog?: ContentModuleCatalog;
}

export function PackagingImagesSettings(props: PackagingImagesSettingsProps = {}): JSX.Element {
  const [experimentalEnabled, setExperimentalEnabled] = createSignal(
    getExperimentalModulesEnabled(),
  );
  const [runtime, setRuntime] = createSignal(
    peekContentModuleRuntime() ?? getContentModuleRuntime(props.catalog ?? MODULE_CATALOG),
  );
  const [installed, setInstalled] = createSignal<readonly InstalledContentModule[]>(
    runtime().listInstalled(),
  );
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>(
    runtime().listTasks(),
  );
  const [error, setError] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal(false);

  let unsubscribeTasks: (() => void) | undefined;
  let unsubscribeRuntime: (() => void) | undefined;

  const bindRuntime = (nextRuntime: BrowserContentModuleRuntime): void => {
    unsubscribeTasks?.();
    setRuntime(nextRuntime);
    setInstalled(nextRuntime.listInstalled());
    setTasks(nextRuntime.listTasks());
    unsubscribeTasks = nextRuntime.subscribe(() => {
      setInstalled(nextRuntime.listInstalled());
      setTasks(nextRuntime.listTasks());
    });
  };

  onMount(() => {
    unsubscribeRuntime = subscribeContentModuleRuntime(bindRuntime);
    const unsubscribePreferences = subscribeAppPreferences((preferences) => {
      setExperimentalEnabled(preferences.experimentalModulesEnabled);
    });
    onCleanup(() => {
      unsubscribePreferences();
      unsubscribeRuntime?.();
      unsubscribeTasks?.();
    });
  });

  const module = createMemo(() =>
    packagingImagesModule(runtime().getCatalog(), experimentalEnabled()),
  );
  const visibility = createMemo(() =>
    packagingImagesModuleVisibility(module() ?? undefined, experimentalEnabled()),
  );
  const installedModule = createMemo(() => {
    const current = module();
    return current ? (installed().find((item) => item.moduleId === current.id) ?? null) : null;
  });
  const task = createMemo(() => {
    const current = module();
    return current
      ? (tasks().find((item) => item.moduleId === current.id && item.version === current.version) ??
          null)
      : null;
  });
  const updateAvailable = createMemo(() => {
    const current = module();
    const currentInstalled = installedModule();
    return Boolean(current && currentInstalled && currentInstalled.version !== current.version);
  });
  const working = createMemo(() => taskIsActive(task() ?? undefined) || removing());
  const activeTask = createMemo(() => {
    const current = task();
    return current && taskIsActive(current) ? current : null;
  });

  const installModule = (): void => {
    const current = module();
    if (!current || visibility() !== 'available' || !installable(current) || working()) return;
    setError(null);
    try {
      runtime().install(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось скачать пакет фотографий.');
    }
  };

  const removeModule = async (): Promise<void> => {
    const current = module();
    if (!current || working()) return;
    setError(null);
    setRemoving(true);
    try {
      await runtime().remove(current.id);
      setInstalled(runtime().listInstalled());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить пакет фотографий.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Show when={module()}>
      {(current) => (
        <section
          class="packaging-images-settings paper-card"
          aria-labelledby="packaging-images-settings-title"
          data-testid="packaging-images-settings"
        >
          <header class="packaging-images-settings__header">
            <div class="packaging-images-settings__heading">
              <AppGlyph name="image" class="packaging-images-settings__icon" aria-hidden="true" />
              <div>
                <h2 id="packaging-images-settings-title" class="packaging-images-settings__title">
                  Фото упаковок препаратов
                </h2>
                <p class="packaging-images-settings__subtitle">Справочные изображения Allmed</p>
              </div>
            </div>
            <span class="packaging-images-settings__badge">Experimental</span>
          </header>
          <p class="packaging-images-settings__description">
            Отдельный офлайн-пакет изображений. Он не заменяет официальные данные ЕСКЛП.
          </p>
          <p class="packaging-images-settings__meta">
            {formatModuleBytes(medicationPackagingImagesDownloadBytes(current()))} · версия{' '}
            {current().version}
          </p>
          <Show when={visibility() === 'disabled'}>
            <p class="packaging-images-settings__notice">Пакет ещё не опубликован.</p>
          </Show>
          <Show when={error()}>
            {(message) => (
              <p class="packaging-images-settings__error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={activeTask()}>
            {(currentTask) => {
              const progress = () => contentModuleTaskProgress(currentTask());
              return (
                <div class="packaging-images-settings__progress-block" role="status">
                  <span class="packaging-images-settings__progress-label">
                    {currentTask().state === 'downloading' && progress() !== null
                      ? `${Math.round((progress() ?? 0) * 100)}%`
                      : 'Подключаем пакет…'}
                  </span>
                  <div class="packaging-images-settings__progress" aria-hidden="true">
                    <span
                      class="packaging-images-settings__progress-fill"
                      style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            }}
          </Show>
          <div class="packaging-images-settings__actions">
            <Show when={!installedModule()}>
              <Button
                type="button"
                variant="primary"
                class="packaging-images-settings__action"
                disabled={visibility() !== 'available' || !installable(current()) || working()}
                onClick={installModule}
                icon={<AppGlyph name="download" />}
              >
                Скачать фотографии
              </Button>
            </Show>
            <Show when={updateAvailable()}>
              <Button
                type="button"
                variant="primary"
                class="packaging-images-settings__action"
                disabled={working()}
                onClick={installModule}
                icon={<AppGlyph name="refresh" />}
              >
                Обновить
              </Button>
            </Show>
            <Show when={installedModule()}>
              <Button
                type="button"
                variant="danger"
                class="packaging-images-settings__action"
                disabled={working()}
                onClick={() => void removeModule()}
                icon={<AppGlyph name="trash" />}
              >
                {removing() ? 'Удаляем…' : 'Удалить'}
              </Button>
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}
