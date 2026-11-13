/**
 * Speech to text for a conversation recording (REC1), during the recording («live») or afterwards on
 * the doctor's request. Samples arrive already at 16 kHz from the recorder's audio-thread tap (or
 * from the stored samples of a finished recording); `SpeechSegmenter` cuts them at pauses, and each
 * stretch goes to the speech worker one at a time. Nothing here decodes a file or touches the
 * recording itself, so recognition can never stall it.
 *
 * Live recognition runs only while the device keeps up. A **governor** watches how long a stretch
 * takes against how long it lasts (the real-time factor), how much audio waits in the queue and an
 * optional overload signal; when it falls behind it **defers**: the queue is dropped (the samples are
 * kept in storage by the recorder) and the rest is read when the doctor taps «Расшифровать». The
 * caller keeps the text (encrypted, `conversation-transcript.ts`); nothing here stores or logs it.
 */
import { cleanRecognisedText } from '@/features/conversations/recognised-text';
import {
  SPEECH_SAMPLE_RATE,
  SpeechSegmenter,
  type SpeechWindow,
  type SpeechWindowOptions,
} from '@/features/conversations/speech-windows';

/** One recognised stretch with its place in the recording (absent for text made before REC1). */
export interface TranscriptSegment {
  readonly startMs?: number;
  readonly endMs?: number;
  readonly text: string;
}

/**
 * `unavailable`: no model yet. `deferred`: the device did not keep up, the rest waits for
 * «Расшифровать». `failed`: the model kept failing.
 */
export type LiveStatus = 'unavailable' | 'listening' | 'working' | 'deferred' | 'failed';

/** A stretch the detector heard less speech in than this is silence or noise: not sent. */
export const MIN_SPEECH_SECONDS = 0.4;
/** Live: more audio than this waiting for the model means it is not keeping up. */
export const LIVE_MAX_BACKLOG_SECONDS = 45;
/** Live, before the model is ready: audio kept in memory to read once it arrives. */
export const LIVE_MAX_WAITING_SECONDS = 180;
/** Live: the smoothed real-time factor above which recognition is deferred. */
export const LIVE_MAX_REALTIME_FACTOR = 1.15;
const MAX_SEGMENTS = 4_000;
const MAX_FAILURES = 3;
const RETRY_MS = 2_000;
const POLL_MS = 1_000;

export interface SpeechTranscriberDeps {
  readonly mode: 'live' | 'request';
  /** Whether the speech model can recognise right now (it may finish loading mid-recording). */
  readonly available: () => boolean;
  readonly recognise: (samples: Float32Array) => Promise<string>;
  readonly onSegments: (segments: readonly TranscriptSegment[]) => void;
  readonly onStatus: (status: LiveStatus) => void;
  /** Everything before this absolute sample index has been read (or was silence). */
  readonly onProgress?: (transcribedUntil: number) => void;
  /** Live: true while the device is struggling (janky frames, low battery…): defers at once. */
  readonly overloaded?: () => boolean;
  readonly initialSegments?: readonly TranscriptSegment[];
  /** Absolute sample index of the first sample `push` will receive. */
  readonly startSample?: number;
  readonly windows?: Partial<SpeechWindowOptions>;
  readonly now?: () => number;
}

export interface SpeechTranscriber {
  push(samples: Float32Array): void;
  /**
   * No more samples: the held stretch goes out and the queue is read to its end (live: unless
   * deferred or the model is missing). Resolves when nothing remains to do.
   */
  finish(): Promise<void>;
  /** Gives up at once; a recognition already running is discarded. */
  stop(): void;
  /** Everything before this absolute sample index has been read or was silence. */
  transcribedUntil(): number;
  status(): LiveStatus;
}

function segmentText(window: SpeechWindow, text: string): TranscriptSegment {
  return {
    startMs: Math.round((window.startSample / SPEECH_SAMPLE_RATE) * 1000),
    endMs: Math.round(((window.startSample + window.samples.length) / SPEECH_SAMPLE_RATE) * 1000),
    text,
  };
}

