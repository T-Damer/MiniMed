import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/state/patient-vault', () => ({
  addPatientBlob: vi.fn(),
  createPatientVault: vi.fn(),
  deletePatientBlob: vi.fn(),
  encryptPatientVault: vi.fn(),
  isEncryptedPatientVaultMode: (mode: string | undefined) =>
    mode === 'native-keychain' || mode === 'browser-device-key',
  isPatientVaultUnlocked: vi.fn(),
  PatientVaultLockedError: class PatientVaultLockedError extends Error {},
  patientVaultStorageMode: vi.fn(),
  readPatientBlob: vi.fn(),
  unlockPatientVault: vi.fn(),
}));
vi.mock('@/state/patient-vault-native', () => ({
  isNativePatientVaultKeychainAvailable: vi.fn(),
  isPatientVaultNativePlatform: vi.fn(),
}));

import {
  createTranscriptSaver,
  type DraftSaveResult,
  decodeTranscript,
  encodeTranscript,
  TRANSCRIPT_SAVE_DELAY_MS,
  type TranscriptSaveState,
  transcriptBlobId,
  transcriptEventText,
} from './conversation-transcript';

describe('transcript encoding', () => {
  it('round-trips lines and names the recording', () => {
    const bytes = encodeTranscript('conv-1', ['Добрый день', 'Что беспокоит?']);
    expect(decodeTranscript(bytes)).toEqual(['Добрый день', 'Что беспокоит?']);
    expect(transcriptBlobId('conv-1')).toBe('conversation-transcript-conv-1');
  });

  it('rejects anything but the stored shape', () => {
    const raw = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
    expect(() => decodeTranscript(new TextEncoder().encode('{'))).toThrow();
    expect(() => decodeTranscript(raw({ kind: 'other', version: 1, lines: [] }))).toThrow();
    expect(() =>
      decodeTranscript(raw({ kind: 'minimed-conversation-transcript', version: 2, lines: [] })),
    ).toThrow();
    expect(() =>
      decodeTranscript(raw({ kind: 'minimed-conversation-transcript', version: 1, lines: [1] })),
    ).toThrow();
  });

  it('puts the machine label before the text in a patient note', () => {
    const text = transcriptEventText(['раз', 'два']);
    expect(text.endsWith('\n\nраз\nдва')).toBe(true);
    expect(text.startsWith('Автоматическая расшифровка')).toBe(true);
  });
});

describe('createTranscriptSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Save = (lines: readonly string[]) => Promise<DraftSaveResult>;
  const setup = (save = vi.fn<Save>(async () => 'saved')) => {
    const states: TranscriptSaveState[] = [];
    const saver = createTranscriptSaver({ save, onState: (state) => states.push(state) });
    return { save, states, saver };
  };

  it('writes once after a quiet moment, whatever the number of updates', async () => {
    const { save, states, saver } = setup();
    saver.update(['a']);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SAVE_DELAY_MS - 100);
    saver.update(['a', 'b']);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SAVE_DELAY_MS - 100);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(['a', 'b']);
    expect(states).toEqual(['pending', 'pending', 'saved']);
  });

  it('still writes when text keeps arriving faster than the quiet moment', async () => {
    const { save, saver } = setup();
    for (let index = 0; index < 20; index += 1) {
      saver.update(Array.from({ length: index + 1 }, (_, line) => `line ${line}`));
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_SAVE_DELAY_MS - 100);
    }
    // 20 updates over ~28 s never reach a quiet moment, yet the wait cap forces writes.
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('flushes pending text at once and writes nothing twice', async () => {
    const { save, saver } = setup();
    saver.update(['a']);
    await saver.flush();
    await saver.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports an unavailable vault as unsaved and keeps trying on new text', async () => {
    const { save, states, saver } = setup(vi.fn<Save>(async () => 'unavailable'));
    saver.update(['a']);
    await saver.flush();
    expect(states.at(-1)).toBe('unsaved');
    saver.update(['a', 'b']);
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('retry() writes the text that was reported as not saved, once the vault exists', async () => {
    let available = false;
    const { save, states, saver } = setup(
      vi.fn<Save>(async () => (available ? 'saved' : 'unavailable')),
    );
    saver.update(['a']);
    await saver.flush();
    expect(states.at(-1)).toBe('unsaved');
    // flush() has nothing left to write: the text was handed over once.
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);

    available = true;
    await saver.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(['a']);
    expect(states.at(-1)).toBe('saved');
  });

  it('retry() with no text yet writes nothing', async () => {
    const { save, saver } = setup();
    await saver.retry();
    expect(save).not.toHaveBeenCalled();
  });

  it('shows a failed write and retries it later without losing the text', async () => {
    let attempts = 0;
    const { save, states, saver } = setup(
      vi.fn<Save>(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('storage');
        return 'saved';
      }),
    );
    saver.update(['a']);
    await saver.flush();
    expect(states.at(-1)).toBe('failed');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(['a']);
    expect(states.at(-1)).toBe('saved');
  });

  it('never runs two writes at once and ends on the newest text', async () => {
    let running = 0;
    let overlapped = false;
    const written: (readonly string[])[] = [];
    const { saver } = setup(
      vi.fn<Save>(async (lines) => {
        running += 1;
        overlapped ||= running > 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        written.push(lines);
        running -= 1;
        return 'saved';
      }),
    );
    saver.update(['a']);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SAVE_DELAY_MS);
    saver.update(['a', 'b']);
    const done = saver.flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(overlapped).toBe(false);
    expect(written.at(-1)).toEqual(['a', 'b']);
  });

  it('cancel() drops pending work', async () => {
    const { save, saver } = setup();
    saver.update(['a']);
    saver.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();
  });
});
