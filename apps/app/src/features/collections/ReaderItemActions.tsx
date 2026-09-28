import { createSignal, type JSX } from 'solid-js';
import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import type { AppGlyphName } from '@/components/AppGlyph';
import { ItemBookmarkMenu } from '@/features/collections/ItemBookmarkMenu';
import type { ItemRefInput } from '@/state/item-collections';

import './reader-item-actions.css';

/** The reader's action menu glyph: a dropdown mark, not three dots next to the ☰ outline button. */
export const READER_ACTIONS_ICON: AppGlyphName = 'caret-circle-down';

/** One collections panel per reader: the title row owns the button, the header menu can open it. */
export interface ReaderBookmark {
  readonly open: () => boolean;
  readonly setOpen: (open: boolean) => void;
}

export function createReaderBookmark(): ReaderBookmark {
  const [open, setOpen] = createSignal(false);
  return { open, setOpen };
}

/**
 * «Меню действий» in a reader's header: the reader's own actions (print first), then «Сохранить
 * в коллекцию», which opens the same panel as the bookmark before the title.
 */
export function ReaderActionsMenu(props: {
  readonly actions: readonly AppContextMenuAction[];
  readonly bookmark?: ReaderBookmark;
}): JSX.Element {
  const actions = (): readonly AppContextMenuAction[] => {
    const bookmark = props.bookmark;
    return bookmark
      ? [
          ...props.actions,
          {
            id: 'save-to-collection',
            label: 'Сохранить в коллекцию',
            icon: 'bookmark',
            // After the menu has closed and returned focus, or the panel would close with it.
            onSelect: () => window.setTimeout(() => bookmark.setOpen(true), 0),
          },
        ]
      : props.actions;
  };
  return (
    <AppContextMenu
      class="reader-actions"
      buttonClass="reader-actions__button"
      buttonIcon={READER_ACTIONS_ICON}
      buttonLabel="Меню действий"
      actions={actions()}
    >
      <span class="reader-actions__anchor" aria-hidden="true" />
    </AppContextMenu>
  );
}

/** The document's title with its bookmark in front, on one line. */
export function ReaderTitleRow(props: {
  readonly item: ItemRefInput;
  readonly bookmark: ReaderBookmark;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <div class="reader-title-row">
      <ItemBookmarkMenu
        class="reader-title-row__bookmark"
        item={props.item}
        open={props.bookmark.open()}
        onOpenChange={props.bookmark.setOpen}
      />
      <div class="reader-title-row__title">{props.children}</div>
    </div>
  );
}
