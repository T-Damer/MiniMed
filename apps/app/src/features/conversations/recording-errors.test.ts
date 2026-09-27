import { describe, expect, it } from 'vitest';

import { captureStartErrorMessage, recordingStartErrorMessage } from './recording-errors';

describe('recordingStartErrorMessage', () => {
  it('never shows the browser English message for microphone failures', () => {
    expect(recordingStartErrorMessage(new DOMException('Not supported', 'NotSupportedError'))).toBe(
      'Этот браузер не умеет записывать звук. Откройте MiniMed в Chrome, Safari или в приложении.',
    );
    expect(
      recordingStartErrorMessage(new DOMException('Requested device not found', 'NotFoundError')),
    ).toContain('Микрофон не найден');
    expect(
      recordingStartErrorMessage(new DOMException('Permission denied', 'NotAllowedError')),
    ).toContain('Нет доступа к микрофону');
    expect(recordingStartErrorMessage(new DOMException('Odd', 'UnknownError'))).toBe(
      'Не удалось начать запись. Проверьте микрофон и попробуйте ещё раз.',
    );
  });

  it('keeps messages the app already wrote in Russian', () => {
    expect(recordingStartErrorMessage(new Error('Запись звука в этом браузере недоступна.'))).toBe(
      'Запись звука в этом браузере недоступна.',
    );
  });

  it('words camera failures for the camera', () => {
    expect(
      captureStartErrorMessage(
        new DOMException('Requested device not found', 'NotFoundError'),
        'camera',
      ),
    ).toBe('Камера не найдена.');
  });
});
