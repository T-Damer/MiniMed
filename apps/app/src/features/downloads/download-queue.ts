/** One app-wide admission queue. Feature owners still validate and atomically install their data. */
export type DownloadKind =
  | 'core'
  | 'module'
  | 'images'
  | 'ecg'
  | 'speech'
  | 'model'
  | 'document'
  | 'app';
export type DownloadPhase =
  | 'queued'
  | 'downloading'
  | 'retrying'
  | 'verifying'
  | 'installing'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'interrupted';

export interface DownloadResume {
  readonly kind: 'reference-images' | 'ecg-package' | 'speech';
  readonly id: string;
  readonly version: string;
}

export interface DownloadDescriptor {
  /** Stable logical edition, not a URL, filename from a patient, or a native task id. */
  readonly id: string;
  readonly kind: DownloadKind;
  readonly title: string;
  readonly totalBytes?: number | null;
  readonly resume?: DownloadResume;
}

export interface DownloadTask extends DownloadDescriptor {
  readonly state: DownloadPhase;
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly completedFiles: number | null;
  readonly totalFiles: number | null;
  readonly attempt: number;
  readonly retryAt: number | null;
  readonly errorMessage: string | null;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  readonly updatedAt: number;
}

export interface DownloadContext {
  readonly id: string;
  readonly signal: AbortSignal;
  progress(
    downloadedBytes: number,
    totalBytes: number | null,
    completedFiles?: number,
    totalFiles?: number,
  ): void;
  phase(state: 'queued' | 'downloading' | 'verifying' | 'installing', cancellable?: boolean): void;
}

interface Controls {
  readonly cancel?: () => Promise<unknown> | void;
  readonly retry?: () => Promise<unknown> | void;
}
interface Entry {
  view: DownloadTask;
  controls: Controls;
  controller?: AbortController;
  promise?: Promise<unknown>;
  cancellation?: Promise<void>;
}
interface Transfer {
  readonly jobId: string;
  readonly key: string;
  readonly signal: AbortSignal;
  readonly start: () => void;
  readonly requiresNetwork: boolean;
  readonly abort: () => void;
}
interface Persistence {
  load(): string | null;
  save(value: string): void;
}

const TERMINAL = new Set<DownloadPhase>(['completed', 'failed', 'cancelled', 'interrupted']);
const KINDS = new Set<DownloadKind>([
  'core',
  'module',
  'images',
  'ecg',
  'speech',
  'model',
  'document',
  'app',
]);
const PHASES = new Set<DownloadPhase>([
  ...TERMINAL,
  'queued',
  'downloading',
  'retrying',
  'verifying',
  'installing',
  'cancelling',
]);
const MAX_HISTORY = 100;
const MAX_RESTORED_TASKS = 2_000;
const isAbort = (cause: unknown): boolean => cause instanceof Error && cause.name === 'AbortError';
const abortError = (): DOMException => new DOMException('Загрузка отменена.', 'AbortError');
const bytesOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 8e12
    ? value
    : null;
const safeText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/u.test(value);

export function isDownloadActive(task: Pick<DownloadTask, 'state'>): boolean {
  return !TERMINAL.has(task.state);
}
export function downloadTaskFraction(task: DownloadTask): number | null {
  if (task.state === 'completed') return 1;
  const fraction =
    task.totalBytes && task.totalBytes > 0
      ? task.downloadedBytes / task.totalBytes
      : task.totalFiles && task.totalFiles > 0 && task.completedFiles !== null
        ? task.completedFiles / task.totalFiles
        : null;
  // Bytes reaching 100% is NOT installation. Keep a real, named verification/commit phase.
  return fraction === null ? null : Math.max(0, Math.min(0.99, fraction));
}
export function aggregateDownloadFraction(tasks: readonly DownloadTask[]): number | null {
  const active = tasks.filter(isDownloadActive);
  if (active.length === 0 || active.some((task) => !task.totalBytes)) return null;
  const total = active.reduce((sum, task) => sum + (task.totalBytes ?? 0), 0);
  return total > 0
    ? active.reduce(
        (sum, task) => sum + (downloadTaskFraction(task) ?? 0) * (task.totalBytes ?? 0),
        0,
      ) / total
    : null;
}

