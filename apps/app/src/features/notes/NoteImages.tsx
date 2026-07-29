import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { deleteNoteImage, type NoteImage } from '@/state/note-images';

export function NoteImagePicker(props: {
  readonly files: readonly File[];
  readonly images: readonly NoteImage[];
  readonly error: string;
  readonly onFilesChange: (files: readonly File[]) => void;
  readonly onError: (message: string) => void;
}): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [previews, setPreviews] = createSignal<
    readonly { readonly name: string; readonly url: string }[]
  >([]);
  const appendFiles = (files: FileList | null): void => {
    if (files?.length) props.onFilesChange([...props.files, ...Array.from(files)]);
  };

  createEffect(() => {
    const next = props.files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    setPreviews(next);
    onCleanup(() => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    });
  });

  return (
    <div class="record-images-editor paper-card">
      <HorizontalScroller
        class="note-images-scroller"
        controls
        hideScrollbar
        controlLabel="изображения"
      >
        <div class="note-image-row">
          <label
            class="note-image-picker"
            classList={{ dragging: dragging() }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
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
                {(image) => (
                  <figure>
                    <a href={image.dataUrl} target="_blank" rel="noreferrer">
                      <img src={image.dataUrl} alt={image.name} loading="lazy" />
                    </a>
                    <figcaption>{image.name}</figcaption>
                    <button
                      type="button"
                      aria-label={`Удалить изображение «${image.name}»`}
                      title="Удалить изображение"
                      data-haptic="heavy"
                      onClick={() =>
                        void deleteNoteImage(image.id).catch(() =>
                          props.onError('Не удалось удалить изображение.'),
                        )
                      }
                    >
                      <AppGlyph name="trash" />
                    </button>
                  </figure>
                )}
              </For>
              <For each={previews()}>
                {(preview) => (
                  <figure>
                    <img src={preview.url} alt={preview.name} />
                    <figcaption>{preview.name}</figcaption>
                  </figure>
                )}
              </For>
            </div>
          </Show>
        </div>
      </HorizontalScroller>
      <Show when={props.error}>
        <p class="note-image-error" role="alert">
          {props.error}
        </p>
      </Show>
    </div>
  );
}
