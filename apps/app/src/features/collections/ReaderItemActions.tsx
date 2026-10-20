import { createSignal, type JSX, Show } from 'solid-js';
import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import type { AppGlyphName } from '@/components/AppGlyph';
import { ItemBookmarkMenu } from '@/features/collections/ItemBookmarkMenu';
import type { ItemRefInput } from '@/state/item-collections';

import './reader-item-actions.css';

/** The reader's action menu glyph: a dropdown mark, not three dots next to the ☰ outline button. */
export const READER_ACTIONS_ICON: AppGlyphName = 'dots-three';

/** One collections panel per reader, opened from the header's «⋯» menu (owner 2026-10-20: no bookmark beside the title). */
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
 * в коллекцию», which opens the collections panel anchored on this menu.
 */
export function ReaderActionsMenu(props: {
  readonly actions: readonly AppContextMenuAction[];
  readonly bookmark?: ReaderBookmark;
  /** What «Сохранить в коллекцию» saves; without it the item is left out of the menu. */
  readonly bookmarkItem?: ItemRefInput | undefined;
}): JSX.Element {
  const actions = (): readonly AppContextMenuAction[] => {
    const bookmark = props.bookmark;
    return bookmark && props.bookmarkItem
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
    <div class="reader-actions-host">
      <AppContextMenu
        class="reader-actions"
        buttonClass="reader-actions__button"
        buttonIcon={READER_ACTIONS_ICON}
        buttonLabel="Меню действий"
        actions={actions()}
      >
        <span class="reader-actions__anchor" aria-hidden="true" />
      </AppContextMenu>
      <Show when={props.bookmark && props.bookmarkItem}>
        <ItemBookmarkMenu
          hiddenTrigger
          item={props.bookmarkItem as ItemRefInput}
          open={props.bookmark?.open() ?? false}
          onOpenChange={(open) => props.bookmark?.setOpen(open)}
        />
      </Show>
    </div>
  );
}

/** The document's title row; saving lives in the header's «⋯» menu. */
export function ReaderTitleRow(props: { readonly children: JSX.Element }): JSX.Element {
  return (
    <div class="reader-title-row">
      <div class="reader-title-row__title">{props.children}</div>
    </div>
  );
}
