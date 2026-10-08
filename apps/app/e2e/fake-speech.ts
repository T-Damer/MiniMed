import type { Page } from '@playwright/test';

/**
 * An Android bridge whose Keystore wraps the vault key, and a stand-in for the speech worker that
 * «downloads» the model in a moment and answers every stretch of audio with a numbered phrase.
 * Everything else — recorder, live transcriber, autosave, vault encryption — is the built app.
 */
export async function installDeviceKeyAndSpeech(page: Page): Promise<void> {
  await installDeviceKey(page);
  await installFakeSpeech(page);
}

/** The Android bridge alone: a Keystore that wraps the vault key. */
export async function installDeviceKey(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.assign(window, {
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: [
          {
            name: 'LocalMedPatientVault',
            methods: ['isAvailable', 'wrapKey', 'unwrapKey', 'deleteKey'].map((name) => ({
              name,
              rtype: 'promise',
            })),
          },
        ],
        nativePromise: async (
          plugin: string,
          method: string,
          options: Record<string, string> = {},
        ) => {
          if (plugin !== 'LocalMedPatientVault') throw new Error(`Not mocked: ${plugin}`);
          if (method === 'isAvailable') return { available: true };
          if (method === 'wrapKey')
            return {
              ivBase64: btoa('\0'.repeat(12)),
              ciphertextBase64: btoa(atob(options.keyBase64 ?? '') + '\0'.repeat(16)),
            };
          if (method === 'unwrapKey')
            return { keyBase64: btoa(atob(options.ciphertextBase64 ?? '').slice(0, 32)) };
          return {};
        },
      },
    });
  });
}

/** The speech worker stand-in alone: the browser build with a model that «downloads» in a moment. */
export async function installFakeSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const RealWorker = window.Worker;
    class FakeSpeechWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      private phrases = 0;
      postMessage(message: { type: string; modelId?: string; requestId?: string }): void {
        const reply = (data: unknown, delay: number): void => {
          setTimeout(() => this.onmessage?.({ data }), delay);
        };
        if (message.type === 'load') {
          reply({ type: 'loading', modelId: message.modelId, progress: 0.4 }, 150);
          reply({ type: 'loading', modelId: message.modelId, progress: 1 }, 600);
          reply({ type: 'ready', modelId: message.modelId }, 1_200);
        } else if (message.type === 'transcribe') {
          this.phrases += 1;
          reply(
            { type: 'result', requestId: message.requestId, text: `Фраза номер ${this.phrases}` },
            50,
          );
        }
      }
      terminate(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    window.Worker = function patchedWorker(url: string | URL, options?: WorkerOptions) {
      return String(url).includes('asr.worker')
        ? (new FakeSpeechWorker() as unknown as Worker)
        : new RealWorker(url, options);
    } as unknown as typeof Worker;
  });
}
