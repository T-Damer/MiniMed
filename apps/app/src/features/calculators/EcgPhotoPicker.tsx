import { type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import {
  captureNativePhoto,
  NativeCameraError,
  nativeCameraMessage,
  usesNativeCamera,
} from '@/features/camera/native-camera';

export const ECG_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

/** Camera first on phones; the gallery stays one tap away. Desktop browsers ignore `capture`. */
export function EcgPhotoPicker(props: {
  readonly disabled?: boolean;
  readonly replacing?: boolean;
  readonly stretch?: boolean;
  /** One obvious action (the camera) on its own row, the other ways to get a photo under it. */
  readonly stack?: boolean;
  /** Another way in (typing measurements), shown beside the gallery as a secondary button. */
  readonly extra?: JSX.Element;
  readonly onFile: (file: File) => void;
}): JSX.Element {
  const pick = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) props.onFile(file);
  };
  /** Android: the system camera app, not the WebView's `<input capture>`. */
  const native = usesNativeCamera();
  const shoot = async (): Promise<void> => {
    try {
      const file = await captureNativePhoto('ecg');
      if (file) props.onFile(file);
    } catch (cause) {
      toast.error(
        nativeCameraMessage(cause instanceof NativeCameraError ? cause.failure : 'failed'),
      );
    }
  };
  const cameraLabel = (): string => (props.replacing ? 'Переснять' : 'Фото');
  const cameraClasses = (): Record<string, boolean> => ({
    'ecg-picker__option--primary': !props.replacing,
    'ecg-picker__option--stretch': props.stretch ?? false,
    'ecg-picker__option--wide': props.stack ?? false,
  });
  return (
    <div class="ecg-picker" classList={{ 'ecg-picker--stack': props.stack ?? false }}>
      <Show
        when={native}
        fallback={
          <label class="ecg-picker__option" classList={cameraClasses()}>
            <AppGlyph class="ecg-picker__icon" name="camera" />
            {cameraLabel()}
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
        }
      >
        <button
          class="ecg-picker__option"
          classList={cameraClasses()}
          type="button"
          aria-label="Сфотографировать ЭКГ"
          disabled={props.disabled}
          onClick={() => void shoot()}
        >
          <AppGlyph class="ecg-picker__icon" name="camera" />
          {cameraLabel()}
        </button>
      </Show>
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
      {props.extra}
    </div>
  );
}
