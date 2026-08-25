/**
 * Single-lane scheduler for exclusive heavy background work (WASM OCR,
 * speech transcription, embeddings). Only one job runs at a time; a newly
 * submitted job with a higher priority preempts the running one at its next
 * cooperative checkpoint, pushing the interrupted job back into the queue.
 */
export type ParityPriority = number;

export interface ParityRunContext {
  /** Aborted when the job is preempted, elevated away, or cancelled. */
  readonly signal: AbortSignal;
  /** True while a more important job is waiting for the lane. */
  readonly shouldPause: () => boolean;
  /** Throw PreemptedError here when pausing is safe. */
  checkpoint: () => Promise<void>;
}

export class PreemptedError extends Error {
  constructor(message = 'Задача вытеснена более приоритетной.') {
    super(message);
    this.name = 'PreemptedError';
  }
}

interface QueueEntry {
  readonly id: string;
  readonly kind: string;
  priority: ParityPriority;
  readonly run: (ctx: ParityRunContext) => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: unknown) => void;
  readonly onCancel: () => void;
}

export interface ParityStatus {
  readonly active: { readonly id: string; readonly kind: string } | null;
  readonly paused: boolean;
  readonly pending: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly priority: ParityPriority;
  }>;
}

function abortError(): Error {
  const error = new Error('Операция отменена.');
  error.name = 'AbortError';
  return error;
}

function microtaskCheckpoint(signal: AbortSignal, shouldPause: () => boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      if (shouldPause()) {
        reject(new PreemptedError());
        return;
      }
      resolve();
    };
    const onAbort = (): void => finish();
    signal.addEventListener('abort', onAbort, { once: true });
    setTimeout(() => {
      if (!signal.aborted && !shouldPause()) {
        signal.removeEventListener('abort', onAbort);
        resolve();
        return;
      }
      finish();
    }, 0);
  });
}

export class ParityController {
  private readonly queue: QueueEntry[] = [];
  private active: { entry: QueueEntry; controller: AbortController } | null = null;
  private pauseActive = false;
  private readonly listeners = new Set<(status: ParityStatus) => void>();
  private nextId = 0;

  subscribe(listener: (status: ParityStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => {
      this.listeners.delete(listener);
    };
  }

  status(): ParityStatus {
    return {
      active: this.active ? { id: this.active.entry.id, kind: this.active.entry.kind } : null,
      paused: this.pauseActive,
      pending: this.queue.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        priority: entry.priority,
      })),
    };
  }

  submit<T>(job: {
    kind: string;
    priority: ParityPriority;
    label?: string;
    run: (ctx: ParityRunContext) => Promise<T>;
  }): {
    id: string;
    done: Promise<T>;
    cancel: () => void;
    elevate: (priority: ParityPriority) => void;
  } {
    let entryRef: QueueEntry | undefined;
    this.nextId += 1;
    const id = `parity-${this.nextId}-${job.kind}`;
    const done = new Promise<T>((resolve, reject) => {
      entryRef = {
        id,
        kind: job.kind,
        priority: job.priority,
        run: job.run as (ctx: ParityRunContext) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        onCancel: () => reject(abortError()),
      };
    });
    const entry = entryRef;
    if (!entry) throw new Error('Не удалось поставить задачу в очередь.');

    const cancel = (): void => {
      const index = this.queue.indexOf(entry);
      if (index >= 0) {
        this.queue.splice(index, 1);
        entry.onCancel();
        this.emit();
        return;
      }
      if (this.active?.entry === entry) {
        this.pauseActive = false;
        this.active.controller.abort();
      }
    };

    const elevate = (priority: ParityPriority): void => {
      const index = this.queue.indexOf(entry);
      if (index < 0) return;
      entry.priority = priority;
      this.sortQueue();
      this.emit();
      this.pump();
    };

    this.queue.push(entry);
    this.sortQueue();
    // A strictly more important job takes the lane from whatever runs now.
    if (this.active && job.priority > this.active.entry.priority && !this.pauseActive) {
      this.pauseActive = true;
    }
    this.emit();
    void Promise.resolve().then(() => this.pump());

    return { id, done, cancel, elevate };
  }

  /** Re-queue an interrupted entry keeping its place inside its priority band. */
  private requeue(entry: QueueEntry): void {
    let insertAt = this.queue.length;
    for (let index = 0; index < this.queue.length; index += 1) {
      const other = this.queue[index];
      if (!other) continue;
      if (other.priority < entry.priority) {
        insertAt = index;
        break;
      }
    }
    this.queue.splice(insertAt, 0, entry);
  }

  private sortQueue(): void {
    // Stable sort keeps FIFO order within equal priorities.
    this.queue.sort((left, right) => right.priority - left.priority);
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const entry = this.queue.shift();
    if (!entry) return;

    const controller = new AbortController();
    this.active = { entry, controller };
    this.pauseActive = false;
    this.emit();

    void (async () => {
      try {
        const value = await entry.run({
          signal: controller.signal,
          shouldPause: () =>
            this.pauseActive &&
            this.active?.entry === entry &&
            Boolean(this.hasHigherWaiting(entry)),
          checkpoint: () =>
            microtaskCheckpoint(controller.signal, () => this.shouldPauseEntry(entry)),
        });
        if (this.active?.entry !== entry) return;
        entry.resolve(value);
      } catch (cause) {
        if (this.active?.entry !== entry) return;
        if (cause instanceof PreemptedError) {
          this.requeue(entry);
        } else if ((cause as Error)?.name === 'AbortError') {
          if (!this.pauseActive) entry.onCancel();
          else this.requeue(entry);
        } else {
          entry.reject(cause);
        }
      } finally {
        const finished = this.active?.entry === entry;
        if (finished) this.active = null;
        this.pauseActive = false;
        this.emit();
        this.pump();
      }
    })();
  }

  private shouldPauseEntry(entry: QueueEntry): boolean {
    if (!this.pauseActive || this.active?.entry !== entry) return false;
    return this.hasHigherWaiting(entry);
  }

  private hasHigherWaiting(entry: QueueEntry): boolean {
    return this.queue.some((other) => other.priority > entry.priority);
  }

  private emit(): void {
    const snapshot = this.status();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Well-known background lanes: OCR outranks speech transcription. */
export const PARITY_PRIORITIES = {
  ocr: 100,
  transcription: 50,
} as const;

export const backgroundParity = new ParityController();
