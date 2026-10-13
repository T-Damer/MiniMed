import { CORE_DOWNLOAD_SIZE_LABEL } from '@/composition/core-download';
import { formatModuleBytes } from '@/features/modules/module-display';
import { downloadPercent } from '@/features/setup/setup-state';
import { formatSpeed } from './download-speed';

export interface CoreLineInput {
  readonly ready: boolean;
  readonly downloading: boolean;
  /** A metered connection is holding the automatic download for the user's decision. */
  readonly deferred: boolean;
  readonly error: string | undefined;
  readonly progress:
    | {
        readonly loaded: number;
        readonly total: number;
        readonly phase?: 'downloading' | 'verifying' | 'installing';
      }
    | undefined;
  /** Smoothed bytes per second, when known. */
  readonly speed: number | undefined;
}

export type CoreLineKind =
  | 'preparing'
  | 'connecting'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'deferred'
  | 'error'
  | 'ready';

export interface CoreLineState {
  readonly kind: CoreLineKind;
  /** 0..1 for a determinate line; undefined for an indeterminate one. */
  readonly fraction: number | undefined;
  /** The small text under the line, e.g. «37 % · 4,2 МБ/с». */
  readonly label: string;
  /**
   * A short form of the label for places where a long message would cover something (the
   * onboarding): the same as `label` except where `label` is a sentence.
   */
  readonly compactLabel: string;
}

function plain(kind: CoreLineKind, fraction: number | undefined, label: string): CoreLineState {
  return { kind, fraction, label, compactLabel: label };
}

/** What the thin line along the bottom edge shows for the core's current state. */
export function coreLineState(input: CoreLineInput): CoreLineState {
  if (input.ready) {
    const label = 'Основная база установлена';
    return { kind: 'ready', fraction: 1, label, compactLabel: label };
  }
  if (input.error) {
    const label = 'Не удалось скачать основную базу';
    return { kind: 'error', fraction: undefined, label, compactLabel: 'База не скачана' };
  }
  if (input.deferred && !input.downloading) {
    return {
      kind: 'deferred',
      fraction: 0,
      label: `Мобильная сеть: основная база около ${CORE_DOWNLOAD_SIZE_LABEL}`,
      compactLabel: 'Мобильная сеть',
    };
  }
  const phase = input.progress?.phase;
  if (phase === 'verifying') {
    return plain('verifying', undefined, 'Проверяем основную базу…');
  }
  if (phase === 'installing') {
    return plain('installing', undefined, 'Устанавливаем основную базу…');
  }
  const loaded = input.progress?.loaded ?? 0;
  if (!input.downloading && !input.progress) {
    return plain('preparing', undefined, 'Готовим поиск…');
  }
  if (loaded <= 0) return plain('connecting', undefined, 'Начинаем загрузку…');
  const percent = downloadPercent(loaded, input.progress?.total);
  const speed = input.speed === undefined ? '' : ` · ${formatSpeed(input.speed)}`;
  if (percent === undefined) {
    return plain('downloading', undefined, `${formatModuleBytes(loaded)}${speed}`);
  }
  return plain('downloading', percent / 100, `${Math.floor(percent)} %${speed}`);
}
