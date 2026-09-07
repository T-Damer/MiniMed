import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
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
  const downloadLabel = (): string => {
    const current = task();
    if (current?.state === 'verifying') return 'Проверяем данные';
    if (current?.state === 'installing') return 'Сохраняем данные';
    if (current?.state === 'cancelling') return 'Останавливаем';
    if (current?.state === 'queued') return 'В очереди';
    return busy()
      ? progress() === null
        ? 'Скачиваем'
        : `Скачиваем ${Math.floor((progress() ?? 0) * 100)}%`
      : 'Скачать';
  };
  return (
    <section
      class="settings-section paper-sheet reference-images-settings"
      aria-labelledby="settings-reference-images-heading"
    >
      <header class="settings-section__heading">
        <div class="settings-section__heading-main">
          <AppGlyph name="image" class="settings-section__icon" />
          <div class="settings-section__heading-copy">
            <h2 id="settings-reference-images-heading" class="settings-section__title">
              Иллюстрации справочника
            </h2>
            <p class="settings-section__description">
              Изображения источника «Красота и медицина». Скачайте заранее для просмотра без
              интернета. Уже просмотренные изображения сохраняются автоматически.
            </p>
          </div>
        </div>
      </header>
      <p class="reference-images-settings__status" role="status">
        <Show when={status()} fallback={'Проверяем каталог иллюстраций…'}>
          {(current) => (
            <>
              {current().complete
                ? 'Скачаны все иллюстрации'
                : current().files > 0
                  ? `Сохранено файлов: ${current().files}`
                  : 'Ещё не скачано'}
              {' · '}Файлы: {current().totalFiles}
              {' · '}
              {formatModuleBytes(current().totalBytes)}
            </>
          )}
        </Show>
      </p>
      <div class="reference-images-settings__actions">
        <Show when={!status()?.complete}>
          <Button
            type="button"
            class="reference-images-settings__action"
            variant="primary"
            disabled={busy() || removing() || !status()}
            onClick={() => void download()}
          >
            {downloadLabel()}
          </Button>
        </Show>
        <Show
          when={busy()}
          fallback={
            <Show when={(status()?.files ?? 0) > 0}>
              <Button
                type="button"
                class="reference-images-settings__action"
                variant="danger"
                onClick={() => void remove()}
              >
                Удалить
              </Button>
            </Show>
          }
        >
          <Button
            type="button"
            class="reference-images-settings__action"
            variant="danger"
            disabled={!task()?.canCancel}
            onClick={cancel}
          >
            Отменить
          </Button>
        </Show>
      </div>
      <Show when={error()}>
        <p class="reference-images-settings__error" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}
