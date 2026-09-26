import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type IndexedDbStoreDouble,
  installMultiStoreIndexedDbDouble,
} from '@/features/network/indexeddb-test-double';

const { downloadWithRetryMock } = vi.hoisted(() => ({
  downloadWithRetryMock: vi.fn(),
}));

vi.mock('@/features/network/download-retry', () => ({
  downloadWithRetry: downloadWithRetryMock,
}));

import {
  BROWSER_DIARIZATION_MODEL_BYTES,
  BROWSER_DIARIZATION_MODELS,
  type BrowserDiarizationModelArtifact,
  getBrowserDiarizationModelBytes,
  verifyBrowserDiarizationArtifact,
} from './browser-diarization-models';

const fixtureBytes = new TextEncoder().encode('minimed-diarization');
const fixtureArtifact: BrowserDiarizationModelArtifact = {
  id: 'pyannote-segmentation',
  fileName: 'fixture.onnx',
  url: 'https://example.invalid/fixture.onnx',
  expectedBytes: 19,
  expectedSha256: '30c684498c567896462c3cbb25087d2a8c7b652b1d6e801b2764d615f4d06908',
  license: 'MIT',
  source: 'https://example.invalid/',
};

function installModelCache(): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  installMultiStoreIndexedDbDouble(
    new Map<string, IndexedDbStoreDouble>([['models', { keyPath: 'id', records }]]),
  );
  return records;
}

afterEach(() => {
  downloadWithRetryMock.mockReset();
  vi.unstubAllGlobals();
});

describe('browser diarization model admission', () => {
  it('pins immutable model revisions, exact sizes and SHA-256 values', () => {
    expect(BROWSER_DIARIZATION_MODELS).toHaveLength(2);
    expect(BROWSER_DIARIZATION_MODEL_BYTES).toBe(31_137_484);
    expect(new Set(BROWSER_DIARIZATION_MODELS.map((artifact) => artifact.id)).size).toBe(2);

    for (const artifact of BROWSER_DIARIZATION_MODELS) {
      expect(artifact.expectedBytes).toBeGreaterThan(0);
      expect(artifact.expectedSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact.url).toMatch(/^https:\/\/huggingface\.co\//u);
      expect(artifact.url).not.toContain('/main/');
      expect(artifact.url).toMatch(/\/resolve\/[a-f0-9]{40}\//u);
    }
  });

  it('accepts only bytes matching both size and SHA-256', async () => {
    await expect(
      verifyBrowserDiarizationArtifact(fixtureBytes, fixtureArtifact),
    ).resolves.toBeUndefined();
    await expect(
      verifyBrowserDiarizationArtifact(
        fixtureBytes.subarray(0, fixtureBytes.length - 1),
        fixtureArtifact,
      ),
    ).rejects.toThrow('Размер модели');

    const wrongHash = {
      ...fixtureArtifact,
      expectedSha256: '0'.repeat(64),
    };
    await expect(verifyBrowserDiarizationArtifact(fixtureBytes, wrongHash)).rejects.toThrow(
      'Контрольная сумма',
    );
  });

  it('reuses a verified IndexedDB model without a second download', async () => {
    const cache = installModelCache();
    downloadWithRetryMock.mockResolvedValue(Uint8Array.from(fixtureBytes));

    const first = await getBrowserDiarizationModelBytes(fixtureArtifact);
    const second = await getBrowserDiarizationModelBytes(fixtureArtifact);

    expect([...first]).toEqual([...fixtureBytes]);
    expect([...second]).toEqual([...fixtureBytes]);
    expect(downloadWithRetryMock).toHaveBeenCalledTimes(1);
    expect(cache.get(fixtureArtifact.id)).toMatchObject({
      id: fixtureArtifact.id,
      sha256: fixtureArtifact.expectedSha256,
      expectedBytes: fixtureArtifact.expectedBytes,
    });
  });

  it('drops a same-size corrupt cached model and downloads the verified artifact again', async () => {
    const cache = installModelCache();
    cache.set(fixtureArtifact.id, {
      id: fixtureArtifact.id,
      sha256: fixtureArtifact.expectedSha256,
      expectedBytes: fixtureArtifact.expectedBytes,
      data: new Blob([new Uint8Array(fixtureArtifact.expectedBytes).fill(7)]),
      updatedAt: '2026-09-26T08:00:00.000Z',
    });
    downloadWithRetryMock.mockResolvedValue(Uint8Array.from(fixtureBytes));

    const result = await getBrowserDiarizationModelBytes(fixtureArtifact);

    expect([...result]).toEqual([...fixtureBytes]);
    expect(downloadWithRetryMock).toHaveBeenCalledTimes(1);
    const repaired = cache.get(fixtureArtifact.id);
    expect(repaired).toMatchObject({
      id: fixtureArtifact.id,
      sha256: fixtureArtifact.expectedSha256,
      expectedBytes: fixtureArtifact.expectedBytes,
    });
    const repairedBlob = repaired?.['data'] as Blob | undefined;
    expect(repairedBlob).toBeInstanceOf(Blob);
    expect(repairedBlob ? [...new Uint8Array(await repairedBlob.arrayBuffer())] : []).toEqual([
      ...fixtureBytes,
    ]);
  });
});
