import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { highlightStatusNote } from '@/features/library/highlight-status';
import { createDocumentHighlightStore } from '@/features/library/use-document-highlights';
import {
  removeUserHighlight,
  type UserDocumentHighlight,
  userHighlightColor,
} from '@/state/user-library-highlights';

import '@/features/library/document-highlights-sheet.css';

/** The text a row shows: the quote on one line of context, not the whole selection. */
function previewQuote(quote: string): string {
  const flat = quote.replace(/\s+/gu, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 217)}…` : flat;
}

/**
 * The document's highlights as a list: tap one to go to it, remove it, and see which ones were
 * carried over from an earlier edition or could not be found in this one (those are kept, with the
 * words the reader selected, so nothing is lost with an edition change).
 */
export function DocumentHighlightsSheet(props: {
  readonly documentId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Goes to a highlight that is on the page. */
  readonly onJump: (highlight: UserDocumentHighlight) => void;
  /** Opens the earlier edition a highlight came from. */
  readonly onOpenEarlier?: ((documentId: string) => void) | undefined;
}): JSX.Element {
  const store = createDocumentHighlightStore({ documentId: () => props.documentId });
  const items = (): readonly UserDocumentHighlight[] =>
    store.highlights().filter((item) => !item.cfiRange);
  const missing = (): readonly UserDocumentHighlight[] =>
    items().filter((item) => item.anchorStatus === 'missing');
  const found = (): readonly UserDocumentHighlight[] =>
    items().filter((item) => item.anchorStatus !== 'missing');

  const row = (item: UserDocumentHighlight): JSX.Element => {
    // The heading above the not-found rows already says it.
    const note = item.anchorStatus === 'missing' ? undefined : highlightStatusNote(item);
    const earlier = item.carriedFrom?.documentId;
    return (
      <li class="document-highlights__item">
        <button
          type="button"
          class="document-highlights__jump"
          disabled={item.anchorStatus === 'missing'}
          onClick={() => {
            props.onClose();
            props.onJump(item);
          }}
        >
          <span
            class="document-highlights__swatch"
            style={{ '--highlight-color': userHighlightColor(item.color).fill }}
            aria-hidden="true"
          />
          <span class="document-highlights__text">
            <span class="document-highlights__quote">{previewQuote(item.quote)}</span>
            <Show when={note}>
              {(value) => <span class="document-highlights__note">{value()}</span>}
            </Show>
          </span>
        </button>
        <Show when={earlier && props.onOpenEarlier}>
          <button
            type="button"
            class="document-highlights__action"
            aria-label="Открыть прежнюю редакцию"
            title="Открыть прежнюю редакцию"
            onClick={() => {
              props.onClose();
              if (earlier) props.onOpenEarlier?.(earlier);
            }}
          >
            <AppGlyph name="arrow-square-out" class="document-highlights__icon" />
          </button>
        </Show>
        <button
          type="button"
          class="document-highlights__action"
          aria-label="Убрать выделение"
          title="Убрать выделение"
          onClick={() => void removeUserHighlight(item.id)}
        >
          <AppGlyph name="trash" class="document-highlights__icon" />
        </button>
      </li>
    );
  };

  return (
    <OverlayDialog open={props.open} title="Выделения" onClose={props.onClose}>
      <Show
        when={items().length > 0}
        fallback={
          <p class="document-highlights__empty">
            <AppGlyph name="highlighter" class="document-highlights__icon" />
            Выделите текст в документе
          </p>
        }
      >
        <div class="document-highlights">
          <Show when={missing().length > 0}>
            <h3 class="document-highlights__heading">Не найдено в новой редакции</h3>
            <ul class="document-highlights__list">
              <For each={missing()}>{row}</For>
            </ul>
          </Show>
          <Show when={found().length > 0}>
            <Show when={missing().length > 0}>
              <h3 class="document-highlights__heading">На странице</h3>
            </Show>
            <ul class="document-highlights__list">
              <For each={found()}>{row}</For>
            </ul>
          </Show>
        </div>
      </Show>
    </OverlayDialog>
  );
}
