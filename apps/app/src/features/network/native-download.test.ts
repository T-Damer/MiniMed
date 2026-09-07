import { describe, expect, it, vi } from 'vitest';

import {
  type AndroidDownloadPlugin,
  createNativeDownloadTransport,
} from '@/features/network/native-download';

const id = 'a'.repeat(64);
const request = { url: 'https://example.com/core.db', cacheKey: 'edition-1', expectedBytes: 3 };
function setup(pluginOverrides: Partial<AndroidDownloadPlugin> = {}) {
  const plugin: AndroidDownloadPlugin = {
    download: vi.fn(async () => ({ id })),
    checkStatus: vi.fn(async () => ({ status: 8, bytesDownloaded: 3, bytesTotal: 3 })),
    stop: vi.fn(async () => ({ removed: true })),
    ...pluginOverrides,
  };
  const files = {
    prepareNativeDownload: vi.fn(async () => ({
      destination: `minimed-downloads/${id}.part`,
      filePath: '/stage',
    })),
    inspectNativeDownload: vi.fn(async () => ({ filePath: '/stage', sizeBytes: 3 })),
  };
  return { plugin, files, run: createNativeDownloadTransport(plugin, files, async () => id, 0) };
}

describe('native download file ownership', () => {
  it('holds the completed file through validation/installation, then releases it', async () => {
    const { run, plugin } = setup();
    const result = await run(request, async (file) => {
      expect(plugin.stop).not.toHaveBeenCalled();
      expect(file).toEqual({ id, filePath: '/stage', sizeBytes: 3 });
      return 'installed';
    });
    expect(result).toBe('installed');
    expect(plugin.stop).toHaveBeenCalledWith({ id });
  });

  it('does not consume a completed response with a mismatched on-disk length', async () => {
    const { run, plugin } = setup();
    const consume = vi.fn();
    await expect(run({ ...request, expectedBytes: 4 }, consume)).rejects.toThrow('Размер файла');
    expect(consume).not.toHaveBeenCalled();
    expect(plugin.stop).toHaveBeenCalled();
  });

  it('does not convert transfer completion into a successful installation', async () => {
    const { run, plugin } = setup();
    await expect(
      run(request, async () => {
        throw new Error('checksum mismatch');
      }),
    ).rejects.toThrow('checksum mismatch');
    expect(plugin.stop).toHaveBeenCalled();
  });

  it('waits for actual native cancellation rather than detaching an operation', async () => {
    const abort = new AbortController();
    let finishStop = (): void => {};
    const stopped = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    const { run, plugin } = setup({
      checkStatus: vi.fn(async () => {
        abort.abort();
        return { status: 2, bytesDownloaded: 1, bytesTotal: 3 };
      }),
      stop: vi.fn(() => stopped),
    });
    const result = run({ ...request, signal: abort.signal }, vi.fn());
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalled());
    finishStop();
    await rejection;
  });

  it('yields native capacity errors to shared admission without starting browser fetch', async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce({ code: 'NATIVE_DOWNLOAD_BUSY' })
      .mockResolvedValue({ id });
    const { run } = setup({ download });
    await expect(run(request, async () => 'ok')).rejects.toMatchObject({
      code: 'NATIVE_DOWNLOAD_BUSY',
    });
    await expect(run(request, async () => 'ok')).resolves.toBe('ok');
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('serializes same-ID consumers until the previous native owner has been stopped', async () => {
    const { run, plugin } = setup();
    let finish = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = run(request, () => blocked);
    await vi.waitFor(() => expect(plugin.checkStatus).toHaveBeenCalledOnce());
    const second = run(request, async () => 'second');
    await Promise.resolve();
    expect(plugin.download).toHaveBeenCalledOnce();
    finish();
    await first;
    await expect(second).resolves.toBe('second');
    expect(plugin.stop).toHaveBeenCalledTimes(2);
  });

  it('does not relabel storage errors as a network retry', async () => {
    const { run, plugin } = setup({
      download: vi.fn(async () => {
        throw new Error('journal failed');
      }),
    });
    await expect(run(request, vi.fn())).rejects.toThrow('journal failed');
    expect(plugin.stop).not.toHaveBeenCalled();
  });

  it('preserves both validation and cleanup failures', async () => {
    const { run } = setup({
      stop: vi.fn(async () => {
        throw new Error('stop failed');
      }),
    });
    await expect(
      run(request, async () => {
        throw new Error('invalid pack');
      }),
    ).rejects.toBeInstanceOf(AggregateError);
  });
});