/** No global storage, timers, UI, native SDK or automatic network activity in this class. */
export class DownloadQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly waiting: Transfer[] = [];
  private readonly active = new Set<Transfer>();
  private readonly activeKeys = new Set<string>();
  private online = true;
  private persistenceError: string | null = null;
  private lastSaved = 0;

  public constructor(
    private readonly limit = 3,
    private readonly persistence?: Persistence,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid download concurrency.');
    this.restore();
  }
  public list(): readonly DownloadTask[] {
    return [...this.entries.values()].map((entry) => entry.view);
  }
  public get(id: string): DownloadTask | undefined {
    return this.entries.get(id)?.view;
  }
  public getStorageError(): string | null {
    return this.persistenceError;
  }
  public get activeTransfers(): number {
    return this.active.size;
  }
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public setOnline(value: boolean): void {
    this.online = value;
    this.drain();
    this.emit(false);
  }
  public isOnline(): boolean {
    return this.online;
  }

  private create(descriptor: DownloadDescriptor, controls: Controls): Entry {
    if (
      !safeText(descriptor.id, 512) ||
      !safeText(descriptor.title, 180) ||
      !KINDS.has(descriptor.kind)
    ) {
      throw new Error('Invalid download descriptor.');
    }
    const entry: Entry = {
      view: {
        ...descriptor,
        state: 'queued',
        downloadedBytes: 0,
        totalBytes: descriptor.totalBytes ?? null,
        completedFiles: null,
        totalFiles: null,
        attempt: 0,
        retryAt: null,
        errorMessage: null,
        canCancel: true,
        canRetry: false,
        updatedAt: Date.now(),
      },
      controls,
    };
    this.entries.set(descriptor.id, entry);
    return entry;
  }
  private update(entry: Entry, patch: Partial<DownloadTask>, durable = true): void {
    entry.view = { ...entry.view, ...patch, updatedAt: Date.now() };
    this.emit(durable);
  }

  public run<T>(
    descriptor: DownloadDescriptor,
    operation: (context: DownloadContext) => Promise<T>,
    options: {
      readonly signal?: AbortSignal;
      /** Full feature operation, never a transport-only replay that could bypass validation. */
      readonly retry?: () => Promise<unknown> | void;
    } = {},
  ): Promise<T> {
    const previous = this.entries.get(descriptor.id);
    if (previous?.promise) return previous.promise as Promise<T>;
    if (previous?.cancellation)
      return previous.cancellation.then(() => this.run(descriptor, operation, options));
    const controller = new AbortController();
    const entry = this.create(descriptor, { ...(options.retry ? { retry: options.retry } : {}) });
    entry.controller = controller;
    const onAbort = (): void => {
      // An atomic commit cannot be interrupted safely. Its observed result wins a late cancel.
      if (entry.view.canCancel) controller.abort();
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const context: DownloadContext = {
      id: descriptor.id,
      signal: controller.signal,
      progress: (downloadedBytes, totalBytes, completedFiles, totalFiles) =>
        this.update(
          entry,
          {
            downloadedBytes: bytesOrNull(downloadedBytes) ?? 0,
            totalBytes: bytesOrNull(totalBytes),
            ...(completedFiles === undefined ? {} : { completedFiles }),
            ...(totalFiles === undefined ? {} : { totalFiles }),
          },
          false,
        ),
      phase: (state, cancellable = state !== 'installing') => {
        controller.signal.throwIfAborted();
        this.update(entry, { state, retryAt: null, canCancel: cancellable });
      },
    };
    const promise = Promise.resolve()
      .then(async () => {
        try {
          controller.signal.throwIfAborted();
          const result = await operation(context);
          if (entry.view.state !== 'installing') controller.signal.throwIfAborted();
          this.update(entry, {
            state: 'completed',
            canCancel: false,
            canRetry: false,
            retryAt: null,
          });
          return result;
        } catch (cause) {
          this.update(entry, {
            state: isAbort(cause) ? 'cancelled' : 'failed',
            canCancel: false,
            canRetry: Boolean(entry.controls.retry),
            retryAt: null,
            errorMessage: isAbort(cause) ? null : 'Не удалось завершить загрузку или проверку.',
          });
          throw cause;
        }
      })
      .finally(() => {
        options.signal?.removeEventListener('abort', onAbort);
        delete entry.promise;
        delete entry.controller;
        this.emit(true);
      });
    entry.promise = promise;
    this.emit(true);
    return promise;
  }

  /** Existing content installer remains the authoritative owner of validation and installation. */
  public observe(
    descriptor: DownloadDescriptor,
    patch: Partial<DownloadTask>,
    controls: Controls,
  ): void {
    const entry = this.entries.get(descriptor.id) ?? this.create(descriptor, controls);
    entry.controls = controls;
    const state = patch.state ?? entry.view.state;
    this.update(
      entry,
      {
        ...patch,
        title: descriptor.title,
        state: entry.cancellation ? 'cancelling' : state,
        canCancel:
          !entry.cancellation &&
          Boolean(controls.cancel) &&
          !TERMINAL.has(state) &&
          state !== 'installing',
        canRetry:
          Boolean(controls.retry) &&
          (state === 'failed' || state === 'cancelled' || state === 'interrupted'),
      },
      state !== entry.view.state,
    );
  }

  public progress(id: string, downloadedBytes: number, totalBytes: number | null): void {
    const entry = this.entries.get(id);
    if (entry && !TERMINAL.has(entry.view.state))
      this.update(
        entry,
        {
          downloadedBytes: bytesOrNull(downloadedBytes) ?? 0,
          totalBytes: bytesOrNull(totalBytes),
        },
        false,
      );
  }

  public retrying(id: string, attempt: number, delayMs: number): void {
    const entry = this.entries.get(id);
    if (entry && !entry.controller?.signal.aborted && !entry.cancellation) {
      this.update(entry, { state: 'retrying', attempt, retryAt: Date.now() + delayMs });
    }
  }

  /** Every transport attempt acquires here; retry backoff and parent jobs hold no transfer slot. */
  public transfer<T>(
    jobId: string,
    key: string,
    signal: AbortSignal,
    operation: () => Promise<T>,
    requiresNetwork = true,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const transfer: Transfer = {
        jobId,
        key,
        signal,
        requiresNetwork,
        abort: () => {
          const index = this.waiting.indexOf(transfer);
          if (index < 0) return; // An active transport must settle its own real cancellation first.
          this.waiting.splice(index, 1);
          signal.removeEventListener('abort', transfer.abort);
          reject(abortError());
          this.refreshTransferPhase(jobId);
          this.drain();
        },
        start: () => {
          this.active.add(transfer);
          this.activeKeys.add(key);
          this.refreshTransferPhase(jobId);
          void Promise.resolve()
            .then(() => {
              signal.throwIfAborted();
              return operation();
            })
            .then(resolve, reject)
            .finally(() => {
              this.active.delete(transfer);
              this.activeKeys.delete(key);
              signal.removeEventListener('abort', transfer.abort);
              this.refreshTransferPhase(jobId);
              this.drain();
            });
        },
      };
      signal.addEventListener('abort', transfer.abort, { once: true });
      this.waiting.push(transfer);
      this.refreshTransferPhase(jobId);
      this.drain();
    });
  }
  private drain(): void {
    while (this.active.size < this.limit) {
      const index = this.waiting.findIndex(
        (item) => (!item.requiresNetwork || this.online) && !this.activeKeys.has(item.key),
      );
      if (index < 0) return;
      const [next] = this.waiting.splice(index, 1);
      if (next) next.start();
    }
  }
  private refreshTransferPhase(id: string): void {
    const entry = this.entries.get(id);
    if (
      !entry ||
      TERMINAL.has(entry.view.state) ||
      entry.cancellation ||
      ['verifying', 'installing', 'cancelling'].includes(entry.view.state)
    )
      return;
    if ([...this.active].some((item) => item.jobId === id))
      this.update(entry, { state: 'downloading', retryAt: null });
    else if (this.waiting.some((item) => item.jobId === id))
      this.update(entry, { state: 'queued', retryAt: null });
  }

  public cancel(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve();
    if (entry.cancellation) return entry.cancellation;
    if (!entry.view.canCancel) return Promise.resolve();
    this.update(entry, { state: 'cancelling', canCancel: false });
    entry.controller?.abort();
    const cancellation = Promise.resolve()
      .then(async () => {
        await entry.controls.cancel?.();
        // Consuming a rejected owner here is intentional: the caller still receives its rejection.
        await entry.promise?.then(
          () => undefined,
          (cause: unknown) => {
            if (!isAbort(cause)) throw cause;
          },
        );
        this.update(entry, {
          state: 'cancelled',
          canRetry: Boolean(entry.controls.retry),
          errorMessage: null,
          retryAt: null,
        });
      })
      .catch((cause: unknown) => {
        this.update(entry, {
          state: 'failed',
          errorMessage: 'Не удалось подтвердить отмену загрузки.',
          canRetry: false,
        });
        throw cause;
      })
      .finally(() => {
        delete entry.cancellation;
      });
    entry.cancellation = cancellation;
    return cancellation;
  }
  public async cancelAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.list()
        .filter((task) => task.canCancel)
        .map((task) => this.cancel(task.id)),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Не все загрузки удалось отменить.',
      );
  }
  public async wait(id: string): Promise<DownloadTask | undefined> {
    const entry = this.entries.get(id);
    // The operation's caller owns its rejection. A lifecycle waiter reads the terminal snapshot.
    await entry?.promise?.then(
      () => undefined,
      () => undefined,
    );
    return entry?.view;
  }
  public async retry(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry?.view.canRetry || !entry.controls.retry)
      throw new Error('Откройте соответствующий раздел для повторной загрузки.');
    if (entry.cancellation) await entry.cancellation;
    await entry.promise?.then(
      () => undefined,
      () => undefined,
    );
    await entry.controls.retry();
  }
  public async retryFailed(): Promise<void> {
    const results = await Promise.allSettled(
      this.list()
        .filter((task) => task.canRetry && ['failed', 'interrupted'].includes(task.state))
        .map((task) => this.retry(task.id)),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Некоторые загрузки не завершены.',
      );
  }
  public clearFinished(): void {
    for (const [id, entry] of this.entries)
      if (
        ['completed', 'cancelled'].includes(entry.view.state) &&
        !entry.promise &&
        !entry.cancellation
      )
        this.entries.delete(id);
    this.emit(true);
  }
  public setRestorer(id: string, restore: () => Promise<unknown>): void {
    const entry = this.entries.get(id);
    if (!entry || !['interrupted', 'failed', 'cancelled'].includes(entry.view.state)) return;
    entry.controls = { retry: restore };
    this.update(entry, { canRetry: true });
  }
  public rejectRestoration(id: string): void {
    const entry = this.entries.get(id);
    if (entry)
      this.update(entry, {
        state: 'failed',
        canCancel: false,
        canRetry: false,
        errorMessage: 'Эта версия больше недоступна. Выберите загрузку в соответствующем разделе.',
      });
  }
  private emit(durable: boolean): void {
    const history = [...this.entries.entries()].filter(
      ([, entry]) =>
        TERMINAL.has(entry.view.state) &&
        entry.view.state !== 'interrupted' &&
        !entry.promise &&
        !entry.cancellation,
    );
    for (const [id] of history.slice(0, Math.max(0, history.length - MAX_HISTORY)))
      this.entries.delete(id);
    if (this.persistence && (durable || Date.now() - this.lastSaved >= 1_000)) {
      try {
        this.persistence.save(JSON.stringify({ version: 1, tasks: this.list() }));
        this.lastSaved = Date.now();
        this.persistenceError = null;
      } catch {
        this.persistenceError =
          'Очередь работает, но её состояние не удалось сохранить для следующего запуска.';
      }
    }
    for (const listener of this.listeners) listener();
  }
  private restore(): void {
    if (!this.persistence) return;
    try {
      const raw = this.persistence.load();
      if (!raw) return;
      const value: unknown = JSON.parse(raw);
      if (
        !value ||
        typeof value !== 'object' ||
        !('version' in value) ||
        value.version !== 1 ||
        !('tasks' in value) ||
        !Array.isArray(value.tasks)
      )
        throw new Error('Invalid journal.');
      for (const item of value.tasks.slice(0, MAX_RESTORED_TASKS)) {
        if (
          !item ||
          typeof item !== 'object' ||
          !safeText(item.id, 512) ||
          !safeText(item.title, 180) ||
          !KINDS.has(item.kind) ||
          !PHASES.has(item.state)
        )
          continue;
        const resume = item.resume;
        const safeResume: DownloadResume | undefined =
          resume &&
          typeof resume === 'object' &&
          ['reference-images', 'ecg-package', 'speech'].includes(resume.kind) &&
          safeText(resume.id, 256) &&
          safeText(resume.version, 200)
            ? { kind: resume.kind, id: resume.id, version: resume.version }
            : undefined;
        const state: DownloadPhase = TERMINAL.has(item.state) ? item.state : 'interrupted';
        const descriptor: DownloadDescriptor = {
          id: item.id,
          kind: item.kind,
          title: item.title,
          ...(safeResume ? { resume: safeResume } : {}),
        };
        const entry = this.create(descriptor, {});
        entry.view = {
          ...entry.view,
          state,
          downloadedBytes: bytesOrNull(item.downloadedBytes) ?? 0,
          totalBytes: bytesOrNull(item.totalBytes),
          completedFiles: bytesOrNull(item.completedFiles),
          totalFiles: bytesOrNull(item.totalFiles),
          canCancel: false,
          canRetry: false,
          updatedAt: bytesOrNull(item.updatedAt) ?? Date.now(),
          errorMessage:
            state === 'interrupted' ? 'Восстанавливаем состояние после перезапуска.' : null,
        };
      }
    } catch {
      this.persistenceError =
        'Сохранённая очередь повреждена или недоступна. Установленные данные не изменены.';
    }
  }
}
