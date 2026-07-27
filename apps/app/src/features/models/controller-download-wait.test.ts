import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalModelController } from '@/features/models/controller';
import { downloadCoordinator } from '@/features/network/download-coordinator';

vi.mock('@/features/models/browser-runtime', () => ({
  BrowserWllamaRuntime: class {
    public readonly kind = 'wllama-web';
    public async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

describe('local model download coordination', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      setTimeout,
    });
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      hardwareConcurrency: 4,
      webdriver: false,
      storage: { estimate: async () => ({ quota: 1_000_000_000, usage: 0 }) },
    });
    vi.stubGlobal('Worker', undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows a deferred state while document downloads own the network lane', async () => {
    const release = downloadCoordinator.beginContentDownload();
    const controller = new LocalModelController({
      remoteCatalogUrl: '',
      mirrorBaseUrl: '',
      allowUpstreamFallback: false,
      allowAutomationDownloads: true,
      defaultAutoLoad: true,
    });

    const start = controller.start();
    await vi.waitFor(() => {
      expect(controller.getState().phase).toBe('deferred');
      expect(controller.getState().message).toContain('после загрузки документов');
    });

    controller.cancelLoad();
    release();
    await start;
  });
});
