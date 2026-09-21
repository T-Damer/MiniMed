import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import {
  contentModuleNeedsInstall,
  isModuleReleased,
} from '@/features/modules/local-packaged-modules';
import { formatModuleBytes } from '@/features/modules/module-display';
import { DownloadProgress } from './DownloadProgress';
import { downloadPercent } from './setup-state';

export function PackageDownloadRow(props: {
  readonly module: ContentModuleCatalogEntry;
  readonly runtime: BrowserContentModuleRuntime;
  readonly revision: number;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [error, setError] = createSignal<string>();
  const [starting, setStarting] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const task = createMemo(() => {
    props.revision;
    return props.runtime
      .listTasks()
      .toReversed()
      .find((item) => item.moduleId === props.module.id && item.version === props.module.version);
  });
  const installed = createMemo(() => {
    props.revision;
    return props.runtime.listInstalled().find((item) => item.moduleId === props.module.id);
  });
  const ready = () => installed()?.enabled && !contentModuleNeedsInstall(props.module, installed());
  const active = () => {
    const state = task()?.state;
    return (
      starting() || (state !== undefined && !['completed', 'failed', 'cancelled'].includes(state))
    );
  };
  const downloadable = () => {
    props.revision;
    return isModuleReleased(props.module);
  };
  const label = () => {
    if (ready()) return 'Установлен';
    if (task()?.state === 'verifying') return 'Проверяем';
    if (task()?.state === 'installing') return 'Устанавливаем';
    if (task()?.state === 'downloading') {
      const percent = downloadPercent(task()?.downloadedBytes ?? 0, task()?.totalBytes);
      return percent === undefined ? 'Скачиваем…' : `${Math.floor(percent)}%`;
    }
    if (active()) return 'В очереди';
    if (task()?.state === 'failed' || error()) return 'Ошибка';
    if (task()?.state === 'cancelled') return 'Отменено';
    if (!downloadable())
      return props.module.releaseState === 'preview' ? 'Предварительный' : 'Недоступен';
    return props.module.sizes.downloadBytes === null
      ? 'По выбору'
      : formatModuleBytes(props.module.sizes.downloadBytes);
  };
  const install = async () => {
    if (active() || ready() || !downloadable()) return;
    setError(undefined);
    setStarting(true);
    try {
      const next = props.runtime.install(props.module);
      if (!disposed) setStarting(false);
      const completed = await props.runtime.wait(next.id);
      if (completed.state === 'completed') await props.onContentChanged();
      else if (completed.state === 'failed')
        throw new Error(completed.errorMessage ?? 'Не удалось установить пакет.');
    } catch (cause) {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : 'Не удалось установить пакет.');
    } finally {
      if (!disposed) setStarting(false);
    }
  };
  return (
    <li class="package-row" data-module-id={props.module.id}>
      <div class="package-row__copy">
        <span class="package-row__title">{props.module.title}</span>
        <p class="package-row__description">{props.module.description}</p>
        <Show when={props.module.definitionReference}>
          <p class="package-row__notice">
            Предварительный справочник: исходные записи требуют проверки.
          </p>
        </Show>
        <Show when={!downloadable() && !ready() && props.module.releaseState === 'preview'}>
          <p class="package-row__notice">
            Для подготовленного пакета нужны доступный файл и включённые экспериментальные модули.
          </p>
        </Show>
        <Show when={error()}>
          {(message) => (
            <p class="package-row__error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </div>
      <div class="package-row__status">
        <span class="package-row__state" role="status" aria-live="polite">
          {label()}
        </span>
        <Show when={active() && !ready()}>
          <DownloadProgress
            value={
              task()?.state === 'downloading'
                ? downloadPercent(task()?.downloadedBytes ?? 0, task()?.totalBytes)
                : undefined
            }
            label={`Загрузка: ${props.module.title}`}
          />
          <Show when={task()}>
            {(current) => (
              <button
                class="package-row__button"
                type="button"
                onClick={() => props.runtime.cancel(current().id)}
              >
                Отменить
              </button>
            )}
          </Show>
        </Show>
        <Show when={!active() && !ready() && downloadable()}>
          <button class="package-row__button" type="button" onClick={() => void install()}>
            {task()?.state === 'failed' || error() ? 'Повторить' : 'Скачать'}
          </button>
        </Show>
      </div>
    </li>
  );
}
