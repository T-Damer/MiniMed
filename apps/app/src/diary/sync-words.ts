import type { SyncStatus } from '@/features/diary/connected/patient-connection';

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Where sending to the doctor stands, in a few words for the header line under the doctor's name. */
export function syncWords(sync: SyncStatus): string {
  switch (sync.phase) {
    case 'syncing':
      return 'отправляем…';
    case 'offline':
      return sync.pending ? `нет сети, ждут отправки: ${sync.pending}` : 'нет сети';
    case 'error':
      return 'не отправлено';
    case 'ended':
      return 'наблюдение завершено';
    case 'idle':
      if (sync.pending) return `ждут отправки: ${sync.pending}`;
      return sync.lastSyncAt
        ? `врач видит записи на ${clock(sync.lastSyncAt)}`
        : 'врач видит записи';
  }
}

/** Something is waiting or failed: the header offers «Отправить сейчас». */
export function syncNeedsAction(sync: SyncStatus): boolean {
  return sync.pending > 0 || sync.phase === 'offline' || sync.phase === 'error';
}
