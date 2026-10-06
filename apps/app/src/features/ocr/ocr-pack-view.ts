import { type DownloadTask, downloadTaskFraction } from '@/features/downloads/download-queue';

import { OCR_LANGUAGE_PACK_SIZE_LABEL } from './ocr-language-pack-catalog';

/**
 * What the OCR language pack looks like to the user, derived from the two things that exist: the
 * stored pack and the download task. One place for the wording, so the prompt sheet and the
 * settings card never disagree.
 */
export type OcrPackViewKind =
  | 'missing'
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'failed'
  | 'ready';

export interface OcrPackView {
  readonly kind: OcrPackViewKind;
  /** 0–1 while bytes are moving, null when the total is unknown, undefined when no bar applies. */
  readonly fraction: number | null | undefined;
  readonly label: string;
  /** A transfer or commit is in flight: starting another one would only join it. */
  readonly busy: boolean;
  /** Whether the user can still stop it; the final commit cannot be interrupted. */
  readonly cancellable: boolean;
}

export const OCR_PACK_FAILURE_MESSAGE =
  'Не удалось скачать или проверить языковой пакет. Проверьте соединение и повторите.';

const MISSING_LABEL = `Не скачано · ${OCR_LANGUAGE_PACK_SIZE_LABEL}`;

function percent(fraction: number | null): string {
  return fraction === null ? '' : ` · ${Math.floor(fraction * 100)}%`;
}

function resting(kind: 'missing' | 'failed', label: string): OcrPackView {
  return { kind, fraction: undefined, label, busy: false, cancellable: false };
}

export function ocrPackView(input: {
  readonly installed: boolean;
  readonly task: DownloadTask | undefined;
}): OcrPackView {
  const { installed, task } = input;
  if (installed) {
    return {
      kind: 'ready',
      fraction: undefined,
      label: 'Готово к работе',
      busy: false,
      cancellable: false,
    };
  }
  if (!task) return resting('missing', MISSING_LABEL);
  const fraction = downloadTaskFraction(task);
  switch (task.state) {
    case 'queued':
      return {
        kind: 'queued',
        fraction: null,
        label: 'В очереди',
        busy: true,
        cancellable: task.canCancel,
      };
    case 'downloading':
    case 'retrying':
      return {
        kind: 'downloading',
        fraction,
        label:
          task.state === 'retrying'
            ? 'Ждём сеть, повторим автоматически'
            : `Скачивается${percent(fraction)}`,
        busy: true,
        cancellable: task.canCancel,
      };
    case 'verifying':
      return {
        kind: 'verifying',
        fraction: null,
        label: 'Проверяем файлы…',
        busy: true,
        cancellable: task.canCancel,
      };
    case 'installing':
    case 'cancelling':
      return {
        kind: 'installing',
        fraction: null,
        label: task.state === 'cancelling' ? 'Останавливаем…' : 'Сохраняем на устройстве…',
        busy: true,
        cancellable: false,
      };
    case 'failed':
    case 'interrupted':
      return resting('failed', 'Не скачано · ошибка');
    case 'completed':
    case 'cancelled':
      return resting('missing', MISSING_LABEL);
  }
}
