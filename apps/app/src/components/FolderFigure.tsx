import { type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';

/** The folder icon from “Мои файлы”, shared so tool collections look like the same folders. */
export function FolderFigure(props: {
  readonly variant: string;
  readonly hasDocument?: boolean;
  readonly glyph?: AppGlyphName | undefined;
}): JSX.Element {
  return (
    <span
      class={`user-library-folder-card__figure user-library-folder-card__figure--${props.variant}`}
      aria-hidden="true"
    >
      <span class="user-library-folder-card__back" />
      <Show when={props.hasDocument}>
        <span class="user-library-folder-card__document" />
      </Show>
      <span class="user-library-folder-card__front">
        <Show when={props.glyph}>
          {(glyph) => <AppGlyph name={glyph()} class="user-library-folder-card__system-icon" />}
        </Show>
      </span>
    </span>
  );
}
