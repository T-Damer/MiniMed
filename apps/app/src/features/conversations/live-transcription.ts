/**
 * Live text during a conversation recording. The recorder keeps writing audio as before; every few
 * seconds the newest stretch is recognised by the local speech model and appended to what the
 * doctor sees. Nothing here stores or logs the text: it lives in memory while the recording runs.
 */
export const LIVE_SAMPLE_RATE = 16_000;
/** A stretch shorter than this is left to grow: tiny clips recognise badly. */
export const LIVE_MIN_WINDOW_SECONDS = 6;
/** Longer than a speech window the model reads in one go; the rest goes in the next step. */
export const LIVE_MAX_WINDOW_SECONDS = 28;
export const LIVE_INTERVAL_MS = 7_000;
const LIVE_MAX_LINES = 400;
const LIVE_SILENCE_RMS = 0.006;
const LIVE_MAX_FAILURES = 3;

export type LiveStatus = 'unavailable' | 'listening' | 'working';

/** The next stretch of samples to recognise, or null while too little new audio has arrived. */
export function planLiveWindow(
  totalSamples: number,
  committedSamples: number,
): { readonly from: number; readonly to: number } | null {
  const fresh = totalSamples - committedSamples;
  if (fresh < LIVE_MIN_WINDOW_SECONDS * LIVE_SAMPLE_RATE) return null;
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
}

export interface LiveTranscriber {
  stop(): void;
}

export function startLiveTranscriber(deps: LiveTranscriberDeps): LiveTranscriber {
  let lines: readonly string[] = [];
  let committed = 0;
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: LiveStatus = 'unavailable';
  const setStatus = (next: LiveStatus): void => {
    if (next === status) return;
    status = next;
    deps.onStatus(next);
  };
  deps.onStatus(status);

  const step = async (): Promise<void> => {
    if (!deps.available() || failures >= LIVE_MAX_FAILURES) {
      setStatus('unavailable');
      return;
    }
    setStatus('listening');
    try {
      const pcm = await deps.decode(deps.snapshot());
      const plan = planLiveWindow(pcm.length, committed);
      if (!plan || stopped) return;
      const window = pcm.slice(plan.from, plan.to);
      committed = plan.to;
      if (isSilent(window)) return;
      setStatus('working');
      const text = await deps.recognise(window);
      if (stopped) return;
      failures = 0;
      lines = appendLiveLine(lines, text);
      deps.onLines(lines);
    } catch {
      // The cause may carry audio-derived detail; only the count is kept.
      failures += 1;
    } finally {
      if (!stopped && status === 'working') setStatus('listening');
    }
  };

  const loop = async (): Promise<void> => {
    await step();
    if (!stopped) timer = setTimeout(() => void loop(), deps.intervalMs ?? LIVE_INTERVAL_MS);
  };
  timer = setTimeout(() => void loop(), deps.intervalMs ?? LIVE_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
