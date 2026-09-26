import { Popover } from '@kobalte/core/popover';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { FolderFigure } from '@/components/FolderFigure';
import { StarGlyph } from '@/components/StarGlyph';
import {
  openQuickTool,
  type QuickTool,
  type ResolvedToolRef,
  resolveToolRefs,
} from '@/features/search/quick-tools';
import {
  ToolCollectionCreateForm,
  ToolCollectionMenu,
  ToolFavoriteButton,
} from '@/features/search/ToolPinControls';
import {
  deleteToolCollection,
  renameToolCollection,
  setToolInCollection,
  type ToolCollection,
  toolCollectionNameError,
  toolCollections,
  updateToolCollections,
} from '@/state/tool-collections';

import './search-quick-access.css';

const MAX_CHIPS = 8;

/** One pinned tool; a tool no longer in the catalog stays visible and marked unavailable. */
function QuickToolRow(props: {
  readonly entry: ResolvedToolRef;
  readonly onOpen: (tool: QuickTool) => void;
  readonly trailing: JSX.Element;
}): JSX.Element {
  return (
    <li class="quick-tool-row" classList={{ 'quick-tool-row--unavailable': !props.entry.tool }}>
      <Show
        when={props.entry.tool}
        fallback={
          <span class="quick-tool-row__open quick-tool-row__open--unavailable">
            <AppGlyph name="question" class="quick-tool-row__icon" />
            <span class="quick-tool-row__copy">
              <span class="quick-tool-row__title">{props.entry.id}</span>
              <span class="quick-tool-row__meta">Недоступен — нет в текущем каталоге</span>
            </span>
          </span>
        }
      >
        {(tool) => (
          <button type="button" class="quick-tool-row__open" onClick={() => props.onOpen(tool())}>
            <AppGlyph name={tool().icon} class="quick-tool-row__icon" />
            <span class="quick-tool-row__copy">
              <span class="quick-tool-row__title">{tool().title}</span>
              <span class="quick-tool-row__meta">{tool().kindLabel}</span>
            </span>
          </button>
        )}
      </Show>
      {props.trailing}
    </li>
  );
}

