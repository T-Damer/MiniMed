import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import type { SavedEntry } from '@/features/collections/saved-items';
import { openQuickTool } from '@/features/search/quick-tools';

import './saved-items.css';

/** One saved item: tap opens it, the small button takes it out of this list. */
export function SavedItemRow(props: {
  readonly entry: SavedEntry;
  readonly onOpen?: (() => void) | undefined;
  readonly onRemove?: (() => void) | undefined;
}): JSX.Element {
  return (
    <li class="saved-items__row">
      <button
        type="button"
        class="saved-items__open"
        onClick={() => {
          props.onOpen?.();
          openQuickTool(props.entry.tool);
        }}
      >
        <AppGlyph name={props.entry.tool.icon} class="saved-items__icon" />
        <span class="saved-items__copy">
          <span class="saved-items__title">{props.entry.tool.title}</span>
          <span class="saved-items__meta">{props.entry.tool.kindLabel}</span>
        </span>
      </button>
      <Show when={props.onRemove}>
        {(remove) => (
          <button
            type="button"
            class="saved-items__remove"
            aria-label={`Убрать «${props.entry.tool.title}»`}
            title="Убрать"
            onClick={() => remove()()}
          >
            <AppGlyph name="close" class="saved-items__remove-icon" />
          </button>
        )}
      </Show>
    </li>
  );
}
