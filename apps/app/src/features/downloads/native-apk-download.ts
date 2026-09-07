import {
  type ApkDownloadRequest,
  type ApkTaskStatus,
  cancelAndroidApkDownload,
  getAndroidApkTaskStatus,
  startAndroidApkDownload,
} from '@/state/native-update';
import { getDownloadQueue } from './download-service';

export const apkDownloadId = (request: ApkDownloadRequest): string =>
  `app:${request.expectedSha256 ?? request.releaseVersion ?? 'android-update'}`;
const starts = new Map<string, Promise<{ readonly taskId: string }>>();
const wait = (): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, 400));

/** Keep the platform's APK validation and user-initiated job; share admission and UI with all files. */
export function startQueuedAndroidApkDownload(
  request: ApkDownloadRequest,
  onStarted?: (taskId: string) => Promise<void>,
  retained?: ApkTaskStatus,
): Promise<{ readonly taskId: string }> {
  const id = apkDownloadId(request);
  const existing = starts.get(id);
  if (existing) return existing;
  let resolveStarted!: (value: { readonly taskId: string }) => void;
  let rejectStarted!: (cause: unknown) => void;
  const started = new Promise<{ readonly taskId: string }>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  starts.set(id, started);
  const queue = getDownloadQueue();
  const completion = queue.run(
    {
      id,
      kind: 'app',
      title: `Обновление MiniMed${request.releaseVersion ? ` ${request.releaseVersion}` : ''}`,
      totalBytes: request.expectedBytes ?? null,
    },
    async (context) => {
      await queue.transfer(
        id,
        'native-apk-update',
        context.signal,
        async () => {
          const value = retained
            ? { taskId: retained.taskId }
            : await startAndroidApkDownload(request);
          resolveStarted(value);
          let cancellationSent = false;
          try {
            await onStarted?.(value.taskId);
            for (;;) {
              if (context.signal.aborted && !cancellationSent) {
                await cancelAndroidApkDownload(value.taskId);
                cancellationSent = true;
              }
              const status = await getAndroidApkTaskStatus(value.taskId);
              context.progress(status.downloadedBytes, status.totalBytes);
              if (status.state === 'ready' && !status.transportActive) return;
              // CANCELLED is published before the native stream unwinds. Do not give away its slot yet.
              if (
                (status.state === 'failed' || status.state === 'cancelled') &&
                !status.transportActive
              ) {
                if (status.state === 'cancelled')
                  throw new DOMException('APK download cancelled.', 'AbortError');
                throw new Error('Обновление не прошло загрузку или проверку.');
              }
              if (!context.signal.aborted)
                context.phase(status.state === 'verifying' ? 'verifying' : 'downloading');
              await wait();
            }
          } catch (cause) {
            // Polling/callback failure must not leave a real native transfer behind an available slot.
            if (!cancellationSent) {
              try {
                await cancelAndroidApkDownload(value.taskId);
              } catch (cleanupError) {
                throw new AggregateError(
                  [cause, cleanupError],
                  'Не удалось остановить загрузку обновления.',
                );
              }
            }
            throw cause;
          }
        },
        !retained,
      );
    },
    {
      retry: async () => {
        await startQueuedAndroidApkDownload(request, onStarted);
      },
    },
  );
  // The API returns on scheduling; the queue retains and reports the actual terminal result.
  void completion.then(
    () => starts.delete(id),
    (cause: unknown) => {
      starts.delete(id);
      rejectStarted(cause);
    },
  );
  return started;
}

export function cancelQueuedAndroidApkDownload(request: ApkDownloadRequest): Promise<void> {
  return getDownloadQueue().cancel(apkDownloadId(request));
}