function CollectionRenameForm(props: {
  readonly collection: ToolCollection;
  readonly onDone: () => void;
}): JSX.Element {
  const [name, setName] = createSignal(props.collection.name);
  const [error, setError] = createSignal<string>();
  return (
    <form
      class="tool-collection-form"
      onSubmit={(event) => {
        event.preventDefault();
        const problem = toolCollectionNameError(toolCollections(), name(), props.collection.id);
        if (problem) {
          setError(problem);
          return;
        }
        updateToolCollections((state) => renameToolCollection(state, props.collection.id, name()));
        props.onDone();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          props.onDone();
        }
      }}
    >
      <label class="tool-collection-form__label">
        <span class="sr-only">Новое название коллекции «{props.collection.name}»</span>
        <input
          ref={(element) => requestAnimationFrame(() => element.select())}
          class="tool-collection-form__input"
          type="text"
          value={name()}
          maxlength={80}
          aria-invalid={Boolean(error())}
          onInput={(event) => {
            setName(event.currentTarget.value);
            setError(undefined);
          }}
        />
      </label>
      <button class="tool-collection-form__submit" type="submit" aria-label="Сохранить название">
        <AppGlyph name="check" class="tool-pin__glyph" />
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

/**
 * Compact tool access above the search field: a menu with favourites first and folder-like
 * collections below, plus chips for the first favourites. Stays visible while typing.
 */
export function SearchQuickAccess(props: {
  readonly tools: readonly QuickTool[];
  /** Built-in tools without a catalog card, offered here so they can be starred too. */
  readonly builtInTools: readonly QuickTool[];
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [expanded, setExpanded] = createSignal<string>();
  const [renaming, setRenaming] = createSignal<string>();
  const [pendingDelete, setPendingDelete] = createSignal<ToolCollection>();
  const toolsById = createMemo(() => new Map(props.tools.map((tool) => [tool.id, tool])));
  const favorites = createMemo(() => resolveToolRefs(toolCollections().favorites, toolsById()));
  const chips = createMemo(() =>
    favorites()
      .flatMap((entry) => (entry.tool ? [entry.tool] : []))
      .slice(0, MAX_CHIPS),
  );
  const openFromMenu = (tool: QuickTool): void => {
    setOpen(false);
    openQuickTool(tool);
  };
  return (
    <div class="search-quick-access">
      <Popover open={open()} onOpenChange={setOpen} placement="bottom-start" gutter={6} fitViewport>
        <Popover.Trigger class="search-quick-access__menu" aria-label="Мои инструменты">
          <StarGlyph filled class="search-quick-access__menu-icon" />
          <span class="search-quick-access__menu-label">Мои инструменты</span>
          <AppGlyph name="caret-down" class="search-quick-access__menu-caret" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="search-quick-access__panel" aria-label="Мои инструменты">
            <section class="search-quick-access__section" aria-labelledby="quick-access-favorites">
              <h2 class="search-quick-access__heading" id="quick-access-favorites">
                Избранное
              </h2>
              <Show
                when={favorites().length > 0}
                fallback={
                  <p class="search-quick-access__empty">
                    Отметьте калькулятор или опросник звёздочкой — он появится здесь и над поиском.
                  </p>
                }
              >
                <ul class="search-quick-access__list">
                  <For each={favorites()}>
                    {(entry) => (
                      <QuickToolRow
                        entry={entry}
                        onOpen={openFromMenu}
                        trailing={
                          <ToolFavoriteButton
                            toolId={entry.id}
                            toolTitle={entry.tool?.title ?? entry.id}
                          />
                        }
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </section>
            <section
              class="search-quick-access__section"
              aria-labelledby="quick-access-collections"
            >
              <h2 class="search-quick-access__heading" id="quick-access-collections">
                Коллекции
              </h2>
              <ul class="search-quick-access__list">
                <For each={toolCollections().collections}>
                  {(collection) => {
                    const isExpanded = () => expanded() === collection.id;
                    const entries = createMemo(() =>
                      resolveToolRefs(collection.toolIds, toolsById()),
                    );
                    return (
                      <li class="tool-collection-row">
                        <Show
                          when={renaming() !== collection.id}
                          fallback={
                            <CollectionRenameForm
                              collection={collection}
                              onDone={() => setRenaming(undefined)}
                            />
                          }
                        >
                          <div class="tool-collection-row__header">
                            <button
                              type="button"
                              class="tool-collection-row__toggle"
                              aria-expanded={isExpanded()}
                              onClick={() => setExpanded(isExpanded() ? undefined : collection.id)}
                            >
                              <FolderFigure
                                variant="list"
                                hasDocument={collection.toolIds.length > 0}
                              />
                              <span class="tool-collection-row__name">{collection.name}</span>
                              <span class="tool-collection-row__count">
                                {collection.toolIds.length}
                              </span>
                            </button>
                            <button
                              type="button"
                              class="tool-collection-row__action"
                              aria-label={`Переименовать «${collection.name}»`}
                              title="Переименовать"
                              onClick={() => setRenaming(collection.id)}
                            >
                              <AppGlyph name="edit" class="tool-pin__glyph" />
                            </button>
                            <button
                              type="button"
                              class="tool-collection-row__action"
                              aria-label={`Удалить «${collection.name}»`}
                              title="Удалить коллекцию"
                              onClick={() => setPendingDelete(collection)}
                            >
                              <AppGlyph name="trash" class="tool-pin__glyph" />
                            </button>
                          </div>
                        </Show>
                        <Show when={isExpanded()}>
                          <Show
                            when={entries().length > 0}
                            fallback={
                              <p class="search-quick-access__empty">
                                Пусто. Добавьте инструмент кнопкой с папкой на его карточке.
                              </p>
                            }
                          >
                            <ul class="tool-collection-row__tools">
                              <For each={entries()}>
                                {(entry) => (
                                  <QuickToolRow
                                    entry={entry}
                                    onOpen={openFromMenu}
                                    trailing={
                                      <button
                                        type="button"
                                        class="tool-collection-row__action"
                                        aria-label={`Убрать «${entry.tool?.title ?? entry.id}» из «${collection.name}»`}
                                        title="Убрать из коллекции"
                                        onClick={() =>
                                          updateToolCollections((state) =>
                                            setToolInCollection(
                                              state,
                                              collection.id,
                                              entry.id,
                                              false,
                                            ),
                                          )
                                        }
                                      >
                                        <AppGlyph name="close" class="tool-pin__glyph" />
                                      </button>
                                    }
                                  />
                                )}
                              </For>
                            </ul>
                          </Show>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <ToolCollectionCreateForm onCreated={(id) => setExpanded(id)} />
            </section>
            <section class="search-quick-access__section" aria-labelledby="quick-access-built-in">
              <h2 class="search-quick-access__heading" id="quick-access-built-in">
                Встроенные инструменты
              </h2>
              <ul class="search-quick-access__list">
                <For each={props.builtInTools}>
                  {(tool) => (
                    <QuickToolRow
                      entry={{ id: tool.id, tool }}
                      onOpen={openFromMenu}
                      trailing={
                        <>
                          <ToolFavoriteButton toolId={tool.id} toolTitle={tool.title} />
                          <ToolCollectionMenu toolId={tool.id} toolTitle={tool.title} />
                        </>
                      }
                    />
                  )}
                </For>
              </ul>
            </section>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
      <Show when={chips().length > 0}>
        <ul class="search-quick-access__chips" aria-label="Избранные инструменты">
          <For each={chips()}>
            {(tool) => (
              <li class="search-quick-access__chip-item">
                <button
                  type="button"
                  class="search-quick-access__chip"
                  onClick={() => openQuickTool(tool)}
                >
                  <AppGlyph name={tool.icon} class="search-quick-access__chip-icon" />
                  <span class="search-quick-access__chip-label">{tool.title}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <ConfirmationDialog
        open={Boolean(pendingDelete())}
        title="Удалить коллекцию?"
        description={
          <>
            Коллекция «{pendingDelete()?.name}» будет удалена. Сами инструменты и избранное
            останутся.
          </>
        }
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          const target = pendingDelete();
          if (target) updateToolCollections((state) => deleteToolCollection(state, target.id));
          setPendingDelete(undefined);
        }}
        onOpenChange={(value) => {
          if (!value) setPendingDelete(undefined);
        }}
      />
    </div>
  );
}
