import { onCleanup } from 'solid-js';

import {
  type AsrInstallPhase,
  asrInstall,
  watchAsrInstall,
} from '@/features/asr/asr-model-install';
import { nativeInstall, watchNativeInstall } from '@/features/asr/native-model-install';
import {
  chooseSpeechEngine,
  offeredSpeechModel,
  type SpeechEngineKind,
  type SpeechEngineState,
} from '@/features/conversations/speech-engine';
import { isNativeSpeechSupported } from '@/state/native-transcriber';

export interface SpeechOffer {
  /** A recogniser can read speech now (GigaAM or Whisper). */
  readonly ready: () => boolean;
  /** The model the install card offers when none is ready. */
  readonly offered: SpeechEngineKind;
  /** That model's install phase. */
  readonly phase: () => AsrInstallPhase;
  /**
   * The install card is worth showing: the offered model is known to be absent, downloading or
   * failed. In the Android app that holds even while Whisper reads meanwhile — GigaAM is the one
   * that hears Russian conversation well, so it is offered until installed.
   */
  readonly offerShown: () => boolean;
}

const OFFER_PHASES: ReadonlySet<AsrInstallPhase> = new Set([
  'missing',
  'cached',
  'loading',
  'failed',
]);

/**
 * For the recorder window and the recording sheet: whether speech can be read, and which model to
 * offer when it cannot — GigaAM in the Android app, Whisper elsewhere. Follows both while mounted.
 */
export function useSpeechOffer(): SpeechOffer {
  const nativeSupported = isNativeSpeechSupported();
  onCleanup(watchAsrInstall());
  if (nativeSupported) onCleanup(watchNativeInstall());
  const state = (): SpeechEngineState => ({
    nativeSupported,
    nativeReady: nativeInstall.phase() === 'ready',
    whisperReady: asrInstall.phase() === 'ready',
  });
  const offered = offeredSpeechModel({ nativeSupported });
  const phase = (): AsrInstallPhase =>
    offered === 'native' ? nativeInstall.phase() : asrInstall.phase();
  return {
    ready: () => chooseSpeechEngine(state()) !== null,
    offered,
    phase,
    offerShown: () => OFFER_PHASES.has(phase()),
  };
}
