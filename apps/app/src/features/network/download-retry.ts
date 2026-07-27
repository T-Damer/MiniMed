import {
  downloadWithResume,
  type ResumableDownloadOptions,
} from '@/features/network/resumable-download';

export const DOWNLOAD_RETRY_DELAYS_MS = [1_000, 2_500, 5_000, 15_000, 30_000, 60_000] as const;

const TRANSIENT_MESSAGE_MARKERS = [
  // Browser fetch failures differ per engine: Chrome says "Failed to fetch", Firefox reports a
  // NetworkError, Safari says "Load failed". None of them are actionable for a doctor.
  'failed to fetch',
  'networkerror',
  'network error',
  'load failed',
  'network request failed',
  'connection',
  'timeout',
  'timed out',
  // Our own transport errors, raised in Russian with the status appended.
  // Published catalogs can briefly lead their release assets; keep polling until the file appears.
  'http 404',
  'http 408',
  'http 425',
  'http 429',
  'http 500',
  'http 502',
  'http 503',
  'http 504',
  // A truncated transfer keeps its partial bytes, so the next attempt resumes instead of restarting.
  'размер файла не совпал',
] as const;

/**
 * A download failure worth retrying without telling the doctor anything. Aborts are excluded: the
 * user asked for the download to stop, so resuming it would fight them.
 */
export function isTransientDownloadError(cause: unknown): boolean {
  if (cause instanceof DOMException && cause.name === 'AbortError') return false;
  if (cause instanceof Error && cause.name === 'AbortError') return false;
  if (!(cause instanceof Error)) return false;
  const normalized = cause.message.toLowerCase();
  return TRANSIENT_MESSAGE_MARKERS.some((marker) => normalized.includes(marker));
}

function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Download aborted.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Download aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryingDownloadOptions extends ResumableDownloadOptions {
  /** Overridable so tests do not have to wait out the real backoff. */
  readonly retryDelaysMs?: readonly number[];
  /** Keep retrying transient failures until the caller aborts. */
  readonly retryForever?: boolean;
}

/**
 * Downloads an artifact, recovering from transient network failures on its own. Partial bytes are
 * preserved between attempts by the resumable layer, so a retry continues instead of restarting.
 * Only an exhausted retry budget, an abort, or a non-transient cause reaches the caller.
 */
export async function downloadWithRetry(options: RetryingDownloadOptions): Promise<Uint8Array> {
  const {
    retryDelaysMs = DOWNLOAD_RETRY_DELAYS_MS,
    retryForever = false,
    ...downloadOptions
  } = options;
  let lastError: unknown;
  let attempt = 0;

  while (retryForever || attempt <= retryDelaysMs.length) {
    const delay =
      attempt === 0 ? 0 : (retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0);
    if (delay > 0) await waitForRetry(delay, downloadOptions.signal);
    try {
      return await downloadWithResume(downloadOptions);
    } catch (cause) {
      lastError = cause;
      if (!isTransientDownloadError(cause) || downloadOptions.signal?.aborted) throw cause;
    }
    attempt += 1;
  }

  throw new Error(
    'Не удалось завершить загрузку из-за нестабильной сети. Скачанная часть сохранена — попробуйте позже.',
    { cause: lastError },
  );
}
