import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';
import { toast } from 'solid-sonner';

import { syncHighlights, unitsRevision } from '@/features/anchoring/highlight-sync';
import type { AnchorUnit } from '@/features/anchoring/text-anchor';
import {
  loadUserHighlights,
  putUserHighlights,
  USER_HIGHLIGHTS_EVENT,
  type UserDocumentHighlight,
} from '@/state/user-library-highlights';

export interface DocumentHighlightStore {
  /** The document's highlights as stored (tombstones left out), oldest first. */
  readonly highlights: Accessor<readonly UserDocumentHighlight[]>;
  /** True once the first load finished. */
  readonly loaded: Accessor<boolean>;
  reload(): void;
  /**
   * Settles the highlights against the text the reader shows: verifies them, re-anchors moved or
   * reworded ones and carries those of earlier editions over. Call with the document's complete
   * text; calls with text that was already settled do nothing.
   */
  sync(units: readonly AnchorUnit[]): Promise<void>;
}

/**
 * The stored highlights of one document, kept in step with the store, and the re-anchoring pass
 * both the text readers and the PDF viewer run (`syncHighlights`).
 */
export function createDocumentHighlightStore(options: {
  readonly documentId: Accessor<string>;
  /** Earlier editions of the document, nearest first (КР chain, `supersedesDocumentIds`). */
  readonly predecessorDocumentIds?: Accessor<readonly string[]>;
}): DocumentHighlightStore {
  const [highlights, setHighlights] = createSignal<readonly UserDocumentHighlight[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  let settledKey = '';
  let running: Promise<void> | undefined;
  let disposed = false;

  const reload = (): void => {
    const documentId = options.documentId();
    void loadUserHighlights(documentId)
      .then((records) => {
        if (disposed || documentId !== options.documentId()) return;
        setHighlights(records);
        setLoaded(true);
      })
      .catch(() => toast.error('Не удалось загрузить выделения.'));
  };

  const runSync = async (units: readonly AnchorUnit[], key: string): Promise<void> => {
    const documentId = options.documentId();
    const [own, ...earlier] = await Promise.all([
      loadUserHighlights(documentId, { includeDismissed: true }),
      ...(options.predecessorDocumentIds?.() ?? []).map(async (id) => ({
        documentId: id,
        records: await loadUserHighlights(id),
      })),
    ]);
    const result = syncHighlights({
      documentId,
      records: own as readonly UserDocumentHighlight[],
      predecessors: earlier as readonly {
        documentId: string;
        records: readonly UserDocumentHighlight[];
      }[],
      units,
      revision: key,
    });
    if (disposed) return;
    await putUserHighlights(result.upserts);
  };

  const sync = (units: readonly AnchorUnit[]): Promise<void> => {
    if (!units.some((unit) => unit.text.length > 0)) return Promise.resolve();
    const revision = unitsRevision(units);
    const key = `${options.documentId()}|${(options.predecessorDocumentIds?.() ?? []).join(',')}|${revision}`;
    if (key === settledKey) return Promise.resolve();
    settledKey = key;
    const previous = running ?? Promise.resolve();
    running = previous
      .then(() => runSync(units, revision))
      .catch((cause: unknown) => {
        settledKey = '';
        console.warn('Highlights could not be re-anchored.', cause);
      });
    return running;
  };

  onMount(() => {
    reload();
    window.addEventListener(USER_HIGHLIGHTS_EVENT, reload);
    onCleanup(() => {
      disposed = true;
      window.removeEventListener(USER_HIGHLIGHTS_EVENT, reload);
    });
  });

  return { highlights, loaded, reload, sync };
}
