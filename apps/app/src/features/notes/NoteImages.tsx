import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { deleteNoteImage, type NoteImage } from '@/state/note-images';

export function NoteImagePicker(props: {
  readonly files: readonly File[];
  readonly error: string;
  readonly onFilesChange: (files: readonly File[]) => void;
}): JSX.Element {
  const [previews, setPreviews] = createSignal<
    readonly { readonly name: string; readonly url: string }[]
  >([]);

  createEffect(() => {
    const next = props.files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    setPreviews(next);
    onCleanup(() => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    });
  });

  return (
    <>
      <label class="note-image-picker">
        <span class="note-image-picker-caption">Изображения</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(event) => props.onFilesChange(Array.from(event.currentTarget.files ?? []))}
        />
        <span class="note-image-picker-button">Выбрать изображения</span>
      </label>
      <Show when={props.files.length > 0}>
        <div class="note-image-previews">
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
      <Show when={props.error}>
        <p class="note-image-error" role="alert">
          {props.error}
        </p>
      </Show>
    </>
  );
}

export function NoteImageGallery(props: {
  readonly images: readonly NoteImage[];
  readonly onError: (message: string) => void;
}): JSX.Element {
  return (
    <Show when={props.images.length > 0}>
      <div class="patient-note-images paper-card">
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
      </div>
    </Show>
  );
}
