/**
 * Decides which PDF canvases render, and in what order. The page near the viewport centre goes
 * first, thumbnails only when no page waits, and at most `concurrency` renders run at once so a fast
 * scroll on a phone cannot start dozens of rasterisations. A job that leaves the screen is
 * cancelled before it starts, or aborted while it runs.
 */

export interface PdfRenderJob {
  /** Lower runs first. Evaluated at pick time, so it follows the scroll position. */
  readonly priority: () => number;
  readonly run: (signal: AbortSignal) => Promise<void>;
  readonly onError?: (cause: unknown) => void;
}

export interface PdfRenderTicket {
  cancel(): void;
}

interface QueuedJob {
  readonly job: PdfRenderJob;
  readonly abort: AbortController;
  state: 'queued' | 'running' | 'done';
}

export class PdfRenderQueue {
  private readonly concurrency: number;
  private readonly queued = new Set<QueuedJob>();
  private running = 0;
  private disposed = false;

  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, concurrency);
  }

  get pending(): number {
    return this.queued.size;
  }

  get active(): number {
    return this.running;
  }

  enqueue(job: PdfRenderJob): PdfRenderTicket {
    const entry: QueuedJob = { job, abort: new AbortController(), state: 'queued' };
    if (this.disposed) {
      entry.state = 'done';
      return { cancel: () => undefined };
    }
    this.queued.add(entry);
    queueMicrotask(() => this.pump());
    return {
      cancel: () => {
        if (entry.state === 'queued') {
          this.queued.delete(entry);
          entry.state = 'done';
        } else if (entry.state === 'running') {
          entry.abort.abort();
        }
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.queued) entry.state = 'done';
    this.queued.clear();
  }

  private pickNext(): QueuedJob | undefined {
    let best: QueuedJob | undefined;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const entry of this.queued) {
      const priority = entry.job.priority();
      if (best === undefined || priority < bestPriority) {
        best = entry;
        bestPriority = priority;
      }
    }
    return best;
  }

  private pump(): void {
    while (!this.disposed && this.running < this.concurrency) {
      const next = this.pickNext();
      if (!next) return;
      this.queued.delete(next);
      next.state = 'running';
      this.running += 1;
      next.job
        .run(next.abort.signal)
        .catch((cause: unknown) => {
          if (!next.abort.signal.aborted) next.job.onError?.(cause);
        })
        .finally(() => {
          next.state = 'done';
          this.running -= 1;
          this.pump();
        });
    }
  }
}
