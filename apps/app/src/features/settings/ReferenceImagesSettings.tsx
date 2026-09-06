import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { getReferenceImageResolver } from '@/features/library/reference-image-assets';
import { formatModuleBytes } from '@/features/modules/module-display';

export function ReferenceImagesSettings(): JSX.Element {
  const resolver = getReferenceImageResolver();
  const [status, setStatus] = createSignal({ complete: false, files: 0 });
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [total, setTotal] = createSignal<number | null>(null);
  const [error, setError] = createSignal('');
  let controller: AbortController | undefined;
  const sync = async (): Promise<void> => {
    const next = await resolver.downloadStatus();
    setStatus(next);
    setTotal(next.totalBytes);
  };
  onMount(() => void sync().catch((cause: unknown) => setError(String(cause))));
  onCleanup(() => controller?.abort());
  const download = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setError('');
    controller = new AbortController();
    try {
      await resolver.downloadAll(controller.signal, (downloaded, bytes) => {
        setTotal(bytes);
        setProgress(bytes > 0 ? downloaded / bytes : 0);
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось скачать иллюстрации.');
    } finally {
      controller = undefined;
      setBusy(false);
      await sync().catch((cause: unknown) => setError(String(cause)));
    }
  };
  const remove = async (): Promise<void> => {
    setError('');
    try {
      await resolver.removeDownloaded();
      await sync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить иллюстрации.');
    }
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
        {status().complete ? 'Скачаны все иллюстрации' : `Сохранено файлов: ${status().files}`}
        <Show when={total() !== null}> · {formatModuleBytes(total())}</Show>
      </p>
      <div class="reference-images-settings__actions">
        <Show when={!status().complete}>
          <Button
            type="button"
            class="reference-images-settings__action"
            variant="primary"
            disabled={busy()}
            onClick={() => void download()}
          >
            {busy() ? `Скачиваем ${Math.round(progress() * 100)}%` : 'Скачать'}
          </Button>
        </Show>
        <Show
          when={busy()}
          fallback={
            <Show when={status().files > 0}>
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
            onClick={() => controller?.abort()}
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
