import { createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

function recorderMimeType(): string {
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Toolbar microphone button: captures a voice note through MediaRecorder and
 * hands the resulting file to the caller (stored as a note attachment).
 */
const MAX_RECORDING_SECONDS = 600;

export function VoiceRecordingButton(props: {
  readonly onComplete: (file: File) => void;
  readonly onStart?: () => void;
  readonly onError?: (message: string) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const [recording, setRecording] = createSignal(false);
  const [seconds, setSeconds] = createSignal(0);
  const [level, setLevel] = createSignal(0);
  let recorder: MediaRecorder | undefined;
  let chunks: Blob[] = [];
  let tickTimer: number | undefined;
  let analyserTimer: number | undefined;
  let analyserContext: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let disposed = false;

  const cleanupCapture = (): void => {
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    if (analyserTimer !== undefined) window.clearInterval(analyserTimer);
    tickTimer = undefined;
    analyserTimer = undefined;
    if (analyserContext) {
      void analyserContext.close();
      analyserContext = undefined;
    }
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    setLevel(0);
  };

  onCleanup(() => {
    disposed = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    cleanupCapture();
  });

  const start = async (): Promise<void> => {
    props.onStart?.();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (disposed) return;
      props.onError?.('Нет доступа к микрофону.');
      return;
    }
    if (disposed) {
      cleanupCapture();
      return;
    }
    const mimeType = recorderMimeType();
    chunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (disposed) {
        setRecording(false);
        cleanupCapture();
        return;
      }
      const type = mimeType.split(';')[0] || 'audio/webm';
      const extension = type === 'audio/mp4' ? 'm4a' : 'webm';
      const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '-');
      props.onComplete(new File(chunks, `Голос ${stamp}.${extension}`, { type }));
      setRecording(false);
      setSeconds(0);
      cleanupCapture();
    };
    recorder.start();

    const context = new AudioContext();
    analyserContext = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    analyserTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128) / 128);
      setLevel(Math.min(1, peak * 2.2));
    }, 120);

    setSeconds(0);
    tickTimer = window.setInterval(() => {
      const next = seconds() + 1;
      if (next >= MAX_RECORDING_SECONDS) {
        stop();
        return;
      }
      setSeconds(next);
    }, 1000);
    setRecording(true);
  };

  const stop = (): void => {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  };

  const durationLabel = (): string => {
    const minutes = Math.floor(seconds() / 60);
    const rest = seconds() % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  };

  return (
    <button
      type="button"
      class={`note-markdown-editor__tool note-voice-button${recording() ? ' note-voice-button--recording' : ''}`}
      data-note-voice-button="true"
      aria-label={recording() ? `Остановить запись (${durationLabel()})` : 'Записать голос'}
      title={recording() ? `Остановить запись · ${durationLabel()}` : 'Голосовая заметка'}
      disabled={props.disabled}
      onClick={() => void (recording() ? stop() : start())}
    >
      <Show
        when={recording()}
        fallback={<AppGlyph name="microphone" class="note-markdown-editor__tool-icon" />}
      >
        <span
          class="note-voice-button__halo"
          style={{ '--voice-level': `${Math.round(level() * 100)}%` }}
          aria-hidden="true"
        />
        <AppGlyph name="stop-circle" class="note-voice-button__stop-icon" />
        <span class="note-voice-button__time">{durationLabel()}</span>
      </Show>
    </button>
  );
}
