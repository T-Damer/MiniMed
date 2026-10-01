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
}

/** What the thin line along the bottom edge shows for the core's current state. */
export function coreLineState(input: CoreLineInput): CoreLineState {
  if (input.ready) return { kind: 'ready', fraction: 1, label: 'Ядро знаний установлено' };
  if (input.error) return { kind: 'error', fraction: undefined, label: 'Не удалось скачать ядро' };
  if (input.deferred && !input.downloading) {
    return { kind: 'deferred', fraction: 0, label: 'Мобильная сеть: ядро около 490 МБ' };
  }
  const phase = input.progress?.phase;
  if (phase === 'verifying') {
    return { kind: 'verifying', fraction: undefined, label: 'Проверяем ядро…' };
  }
  if (phase === 'installing') {
    return { kind: 'installing', fraction: undefined, label: 'Устанавливаем ядро…' };
  }
  const loaded = input.progress?.loaded ?? 0;
  if (!input.downloading && !input.progress) {
    return { kind: 'preparing', fraction: undefined, label: 'Готовим поиск…' };
  }
  if (loaded <= 0) return { kind: 'connecting', fraction: undefined, label: 'Соединяемся…' };
  const percent = downloadPercent(loaded, input.progress?.total);
  const speed = input.speed === undefined ? '' : ` · ${formatSpeed(input.speed)}`;
  if (percent === undefined) {
    return {
      kind: 'downloading',
      fraction: undefined,
      label: `${formatModuleBytes(loaded)}${speed}`,
    };
  }
  return {
    kind: 'downloading',
    fraction: percent / 100,
    label: `${Math.floor(percent)} %${speed}`,
  };
}
