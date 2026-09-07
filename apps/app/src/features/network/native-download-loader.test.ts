import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  checkStatus: vi.fn(),
  unsupportedThen: vi.fn((_resolve: unknown, reject: (error: Error) => void) => {
    reject(new Error('CapacitorDownloader.then() is not implemented on android'));
  }),
}));
vi.mock('@capgo/capacitor-downloader', () => ({
  // Capacitor proxies expose a function even for nonexistent native methods such as `then`.
  CapacitorDownloader: new Proxy(
    {},
    {
      get: (_target, name) => (name === 'then' ? native.unsupportedThen : native.checkStatus),
    },
  ),
}));

import { hasRetainedNativeDownload } from './native-download';

it('inspects a native job without treating the Capacitor proxy as a Promise', async () => {
  native.checkStatus.mockRejectedValueOnce({ code: 'NATIVE_DOWNLOAD_NOT_FOUND' });
  const request = { url: 'https://example.com/core.db', cacheKey: 'edition' };
  await expect(hasRetainedNativeDownload(request)).resolves.toBe(false);
  native.checkStatus.mockResolvedValueOnce({ status: 2, bytesDownloaded: 1, bytesTotal: 3 });
  await expect(hasRetainedNativeDownload(request)).resolves.toBe(true);
  expect(native.unsupportedThen).not.toHaveBeenCalled();
});
