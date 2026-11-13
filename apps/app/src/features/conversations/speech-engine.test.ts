import { describe, expect, it } from 'vitest';

import {
  chooseSpeechEngine,
  createSpeechEngine,
  offeredSpeechModel,
  type SpeechEngineState,
} from '@/features/conversations/speech-engine';

const state = (overrides: Partial<SpeechEngineState> = {}): SpeechEngineState => ({
  nativeSupported: false,
  nativeReady: false,
  whisperReady: false,
  ...overrides,
});

describe('chooseSpeechEngine', () => {
  it('uses GigaAM on Android once its models are installed, even with Whisper loaded', () => {
    expect(
      chooseSpeechEngine(state({ nativeSupported: true, nativeReady: true, whisperReady: true })),
    ).toBe('native');
    expect(chooseSpeechEngine(state({ nativeSupported: true, nativeReady: true }))).toBe('native');
  });

  it('falls back to Whisper on Android until the native models are downloaded', () => {
    expect(chooseSpeechEngine(state({ nativeSupported: true, whisperReady: true }))).toBe(
      'whisper',
    );
  });

  it('uses Whisper outside the Android app', () => {
    expect(chooseSpeechEngine(state({ whisperReady: true }))).toBe('whisper');
    // A stale «ready» without the plugin never routes to the bridge.
    expect(chooseSpeechEngine(state({ nativeReady: true, whisperReady: true }))).toBe('whisper');
  });

  it('has nothing to run without a model', () => {
    expect(chooseSpeechEngine(state())).toBeNull();
    expect(chooseSpeechEngine(state({ nativeSupported: true }))).toBeNull();
    expect(chooseSpeechEngine(state({ nativeReady: true }))).toBeNull();
  });
});

describe('offeredSpeechModel', () => {
  it('offers the native download in the Android app and Whisper elsewhere', () => {
    expect(offeredSpeechModel({ nativeSupported: true })).toBe('native');
    expect(offeredSpeechModel({ nativeSupported: false })).toBe('whisper');
  });
});

describe('createSpeechEngine', () => {
  const samples = new Float32Array(16_000);

  it('routes each stretch to the recogniser chosen at that moment', async () => {
    let current = state({ nativeSupported: true, whisperReady: true });
    const calls: string[] = [];
    const engine = createSpeechEngine({
      state: () => current,
      recogniseNative: async () => {
        calls.push('native');
        return 'Гигаам.';
      },
      recogniseWhisper: async () => {
        calls.push('whisper');
        return 'виспер';
      },
    });
    expect(engine.available()).toBe(true);
    expect(await engine.recognise(samples)).toBe('виспер');
    // The native models finish downloading mid-recording: the next stretch goes to GigaAM.
    current = { ...current, nativeReady: true };
    expect(engine.kind()).toBe('native');
    expect(await engine.recognise(samples)).toBe('Гигаам.');
    expect(calls).toEqual(['whisper', 'native']);
  });

  it('is unavailable and rejects without a model', async () => {
    const engine = createSpeechEngine({
      state: () => state({ nativeSupported: true }),
      recogniseNative: async () => 'x',
      recogniseWhisper: async () => 'y',
    });
    expect(engine.available()).toBe(false);
    await expect(engine.recognise(samples)).rejects.toThrow();
  });
});
