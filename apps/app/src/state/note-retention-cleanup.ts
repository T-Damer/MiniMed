import { deleteNoteFilesForNotes } from '@/state/note-files';
import { deleteNoteImagesForNotes } from '@/state/note-images';

const PENDING_KEY = 'minimed-note-retention-cleanup-v1';

const memoryPending = new Set<string>();
let cleanupInFlight: Promise<void> | null = null;

function normalizedIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value))];
}

function storedPendingIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return normalizedIds(JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function pendingIds(): string[] {
  return [...new Set([...memoryPending, ...storedPendingIds()])];
}

function persistPending(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (ids.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // The current-session in-memory journal still keeps cleanup retryable.
  }
}

function removeProcessed(processed: ReadonlySet<string>): void {
  for (const noteId of processed) memoryPending.delete(noteId);
  const remaining = storedPendingIds().filter((noteId) => !processed.has(noteId));
  persistPending(remaining);
}

function logCleanupFailure(cause: unknown): void {
  console.warn(
    cause instanceof Error
      ? `Не удалось завершить очистку удалённых заметок: ${cause.message}`
      : 'Не удалось завершить очистку удалённых заметок.',
  );
}

export function scheduleNoteRetentionCleanup(noteIds: readonly string[]): void {
  const ids = normalizedIds(noteIds);
  if (ids.length === 0) return;
  for (const noteId of ids) memoryPending.add(noteId);
  persistPending(pendingIds());
  void runPendingNoteRetentionCleanup().catch(logCleanupFailure);
}

export function runPendingNoteRetentionCleanup(): Promise<void> {
  if (cleanupInFlight) return cleanupInFlight;

  let completed = false;
  const task = (async () => {
    const ids = pendingIds();
    if (ids.length === 0) return;
    const processed = new Set(ids);

    // Files delete transcripts first, so the most sensitive derived text is
    // removed before the attachment store is mutated.
    await deleteNoteFilesForNotes(ids);
    await deleteNoteImagesForNotes(ids);
    removeProcessed(processed);
    completed = true;
  })();

  cleanupInFlight = task.finally(() => {
    cleanupInFlight = null;
    if (completed && pendingIds().length > 0) {
      queueMicrotask(() => {
        void runPendingNoteRetentionCleanup().catch(logCleanupFailure);
      });
    }
  });
  return cleanupInFlight;
}

if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    void runPendingNoteRetentionCleanup().catch(logCleanupFailure);
  });
}
