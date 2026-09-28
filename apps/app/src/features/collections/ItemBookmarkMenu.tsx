import { Popover } from '@kobalte/core/popover';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ItemCollectionCreateForm } from '@/features/search/ToolPinControls';
import {
  FAVORITES_TARGET,
  lastTargetKey,
  loadLastTargets,
  orderByLastTarget,
  rememberLastTarget,
} from '@/state/collection-last-target';
import {
  collectionIdsContaining,
  type ItemRefInput,
  isFavoriteItem,
  itemCollections,
  setItemInCollection,
  toggleFavoriteItem,
  updateItemCollections,
} from '@/state/item-collections';

import '@/features/search/search-quick-access.css';
import './item-bookmark.css';

/**
 * Save button for a document, medication card or note: a panel opens on click with «Избранные»,
 * the doctor's collections and a way to start a new one. The place used last for this kind of
 * item comes first, so repeated saving is one tap.
 */
export function ItemBookmarkMenu(props: {
  readonly item: ItemRefInput;
  readonly class?: string;
  /** Controlled panel, for a second way in (a reader's header menu); otherwise self-managed. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [ownOpen, setOwnOpen] = createSignal(false);
  const open = (): boolean => props.open ?? ownOpen();
  const setOpen = (value: boolean): void => {
    setOwnOpen(value);
    props.onOpenChange?.(value);
  };
  const [lastTargets, setLastTargets] = createSignal(loadLastTargets());
  createEffect(() => {
    if (open()) setLastTargets(loadLastTargets());
  });
  const title = () => props.item.title ?? props.item.id;
  const favorite = () => isFavoriteItem(itemCollections(), props.item);
  const memberOf = createMemo(() => collectionIdsContaining(itemCollections(), props.item));
  const saved = () => favorite() || memberOf().size > 0;
  const lastTarget = () => lastTargets()[lastTargetKey(props.item)];
  const collections = createMemo(() =>
    orderByLastTarget(itemCollections().collections, lastTarget()),
  );
  const remember = (target: string): void => {
    rememberLastTarget(props.item, target);
    setLastTargets(loadLastTargets());
  };
  const now = () => new Date().toISOString();
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-end" gutter={6} fitViewport>
      <Popover.Trigger
        class={`item-bookmark ${props.class ?? ''}`.trim()}
        classList={{ 'item-bookmark--saved': saved() }}
        aria-label={saved() ? `Сохранено: «${title()}»` : `Сохранить «${title()}»`}
        title={saved() ? 'Сохранено — изменить' : 'Сохранить'}
      >
        <AppGlyph name={saved() ? 'bookmark-fill' : 'bookmark'} class="item-bookmark__icon" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="tool-collection-menu" aria-label={`Сохранить: ${title()}`}>
          <p class="tool-collection-menu__heading">Сохранить в</p>
          <ul class="tool-collection-menu__list">
            <li class="tool-collection-menu__item">
              <label class="tool-collection-menu__option">
                <input
                  class="tool-collection-menu__checkbox"
                  type="checkbox"
                  checked={favorite()}
                  onChange={(event) => {
                    const include = event.currentTarget.checked;
                    if (include !== favorite())
                      updateItemCollections((state) =>
                        toggleFavoriteItem(state, props.item, now()),
                      );
                    if (include) remember(FAVORITES_TARGET);
                  }}
                />
                <span class="tool-collection-menu__name">Избранные</span>
                <Show when={lastTarget() === FAVORITES_TARGET}>
                  <span class="item-bookmark__last">в прошлый раз</span>
                </Show>
              </label>
            </li>
            <For each={collections()}>
              {(collection) => (
                <li class="tool-collection-menu__item">
                  <label class="tool-collection-menu__option">
                    <input
                      class="tool-collection-menu__checkbox"
                      type="checkbox"
                      checked={memberOf().has(collection.id)}
                      onChange={(event) => {
                        const included = event.currentTarget.checked;
                        updateItemCollections((state) =>
                          setItemInCollection(state, collection.id, props.item, included, now()),
                        );
                        if (included) remember(collection.id);
                      }}
                    />
                    <span class="tool-collection-menu__name">{collection.name}</span>
                    <Show
                      when={lastTarget() === collection.id}
                      fallback={
                        <span class="tool-collection-menu__count">{collection.items.length}</span>
                      }
                    >
                      <span class="item-bookmark__last">в прошлый раз</span>
                    </Show>
                  </label>
                </li>
              )}
            </For>
          </ul>
          <ItemCollectionCreateForm item={props.item} onCreated={(id) => remember(id)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
