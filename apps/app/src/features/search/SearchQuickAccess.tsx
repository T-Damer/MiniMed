import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { FolderFigure } from '@/components/FolderFigure';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { OverlayDialog } from '@/components/OverlayDialog';
import { dragCarriesFiles } from '@/features/library/imaging-entry';
import {
  groupQuickTools,
  openQuickTool,
  type QuickTool,
  type ResolvedToolRef,
  resolveItemRefs,
  resolveToolRefs,
} from '@/features/search/quick-tools';
import {
  ItemCollectionCreateForm,
  ItemCollectionMenu,
  ItemFavoriteButton,
  toolItem,
} from '@/features/search/ToolPinControls';
import { ToolAgeBadge } from '@/features/tools/ToolAgeBadge';
import { ToolAgeFilterBar } from '@/features/tools/ToolAgeFilterBar';
import { filterByAge, toolMatchesAgeFilter } from '@/features/tools/tool-age-filter';
import { createToolAgeFilter } from '@/features/tools/tool-age-filter-state';
import { isAnyAge } from '@/features/tools/tool-age-scope';
import {
  collectionNameError,
  deleteCollection,
  type ItemCollection,
  itemCollections,
  renameCollection,
  setItemInCollection,
  updateItemCollections,
} from '@/state/item-collections';

import './search-quick-access.css';

/**
 * Drop handling for a tool that takes files (data on the tool, never a check of its id): the
 * element lights up while a file is over it and hands the dropped files to the tool.
 */
function createFileDrop(tool: () => QuickTool | undefined) {
  const [over, setOver] = createSignal(false);
  const accepts = (event: DragEvent): boolean =>
    Boolean(tool()?.dropFiles) && dragCarriesFiles(event.dataTransfer);
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if ((event.currentTarget as Node).contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(false);
        tool()?.dropFiles?.(Array.from(event.dataTransfer?.files ?? []));
      },
    },
  };
}

/** One pinned tool; a tool no longer in the catalog stays visible and marked unavailable. */
function QuickToolRow(props: {
  readonly entry: ResolvedToolRef;
  readonly onOpen: (tool: QuickTool) => void;
  readonly trailing: JSX.Element;
}): JSX.Element {
  const drop = createFileDrop(() => props.entry.tool);
  return (
    <li
      class="quick-tool-row"
      classList={{
        'quick-tool-row--unavailable': !props.entry.tool,
        'quick-tool-row--drop': drop.over(),
      }}
      {...drop.handlers}
    >
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
          <button
            type="button"
            class="quick-tool-row__open"
            disabled={Boolean(tool().unavailableReason)}
            onClick={() => props.onOpen(tool())}
          >
            <AppGlyph name={tool().icon} class="quick-tool-row__icon" />
            <span class="quick-tool-row__copy">
              <span class="quick-tool-row__title">{tool().title}</span>
              <span class="quick-tool-row__meta">
                {tool().unavailableReason ?? tool().kindLabel}
              </span>
              {/* «Любой возраст» says nothing on a row; only a real restriction is worth showing. */}
              <Show when={!isAnyAge(tool().ageScope)}>
                <ToolAgeBadge scope={tool().ageScope} />
              </Show>
            </span>
          </button>
        )}
      </Show>
      {props.trailing}
    </li>
  );
}

/** A starred tool in the row under the search field. */
function QuickToolChip(props: { readonly tool: QuickTool }): JSX.Element {
  const drop = createFileDrop(() => props.tool);
  return (
    <li class="search-quick-access__chip-item" {...drop.handlers}>
      <button
        type="button"
        class="search-quick-access__chip"
        classList={{ 'search-quick-access__chip--drop': drop.over() }}
        disabled={Boolean(props.tool.unavailableReason)}
        title={props.tool.unavailableReason}
        onClick={() => openQuickTool(props.tool)}
      >
        <AppGlyph name={props.tool.icon} class="search-quick-access__chip-icon" />
        <span class="search-quick-access__chip-label">{props.tool.title}</span>
      </button>
    </li>
  );
}

