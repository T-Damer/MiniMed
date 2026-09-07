import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadQueue } from './download-queue';
import { apkDownloadId, startQueuedAndroidApkDownload } from './native-apk-download';

const mocks = vi.hoisted(() => ({
  queue: undefined as DownloadQueue | undefined,
  start: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('./download-service', () => ({ getDownloadQueue: () => mocks.queue }));
vi.mock('@/state/native-update', () => ({
  startAndroidApkDownload: mocks.start,
  getAndroidApkTaskStatus: mocks.status,
  cancelAndroidApkDownload: mocks.cancel,
}));
const request = {
  url: 'https://example.com/app.apk',
  expectedSha256: 'a'.repeat(64),
  expectedBytes: 100,
  releaseVersion: '0.6.35',
};
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function flush(): Promise<void> {
  for (let index = 0; index < 24; index++) await Promise.resolve();
}

describe('APK common queue adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.queue = new DownloadQueue(3);
    mocks.start.mockReset().mockResolvedValue({ taskId: 'native-task' });
    mocks.cancel.mockReset().mockResolvedValue(undefined);
    mocks.status.mockReset().mockResolvedValue({
      taskId: 'native-task',
      state: 'ready',
      downloadedBytes: 100,
      totalBytes: 100,
      transportActive: false,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('does not start an APK while other types occupy all slots; queued cancellation reaches no native API', async () => {
    const queue = mocks.queue as DownloadQueue;
    const finish = gate();
    const otherJobs = ['core', 'module', 'ecg'].map((id) =>
      queue.run({ id, kind: 'module', title: id }, (ctx) =>
        queue.transfer(id, id, ctx.signal, () => finish.promise),
      ),
    );
    const started = startQueuedAndroidApkDownload(request);
    const rejected = expect(started).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(mocks.start).not.toHaveBeenCalled();
    await queue.cancel(apkDownloadId(request));
    await rejected;
    finish.resolve();
    await Promise.all(otherJobs);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('retains the slot until the final native stream cleanup even after ready status', async () => {
    const queue = mocks.queue as DownloadQueue;
    mocks.status.mockResolvedValueOnce({
      taskId: 'native-task',
      state: 'ready',
      downloadedBytes: 100,
      totalBytes: 100,
      transportActive: true,
    });
    await startQueuedAndroidApkDownload(request);
    await flush();
    expect(queue.activeTransfers).toBe(1);
    expect(queue.get(apkDownloadId(request))?.state).not.toBe('completed');
    await vi.advanceTimersByTimeAsync(400);
    await queue.wait(apkDownloadId(request));
    expect(queue.activeTransfers).toBe(0);
    expect(queue.get(apkDownloadId(request))?.state).toBe('completed');
  });

  it('deduplicates native starts and waits for acknowledged cancellation', async () => {
    const queue = mocks.queue as DownloadQueue;
    const cleanup = gate();
    mocks.status.mockResolvedValue({
      taskId: 'native-task',
      state: 'downloading',
      downloadedBytes: 1,
      totalBytes: 100,
      transportActive: true,
    });
    mocks.cancel.mockImplementation(async () => {
      await cleanup.promise;
      mocks.status.mockResolvedValue({
        taskId: 'native-task',
        state: 'cancelled',
        downloadedBytes: 1,
        totalBytes: 100,
        transportActive: false,
      });
    });
    const first = startQueuedAndroidApkDownload(request);
    expect(startQueuedAndroidApkDownload(request)).toBe(first);
    await first;
    await flush();
    const cancellation = queue.cancel(apkDownloadId(request));
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(queue.activeTransfers).toBe(1);
    expect(queue.get(apkDownloadId(request))?.state).toBe('cancelling');
    cleanup.resolve();
    await cancellation;
    expect(queue.activeTransfers).toBe(0);
  });

  it('stops and acknowledges the native task when a progress observer fails', async () => {
    const queue = mocks.queue as DownloadQueue;
    const cleanup = gate();
    mocks.cancel.mockImplementation(() => cleanup.promise);
    await startQueuedAndroidApkDownload(request, async () => {
      throw new Error('observer failed');
    });
    await flush();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(queue.activeTransfers).toBe(1);
    cleanup.resolve();
    await queue.wait(apkDownloadId(request));
    expect(queue.get(apkDownloadId(request))?.state).toBe('failed');
    expect(queue.activeTransfers).toBe(0);
  });
});
