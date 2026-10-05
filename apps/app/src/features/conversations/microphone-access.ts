import { captureStartErrorMessage } from '@/features/conversations/recording-errors';

/**
 * What the operating system says about the app's microphone permission. `unknown` is every
 * environment where the app cannot ask the OS (a desktop or mobile browser, the dev server).
 */
export type MicrophoneOsPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Why a capture attempt failed, in words for the user, and whether Android settings can fix it. */
export interface MicrophoneFailure {
  readonly message: string;
  readonly openSettings: boolean;
}

export const OPEN_APP_SETTINGS_LABEL = 'Открыть настройки приложения';

const OS_DENIED_MESSAGE = 'Нет доступа к микрофону. Разрешите его в настройках приложения Android.';
const OS_PROMPT_MESSAGE =
  'Нужен доступ к микрофону. Разрешите его в окне запроса Android и повторите попытку.';
const OS_GRANTED_MESSAGE =
  'Android разрешил микрофон, но приложение не смогло его открыть. Закройте MiniMed полностью и откройте снова.';

/** Capacitor permission states → ours; the rationale state is a prompt that was declined once. */
export function microphonePermissionFromNative(value: unknown): MicrophoneOsPermission {
  switch (value) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
    case 'prompt-with-rationale':
      return 'prompt';
    default:
      return 'unknown';
  }
}

/** getUserMedia rejects with these when the page was refused the device, not when it is broken. */
function isPermissionRefusal(cause: unknown): boolean {
  return (
    cause instanceof DOMException &&
    (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
  );
}

/**
 * The verdict comes from the failed getUserMedia call, never from a cached or Permissions-API
 * answer (a WebView reports `denied` or `prompt` there regardless of the OS). Only a refusal is
 * then compared with the OS state: settings are offered when the OS itself denies the permission;
 * when the OS grants it, the refusal came from the WebView bridge and settings cannot help.
 */
export function microphoneFailure(
  cause: unknown,
  osPermission: MicrophoneOsPermission,
): MicrophoneFailure {
  if (!isPermissionRefusal(cause)) {
    return { message: captureStartErrorMessage(cause, 'microphone'), openSettings: false };
  }
  switch (osPermission) {
    case 'denied':
      return { message: OS_DENIED_MESSAGE, openSettings: true };
    case 'prompt':
      return { message: OS_PROMPT_MESSAGE, openSettings: false };
    case 'granted':
      return { message: OS_GRANTED_MESSAGE, openSettings: false };
    case 'unknown':
      return { message: captureStartErrorMessage(cause, 'microphone'), openSettings: false };
  }
}

async function readOsMicrophonePermission(): Promise<MicrophoneOsPermission> {
  const native = await import('@/state/native-transcriber');
  return native.readNativeMicrophonePermission();
}

/** Classifies a failed microphone start; reads the OS state only for permission refusals. */
export async function diagnoseMicrophoneFailure(
  cause: unknown,
  readPermission: () => Promise<MicrophoneOsPermission> = readOsMicrophonePermission,
): Promise<MicrophoneFailure> {
  if (!isPermissionRefusal(cause)) return microphoneFailure(cause, 'unknown');
  let osPermission: MicrophoneOsPermission;
  try {
    osPermission = await readPermission();
  } catch {
    // The OS state is only a refinement of the message; without it the generic wording applies.
    osPermission = 'unknown';
  }
  return microphoneFailure(cause, osPermission);
}

export async function openMicrophoneSettings(): Promise<void> {
  const native = await import('@/state/native-transcriber');
  await native.openNativeAppSettings();
}
