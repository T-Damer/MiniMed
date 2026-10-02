import { CORE_DOWNLOAD_SIZE_LABEL } from '@/composition/core-download';
import { formatModuleBytes } from '@/features/modules/module-display';

/**
 * What the search page shows while the medical core is not ready. The page itself stays mounted
 * and usable; only the field is disabled and a compact status sits under it.
 */
export type SearchCoreStatus =
  | { readonly kind: 'opening'; readonly slow: boolean }
  | { readonly kind: 'other-tab' }
  | { readonly kind: 'downloading'; readonly loaded: number; readonly total: number }
  | { readonly kind: 'verifying' }
  | { readonly kind: 'installing' }
  /** Missing core held for the user's consent (metered network); the setup screen owns it. */
  | { readonly kind: 'download-required' }
  | { readonly kind: 'error'; readonly message: string };

export interface CoreSessionSnapshot {
  readonly ready: boolean;
  readonly error: string | undefined;
  readonly waitingForOtherTab: boolean;
  readonly downloadRequired: boolean;
  readonly downloading: boolean;
  readonly progress:
    | {
        readonly loaded: number;
        readonly total: number;
        readonly phase?: 'downloading' | 'verifying' | 'installing';
      }
    | undefined;
  readonly slow: boolean;
}

/** Maps the session's core signals to one status, or undefined once search is ready. */
export function searchCoreStatus(session: CoreSessionSnapshot): SearchCoreStatus | undefined {
  if (session.ready) return undefined;
  if (session.error) return { kind: 'error', message: session.error };
  if (session.waitingForOtherTab) return { kind: 'other-tab' };
  const phase = session.progress?.phase;
  if (phase === 'verifying') return { kind: 'verifying' };
  if (phase === 'installing') return { kind: 'installing' };
  if (session.downloading || session.progress)
    return {
      kind: 'downloading',
      loaded: session.progress?.loaded ?? 0,
      total: session.progress?.total ?? 0,
    };
  if (session.downloadRequired) return { kind: 'download-required' };
  return { kind: 'opening', slow: session.slow };
}

/** An open that finishes sooner than this shows only the field's placeholder. */
export const SEARCH_CORE_NOTE_DELAY_MS = 400;

/**
 * Whether the note under the field is worth showing. A quick open finishes before the delay and
 * the field's placeholder already says so; a note that flashes in and out only shifts the page.
 */
export function searchCoreStatusNoteVisible(
  status: SearchCoreStatus,
  delayPassed: boolean,
): boolean {
  return status.kind !== 'opening' || status.slow || delayPassed;
}

/** Share downloaded, 0–1, or null when there is nothing to measure. */
export function searchCoreProgress(status: SearchCoreStatus): number | null {
  if (status.kind !== 'downloading' || status.total <= 0) return null;
  return Math.max(0, Math.min(1, status.loaded / status.total));
}

/** Short text for the disabled search field. */
export function searchCoreStatusLabel(status: SearchCoreStatus): string {
  switch (status.kind) {
    case 'opening':
      return 'Подготавливаем поиск…';
    case 'other-tab':
      return 'MiniMed открыт в другой вкладке';
    case 'downloading': {
      const progress = searchCoreProgress(status);
      return progress === null
        ? 'Загружаем базу…'
        : `Загружаем базу… ${Math.floor(progress * 100)}%`;
    }
    case 'verifying':
      return 'Проверяем базу…';
    case 'installing':
      return 'Устанавливаем базу…';
    case 'download-required':
      return 'Поиск откроется после загрузки ядра';
    case 'error':
      return 'База не открылась';
  }
}

/** The line under the field: what is happening and what already works. */
export function searchCoreStatusDetail(status: SearchCoreStatus): string {
  switch (status.kind) {
    case 'opening':
      return status.slow
        ? 'Подготовка базы продолжается. Инструменты, свои файлы и настройки уже доступны.'
        : 'Инструменты, свои файлы и настройки уже доступны.';
    case 'other-tab':
      return 'Локальную базу одновременно открывает только одна вкладка. Закройте другую — поиск откроется здесь автоматически.';
    case 'downloading':
      return status.total > 0
        ? `Скачано ${formatModuleBytes(status.loaded)} из ${formatModuleBytes(status.total)}. Затем проверим и откроем базу.`
        : 'Соединяемся с сервером…';
    case 'verifying':
      return 'Сверяем контрольную сумму ядра.';
    case 'installing':
      return 'Устанавливаем проверенное ядро.';
    case 'download-required':
      return `Загрузка ядра — около ${CORE_DOWNLOAD_SIZE_LABEL}. Скачайте его, чтобы искать по источникам.`;
    case 'error':
      return status.message;
  }
}
