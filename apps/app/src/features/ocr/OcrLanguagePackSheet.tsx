import { createUniqueId, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';

import { OCR_LANGUAGE_PACK_SIZE_LABEL } from './ocr-language-pack-catalog';
import { useOcrLanguagePack } from './use-ocr-language-pack';

import '@/styles/ocr-language-pack.css';

interface OcrLanguagePackSheetProps {
  readonly open: boolean;
  /** The sheet was dismissed; a transfer that is already running keeps going in the background. */
  readonly onClose: () => void;
  /** The pack is on the device: the OCR the user asked for can start now. */
  readonly onReady: () => void;
}

/**
 * Asked in place when the user requests OCR and the language pack is not on the device: what is
 * needed and how large it is, then «Скачать» (the consent), progress, and «Повторить» on failure.
 * When the pack lands, OCR starts on its own.
 */
export function OcrLanguagePackSheet(props: OcrLanguagePackSheetProps): JSX.Element {
  const pack = useOcrLanguagePack();
  const descriptionId = createUniqueId();
  const view = pack.view;

  const download = async (): Promise<void> => {
    if (await pack.install()) props.onReady();
  };

  return (
    <OverlayDialog
      open={props.open}
      title="Распознавание текста"
      describedBy={descriptionId}
      tracksHistory={false}
      class="ocr-pack-sheet"
      onClose={props.onClose}
    >
      <div class="ocr-pack-sheet__body" id={descriptionId}>
        <p class="ocr-pack-sheet__text" data-testid="ocr-pack-prompt">
          Для распознавания текста нужен языковой пакет (рус + англ) ·{' '}
          {OCR_LANGUAGE_PACK_SIZE_LABEL}. Он скачивается один раз и дальше работает без интернета:
          документ и распознанный текст остаются на устройстве.
        </p>
        <Show when={view().kind !== 'missing' && view().kind !== 'failed'}>
          <div class="ocr-pack-sheet__status" role="status" aria-live="polite">
            <span class="ocr-pack-sheet__status-label">{view().label}</span>
            <span
              class="ocr-pack-sheet__progress"
              role="progressbar"
              aria-label={view().label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                typeof view().fraction === 'number'
                  ? Math.round((view().fraction as number) * 100)
                  : undefined
              }
            >
              <span
                class="ocr-pack-sheet__progress-fill"
                classList={{
                  'ocr-pack-sheet__progress-fill--indeterminate': view().fraction === null,
                }}
                style={{ '--ocr-pack-progress': String(view().fraction ?? 0.35) }}
              />
            </span>
          </div>
        </Show>
        <Show when={pack.error()}>
          {(message) => (
            <p class="ocr-pack-sheet__error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div class="ocr-pack-sheet__actions">
          <Show
            when={view().busy}
            fallback={
              <>
                <Button type="button" variant="quiet" onClick={props.onClose}>
                  Не сейчас
                </Button>
                <Button type="button" variant="primary" onClick={() => void download()}>
                  {view().kind === 'failed' || pack.error() ? 'Повторить' : 'Скачать'}
                </Button>
              </>
            }
          >
            <Button type="button" variant="quiet" onClick={props.onClose}>
              Скрыть
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!view().cancellable}
              onClick={pack.cancel}
            >
              Отменить загрузку
            </Button>
          </Show>
        </div>
      </div>
    </OverlayDialog>
  );
}
