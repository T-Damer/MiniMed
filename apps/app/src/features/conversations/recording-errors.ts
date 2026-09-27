export type CaptureDevice = 'microphone' | 'camera';

const DEVICE_WORDS: Readonly<
  Record<
    CaptureDevice,
    {
      readonly access: string;
      readonly missing: string;
      readonly busy: string;
      readonly unsupported: string;
      readonly failed: string;
    }
  >
> = {
  microphone: {
    access: 'Нет доступа к микрофону. Разрешите его в настройках браузера или приложения.',
    missing: 'Микрофон не найден. Подключите микрофон или откройте MiniMed на телефоне.',
    busy: 'Микрофон занят другой программой. Закройте её и попробуйте ещё раз.',
    unsupported:
      'Этот браузер не умеет записывать звук. Откройте MiniMed в Chrome, Safari или в приложении.',
    failed: 'Не удалось начать запись. Проверьте микрофон и попробуйте ещё раз.',
  },
  camera: {
    access: 'Нет доступа к камере. Разрешите её в настройках браузера или приложения.',
    missing: 'Камера не найдена.',
    busy: 'Камера занята другой программой.',
    unsupported: 'Этот браузер не даёт доступ к камере.',
    failed: 'Камера недоступна.',
  },
};

/**
 * Explains why a microphone or camera could not start, in the user's words. Browsers report these
 * failures as DOMException names with terse English messages ("Not supported"), which must not
 * reach the UI.
 */
export function captureStartErrorMessage(cause: unknown, device: CaptureDevice): string {
  const words = DEVICE_WORDS[device];
  if (!(cause instanceof DOMException)) {
    return cause instanceof Error && cause.message ? cause.message : words.failed;
  }
  switch (cause.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return words.access;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return words.missing;
    case 'NotReadableError':
    case 'AbortError':
      return words.busy;
    case 'NotSupportedError':
      return words.unsupported;
    default:
      return words.failed;
  }
}

export function recordingStartErrorMessage(cause: unknown): string {
  return captureStartErrorMessage(cause, 'microphone');
}
