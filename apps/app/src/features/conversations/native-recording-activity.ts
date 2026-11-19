import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { createSignal } from 'solid-js';

type RecordingState = 'recording' | 'paused' | 'ended';
interface RecordingPresentation {
  readonly presented: boolean;
}

interface NativeRecordingActivity {
  update(options: { state: RecordingState; elapsedMs: number }): Promise<RecordingPresentation>;
  addListener(
    event: 'presentationChanged',
    listener: (state: RecordingPresentation) => void,
  ): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<NativeRecordingActivity>('LocalMedRecordingActivity');
const RECORDING_URL = 'minimed-recording://open';
const [nativeRecordingPresented, setPresented] = createSignal(false);

export { nativeRecordingPresented };

let openRecording: (() => void) | undefined;
let listeners: Promise<void> | undefined;
let generation = 0;
let active = false;
let pending = Promise.resolve();

function observePresentation(): Promise<void> {
  listeners ??= Promise.all([
    Native.addListener('presentationChanged', ({ presented }) => {
      if (!presented) setPresented(false);
    }),
    App.addListener('appUrlOpen', ({ url }) => {
      if (url === RECORDING_URL && active) openRecording?.();
    }),
  ]).then(() => undefined);
  return listeners;
}

/** The OS owns the clock. The bridge only runs when recording starts, pauses, resumes or ends. */
export function updateNativeRecordingActivity(
  state: RecordingState,
  elapsedMs: number,
  controls?: { readonly open: () => void; readonly onPresented: () => void },
): void {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('LocalMedRecordingActivity'))
    return;
  active = state !== 'ended';
  if (controls) openRecording = controls.open;
  if (!active) {
    openRecording = undefined;
    setPresented(false);
  }
  const request = ++generation;
  pending = pending
    .then(async () => {
      // A stop must clear the old activity before a new recording can publish its own.
      if (state !== 'ended') {
        if (request !== generation) return;
        await observePresentation();
        if (request !== generation) return;
      }
      const result = await Native.update({ state, elapsedMs: Math.floor(elapsedMs) });
      if (request !== generation) return;
      setPresented(active && result.presented);
      if (active && result.presented) controls?.onPresented();
    })
    .catch((cause: unknown) => {
      if (request === generation) setPresented(false);
      console.warn('The system recording indicator is unavailable.', cause);
    });
}
