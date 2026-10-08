/**
 * Live text during a conversation recording. The recorder keeps writing audio as before; every few
 * seconds the newest stretch is recognised by the local speech model and appended to what the
 * doctor sees. The caller keeps the lines (encrypted, see `conversation-transcript.ts`); nothing
 * here stores or logs the text.
 */
export const LIVE_SAMPLE_RATE = 16_000;
/** A stretch shorter than this is left to grow: tiny clips recognise badly. */
export const LIVE_MIN_WINDOW_SECONDS = 6;
/** When the recording ends, even a short tail is worth recognising. */
export const LIVE_FINAL_MIN_WINDOW_SECONDS = 1.5;
/** Longer than a speech window the model reads in one go; the rest goes in the next step. */
export const LIVE_MAX_WINDOW_SECONDS = 28;
export const LIVE_INTERVAL_MS = 7_000;
/** Audio recorded before the model was ready is read back-to-back, not every 7 seconds. */
export const LIVE_BACKLOG_DELAY_MS = 300;
const LIVE_MAX_LINES = 2_000;
const LIVE_SILENCE_RMS = 0.006;
const LIVE_MAX_FAILURES = 3;

/** `unavailable`: no model yet. `failed`: the model is there but kept failing. */
export type LiveStatus = 'unavailable' | 'listening' | 'working' | 'failed';

/** The next stretch of samples to recognise, or null while too little new audio has arrived. */
export function planLiveWindow(
  totalSamples: number,
  committedSamples: number,
  minSeconds = LIVE_MIN_WINDOW_SECONDS,
): { readonly from: number; readonly to: number } | null {
  const fresh = totalSamples - committedSamples;
  if (fresh < minSeconds * LIVE_SAMPLE_RATE) return null;
  return {
    from: committedSamples,
    to: Math.min(totalSamples, committedSamples + LIVE_MAX_WINDOW_SECONDS * LIVE_SAMPLE_RATE),
  };
}

/** True for a stretch with no speech-level signal, which the model would hallucinate text for. */
export function isSilent(samples: Float32Array): boolean {
  if (samples.length === 0) return true;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length) < LIVE_SILENCE_RMS;
}

/** Adds recognised text as a new line; empty text and a repeat of the last line change nothing. */
export function appendLiveLine(lines: readonly string[], text: string): readonly string[] {
  const line = text.replace(/\s+/gu, ' ').trim();
  if (!line || lines[lines.length - 1] === line) return lines;
  return [...lines, line].slice(-LIVE_MAX_LINES);
}

export interface LiveTranscriberDeps {
  /** Whether the speech model can recognise right now (it may finish loading mid-recording). */
  readonly available: () => boolean;
  readonly snapshot: () => Blob;
  readonly decode: (audio: Blob) => Promise<Float32Array>;
  readonly recognise: (samples: Float32Array) => Promise<string>;
  readonly onLines: (lines: readonly string[]) => void;
  readonly onStatus: (status: LiveStatus) => void;
  readonly intervalMs?: number;
  readonly backlogDelayMs?: number;
}

export interface LiveTranscriber {
  /** Gives up at once; a recognition already running is discarded. */
  stop(): void;
  /**
   * Ends the recording's text: lets a running step finish, then reads whatever audio is left,
   * including a short tail, and resolves when nothing remains.
   */
  finish(): Promise<void>;
}

export function startLiveTranscriber(deps: LiveTranscriberDeps): LiveTranscriber {
  let lines: readonly string[] = [];
  let committed = 0;
  let failures = 0;
  let stopped = false;
  let finishing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let status: LiveStatus = 'unavailable';
  const setStatus = (next: LiveStatus): void => {
    if (next === status) return;
    status = next;
    deps.onStatus(next);
  };
  deps.onStatus(status);

  /** Recognises the next stretch; true when more audio is already waiting behind it. */
  const step = async (minSeconds: number): Promise<boolean> => {
    if (failures >= LIVE_MAX_FAILURES) {
      setStatus('failed');
      return false;
    }
    if (!deps.available()) {
      setStatus('unavailable');
      return false;
    }
    setStatus('listening');
    try {
      const pcm = await deps.decode(deps.snapshot());
      const plan = planLiveWindow(pcm.length, committed, minSeconds);
      if (!plan || stopped) return false;
      const window = pcm.slice(plan.from, plan.to);
      if (!isSilent(window)) {
        setStatus('working');
        const text = await deps.recognise(window);
        if (stopped) return false;
        lines = appendLiveLine(lines, text);
        deps.onLines(lines);
      }
      // The stretch is consumed only once it is read; a failed one is tried again next step.
      committed = plan.to;
      failures = 0;
      return pcm.length - committed >= minSeconds * LIVE_SAMPLE_RATE;
    } catch {
      // The cause may carry audio-derived detail; only the count is kept.
      failures += 1;
      if (failures >= LIVE_MAX_FAILURES) setStatus('failed');
      return false;
    } finally {
      if (!stopped && status === 'working') setStatus('listening');
    }
  };

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      running = loop();
    }, delayMs);
  };

  const loop = async (): Promise<void> => {
    const backlog = await step(LIVE_MIN_WINDOW_SECONDS);
    if (stopped || finishing) return;
    schedule(
      backlog
        ? (deps.backlogDelayMs ?? LIVE_BACKLOG_DELAY_MS)
        : (deps.intervalMs ?? LIVE_INTERVAL_MS),
    );
  };
  schedule(deps.intervalMs ?? LIVE_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    async finish() {
      finishing = true;
      clearTimeout(timer);
      await running;
      while (!stopped && (await step(LIVE_FINAL_MIN_WINDOW_SECONDS))) {
        // Every pass consumes one speech window until the recording's end is reached.
      }
      stopped = true;
    },
  };
}
