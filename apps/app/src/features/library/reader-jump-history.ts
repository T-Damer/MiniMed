/**
 * A jump the user makes inside a document (a contents entry, a page of the page bubble) is a step
 * in the history: the place the reader jumped from stays on its entry, the jump pushes an entry at
 * the same address, and back — the in-app ‹, the browser's, Android's — returns to the place the
 * reader was at, in the same document, instead of leaving it. Forward does the reverse.
 *
 * The entries are stamped like any other (`state/history-entries.ts`), carry the reading position
 * (section anchor plus pixels past its start) and are owned by the reader that made them; the
 * reader restores the position when the history arrives on one of its entries.
 */
import {
  currentHistoryEntry,
  type HistoryEntryInfo,
  onHistoryArrival,
  pushStampedEntry,
  type ReaderPosition,
  saveReaderPosition,
} from '@/state/history-entries';

export interface ReaderJumpHistory {
  /** Whether the entry belongs to this reader (its own or one of its jump steps). */
  owns(entryId: string): boolean;
  /**
   * Called just before a user jump: saves `position` (where the reader is now) on the current
   * entry and pushes the step the jump lands on. Does nothing on a foreign entry (a layer is open).
   */
  record(position: ReaderPosition | null): void;
  dispose(): void;
}

export function createReaderJumpHistory(options: {
  /** The entry the reader was made for. */
  readonly entryId: string;
  /** Puts the reader at a saved position (history arrived on one of its entries). */
  readonly restore: (position: ReaderPosition) => void;
}): ReaderJumpHistory {
  const owned = new Set<string>([options.entryId]);
  const stopArrival = onHistoryArrival((entry: HistoryEntryInfo, previous) => {
    if (previous?.id === entry.id) return;
    if (!owned.has(entry.id) || !entry.position) return;
    options.restore(entry.position);
  });
  return {
    owns: (entryId) => owned.has(entryId),
    record(position): void {
      const current = currentHistoryEntry();
      if (!owned.has(current.id)) return;
      if (position) saveReaderPosition(current.id, position);
      const step = pushStampedEntry(window.history.state, false);
      owned.add(step.id);
    },
    dispose(): void {
      stopArrival();
      owned.clear();
    },
  };
}
