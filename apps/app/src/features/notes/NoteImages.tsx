import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import {
  AttachmentViewerDialog,
  recordToViewerState,
  type ViewerState,
} from '@/features/notes/NoteAttachmentViewer';
import { deleteNoteFile, type NoteFile, noteFileSrc } from '@/state/note-files';
import { deleteNoteImage, type NoteImage } from '@/state/note-images';
import { attachmentViewerKind } from '@/state/thumbnails';

const LONG_PRESS_MS = 500;

type SelectionKey = `saved:${string}` | `file:${string}` | `pending:${number}`;

type DeleteConfirmState =
  | { readonly kind: 'single'; readonly name: string; readonly keys: readonly SelectionKey[] }
  | { readonly kind: 'multi'; readonly count: number; readonly keys: readonly SelectionKey[] };

function attachmentCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} вложение`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} вложения`;
  return `${count} вложений`;
}

function parseSelectionKey(key: SelectionKey): {
  readonly kind: 'saved' | 'file' | 'pending';
  readonly id: string;
} {
  const separator = key.indexOf(':');
  return {
    kind: key.slice(0, separator) as 'saved' | 'file' | 'pending',
    id: key.slice(separator + 1),
  };
}

const FILE_ICON_BY_KIND: Record<string, string> = {
  video: 'image',
  audio: 'list',
  pdf: 'file-text',
  text: 'file-text',
  download: 'file-plus',
};

