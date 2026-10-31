import { App as NativeApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Taking a photo for the ECG and skin tools.
 *
 * On Android the WebView's getUserMedia / `<input capture>` proved unreliable (some phones refuse
 * the stream, and Android may kill the WebView process while a camera app is in front, so the
 * `change` event never arrives). There the system camera app is opened by the `LocalMedCamera`
 * plugin, which leaves the JPEG in the app cache until the page has read it. Everywhere else
 * (browsers, iOS) the existing web paths stay. The gallery picker is the same on every platform.
 */

export type CameraPurpose = 'ecg' | 'skin';

export type PhotoCapturePath = 'native' | 'web';

/** Android uses the native camera; the web and iOS keep getUserMedia / `<input capture>`. */
export function photoCapturePath(platform: string = Capacitor.getPlatform()): PhotoCapturePath {
  return platform === 'android' ? 'native' : 'web';
}

export function usesNativeCamera(): boolean {
  return photoCapturePath() === 'native';
}

export type NativeCameraFailure = 'denied' | 'unavailable' | 'failed';

export class NativeCameraError extends Error {
  public constructor(public readonly failure: NativeCameraFailure) {
    super(`Native camera: ${failure}`);
    this.name = 'NativeCameraError';
  }
}

/** The message a person sees for a failure; a cancelled shot is not a failure and has none. */
export function nativeCameraMessage(failure: NativeCameraFailure): string {
  switch (failure) {
    case 'denied':
      return 'Нет доступа к камере. Разрешите её в настройках телефона.';
    case 'unavailable':
      return 'Приложение камеры не найдено.';
    case 'failed':
      return 'Не удалось снять фото.';
  }
}

export interface CapturedPhotoInfo {
  readonly id: string;
  readonly path: string;
  readonly mimeType: string;
  readonly purpose?: CameraPurpose | null;
}

interface LocalMedCameraPlugin {
  capturePhoto(options: {
    readonly id: string;
    readonly purpose: CameraPurpose;
  }): Promise<CapturedPhotoInfo>;
  discardPhoto(options: { readonly id: string }): Promise<void>;
}

export interface NativeCameraDeps {
  readonly plugin: LocalMedCameraPlugin;
  readonly convertFileSrc: (path: string) => string;
  readonly fetchFile: (url: string) => Promise<Blob>;
  readonly newId: () => string;
}

const defaultDeps: NativeCameraDeps = {
  plugin: registerPlugin<LocalMedCameraPlugin>('LocalMedCamera'),
  convertFileSrc: (path) => Capacitor.convertFileSrc(`file://${path}`),
  fetchFile: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Снимок не прочитан.');
    return response.blob();
  },
  newId: () => crypto.randomUUID(),
};

function failureFor(error: unknown): NativeCameraFailure | 'cancelled' {
  switch ((error as { readonly code?: unknown } | null | undefined)?.code) {
    case 'CAMERA_CANCELLED':
      return 'cancelled';
    case 'CAMERA_DENIED':
      return 'denied';
    case 'CAMERA_UNAVAILABLE':
      return 'unavailable';
    default:
      return 'failed';
  }
}

/**
 * Reads a finished capture into memory and only then lets the plugin delete the file, so a read
 * that fails leaves the photo where the next start can still find it.
 */
export async function takeCapturedPhoto(
  info: CapturedPhotoInfo,
  deps: NativeCameraDeps = defaultDeps,
): Promise<File> {
  const blob = await deps.fetchFile(deps.convertFileSrc(info.path));
  const file = new File([blob], `camera-${info.id}.jpg`, {
    type: info.mimeType || 'image/jpeg',
  });
  try {
    await deps.plugin.discardPhoto({ id: info.id });
  } catch (cause) {
    // The photo is already read; a leftover file is removed by the plugin's age sweep.
    console.warn('Временный снимок не удалён.', cause);
  }
  return file;
}

/**
 * Opens the system camera. Resolves with the photo, or `undefined` when the person closed the
 * camera; a refusal or a phone without a camera app throws a `NativeCameraError`.
 */
export async function captureNativePhoto(
  purpose: CameraPurpose,
  deps: NativeCameraDeps = defaultDeps,
): Promise<File | undefined> {
  let info: CapturedPhotoInfo;
  try {
    info = await deps.plugin.capturePhoto({ id: deps.newId(), purpose });
  } catch (cause) {
    const failure = failureFor(cause);
    if (failure === 'cancelled') return undefined;
    throw new NativeCameraError(failure);
  }
  return takeCapturedPhoto(info, deps);
}

/** What Capacitor passes to `appRestoredResult` for a plugin call finished after a restart. */
export interface RestoredPluginResult {
  readonly pluginId: string;
  readonly methodName: string;
  readonly success: boolean;
  readonly data?: unknown;
}

function isCapturedPhotoInfo(value: unknown): value is CapturedPhotoInfo {
  const info = value as Partial<CapturedPhotoInfo> | null | undefined;
  return (
    typeof info?.id === 'string' &&
    typeof info.path === 'string' &&
    typeof info.mimeType === 'string'
  );
}

/**
 * A photo taken while the app was killed: the camera call finished after the restart, and
 * Capacitor delivers it as `appRestoredResult`. Hands the photo to the handler of the tool that
 * asked for it. Returns whether a photo was routed.
 */
export async function routeRestoredCameraPhoto(
  restored: RestoredPluginResult,
  handlers: Readonly<Record<CameraPurpose, (file: File) => void>>,
  deps: NativeCameraDeps = defaultDeps,
): Promise<boolean> {
  if (restored.pluginId !== 'LocalMedCamera' || restored.methodName !== 'capturePhoto') {
    return false;
  }
  if (!restored.success || !isCapturedPhotoInfo(restored.data)) return false;
  const purpose = restored.data.purpose;
  if (purpose !== 'ecg' && purpose !== 'skin') {
    // No tool to route to: the photo is not kept.
    await deps.plugin.discardPhoto({ id: restored.data.id });
    return false;
  }
  const file = await takeCapturedPhoto(restored.data, deps);
  handlers[purpose](file);
  return true;
}

/**
 * Listens for a camera result delivered after the app restarted. Capacitor keeps the result until a
 * listener exists, so this runs once at start-up. Returns the function that removes the listener.
 */
export async function listenForRestoredCameraPhoto(
  handlers: Readonly<Record<CameraPurpose, (file: File) => void>>,
  deps: NativeCameraDeps = defaultDeps,
): Promise<() => void> {
  if (!usesNativeCamera()) return () => undefined;
  const listener = await NativeApp.addListener('appRestoredResult', (restored) => {
    routeRestoredCameraPhoto(restored as RestoredPluginResult, handlers, deps).catch(
      (cause: unknown) => {
        console.warn('Снимок после перезапуска не открыт.', cause);
      },
    );
  });
  return () => {
    void listener.remove();
  };
}
