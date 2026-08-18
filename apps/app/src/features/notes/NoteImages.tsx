import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { deleteNoteImage, type NoteImage } from '@/state/note-images';

const LONG_PRESS_MS = 500;

type SelectionKey = `saved:${string}` | `pending:${number}`;

type ZoomedImage = {
  readonly src: string;
  readonly alt: string;
};

type DeleteConfirmState =
  | { readonly kind: 'single'; readonly name: string; readonly keys: readonly SelectionKey[] }
  | { readonly kind: 'multi'; readonly count: number; readonly keys: readonly SelectionKey[] };

function imageCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} изображение`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} изображения`;
  return `${count} изображений`;
}

function parseSelectionKey(key: SelectionKey): {
  readonly kind: 'saved' | 'pending';
  readonly id: string;
} {
  const separator = key.indexOf(':');
  return {
    kind: key.slice(0, separator) as 'saved' | 'pending',
    id: key.slice(separator + 1),
  };
}

function NoteImagePreviewCard(props: {
  readonly name: string;
  readonly src: string;
  readonly selectionKey: SelectionKey;
  readonly selectionMode: () => boolean;
  readonly selected: () => boolean;
  readonly disabled?: boolean;
  readonly onToggleSelect: () => void;
  readonly onEnterSelection: () => void;
  readonly onZoom: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  let longPressTimer: number | undefined;
  let suppressClick = false;

  const clearLongPressTimer = (): void => {
    if (longPressTimer !== undefined) {
      window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (props.disabled) return;
    if ((event.target as HTMLElement).closest('.note-image-preview__remove')) return;
    suppressClick = false;
    clearLongPressTimer();
    longPressTimer = window.setTimeout(() => {
      longPressTimer = undefined;
      suppressClick = true;
      props.onEnterSelection();
      if (!props.selected()) props.onToggleSelect();
    }, LONG_PRESS_MS);
  };

  const handlePreviewActivate = (): void => {
    if (props.disabled || suppressClick) {
      suppressClick = false;
      return;
    }
    if (props.selectionMode()) {
      props.onToggleSelect();
      return;
    }
    props.onZoom();
  };

  onCleanup(clearLongPressTimer);

  return (
    <figure
      class="note-image-preview"
      classList={{ 'note-image-preview--selected': props.selectionMode() && props.selected() }}
    >
      <button
        type="button"
        class="note-image-preview__open"
        aria-label={`Увеличить изображение «${props.name}»`}
        title={`Увеличить изображение «${props.name}»`}
        disabled={props.disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        onPointerLeave={clearLongPressTimer}
        onClick={handlePreviewActivate}
      >
        <img
          class="note-image-preview__image"
          src={props.src}
          alt={props.name}
          loading="lazy"
          decoding="async"
        />
      </button>
      <figcaption class="note-image-preview__caption">{props.name}</figcaption>
      <Show when={props.selectionMode()}>
        <button
          type="button"
          class="note-image-preview__check"
          classList={{ 'note-image-preview__check--selected': props.selected() }}
          aria-label={props.selected() ? `Снять выбор «${props.name}»` : `Выбрать «${props.name}»`}
          title={props.selected() ? 'Снять выбор' : 'Выбрать'}
          disabled={props.disabled}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleSelect();
          }}
        >
          <AppGlyph name="check" class="note-image-preview__icon" />
        </button>
      </Show>
      <Show when={!props.selectionMode()}>
        <button
          type="button"
          class="note-image-preview__remove"
          aria-label={`Удалить изображение «${props.name}»`}
          title="Удалить изображение"
          data-haptic="heavy"
          disabled={props.disabled}
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
        >
          <AppGlyph name="trash" class="note-image-preview__icon" />
        </button>
      </Show>
    </figure>
  );
}

export function NoteImagePicker(props: {
  readonly files: readonly File[];
  readonly images: readonly NoteImage[];
  readonly error: string;
  readonly onFilesChange: (files: readonly File[]) => void;
  readonly onError: (message: string) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [previews, setPreviews] = createSignal<
    readonly { readonly name: string; readonly url: string }[]
  >([]);
  const [zoomedImage, setZoomedImage] = createSignal<ZoomedImage | null>(null);
  const [selectionMode, setSelectionMode] = createSignal(false);
  const [selectedKeys, setSelectedKeys] = createSignal<ReadonlySet<SelectionKey>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = createSignal<DeleteConfirmState | null>(null);

  const appendFiles = (files: FileList | null): void => {
    if (props.disabled) return;
    if (files?.length) props.onFilesChange([...props.files, ...Array.from(files)]);
  };

  const exitSelectionMode = (): void => {
    setSelectionMode(false);
    setSelectedKeys(new Set<SelectionKey>());
  };

  const toggleSelection = (key: SelectionKey): void => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  };

  const applyDelete = async (keys: readonly SelectionKey[]): Promise<void> => {
    const savedIds: string[] = [];
    const pendingIndices: number[] = [];

    for (const key of keys) {
      const parsed = parseSelectionKey(key);
      if (parsed.kind === 'saved') {
        savedIds.push(parsed.id);
      } else {
        pendingIndices.push(Number(parsed.id));
      }
    }

    try {
      await Promise.all(savedIds.map((id) => deleteNoteImage(id)));
    } catch {
      props.onError('Не удалось удалить изображение.');
      return;
    }

    if (pendingIndices.length > 0) {
      const doomed = new Set(pendingIndices);
      props.onFilesChange(props.files.filter((_, index) => !doomed.has(index)));
    }

    exitSelectionMode();
    setDeleteConfirm(null);
  };

  const requestDelete = (
    keys: readonly SelectionKey[],
    options?: { readonly name?: string; readonly fromSelection?: boolean },
  ): void => {
    if (keys.length === 0) return;
    const firstKey = keys[0];
    if (!firstKey) return;

    if (keys.length === 1 && !options?.fromSelection) {
      const name =
        options?.name ??
        (parseSelectionKey(firstKey).kind === 'pending'
          ? (props.files[Number(parseSelectionKey(firstKey).id)]?.name ?? 'изображение')
          : 'изображение');
      setDeleteConfirm({ kind: 'single', name, keys });
      return;
    }

    setDeleteConfirm({ kind: 'multi', count: keys.length, keys });
  };

  const handleEditorPointerDown = (event: PointerEvent): void => {
    if (!selectionMode()) return;
    const target = event.target as HTMLElement;
    if (target.closest('.note-image-preview')) return;
    if (target.closest('.note-image-selection')) return;
    exitSelectionMode();
  };

  createEffect(() => {
    const next = props.files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    setPreviews(next);
    onCleanup(() => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    });
  });

  createEffect(() => {
    if (props.disabled) exitSelectionMode();
  });

  createEffect(() => {
    if (!zoomedImage()) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setZoomedImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && selectionMode()) exitSelectionMode();
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <div
      class="record-images-editor paper-card"
      classList={{
        'record-images-editor--disabled': props.disabled,
        'record-images-editor--selecting': selectionMode(),
      }}
      onPointerDown={handleEditorPointerDown}
    >
      <HorizontalScroller
        class="note-images-scroller"
        controls
        hideScrollbar
        controlLabel="изображения"
      >
        <div class="note-image-row">
          <label
            class="note-image-picker"
            classList={{ dragging: dragging(), 'note-image-picker--disabled': props.disabled }}
            onDragEnter={(event) => {
              if (props.disabled) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              if (!props.disabled) event.preventDefault();
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              if (props.disabled) return;
              event.preventDefault();
              setDragging(false);
              appendFiles(event.dataTransfer?.files ?? null);
            }}
          >
            <span class="visually-hidden">Добавить изображения</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={props.disabled}
              onChange={(event) => {
                appendFiles(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            <span class="note-image-picker-plus" aria-hidden="true">
              +
            </span>
          </label>
          <Show when={props.images.length > 0 || props.files.length > 0}>
            <div class="note-image-previews">
              <For each={props.images}>
                {(image) => {
                  const key = (): SelectionKey => `saved:${image.id}`;
                  return (
                    <NoteImagePreviewCard
                      name={image.name}
                      src={image.dataUrl}
                      selectionKey={key()}
                      selectionMode={selectionMode}
                      selected={() => selectedKeys().has(key())}
                      {...(props.disabled ? { disabled: true as const } : {})}
                      onToggleSelect={() => toggleSelection(key())}
                      onEnterSelection={() => setSelectionMode(true)}
                      onZoom={() => setZoomedImage({ src: image.dataUrl, alt: image.name })}
                      onDelete={() => requestDelete([key()], { name: image.name })}
                    />
                  );
                }}
              </For>
              <For each={previews()}>
                {(preview, index) => {
                  const key = (): SelectionKey => `pending:${index()}`;
                  return (
                    <NoteImagePreviewCard
                      name={preview.name}
                      src={preview.url}
                      selectionKey={key()}
                      selectionMode={selectionMode}
                      selected={() => selectedKeys().has(key())}
                      {...(props.disabled ? { disabled: true as const } : {})}
                      onToggleSelect={() => toggleSelection(key())}
                      onEnterSelection={() => setSelectionMode(true)}
                      onZoom={() => setZoomedImage({ src: preview.url, alt: preview.name })}
                      onDelete={() => requestDelete([key()], { name: preview.name })}
                    />
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </HorizontalScroller>
      <Show when={selectionMode()}>
        <div class="note-image-selection">
          <span class="note-image-selection__count">{imageCountLabel(selectedKeys().size)}</span>
          <button
            type="button"
            class="note-image-selection__delete"
            aria-label="Удалить выбранные изображения"
            title="Удалить выбранные изображения"
            disabled={props.disabled || selectedKeys().size === 0}
            onClick={() => requestDelete([...selectedKeys()], { fromSelection: true })}
          >
            <AppGlyph name="trash" class="note-image-preview__icon" />
          </button>
        </div>
      </Show>
      <Show when={props.error}>
        <p class="note-image-error" role="alert">
          {props.error}
        </p>
      </Show>
      <Show when={zoomedImage()}>
        {(image) => (
          <div
            class="note-image-preview__zoom"
            role="dialog"
            aria-modal="true"
            aria-label={image().alt}
          >
            <button
              type="button"
              class="note-image-preview__zoom-backdrop"
              aria-label="Закрыть увеличенное изображение"
              onClick={() => setZoomedImage(null)}
            />
            <img class="note-image-preview__zoom-image" src={image().src} alt={image().alt} />
          </div>
        )}
      </Show>
      <Show when={deleteConfirm()}>
        {(confirmAccessor) => {
          const confirm = confirmAccessor();
          const title =
            confirm.kind === 'single'
              ? 'Удалить изображение?'
              : `Удалить ${confirm.count} изображений?`;
          const description =
            confirm.kind === 'single' ? (
              <>Изображение «{confirm.name}» будет удалено без возможности восстановления.</>
            ) : (
              <>
                Выбранные изображения ({confirm.count}) будут удалены без возможности
                восстановления.
              </>
            );
          return (
            <ConfirmationDialog
              open
              title={title}
              description={description}
              confirmLabel="Удалить"
              danger
              onConfirm={() => {
                void applyDelete(confirm.keys);
              }}
              onOpenChange={(open) => {
                if (!open) setDeleteConfirm(null);
              }}
            />
          );
        }}
      </Show>
    </div>
  );
}
