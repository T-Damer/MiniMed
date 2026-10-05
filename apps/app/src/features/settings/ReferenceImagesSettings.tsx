import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { FeatureCard } from '@/components/FeatureCard';
import { downloadTaskFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import {
  getReferenceImageResolver,
  REFERENCE_IMAGES_DOWNLOAD_ID,
} from '@/features/library/reference-image-assets';
import { formatModuleBytes } from '@/features/modules/module-display';

export function ReferenceImagesSettings(): JSX.Element {
  const resolver = getReferenceImageResolver();
  const queue = getDownloadQueue();
  const [task, setTask] = createSignal(queue.get(REFERENCE_IMAGES_DOWNLOAD_ID));
  const [status, setStatus] = createSignal<Awaited<ReturnType<typeof resolver.downloadStatus>>>();
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal('');
  const busy = () => {
    const current = task();
    return Boolean(current && isDownloadActive(current));
  };
  const progress = () => {
    const current = task();
    return current ? downloadTaskFraction(current) : null;
  };
  let disposed = false;
  const sync = async (): Promise<void> => {
    const next = await resolver.downloadStatus();
    if (!disposed) setStatus(next);
  };
  const syncSafely = (): void => {
    void sync().catch(() => {
      if (!disposed) setError('Не удалось проверить сохранённые иллюстрации.');
    });
  };
  onMount(() => {
    let previous = queue.get(REFERENCE_IMAGES_DOWNLOAD_ID)?.state;
    const update = (): void => {
      const current = queue.get(REFERENCE_IMAGES_DOWNLOAD_ID);
      setTask(current);
      if (current?.state !== previous && current && !isDownloadActive(current)) syncSafely();
      previous = current?.state;
    };
    update();
    syncSafely();
    onCleanup(queue.subscribe(update));
  });
  // Leaving Settings removes subscriptions only. The app-wide owner retains the transfer.
  onCleanup(() => {
    disposed = true;
  });
  const download = (): void => {
    if (busy() || removing()) return;
    setError('');
    void resolver
      .downloadAll(new AbortController().signal, () => undefined)
      .catch((cause: unknown) => {
        if (!disposed && !(cause instanceof Error && cause.name === 'AbortError'))
          setError('Не удалось скачать или проверить иллюстрации.');
      });
  };
  const cancel = (): void => {
    void queue.cancel(REFERENCE_IMAGES_DOWNLOAD_ID).catch(() => {
      if (!disposed) setError('Не удалось подтвердить отмену загрузки.');
    });
  };
  const remove = async (): Promise<void> => {
    if (busy() || removing()) return;
    setRemoving(true);
    setError('');
    try {
      await resolver.removeDownloaded();
      await sync();
    } catch {
      if (!disposed) setError('Не удалось удалить иллюстрации.');
    } finally {
      if (!disposed) setRemoving(false);
    }
  };
  const statusLabel = (): string => {
    const current = task();
    if (removing()) return 'Удаляем…';
    if (current?.state === 'verifying') return 'Проверяем файлы…';
    if (current?.state === 'installing') return 'Сохраняем…';
    if (current?.state === 'cancelling') return 'Останавливаем…';
    if (current?.state === 'queued') return 'В очереди';
    if (busy()) {
      const fraction = progress();
      return fraction === null ? 'Скачивается…' : `Скачивается · ${Math.floor(fraction * 100)}%`;
    }
    const known = status();
    if (!known) return 'Проверяем…';
    if (known.complete) return 'Все скачаны';
    if (known.files > 0) return `Скачано ${known.files} из ${known.totalFiles}`;
    return `Не скачано · ${formatModuleBytes(known.totalBytes)}`;
  };
  return (
    <FeatureCard
      class="reference-images-settings"
      headingId="settings-reference-images-heading"
      icon="image-fill"
      title="Иллюстрации на устройстве"
      summary="Иллюстрации к статьям «Красота и медицина» будут открываться без интернета. То, что вы уже смотрели, сохраняется само."
      status={statusLabel()}
      tone={
        error() ? 'error' : busy() || removing() ? 'working' : status()?.complete ? 'ready' : 'idle'
      }
      {...(busy() ? { progress: progress() } : {})}
      {...(error() ? { error: error() } : {})}
      actions={
        <>
          <Show when={!status()?.complete && !busy()}>
            <Button
              type="button"
              variant="primary"
              disabled={removing() || !status()}
              onClick={() => void download()}
            >
              {(status()?.files ?? 0) > 0 ? 'Докачать остальные' : 'Скачать все'}
            </Button>
          </Show>
          <Show when={busy()}>
            <Button type="button" variant="quiet" disabled={!task()?.canCancel} onClick={cancel}>
              Отменить
            </Button>
          </Show>
          <Show when={!busy() && (status()?.files ?? 0) > 0}>
            <Button
              type="button"
              variant="quiet"
              disabled={removing()}
              onClick={() => void remove()}
            >
              Удалить скачанные
            </Button>
          </Show>
        </>
      }
      {...(status()
        ? {
            details: (
              <p class="reference-images-settings__details">
                {status()?.totalFiles} файлов, {formatModuleBytes(status()?.totalBytes ?? 0)}.
                Картинки хранятся на этом устройстве и не занимают место в базе поиска.
              </p>
            ),
          }
        : {})}
    />
  );
}