export function startSpeechTranscriber(deps: SpeechTranscriberDeps): SpeechTranscriber {
  const segmenter = new SpeechSegmenter(deps.windows, deps.startSample ?? 0);
  const now = deps.now ?? (() => performance.now());
  const queue: SpeechWindow[] = [];
  let segments: readonly TranscriptSegment[] = deps.initialSegments ?? [];
  let status: LiveStatus = 'unavailable';
  let busy = false;
  let stopped = false;
  let finishing = false;
  let failures = 0;
  let realtime = 0;
  let measured = 0;
  /** Set when live recognition gives up: the place the rest starts from. */
  let frozenAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: (() => void) | undefined;

  const setStatus = (next: LiveStatus): void => {
    if (next === status) return;
    status = next;
    deps.onStatus(next);
  };
  deps.onStatus(status);

  const queuedSeconds = (): number =>
    queue.reduce((sum, window) => sum + window.samples.length, 0) / SPEECH_SAMPLE_RATE +
    segmenter.bufferedSeconds;

  const until = (): number => frozenAt ?? queue[0]?.startSample ?? segmenter.position;

  const report = (): void => deps.onProgress?.(until());

  const settle = (): void => {
    const done = idle;
    idle = undefined;
    done?.();
  };

  /** Live recognition stops here; the samples from this point wait in storage. */
  const defer = (next: 'deferred' | 'failed'): void => {
    frozenAt = until();
    queue.length = 0;
    clearTimeout(timer);
    setStatus(next);
    report();
    settle();
  };

  const later = (delayMs: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void pump(), delayMs);
  };

  const pump = async (): Promise<void> => {
    if (busy || stopped || frozenAt !== undefined) return;
    const window = queue[0];
    if (!window) {
      if (status !== 'unavailable') setStatus('listening');
      if (finishing) settle();
      return;
    }
    if (!deps.available()) {
      setStatus('unavailable');
      if (deps.mode === 'live' && (finishing || queuedSeconds() > LIVE_MAX_WAITING_SECONDS)) {
        defer('deferred');
        return;
      }
      if (deps.mode === 'request') {
        defer('failed');
        return;
      }
      later(POLL_MS);
      return;
    }
    if (deps.mode === 'live' && !finishing && deps.overloaded?.()) {
      defer('deferred');
      return;
    }
    if (window.speechSeconds < MIN_SPEECH_SECONDS) {
      queue.shift();
      report();
      void pump();
      return;
    }
    busy = true;
    setStatus('working');
    const started = now();
    const seconds = window.samples.length / SPEECH_SAMPLE_RATE;
    try {
      // The worker takes the buffer; the window is not read again.
      const text = cleanRecognisedText(await deps.recognise(window.samples));
      if (stopped) return;
      const factor = (now() - started) / 1000 / Math.max(0.5, seconds);
      realtime = measured === 0 ? factor : realtime * 0.6 + factor * 0.4;
      measured += 1;
      failures = 0;
      queue.shift();
      const last = segments[segments.length - 1];
      if (text && text !== last?.text) {
        segments = [...segments, segmentText(window, text)].slice(-MAX_SEGMENTS);
        deps.onSegments(segments);
      }
      report();
    } catch {
      // The cause may carry audio-derived detail; only the count is kept.
      failures += 1;
      busy = false;
      if (failures >= MAX_FAILURES) defer('failed');
      else later(RETRY_MS);
      return;
    } finally {
      busy = false;
    }
    if (
      deps.mode === 'live' &&
      !finishing &&
      (queuedSeconds() > LIVE_MAX_BACKLOG_SECONDS ||
        (measured >= 2 && realtime > LIVE_MAX_REALTIME_FACTOR))
    ) {
      defer('deferred');
      return;
    }
    void pump();
  };

  return {
    push(samples) {
      if (stopped || finishing || frozenAt !== undefined) return;
      if (status === 'unavailable' && queue.length === 0 && deps.available())
        setStatus('listening');
      const windows = segmenter.push(samples);
      if (windows.length === 0) {
        // Silence advances what is done even when nothing is sent.
        if (queue.length === 0 && !busy) report();
        return;
      }
      queue.push(...windows);
      void pump();
    },
    finish() {
      if (stopped || frozenAt !== undefined) return Promise.resolve();
      finishing = true;
      const last = segmenter.flush();
      if (last) queue.push(last);
      return new Promise<void>((resolve) => {
        idle = resolve;
        if (!busy) void pump();
      }).finally(() => {
        clearTimeout(timer);
        report();
      });
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      settle();
    },
    transcribedUntil: until,
    status: () => status,
  };
}
