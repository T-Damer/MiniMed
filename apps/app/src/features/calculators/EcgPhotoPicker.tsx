import { type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { ListGroup, ListRow } from '@/components/ListRow';
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

/**
 * Where the ECG comes from, before there is a photo: the app's list (camera, gallery, typed
 * numbers) instead of a stack of big buttons, so the tool's first screen looks like the others
 * (PERF6, owner 2026-11-11). The file inputs keep their names for the system pickers and tests.
 */
export function EcgPhotoSourceList(props: {
  readonly disabled?: boolean;
  readonly onFile: (file: File) => void;
  /** «Ввести измерения»: typing ready measurements instead of a photo. */
  readonly onNumbers?: () => void;
}): JSX.Element {
  let camera: HTMLInputElement | undefined;
  let gallery: HTMLInputElement | undefined;
  const pick = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) props.onFile(file);
  };
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
  return (
    <>
      <Show when={!native}>
        <input
          ref={camera}
          class="ecg-sources__input"
          type="file"
          accept={ECG_PHOTO_ACCEPT}
          capture="environment"
          aria-label="Сфотографировать ЭКГ"
          disabled={props.disabled}
          onChange={pick}
        />
      </Show>
      <input
        ref={gallery}
        class="ecg-sources__input"
        type="file"
        accept={ECG_PHOTO_ACCEPT}
        aria-label="Загрузить ЭКГ"
        disabled={props.disabled}
        onChange={pick}
      />
      <ListGroup class="ecg-sources" label="Откуда взять ЭКГ">
        <ListRow
          icon="camera"
          tone="green"
          title="Сфотографировать"
          subtitle="Весь лист в кадре, сетка чёткая"
          disabled={props.disabled}
          onClick={() => (native ? void shoot() : camera?.click())}
        />
        <ListRow
          icon="image"
          tone="blue"
          title="Из галереи"
          subtitle="Фото или скан ленты"
          disabled={props.disabled}
          onClick={() => gallery?.click()}
        />
        <Show when={props.onNumbers}>
          {(onNumbers) => (
            <ListRow
              icon="list-checks"
              tone="gray"
              title="Ввести измерения"
              subtitle="Интервалы и оси, если они уже есть"
              onClick={() => onNumbers()()}
            />
          )}
        </Show>
      </ListGroup>
    </>
  );
}