function CollectionRenameForm(props: {
  readonly collection: ItemCollection;
  readonly onDone: () => void;
}): JSX.Element {
  const [name, setName] = createSignal(props.collection.name);
  const [error, setError] = createSignal<string>();
  return (
    <form
      class="tool-collection-form"
      onSubmit={(event) => {
        event.preventDefault();
        const problem = collectionNameError(itemCollections(), name(), props.collection.id);
        if (problem) {
          setError(problem);
          return;
        }
        updateItemCollections((state) => renameCollection(state, props.collection.id, name()));
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
 * The tool row under the search field: «Все инструменты» and the tools the doctor starred, in a
 * horizontal scroll. Everything else lives in the «Все инструменты» sheet, grouped by task, where
 * a star adds a tool to the row and collections keep longer lists.
 */
export function SearchQuickAccess(props: {
  /** Every tool that can be starred: app tools with a group, then the catalog. */
  readonly tools: readonly QuickTool[];
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [expanded, setExpanded] = createSignal<string>();
  const [renaming, setRenaming] = createSignal<string>();
  const [pendingDelete, setPendingDelete] = createSignal<ItemCollection>();
  const toolsById = createMemo(() => new Map(props.tools.map((tool) => [tool.id, tool])));
  // The tool row and this sheet hold tools; favourite documents live in «Мои файлы».
  const [ageFilter, setAgeFilter] = createToolAgeFilter();
  const allFavorites = createMemo(() =>
    resolveToolRefs(
      itemCollections()
        .favorites.filter((item) => item.kind === 'tool')
        .map((item) => item.id),
      toolsById(),
    ),
  );
  // A starred tool the age choice hides stays starred; it only leaves this list and the row.
  const favorites = createMemo(() =>
    allFavorites().filter(
      (entry) => !entry.tool || toolMatchesAgeFilter(entry.tool.ageScope, ageFilter()),
    ),
  );
  const chips = createMemo(() => favorites().flatMap((entry) => (entry.tool ? [entry.tool] : [])));
  const visibleTools = createMemo(() => filterByAge(props.tools, ageFilter()));
  const hiddenByAge = createMemo(
    () => allFavorites().length - favorites().length + (props.tools.length - visibleTools().length),
  );
  const groups = createMemo(() => groupQuickTools(visibleTools()));
  const openFromSheet = (tool: QuickTool): void => {
    setOpen(false);
    openQuickTool(tool);
  };
  return (
    <div class="search-quick-access" data-tour="quick-tools">
      <HorizontalScroller class="search-quick-access__row" hideScrollbar>
        <ul class="search-quick-access__chips" aria-label="Инструменты">
          <li class="search-quick-access__chip-item">
            <button
              type="button"
              class="search-quick-access__all"
              data-tour="all-tools"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              <AppGlyph
                name="squares-four"
                class="search-quick-access__chip-icon search-quick-access__chip-icon--on-primary"
              />
              <span class="search-quick-access__chip-label">Все инструменты</span>
            </button>
          </li>
          <For each={chips()}>{(tool) => <QuickToolChip tool={tool} />}</For>
          <Show when={chips().length === 0}>
            <li class="search-quick-access__hint">★ — добавить сюда</li>
          </Show>
        </ul>
      </HorizontalScroller>
      <OverlayDialog
        open={open()}
        title="Все инструменты"
        class="search-quick-access__sheet"
        onClose={() => setOpen(false)}
      >
        <div class="search-quick-access__panel">
          <ToolAgeFilterBar
            class="search-quick-access__age-filter"
            value={ageFilter()}
            onChange={setAgeFilter}
            hidden={hiddenByAge()}
          />
          <section class="search-quick-access__section" aria-labelledby="quick-access-favorites">
            <h2 class="search-quick-access__heading" id="quick-access-favorites">
              Избранное
            </h2>
            <Show
              when={favorites().length > 0}
              fallback={
                <p class="search-quick-access__empty">
                  Отметьте инструмент звёздочкой — он появится здесь и в строке под поиском.
                </p>
              }
            >
              <ul class="search-quick-access__list">
                <For each={favorites()}>
                  {(entry) => (
                    <QuickToolRow
                      entry={entry}
                      onOpen={openFromSheet}
                      trailing={
                        <ItemFavoriteButton
                          item={toolItem(entry.id, entry.tool?.title ?? entry.id)}
                        />
                      }
                    />
                  )}
                </For>
              </ul>
            </Show>
          </section>
          <For each={groups()}>
            {(group) => (
              <section
                class="search-quick-access__section"
                aria-labelledby={`quick-access-group-${group.id}`}
              >
                <h2 class="search-quick-access__heading" id={`quick-access-group-${group.id}`}>
                  {group.title}
                </h2>
                <ul class="search-quick-access__list">
                  <For each={group.tools}>
                    {(tool) => (
                      <QuickToolRow
                        entry={{ id: tool.id, tool }}
                        onOpen={openFromSheet}
                        trailing={
                          <>
                            <ItemFavoriteButton item={toolItem(tool.id, tool.title)} />
                            <ItemCollectionMenu item={toolItem(tool.id, tool.title)} />
                          </>
                        }
                      />
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <section class="search-quick-access__section" aria-labelledby="quick-access-collections">
            <h2 class="search-quick-access__heading" id="quick-access-collections">
              Коллекции
            </h2>
            <ul class="search-quick-access__list">
              <For each={itemCollections().collections}>
                {(collection) => {
                  const isExpanded = () => expanded() === collection.id;
                  const entries = createMemo(() => resolveItemRefs(collection.items, toolsById()));
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
                              hasDocument={collection.items.length > 0}
                            />
                            <span class="tool-collection-row__name">{collection.name}</span>
                            <span class="tool-collection-row__count">
                              {collection.items.length}
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
                                  onOpen={openFromSheet}
                                  trailing={
                                    <button
                                      type="button"
                                      class="tool-collection-row__action"
                                      aria-label={`Убрать «${entry.tool?.title ?? entry.id}» из «${collection.name}»`}
                                      title="Убрать из коллекции"
                                      onClick={() =>
                                        updateItemCollections((state) =>
                                          setItemInCollection(
                                            state,
                                            collection.id,
                                            entry.ref,
                                            false,
                                            new Date().toISOString(),
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
            <ItemCollectionCreateForm onCreated={(id) => setExpanded(id)} />
          </section>
        </div>
      </OverlayDialog>
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
          if (target) updateItemCollections((state) => deleteCollection(state, target.id));
          setPendingDelete(undefined);
        }}
        onOpenChange={(value) => {
          if (!value) setPendingDelete(undefined);
        }}
      />
    </div>
  );
}
