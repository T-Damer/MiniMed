import type { JSX } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';

export const ECG_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

/** Camera first on phones; the gallery stays one tap away. Desktop browsers ignore `capture`. */
export function EcgPhotoPicker(props: {
  readonly disabled?: boolean;
  readonly replacing?: boolean;
  readonly stretch?: boolean;
  readonly onFile: (file: File) => void;
}): JSX.Element {
  const pick = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) props.onFile(file);
  };
  return (
    <div class="ecg-picker">
      <label
        class="ecg-picker__option ecg-picker__option--primary"
        classList={{ 'ecg-picker__option--stretch': props.stretch ?? false }}
      >
        <AppGlyph class="ecg-picker__icon" name="camera" />
        {props.replacing ? 'Переснять' : 'Сфотографировать'}
        <input
          class="ecg-picker__input"
          type="file"
          accept={ECG_PHOTO_ACCEPT}
          capture="environment"
          aria-label="Сфотографировать ЭКГ"
          disabled={props.disabled}
          onChange={pick}
        />
      </label>
      <label
        class="ecg-picker__option"
        classList={{ 'ecg-picker__option--stretch': props.stretch ?? false }}
      >
        <AppGlyph class="ecg-picker__icon" name="image" />
        Из галереи
        <input
          class="ecg-picker__input"
          type="file"
          accept={ECG_PHOTO_ACCEPT}
          aria-label="Загрузить ЭКГ"
          disabled={props.disabled}
          onChange={pick}
        />
      </label>
    </div>
  );
}
