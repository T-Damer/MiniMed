import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import {
  contentModuleNeedsInstall,
  isModuleReleased,
} from '@/features/modules/local-packaged-modules';
import { formatModuleBytes } from '@/features/modules/module-display';
import { DownloadProgress } from '@/features/setup/DownloadProgress';
import { downloadPercent } from '@/features/setup/setup-state';
import '@/features/reference/reference.css';

/**
 * The dictionary is not installed: one row with its name, its size and the download — nothing
 * else. Progress is shown in place; the dialog stays usable meanwhile.
 */
export function DictionaryDownload(props: {
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
  const percent = () =>
    task()?.state === 'downloading'
      ? downloadPercent(task()?.downloadedBytes ?? 0, task()?.totalBytes)
      : undefined;
  const status = (): string => {
    if (task()?.state === 'verifying') return 'Проверяем';
    if (task()?.state === 'installing') return 'Устанавливаем';
    if (task()?.state === 'downloading')
      return percent() === undefined ? 'Скачиваем…' : `${Math.floor(percent() ?? 0)}%`;
    if (active()) return 'В очереди';
    if (!downloadable()) return 'Пока недоступен';
    return props.module.sizes.downloadBytes === null
      ? ''
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
        throw new Error(completed.errorMessage ?? 'Не удалось установить словарь.');
    } catch (cause) {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : 'Не удалось установить словарь.');
    } finally {
      if (!disposed) setStarting(false);
    }
  };
  return (
    <div class="dictionary-download" data-module-id={props.module.id}>
      <div class="dictionary-download__copy">
        <span class="dictionary-download__title">{props.module.title}</span>
        <span class="dictionary-download__status" role="status" aria-live="polite">
          {status()}
        </span>
      </div>
      <Show when={active()}>
        <DownloadProgress
          class="dictionary-download__progress"
          value={percent()}
          label={`Загрузка: ${props.module.title}`}
        />
      </Show>
      <Show when={!active() && !ready() && downloadable()}>
        <button class="dictionary-download__button" type="button" onClick={() => void install()}>
          {task()?.state === 'failed' || error() ? 'Повторить' : 'Скачать'}
        </button>
      </Show>
      <Show when={active() && task()}>
        {(current) => (
          <button
            class="dictionary-download__button dictionary-download__button--quiet"
            type="button"
            onClick={() => props.runtime.cancel(current().id)}
          >
            Отменить
          </button>
        )}
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="dictionary-download__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
