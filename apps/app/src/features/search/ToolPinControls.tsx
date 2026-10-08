import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SheetPopover } from '@/components/SheetPopover';
import { StarGlyph } from '@/components/StarGlyph';
import {
  collectionIdsContaining,
  collectionNameError,
  createCollection,
  type ItemRefInput,
  isFavoriteItem,
  itemCollections,
  setItemInCollection,
  toggleFavoriteItem,
  updateItemCollections,
} from '@/state/item-collections';

import './search-quick-access.css';

/**
 * Tool collections are put away for now (owner 2026-10-08): the folder button on tool cards and
 * the «Коллекции» section of the tool sheet stay hidden. Favourites and their row stay.
 */
export const TOOL_COLLECTIONS_VISIBLE = false;

/** A tool as a collection item: tools resolve their live title from the catalog. */
export function toolItem(toolId: string, title: string): ItemRefInput {
  return { kind: 'tool', id: toolId, title };
}

/** Star toggle for one item; shared by catalog cards, the tool sheet and document pages. */
export function ItemFavoriteButton(props: {
  readonly item: ItemRefInput;
  readonly class?: string;
}): JSX.Element {
  const title = () => props.item.title ?? props.item.id;
  const favorite = () => isFavoriteItem(itemCollections(), props.item);
  return (
    <button
      type="button"
      class={`tool-pin__star ${props.class ?? ''}`.trim()}
      classList={{ 'tool-pin__star--on': favorite() }}
      aria-pressed={favorite()}
      aria-label={
        favorite() ? `Убрать «${title()}» из избранного` : `Добавить «${title()}» в избранное`
      }
      title={favorite() ? 'Убрать из избранного' : 'В избранное'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        updateItemCollections((state) =>
          toggleFavoriteItem(state, props.item, new Date().toISOString()),
        );
      }}
    >
      <StarGlyph filled={favorite()} class="tool-pin__glyph" />
    </button>
  );
}

/** Inline form that creates a collection; optionally puts an item into it right away. */
export function ItemCollectionCreateForm(props: {
  readonly item?: ItemRefInput;
  readonly onCreated?: (collectionId: string) => void;
}): JSX.Element {
  const [name, setName] = createSignal('');
  const [error, setError] = createSignal<string>();
  const submit = (): void => {
    const problem = collectionNameError(itemCollections(), name());
    if (problem) {
      setError(problem);
      return;
    }
    const id = crypto.randomUUID();
    updateItemCollections((state) =>
      createCollection(state, name(), {
        id,
        createdAt: new Date().toISOString(),
        ...(props.item ? { items: [props.item] } : {}),
      }),
    );
    setName('');
    setError(undefined);
    props.onCreated?.(id);
  };
  return (
    <form
      class="tool-collection-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label class="tool-collection-form__label">
        <span class="sr-only">Название новой коллекции</span>
        <input
          class="tool-collection-form__input"
          type="text"
          value={name()}
          maxlength={80}
          placeholder="Новая коллекция, например «Приём кардиолога»"
          aria-invalid={Boolean(error())}
          onInput={(event) => {
            setName(event.currentTarget.value);
            setError(undefined);
          }}
        />
      </label>
      <button class="tool-collection-form__submit" type="submit" aria-label="Создать коллекцию">
        <AppGlyph name="plus" class="tool-pin__glyph" />
      </button>
      <Show when={error()}>
        {(message) => (
          <p class="tool-collection-form__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}

/** Panel (a popover, or a sheet on phones) that adds one item to any number of collections. */
export function ItemCollectionMenu(props: {
  readonly item: ItemRefInput;
  readonly class?: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const title = () => props.item.title ?? props.item.id;
  const memberOf = createMemo(() => collectionIdsContaining(itemCollections(), props.item));
  return (
    <Show when={TOOL_COLLECTIONS_VISIBLE}>
      <SheetPopover
        open={open()}
        onOpenChange={setOpen}
        title={`Коллекции: ${title()}`}
        placement="bottom-end"
        triggerClass={`tool-pin__collections ${props.class ?? ''}`.trim()}
        triggerClassList={{ 'tool-pin__collections--on': memberOf().size > 0 }}
        triggerLabel={`Коллекции для «${title()}»`}
        triggerTitle="Добавить в коллекцию"
        stopTriggerClick
        trigger={<AppGlyph name="folder-open" class="tool-pin__glyph" />}
        contentClass="tool-collection-menu"
      >
        <p class="tool-collection-menu__heading">Добавить в коллекцию</p>
        <Show
          when={itemCollections().collections.length > 0}
          fallback={
            <p class="tool-collection-menu__empty">Коллекций пока нет — создайте первую ниже.</p>
          }
        >
          <ul class="tool-collection-menu__list">
            <For each={itemCollections().collections}>
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
                          setItemInCollection(
                            state,
                            collection.id,
                            props.item,
                            included,
                            new Date().toISOString(),
                          ),
                        );
                      }}
                    />
                    <span class="tool-collection-menu__name">{collection.name}</span>
                    <span class="tool-collection-menu__count">{collection.items.length}</span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <ItemCollectionCreateForm item={props.item} />
      </SheetPopover>
    </Show>
  );
}