function NoteImagePreviewCard(props: {
  readonly name: string;
  readonly src?: string;
  readonly kind?: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'download';
  readonly selectionKey: SelectionKey;
  readonly selectionMode: () => boolean;
  readonly selected: () => boolean;
  readonly disabled?: boolean;
  readonly onToggleSelect: () => void;
  readonly onEnterSelection: () => void;
  readonly onOpenViewer: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const kind = (): string => props.kind ?? 'image';
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
    props.onOpenViewer();
  };

  onCleanup(clearLongPressTimer);

  return (
    <figure
      class="note-image-preview"
      classList={{
        'note-image-preview--selected': props.selectionMode() && props.selected(),
        [`note-image-preview--${kind()}`]: kind() !== 'image',
      }}
    >
      <button
        type="button"
        class="note-image-preview__open"
        aria-label={`Открыть «${props.name}»`}
        title={props.name}
        disabled={props.disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        onPointerLeave={clearLongPressTimer}
        onClick={handlePreviewActivate}
      >
        <Show
          when={kind() === 'image' && props.src}
          fallback={
            <span class="note-image-preview__file-tile" aria-hidden="true">
              <AppGlyph
                name={(FILE_ICON_BY_KIND[kind()] ?? 'file-text') as AppGlyphName}
                class="note-image-preview__file-icon"
              />
            </span>
          }
        >
          <img
            class="note-image-preview__image"
            src={props.src}
            alt={props.name}
            loading="lazy"
            decoding="async"
          />
        </Show>
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
          aria-label={`Удалить вложение «${props.name}»`}
          title="Удалить вложение"
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
  readonly savedFiles?: readonly NoteFile[];
  readonly error: string;
  readonly onFilesChange: (files: readonly File[]) => void;
  readonly onError: (message: string) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const [previews, setPreviews] = createSignal<
    readonly { readonly name: string; readonly url: string; readonly kind: string }[]
  >([]);
  const [viewer, setViewer] = createSignal<ViewerState | null>(null);
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
    const fileRecordIds: string[] = [];
    const pendingIndices: number[] = [];

    for (const key of keys) {
      const parsed = parseSelectionKey(key);
      if (parsed.kind === 'saved') {
        savedIds.push(parsed.id);
      } else if (parsed.kind === 'file') {
        fileRecordIds.push(parsed.id);
      } else {
        pendingIndices.push(Number(parsed.id));
      }
    }

    try {
      await Promise.all(savedIds.map((id) => deleteNoteImage(id)));
      await Promise.all(fileRecordIds.map((id) => deleteNoteFile(id)));
    } catch {
      props.onError('Не удалось удалить вложение.');
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
      const parsed = parseSelectionKey(firstKey);
      const name =
        options?.name ??
        (parsed.kind === 'pending'
          ? (props.files[Number(parsed.id)]?.name ?? 'вложение')
          : 'вложение');
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
    const next = props.files.map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
      kind: attachmentViewerKind(file.type || ''),
    }));
    setPreviews(next);
    onCleanup(() => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    });
  });

  createEffect(() => {
    if (props.disabled) exitSelectionMode();
  });

  createEffect(() => {
    if (!viewer()) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setViewer(null);
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
    <>
      <label class="visually-hidden">
        <span>Добавить вложения</span>
        <input
          data-note-image-picker-input="true"
          type="file"
          multiple
          disabled={props.disabled}
          onChange={(event) => {
            appendFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <Show when={props.images.length > 0 || props.files.length > 0}>
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
            controlLabel="вложения"
          >
            <div class="note-image-row">
              <div class="note-image-previews">
                <For each={props.images}>
                  {(image) => {
                    const key = (): SelectionKey => `saved:${image.id}`;
                    return (
                      <NoteImagePreviewCard
                        name={image.name}
                        src={image.thumbnailDataUrl ?? image.dataUrl}
                        kind="image"
                        selectionKey={key()}
                        selectionMode={selectionMode}
                        selected={() => selectedKeys().has(key())}
                        {...(props.disabled ? { disabled: true as const } : {})}
                        onToggleSelect={() => toggleSelection(key())}
                        onEnterSelection={() => setSelectionMode(true)}
                        onOpenViewer={() =>
                          setViewer({ kind: 'image', name: image.name, src: image.dataUrl })
                        }
                        onDelete={() => requestDelete([key()], { name: image.name })}
                      />
                    );
                  }}
                </For>
                <For each={props.savedFiles ?? []}>
                  {(record) => {
                    const key = (): SelectionKey => `file:${record.id}`;
                    const viewerKind = attachmentViewerKind(record.mimeType);
                    return (
                      <NoteImagePreviewCard
                        name={record.name}
                        {...(record.thumbnailDataUrl ? { src: record.thumbnailDataUrl } : {})}
                        {...(viewerKind === 'image' && !record.thumbnailDataUrl
                          ? { src: noteFileSrc(record) }
                          : {})}
                        kind={
                          viewerKind === 'image'
                            ? 'image'
                            : viewerKind === 'download'
                              ? 'download'
                              : viewerKind
                        }
                        selectionKey={key()}
                        selectionMode={selectionMode}
                        selected={() => selectedKeys().has(key())}
                        {...(props.disabled ? { disabled: true as const } : {})}
                        onToggleSelect={() => toggleSelection(key())}
                        onEnterSelection={() => setSelectionMode(true)}
                        onOpenViewer={() => setViewer(recordToViewerState(record))}
                        onDelete={() => requestDelete([key()], { name: record.name })}
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
                        {...(preview.kind === 'image' ? { src: preview.url } : {})}
                        kind={
                          preview.kind === 'image'
                            ? 'image'
                            : (preview.kind as 'video' | 'audio' | 'pdf' | 'text' | 'download')
                        }
                        selectionKey={key()}
                        selectionMode={selectionMode}
                        selected={() => selectedKeys().has(key())}
                        {...(props.disabled ? { disabled: true as const } : {})}
                        onToggleSelect={() => toggleSelection(key())}
                        onEnterSelection={() => setSelectionMode(true)}
                        onOpenViewer={() =>
                          setViewer(
                            preview.kind === 'image'
                              ? { kind: 'image', name: preview.name, src: preview.url }
                              : preview.kind === 'video'
                                ? {
                                    kind: 'video',
                                    name: preview.name,
                                    src: preview.url,
                                  }
                                : preview.kind === 'audio'
                                  ? { kind: 'audio', name: preview.name, src: preview.url }
                                  : {
                                      kind: 'text',
                                      name: preview.name,
                                      blob: props.files[index()] ?? new Blob(),
                                    },
                          )
                        }
                        onDelete={() => requestDelete([key()], { name: preview.name })}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
          </HorizontalScroller>
          <Show when={selectionMode()}>
            <div class="note-image-selection">
              <span class="note-image-selection__count">
                {attachmentCountLabel(selectedKeys().size)}
              </span>
              <button
                type="button"
                class="note-image-selection__delete"
                aria-label="Удалить выбранные вложения"
                title="Удалить выбранные вложения"
                disabled={props.disabled || selectedKeys().size === 0}
                onClick={() => requestDelete([...selectedKeys()], { fromSelection: true })}
              >
                <AppGlyph name="trash" class="note-image-preview__icon" />
              </button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={props.error}>
        <p class="note-image-error" role="alert">
          {props.error}
        </p>
      </Show>
      <AttachmentViewerDialog state={viewer()} onClose={() => setViewer(null)} />
      <Show when={deleteConfirm()}>
        {(confirmAccessor) => {
          const confirm = confirmAccessor();
          const title =
            confirm.kind === 'single' ? 'Удалить вложение?' : `Удалить ${confirm.count} вложений?`;
          const description =
            confirm.kind === 'single' ? (
              <>Вложение «{confirm.name}» будет удалено без возможности восстановления.</>
            ) : (
              <>
                Выбранные вложения ({confirm.count}) будут удалены без возможности восстановления.
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
    </>
  );
}
