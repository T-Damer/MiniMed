import { createSignal, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import '@/components/FileDropZone.css';

export interface FileDropZoneProps {
  readonly accept: string;
  readonly title: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onFile: (file: File) => void;
}

/** Drop a file here or tap to choose one; keyboard users reach the native file input. */
export function FileDropZone(props: FileDropZoneProps): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  let depth = 0;
  return (
    <label
      class="ui-file-drop-zone"
      classList={{
        'ui-file-drop-zone--dragging': dragging(),
        'ui-file-drop-zone--disabled': props.disabled ?? false,
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        depth += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth = 0;
        setDragging(false);
        const file = event.dataTransfer?.files.item(0);
        if (file && !props.disabled) props.onFile(file);
      }}
    >
      <input
        class="ui-file-drop-zone__input"
        type="file"
        accept={props.accept}
        disabled={props.disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0);
          event.currentTarget.value = '';
          if (file) props.onFile(file);
        }}
      />
      <span class="ui-file-drop-zone__icon">
        <AppGlyph name="file-arrow-down" class="ui-file-drop-zone__glyph" />
      </span>
      <span class="ui-file-drop-zone__title">{props.title}</span>
      <span class="ui-file-drop-zone__hint">
        {props.hint ?? 'Перетащите файл сюда или нажмите, чтобы выбрать'}
      </span>
    </label>
  );
}
