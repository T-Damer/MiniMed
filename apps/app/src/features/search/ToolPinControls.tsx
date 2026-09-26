import { Popover } from '@kobalte/core/popover';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { StarGlyph } from '@/components/StarGlyph';
import {
  collectionIdsContainingTool,
  createToolCollection,
  isFavoriteTool,
  setToolInCollection,
  toggleFavoriteTool,
  toolCollectionNameError,
  toolCollections,
  updateToolCollections,
} from '@/state/tool-collections';

import './search-quick-access.css';

/** Star toggle for one tool; shared by catalog cards and the quick-access list. */
export function ToolFavoriteButton(props: {
  readonly toolId: string;
  readonly toolTitle: string;
  readonly class?: string;
}): JSX.Element {
  const favorite = () => isFavoriteTool(toolCollections(), props.toolId);
  return (
    <button
      type="button"
      class={`tool-pin__star ${props.class ?? ''}`.trim()}
      classList={{ 'tool-pin__star--on': favorite() }}
      aria-pressed={favorite()}
      aria-label={
        favorite()
          ? `Убрать «${props.toolTitle}» из избранного`
          : `Добавить «${props.toolTitle}» в избранное`
      }
      title={favorite() ? 'Убрать из избранного' : 'В избранное'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        updateToolCollections((state) => toggleFavoriteTool(state, props.toolId));
      }}
    >
      <StarGlyph filled={favorite()} class="tool-pin__glyph" />
    </button>
  );
}

/** Inline form that creates a collection; optionally puts a tool into it right away. */
export function ToolCollectionCreateForm(props: {
  readonly toolId?: string;
  readonly onCreated?: (collectionId: string) => void;
}): JSX.Element {
  const [name, setName] = createSignal('');
  const [error, setError] = createSignal<string>();
  const submit = (): void => {
    const problem = toolCollectionNameError(toolCollections(), name());
    if (problem) {
      setError(problem);
      return;
    }
    const id = crypto.randomUUID();
    updateToolCollections((state) =>
      createToolCollection(state, name(), {
        id,
        createdAt: new Date().toISOString(),
        ...(props.toolId ? { toolIds: [props.toolId] } : {}),
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

/** Popover that adds one tool to any number of collections. */
export function ToolCollectionMenu(props: {
  readonly toolId: string;
  readonly toolTitle: string;
  readonly class?: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const memberOf = createMemo(() => collectionIdsContainingTool(toolCollections(), props.toolId));
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-end" gutter={6} fitViewport>
      <Popover.Trigger
        class={`tool-pin__collections ${props.class ?? ''}`.trim()}
        classList={{ 'tool-pin__collections--on': memberOf().size > 0 }}
        aria-label={`Коллекции для «${props.toolTitle}»`}
        title="Добавить в коллекцию"
        onClick={(event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <AppGlyph name="folder-open" class="tool-pin__glyph" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="tool-collection-menu" aria-label={`Коллекции: ${props.toolTitle}`}>
          <p class="tool-collection-menu__heading">Добавить в коллекцию</p>
          <Show
            when={toolCollections().collections.length > 0}
            fallback={
              <p class="tool-collection-menu__empty">Коллекций пока нет — создайте первую ниже.</p>
            }
          >
            <ul class="tool-collection-menu__list">
              <For each={toolCollections().collections}>
                {(collection) => (
                  <li class="tool-collection-menu__item">
                    <label class="tool-collection-menu__option">
                      <input
                        class="tool-collection-menu__checkbox"
                        type="checkbox"
                        checked={memberOf().has(collection.id)}
                        onChange={(event) => {
                          const included = event.currentTarget.checked;
                          updateToolCollections((state) =>
                            setToolInCollection(state, collection.id, props.toolId, included),
                          );
                        }}
                      />
                      <span class="tool-collection-menu__name">{collection.name}</span>
                      <span class="tool-collection-menu__count">{collection.toolIds.length}</span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <ToolCollectionCreateForm toolId={props.toolId} />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
