import { describe, expect, it } from 'vitest';

import { downloadCoordinator } from '@/features/network/download-coordinator';

describe('downloadCoordinator', () => {
  it('releases the content lane after download completes', async () => {
    const release = downloadCoordinator.beginContentDownload();
    expect(downloadCoordinator.hasActiveContentDownloads()).toBe(true);
    release();
    expect(downloadCoordinator.hasActiveContentDownloads()).toBe(false);
  });

  it('waits until all content downloads finish', async () => {
    const first = downloadCoordinator.beginContentDownload();
    const second = downloadCoordinator.beginContentDownload();
    let settled = false;
    const waiting = downloadCoordinator.waitForContentIdle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    first();
    await Promise.resolve();
    expect(settled).toBe(false);
    second();
    await waiting;
    expect(settled).toBe(true);
  });

  it('notifies subscribers when content lane changes', () => {
    let notifications = 0;
    const unsubscribe = downloadCoordinator.subscribe(() => {
      notifications += 1;
    });
    const release = downloadCoordinator.beginContentDownload();
    expect(notifications).toBe(1);
    release();
    expect(notifications).toBe(2);
    unsubscribe();
  });
});
