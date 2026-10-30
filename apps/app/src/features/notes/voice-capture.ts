import { type Accessor, createSignal, onCleanup } from 'solid-js';

import { diagnoseMicrophoneFailure } from '@/features/conversations/microphone-access';

function recorderMimeType(): string {
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

const MAX_RECORDING_SECONDS = 10 * 60;
const RECORDING_BITRATE = 64_000;
const RECORDING_TIMESLICE_MS = 1_000;

export interface VoiceCaptureOptions {
  readonly onComplete: (file: File) => void;
  readonly onStart?: () => void;
  readonly onError?: (message: string, openSettings?: boolean) => void;
  /** Recording stops by itself after this many seconds (10 minutes by default). */
  readonly maxSeconds?: number;
  /** Encoder bitrate in bits per second (64 kbps by default). */
  readonly bitrate?: number;
}

export interface VoiceCapture {
  readonly recording: Accessor<boolean>;
  readonly seconds: Accessor<number>;
  /** Input level 0–1, for a halo that breathes with the voice. */
  readonly level: Accessor<number>;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
}

/**
 * Microphone capture through MediaRecorder: one file per recording, handed to `onComplete`.
 * Shared by the notes editor's voice button and the patient diary's voice note.
 */
export function createVoiceCapture(props: VoiceCaptureOptions): VoiceCapture {
  const [recording, setRecording] = createSignal(false);
  const [seconds, setSeconds] = createSignal(0);
  const [level, setLevel] = createSignal(0);
  let recorder: MediaRecorder | undefined;
  let chunks: Blob[] = [];
  let captureFailed = false;
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (cause) {
      const failure = await diagnoseMicrophoneFailure(cause);
      if (disposed) return;
      props.onError?.(failure.message, failure.openSettings);
      return;
    }
    if (disposed) {
      cleanupCapture();
      return;
    }
    const mimeType = recorderMimeType();
    chunks = [];
    captureFailed = false;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: props.bitrate ?? RECORDING_BITRATE,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        captureFailed = true;
        if (disposed) return;
        setRecording(false);
        setSeconds(0);
        cleanupCapture();
        props.onError?.('Запись с микрофона завершилась с ошибкой.');
      };
      recorder.onstop = () => {
        if (disposed || captureFailed) {
          chunks = [];
          setRecording(false);
          setSeconds(0);
          cleanupCapture();
          return;
        }
        const type = mimeType.split(';')[0] || 'audio/webm';
        const extension = type === 'audio/mp4' ? 'm4a' : 'webm';
        const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '-');
        const file = new File(chunks, `Голос ${stamp}.${extension}`, { type });
        setRecording(false);
        setSeconds(0);
        cleanupCapture();
        if (file.size === 0) {
          props.onError?.('Запись получилась пустой. Попробуйте ещё раз.');
          return;
        }
        props.onComplete(file);
      };
      recorder.start(RECORDING_TIMESLICE_MS);

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
        if (next >= (props.maxSeconds ?? MAX_RECORDING_SECONDS)) {
          stop();
          return;
        }
        setSeconds(next);
      }, 1000);
      setRecording(true);
    } catch {
      recorder = undefined;
      chunks = [];
      setRecording(false);
      setSeconds(0);
      cleanupCapture();
      props.onError?.('Не удалось начать запись в этом браузере.');
    }
  };

  const stop = (): void => {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  };

  return { recording, seconds, level, start, stop };
}
