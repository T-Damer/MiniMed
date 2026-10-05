import { describe, expect, it, vi } from 'vitest';

import {
  diagnoseMicrophoneFailure,
  type MicrophoneOsPermission,
  microphoneFailure,
  microphonePermissionFromNative,
} from './microphone-access';

const refusal = (): DOMException => new DOMException('Permission denied', 'NotAllowedError');

describe('microphonePermissionFromNative', () => {
  it('maps Capacitor states and treats the rationale state as a prompt', () => {
    expect(microphonePermissionFromNative('granted')).toBe('granted');
    expect(microphonePermissionFromNative('denied')).toBe('denied');
    expect(microphonePermissionFromNative('prompt')).toBe('prompt');
    expect(microphonePermissionFromNative('prompt-with-rationale')).toBe('prompt');
    expect(microphonePermissionFromNative(undefined)).toBe('unknown');
  });
});

describe('microphoneFailure', () => {
  it('offers app settings only when the OS itself denies the permission', () => {
    const states: readonly MicrophoneOsPermission[] = ['granted', 'denied', 'prompt', 'unknown'];
    expect(states.filter((state) => microphoneFailure(refusal(), state).openSettings)).toEqual([
      'denied',
    ]);
  });

  it('does not blame the settings when Android granted the microphone', () => {
    const failure = microphoneFailure(refusal(), 'granted');
    expect(failure.openSettings).toBe(false);
    expect(failure.message).toContain('Android разрешил микрофон');
  });

  it('keeps the generic wording when the OS state cannot be read', () => {
    expect(microphoneFailure(refusal(), 'unknown').message).toContain('Нет доступа к микрофону');
  });

  it('never offers settings for failures that are not a refusal', () => {
    for (const name of ['NotFoundError', 'NotReadableError', 'NotSupportedError', 'AbortError']) {
      expect(microphoneFailure(new DOMException('x', name), 'denied').openSettings).toBe(false);
    }
    expect(microphoneFailure(new Error('Запись недоступна.'), 'denied')).toEqual({
      message: 'Запись недоступна.',
      openSettings: false,
    });
  });
});

describe('diagnoseMicrophoneFailure', () => {
  it('reads the OS permission after a refusal and offers settings when denied', async () => {
    const read = vi.fn(async (): Promise<MicrophoneOsPermission> => 'denied');
    const failure = await diagnoseMicrophoneFailure(refusal(), read);
    expect(read).toHaveBeenCalledOnce();
    expect(failure.openSettings).toBe(true);
  });

  it('does not consult the OS for other failures', async () => {
    const read = vi.fn(async (): Promise<MicrophoneOsPermission> => 'denied');
    const failure = await diagnoseMicrophoneFailure(
      new DOMException('x', 'NotReadableError'),
      read,
    );
    expect(read).not.toHaveBeenCalled();
    expect(failure.openSettings).toBe(false);
    expect(failure.message).toContain('занят');
  });

  it('falls back to the generic refusal when the OS state read fails', async () => {
    const failure = await diagnoseMicrophoneFailure(refusal(), async () => {
      throw new Error('plugin missing');
    });
    expect(failure).toEqual({
      message: expect.stringContaining('Нет доступа к микрофону'),
      openSettings: false,
    });
  });
});
