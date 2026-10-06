import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js';

import { getDownloadQueue } from '@/features/downloads/download-service';

import {
  ensureOcrLanguagePackFiles,
  installOcrLanguagePack,
  isOcrLanguagePackInstalled,
  OCR_DOWNLOAD_ID,
  removeOcrLanguagePack,
  subscribeOcrLanguagePack,
} from './ocr-language-pack';
import { OCR_PACK_FAILURE_MESSAGE, type OcrPackView, ocrPackView } from './ocr-pack-view';

export interface OcrLanguagePackControls {
  readonly view: Accessor<OcrPackView>;
  readonly removing: Accessor<boolean>;
  /** Empty when the last attempt did not fail. */
  readonly error: Accessor<string>;
  /** Resolves true once the pack is installed; false when it failed or the user stopped it. */
  readonly install: () => Promise<boolean>;
  readonly cancel: () => void;
  readonly remove: () => Promise<void>;
}

const isAbort = (cause: unknown): boolean => cause instanceof Error && cause.name === 'AbortError';

/** The state of the OCR language pack and its actions, shared by the prompt and the settings card. */
export function useOcrLanguagePack(): OcrLanguagePackControls {
  const queue = getDownloadQueue();
  const [installed, setInstalled] = createSignal(isOcrLanguagePackInstalled());
  const [task, setTask] = createSignal(queue.get(OCR_DOWNLOAD_ID));
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;

  const sync = (): void => {
    setInstalled(isOcrLanguagePackInstalled());
    setTask(queue.get(OCR_DOWNLOAD_ID));
  };

  onMount(() => {
    sync();
    // A cleared site store leaves the descriptor behind; this notices it and offers the pack again.
    ensureOcrLanguagePackFiles().then(
      () => {
        if (!disposed) sync();
      },
      (cause: unknown) => {
        console.warn('Файлы языкового пакета OCR не проверены.', cause);
      },
    );
    const unsubscribers = [subscribeOcrLanguagePack(sync), queue.subscribe(sync)];
    onCleanup(() => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    });
  });

  const view = createMemo(() => ocrPackView({ installed: installed(), task: task() }));

  const install = async (): Promise<boolean> => {
    if (installed()) return true;
    setError('');
    try {
      await installOcrLanguagePack();
      return true;
    } catch (cause) {
      if (!isAbort(cause)) {
        console.warn('Языковой пакет OCR не скачан.', cause);
        if (!disposed) setError(OCR_PACK_FAILURE_MESSAGE);
      }
      return false;
    } finally {
      if (!disposed) sync();
    }
  };

  const cancel = (): void => {
    queue.cancel(OCR_DOWNLOAD_ID).catch((cause: unknown) => {
      console.warn('Отмену загрузки языкового пакета OCR не удалось подтвердить.', cause);
      if (!disposed) setError('Не удалось подтвердить отмену загрузки.');
    });
  };

  const remove = async (): Promise<void> => {
    if (view().busy) return;
    setRemoving(true);
    setError('');
    try {
      await removeOcrLanguagePack();
    } catch (cause) {
      console.warn('Языковой пакет OCR не удалён.', cause);
      setError('Не удалось удалить языковой пакет.');
    } finally {
      if (!disposed) {
        sync();
        setRemoving(false);
      }
    }
  };

  return { view, removing, error, install, cancel, remove };
}
