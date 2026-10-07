import { createSerialQueue } from '@/state/serial-queue';
import {
  type InspectionProgress,
  inspectionStallMs,
  runWithProgressWatchdog,
  type WatchdogTimers,
} from '@/state/user-library-watchdog';

export interface InspectionDocument {
  readonly id: string;
  readonly status: string;
  readonly byteLength: number;
}

export interface InspectionRunnerDeps {
  readonly getDocument: (id: string) => Promise<InspectionDocument | null>;
  /** Reads the file; calls `progress.touch()` as it moves and `progress.assertActive()` before writes. */
  readonly inspect: (id: string, progress: InspectionProgress) => Promise<void>;
  /** Records the failure on the document so its card shows the reason and offers «Повторить». */
  readonly markFailed: (id: string, message: string) => Promise<void>;
  readonly stallMs?: (byteLength: number) => number;
  readonly timers?: WatchdogTimers;
}

export interface InspectionRunner {
  /**
   * Queues the reading of one document. Documents are read one after another (pdf.js and zip
   * parsing of two big files at once exhaust a phone's memory); asking again for a document that
   * is queued or running returns the same promise. Rejects with the failure after recording it.
   */
  readonly run: (id: string) => Promise<void>;
}

/** What the card shows: our own messages are Russian already; a library's (pdf.js) is explained. */
export function inspectionFailureMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : '';
  if (!message) return 'Не удалось обработать файл.';
  return /[а-яё]/iu.test(message) ? message : `Не удалось прочитать файл (${message})`;
}

export function createInspectionRunner(deps: InspectionRunnerDeps): InspectionRunner {
  const queue = createSerialQueue();
  const jobs = new Map<string, Promise<void>>();
  const stallMs = deps.stallMs ?? inspectionStallMs;

  const inspectOne = async (id: string): Promise<void> => {
    const document = await deps.getDocument(id);
    if (!document || document.status !== 'inspecting') return;
    try {
      await runWithProgressWatchdog(
        (progress) => deps.inspect(id, progress),
        stallMs(document.byteLength),
        deps.timers,
      );
    } catch (cause) {
      await deps.markFailed(id, inspectionFailureMessage(cause));
      throw cause;
    }
  };

  return {
    run: (id) => {
      const running = jobs.get(id);
      if (running) return running;
      const job = queue.run(() => inspectOne(id));
      jobs.set(id, job);
      const forget = (): void => {
        if (jobs.get(id) === job) jobs.delete(id);
      };
      // `job` itself goes to the caller; this only releases the dedupe entry once it settles.
      job.then(forget, forget);
      return job;
    },
  };
}
