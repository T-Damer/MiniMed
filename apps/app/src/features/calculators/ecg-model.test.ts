import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  digitizeEcgPhoto,
  ECG_MODEL_CATALOG,
  type EcgModelCatalogItem,
  validateEcgModelFiles,
  verifyEcgModelDownload,
} from '@/features/calculators/ecg-model';
import {
  ECG_DIGITIZER_CONFIG_FILE,
  ECG_DIGITIZER_WEIGHTS_FILE,
  ECG_MODEL_MANIFEST_FILE,
} from '@/features/calculators/ecg-model-contract';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function validFiles(): Map<string, Uint8Array> {
  return new Map([
    [
      ECG_MODEL_MANIFEST_FILE,
      encode(
        JSON.stringify({
          format: 'minimed-ecg-waveform-digitizer',
          formatVersion: 1,
          name: 'Test digitizer',
          version: '1.0',
          source: 'https://example.test/model',
          license: 'CC BY-SA 4.0',
        }),
      ),
    ],
    [
      ECG_DIGITIZER_CONFIG_FILE,
      encode(
        JSON.stringify({
          format: 'open-ecg-digitizer-segmentation',
          formatVersion: 1,
          height: 768,
          width: 1024,
          gridClass: 0,
          signalClass: 2,
        }),
      ),
    ],
    [ECG_DIGITIZER_WEIGHTS_FILE, new Uint8Array([1])],
  ]);
}

describe('ECG digitizer bundle', () => {
  it('accepts only the waveform digitizer files', () => {
    expect(validateEcgModelFiles(validFiles())).toMatchObject({
      manifest: { name: 'Test digitizer', version: '1.0' },
    });
  });

  it('rejects an incomplete or legacy classifier bundle', () => {
    const incomplete = validFiles();
    incomplete.delete(ECG_DIGITIZER_WEIGHTS_FILE);
    expect(() => validateEcgModelFiles(incomplete)).toThrow(ECG_DIGITIZER_WEIGHTS_FILE);

    const legacy = validFiles();
    legacy.set(
      ECG_MODEL_MANIFEST_FILE,
      encode(
        JSON.stringify({
          format: 'minimed-ecg-image-classifier',
          formatVersion: 1,
          name: 'Legacy classifier',
          version: '1.0',
          source: 'https://example.test/model',
          license: 'BSD-3-Clause',
        }),
      ),
    );
    expect(() => validateEcgModelFiles(legacy)).toThrow('Неподдерживаемый формат');
  });

  it('publishes one digitizer and verifies downloaded bytes', async () => {
    expect(ECG_MODEL_CATALOG).toHaveLength(1);
    expect(ECG_MODEL_CATALOG[0]).toMatchObject({
      id: 'open-ecg-digitizer-2026-1',
      name: 'Open ECG Digitizer',
    });
    expect(JSON.stringify(ECG_MODEL_CATALOG)).not.toMatch(/classif/iu);

    const fixture: EcgModelCatalogItem = {
      id: 'fixture',
      name: 'Fixture',
      description: 'Fixture',
      version: '1',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://example.test/source',
      bundleUrl: 'https://example.test/model.zip',
      bundleSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      downloadBytes: 3,
    };
    await expect(verifyEcgModelDownload(fixture, encode('abc'))).resolves.toBeInstanceOf(
      ArrayBuffer,
    );
    await expect(verifyEcgModelDownload(fixture, encode('abd'))).rejects.toThrow(
      'Контрольная сумма',
    );
  });

  it('stops a silent worker and returns the user to manual markup after one minute', async () => {
    vi.useFakeTimers();
    const storage = new Map([
      [
        'minimed.ecg-model',
        JSON.stringify({
          cacheName: 'minimed-ecg-model-test',
          checksum: 'test',
          fileBytes: 1,
          installedAt: '2026-09-02T00:00:00.000Z',
          kind: 'waveform-digitizer',
          license: 'CC BY-SA 4.0',
          name: 'Test digitizer',
          source: 'https://example.test/model',
          version: '1',
        }),
      ],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    class SilentWorker {
      onerror: ((event: ErrorEvent) => unknown) | null = null;
      onmessage: ((event: MessageEvent) => unknown) | null = null;
      terminated = false;

      postMessage(): void {}

      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', SilentWorker);
    const pending = digitizeEcgPhoto({
      arrayBuffer: async () => new ArrayBuffer(1),
      type: 'image/jpeg',
    } as File);
    const rejection = expect(pending).rejects.toThrow('продолжите ручную разметку');
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
  });
});
