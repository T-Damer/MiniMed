import { type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { FeatureCard } from '@/components/FeatureCard';

import { OCR_LANGUAGE_PACK_SIZE_LABEL } from './ocr-language-pack-catalog';
import { OCR_PACK_FAILURE_MESSAGE } from './ocr-pack-view';
import { useOcrLanguagePack } from './use-ocr-language-pack';

/** «Распознавание текста (OCR)»: the language pack with its size, download and removal. */
export function OcrSettings(): JSX.Element {
  const pack = useOcrLanguagePack();
  const view = pack.view;
  const status = (): string => (pack.removing() ? 'Удаляем…' : view().label);
  // A failure that was restored from the download journal has no message of its own yet.
  const error = (): string =>
    pack.error() || (view().kind === 'failed' ? OCR_PACK_FAILURE_MESSAGE : '');

  const install = async (): Promise<void> => {
    if (await pack.install()) toast.success('Языковой пакет для распознавания текста скачан.');
  };

  return (
    <FeatureCard
      class="ocr-settings"
      headingId="settings-ocr-heading"
      icon="file-text"
      title="Распознавание текста (OCR)"
      summary="Превращает сканы и фото документов в текст, который можно искать. Нужен языковой пакет (рус + англ): он скачивается один раз и дальше работает без интернета."
      status={status()}
      tone={
        error()
          ? 'error'
          : view().busy || pack.removing()
            ? 'working'
            : view().kind === 'ready'
              ? 'ready'
              : 'idle'
      }
      {...(view().busy && view().fraction !== undefined ? { progress: view().fraction } : {})}
      {...(error() ? { error: error() } : {})}
      actions={
        <>
          <Show when={view().kind !== 'ready' && !view().busy}>
            <Button
              type="button"
              variant="primary"
              disabled={pack.removing()}
              onClick={() => void install()}
            >
              {view().kind === 'failed' ? 'Повторить' : 'Скачать'}
            </Button>
          </Show>
          <Show when={view().busy}>
            <Button
              type="button"
              variant="quiet"
              disabled={!view().cancellable}
              onClick={pack.cancel}
            >
              Отменить
            </Button>
          </Show>
          <Show when={view().kind === 'ready'}>
            <Button
              type="button"
              variant="quiet"
              disabled={pack.removing()}
              onClick={() => void pack.remove()}
            >
              Удалить
            </Button>
          </Show>
        </>
      }
      detailsTitle="Что внутри"
      details={
        <>
          <p>
            Языковые данные Tesseract (tessdata 4.0.0, лицензия Apache-2.0) для русского и
            английского языков, {OCR_LANGUAGE_PACK_SIZE_LABEL}. Скачанные файлы сверяются с
            контрольными суммами из приложения.
          </p>
          <p>
            Без пакета все остальные функции работают как обычно; распознавание предложит скачать
            его при первом запуске. После удаления пакета уже распознанный текст остаётся в
            документах.
          </p>
        </>
      }
    />
  );
}
