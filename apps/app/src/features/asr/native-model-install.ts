import { createSignal } from 'solid-js';

import type { AsrInstallPhase } from '@/features/asr/asr-model-install';
import { NATIVE_TRANSCRIPTION_MODEL_BYTES } from '@/features/asr/native-transcription-models';
import {
  ensureNativeTranscriptionModels,
  getNativeTranscriptionModelStatus,
  isNativeSpeechSupported,
} from '@/state/native-transcriber';

/**
 * Where the Android GigaAM models stand (REC2), for the conversation recorder: the same phases the
 * Whisper card shows, over `native-transcriber.ts`. The check verifies checksums natively (once per
 * process), so it runs when a screen asks, never at app start. Once ready, it stays ready.
 */
const [phase, setPhase] = createSignal<AsrInstallPhase>('checking');
const [progress, setProgress] = createSignal<number | null>(null);
const [error, setError] = createSignal('');
const [remainingBytes, setRemainingBytes] = createSignal(NATIVE_TRANSCRIPTION_MODEL_BYTES);

let installing = false;
let checking: Promise<boolean> | undefined;

/** Asks the plugin whether the models are installed; resolves true when recognition can run. */
export function checkNativeModels(): Promise<boolean> {
  if (!isNativeSpeechSupported()) return Promise.resolve(false);
  if (phase() === 'ready') return Promise.resolve(true);
  if (installing) return Promise.resolve(false);
  checking ??= getNativeTranscriptionModelStatus()
    .then((status) => {
      setRemainingBytes(Math.max(0, status.bytesTotal - status.bytesReady));
      if (!installing) setPhase(status.ready ? 'ready' : 'missing');
      return status.ready;
    })
    .catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Не удалось проверить модель.');
      if (!installing) setPhase('failed');
      return false;
    })
    .finally(() => {
      checking = undefined;
    });
  return checking;
}

/** True when the native recogniser can read speech right now. */
export function nativeSpeechReady(): boolean {
  return phase() === 'ready';
}

/** Follows the native models while a screen shows their card; nothing to undo. */
export function watchNativeInstall(): () => void {
  void checkNativeModels();
  return () => undefined;
}

/** Downloads, verifies and installs the native models; the screen keeps working meanwhile. */
export async function installNativeModel(): Promise<void> {
  if (installing) return;
  installing = true;
  setError('');
  setProgress(null);
  setPhase('loading');
  try {
    const status = await ensureNativeTranscriptionModels(({ bytesReady, bytesTotal }) =>
      setProgress(bytesTotal > 0 ? bytesReady / bytesTotal : null),
    );
    setRemainingBytes(Math.max(0, status.bytesTotal - status.bytesReady));
    setPhase(status.ready ? 'ready' : 'missing');
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'Не удалось загрузить модель.');
    setPhase('failed');
  } finally {
    installing = false;
    setProgress(null);
  }
}

export const nativeInstall = {
  phase,
  progress,
  error,
  /** Bytes still to download (the whole set when nothing is on the device). */
  remainingBytes,
};
