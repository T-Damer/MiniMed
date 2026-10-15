import { type SearchCoreStatus, searchCoreProgress } from '@/features/search/search-core-status';
import type { SearchScope } from '@/features/search/search-scopes';

/**
 * Scopes whose page is built from the app itself (the tool catalog, the doctor's own files), so
 * they open while the medical core is still downloading. Every other section lists documents the
 * core holds and waits for it.
 */
const SCOPES_WITHOUT_CORE: ReadonlySet<SearchScope> = new Set([
  'all',
  'personal',
  'calculators',
  'assessments',
]);

export function scopeNeedsCore(scope: SearchScope): boolean {
  return !SCOPES_WITHOUT_CORE.has(scope);
}

/** The id of the one notice about the waiting core: a second tap replaces it, never stacks. */
export const SECTION_WAIT_NOTICE_ID = 'section-core-wait';

/** Short notice for a section that cannot open yet; what the core is doing decides the words. */
export function sectionWaitMessage(status: SearchCoreStatus): string {
  switch (status.kind) {
    case 'opening':
    case 'downloading':
    case 'verifying':
    case 'installing':
      return 'Загружаем ядро знаний, подождите';
    case 'offline':
      return 'Нет сети: ядро знаний загрузится, когда она появится';
    case 'waiting':
    case 'download-required':
      return 'Ядро знаний ещё не загружено';
    case 'other-tab':
      return 'Ядро знаний открыто в другой вкладке';
    case 'error':
      return 'Ядро знаний не открылось';
  }
}

export interface SectionWaitMark {
  readonly state: 'queued' | 'running' | 'failed';
  /** 0–1, or null while there is nothing to measure. */
  readonly progress: number | null;
  /** The pie turns: the work is on but has no share to show. */
  readonly busy: boolean;
}

/** The mark of a section's loading state: a real download share, a still mark, or a turning pie. */
export function sectionWaitMark(status: SearchCoreStatus | undefined): SectionWaitMark {
  switch (status?.kind) {
    case 'downloading':
      return { state: 'running', progress: searchCoreProgress(status), busy: false };
    case 'error':
      return { state: 'failed', progress: 1, busy: false };
    case 'waiting':
    case 'download-required':
    case 'offline':
    case 'other-tab':
      return { state: 'queued', progress: null, busy: false };
    default:
      return { state: 'running', progress: null, busy: true };
  }
}

export type SectionGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string };

/**
 * Whether a section may open now. `status` is the core's status, undefined once the core is ready.
 * The gate only stops the user's own choice (a row, the scope picker, the analysis switch); an
 * address that names a section still opens it, onto a loading state.
 */
export function sectionGate(scope: SearchScope, status: SearchCoreStatus | undefined): SectionGate {
  if (status === undefined || !scopeNeedsCore(scope)) return { allowed: true };
  return { allowed: false, message: sectionWaitMessage(status) };
}
