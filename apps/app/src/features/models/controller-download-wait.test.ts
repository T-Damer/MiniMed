import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalModelController } from '@/features/models/controller';

vi.mock('@/features/models/browser-runtime', () => ({
  BrowserWllamaRuntime: class {
    public readonly kind = 'wllama-web';
    public async isAvailable(): Promise<boolean> {
      return true;
    }
    public async load(
      model: { readonly id: string },
      artifact: { readonly id: string },
      _profile: unknown,
      callbacks: { readonly onProgress: (loaded: number, total: number) => void },
    ) {
      callbacks.onProgress(1, 2);
      callbacks.onProgress(2, 2);
      return {
        modelId: model.id,
        artifactId: artifact.id,
        async benchmark() {
          return {
            modelId: model.id,
            artifactId: artifact.id,
            runtime: 'wllama-web',
            generationMs: 1,
            outputCharacters: 20,
            validStructuredOutput: true,
          };
        },
        async completeStructured() {
          throw new Error('not used');
        },
        async unload() {},
      };
    }
  },
}));

vi.mock('@/features/models/llama-runtime', () => ({
  LlamaNativeRuntime: class {
    public readonly kind = 'llama-native';
    public async isAvailable(profile: {
      readonly platform: string;
      readonly nativeContainer: boolean;
    }): Promise<boolean> {
      return profile.platform === 'android' && profile.nativeContainer;
    }
    public async load(
      model: { readonly id: string },
      artifact: { readonly id: string },
      _profile: unknown,
      callbacks: { readonly onProgress: (loaded: number, total: number) => void },
    ) {
      callbacks.onProgress(1, 2);
      callbacks.onProgress(2, 2);
      return {
        modelId: model.id,
        artifactId: artifact.id,
        async benchmark() {
          return {
            modelId: model.id,
            artifactId: artifact.id,
            runtime: 'llama-native',
            generationMs: 1,
            outputCharacters: 20,
            validStructuredOutput: true,
          };
        },
        async completeStructured() {
          throw new Error('not used');
        },
        async unload() {},
      };
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

  it('starts loading without waiting for the document queue', async () => {
    const controller = new LocalModelController({
      remoteCatalogUrl: '',
      mirrorBaseUrl: '',
      allowUpstreamFallback: false,
      allowAutomationDownloads: true,
      defaultAutoLoad: true,
    });

    try {
      await controller.start();
      expect(controller.getState().phase).toBe('ready');
    } finally {
      await controller.dispose();
    }
  });

  it('prefers the native llama.cpp runtime over wllama on a native Android device', async () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    const controller = new LocalModelController({
      remoteCatalogUrl: '',
      mirrorBaseUrl: '',
      allowUpstreamFallback: false,
      allowAutomationDownloads: true,
      defaultAutoLoad: true,
    });

    try {
      await controller.start();
      const state = controller.getState();
      expect(state.phase).toBe('ready');
      expect(state.benchmark?.runtime).toBe('llama-native');
    } finally {
      await controller.dispose();
    }
  });
});
