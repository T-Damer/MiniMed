/**
 * Which recogniser turns a conversation recording into text (REC2). On Android the app carries
 * sherpa-onnx with GigaAM v3, a Russian model with punctuation that runs well under real time on a
 * phone; it is used whenever its models are installed. Elsewhere — and on Android until those models
 * are downloaded — the browser's Whisper reads the stretches, as in REC1.
 *
 * The choice is made per stretch, so a model that finishes downloading during a recording takes
 * over from the next stretch on. Nothing here logs audio or text.
 */

import { perfSpan } from '@/state/perf-log';

export type SpeechEngineKind = 'native' | 'whisper';

export interface SpeechEngineState {
  /** The Android app with the native recogniser (its models may still be missing). */
  readonly nativeSupported: boolean;
  /** The native models are installed and verified. */
  readonly nativeReady: boolean;
  /** A Whisper model is loaded in the speech worker. */
  readonly whisperReady: boolean;
}

/** The recogniser to use now, or null when none can run. */
export function chooseSpeechEngine(state: SpeechEngineState): SpeechEngineKind | null {
  if (state.nativeSupported && state.nativeReady) return 'native';
  if (state.whisperReady) return 'whisper';
  return null;
}

/** The model to offer for download when no recogniser can run: the native one where it exists. */
export function offeredSpeechModel(
  state: Pick<SpeechEngineState, 'nativeSupported'>,
): SpeechEngineKind {
  return state.nativeSupported ? 'native' : 'whisper';
}

export interface SpeechEngineDeps {
  readonly state: () => SpeechEngineState;
  readonly recogniseNative: (samples: Float32Array) => Promise<string>;
  readonly recogniseWhisper: (samples: Float32Array) => Promise<string>;
}

/** The `available` / `recognise` pair `startSpeechTranscriber` takes, chosen per stretch. */
export interface SpeechEngine {
  readonly available: () => boolean;
  readonly recognise: (samples: Float32Array) => Promise<string>;
  readonly kind: () => SpeechEngineKind | null;
}

export function createSpeechEngine(deps: SpeechEngineDeps): SpeechEngine {
  const kind = (): SpeechEngineKind | null => chooseSpeechEngine(deps.state());
  return {
    kind,
    available: () => kind() !== null,
    recognise: (samples) => {
      const engine = kind();
      if (engine === null) return Promise.reject(new Error('Речевая модель не загружена.'));
      // Performance log: engine, audio length and wall time of each stretch (no text).
      const end = perfSpan('asr.stretch', { engine, audioS: samples.length / 16_000 });
      const reading =
        engine === 'native' ? deps.recogniseNative(samples) : deps.recogniseWhisper(samples);
      return reading.then(
        (text) => {
          end({ ok: true });
          return text;
        },
        (cause: unknown) => {
          end({ ok: false });
          throw cause;
        },
      );
    },
  };
}
