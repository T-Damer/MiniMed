import { describe, expect, it, vi } from 'vitest';

import {
  assertHttpsApkUrl,
  cancelAndroidApkDownload,
  getAndroidApkTaskStatus,
  getLatestAndroidApkTaskStatus,
  installAndroidApk,
  startAndroidApkDownload,
  watchAndroidApkTasks,
} from '@/state/native-update';

describe('Android APK updater bridge', () => {
  it('rejects non-HTTPS URLs', () => {
    for (const url of [
      'http://example.test/app.apk',
      'https://user@example.test/app.apk',
      'not a URL',
    ]) {
      expect(() => assertHttpsApkUrl(url)).toThrow('Only HTTPS APK URLs are allowed.');
    }
  });

  it('starts a native task without materializing APK bytes in JavaScript', async () => {
    const startApkDownload = vi.fn(async () => ({ taskId: 'task-1' }));

    await expect(
      startAndroidApkDownload(
        {
          url: 'https://example.test/app.apk',
          releaseVersion: '1.0.1',
          expectedSha256: `sha256:${'a'.repeat(64)}`,
          expectedBytes: 1024,
        },
        { startApkDownload },
      ),
    ).resolves.toEqual({ taskId: 'task-1' });

    expect(startApkDownload).toHaveBeenCalledWith({
      url: 'https://example.test/app.apk',
      releaseVersion: '1.0.1',
      expectedSha256: `sha256:${'a'.repeat(64)}`,
      expectedBytes: 1024,
    });
  });

  it('uses task IDs for status, cancellation, and installation', async () => {
    const getApkDownloadStatus = vi.fn(async () => ({
      taskId: 'task-1',
      state: 'ready' as const,
      downloadedBytes: 1024,
      totalBytes: 1024,
      errorCode: null,
      transportActive: false,
    }));
    const cancelApkDownload = vi.fn(async () => undefined);
    const installDownloadedApk = vi.fn(async () => undefined);

    await expect(
      getAndroidApkTaskStatus('task-1', { getApkDownloadStatus }),
    ).resolves.toMatchObject({ state: 'ready' });
    await cancelAndroidApkDownload('task-1', { cancelApkDownload });
    await installAndroidApk('task-1', { installDownloadedApk });

    expect(getApkDownloadStatus).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(cancelApkDownload).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(installDownloadedApk).toHaveBeenCalledWith({ taskId: 'task-1' });
  });

  it('restores only a task for the available release artifact', async () => {
    const getLatestApkDownloadStatus = vi.fn(async () => ({
      status: {
        taskId: 'task-1',
        state: 'failed' as const,
        downloadedBytes: 512,
        totalBytes: 1024,
        errorCode: 'interrupted',
        transportActive: false,
      },
    }));

    await expect(
      getLatestAndroidApkTaskStatus(
        {
          url: 'https://example.test/app.apk',
          releaseVersion: '1.0.1',
          expectedSha256: `sha256:${'a'.repeat(64)}`,
          expectedBytes: 1024,
        },
        { getLatestApkDownloadStatus },
      ),
    ).resolves.toMatchObject({ taskId: 'task-1', errorCode: 'interrupted' });

    expect(getLatestApkDownloadStatus).toHaveBeenCalledWith({
      url: 'https://example.test/app.apk',
      releaseVersion: '1.0.1',
      expectedSha256: `sha256:${'a'.repeat(64)}`,
      expectedBytes: 1024,
    });
  });

  it('subscribes to native task snapshots', async () => {
    const remove = vi.fn(async () => undefined);
    const addListener = vi.fn(async () => ({ remove }));
    const listener = vi.fn();

    const handle = await watchAndroidApkTasks(listener, { addListener });

    expect(addListener).toHaveBeenCalledWith('apkDownloadProgress', listener);
    await handle.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
