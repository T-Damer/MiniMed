import { describe, expect, it } from 'vitest';

import {
  BROWSER_DIARIZATION_MODEL_BYTES,
  BROWSER_DIARIZATION_MODELS,
  type BrowserDiarizationModelArtifact,
  verifyBrowserDiarizationArtifact,
} from './browser-diarization-models';

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
    const bytes = new TextEncoder().encode('minimed-diarization');
    const artifact: BrowserDiarizationModelArtifact = {
      id: 'pyannote-segmentation',
      fileName: 'fixture.onnx',
      url: 'https://example.invalid/fixture.onnx',
      expectedBytes: 19,
      expectedSha256: '30c684498c567896462c3cbb25087d2a8c7b652b1d6e801b2764d615f4d06908',
      license: 'MIT',
      source: 'https://example.invalid/',
    };

    await expect(verifyBrowserDiarizationArtifact(bytes, artifact)).resolves.toBeUndefined();
    await expect(
      verifyBrowserDiarizationArtifact(bytes.subarray(0, bytes.length - 1), artifact),
    ).rejects.toThrow('Размер модели');

    const wrongHash = {
      ...artifact,
      expectedSha256: '0'.repeat(64),
    };
    await expect(verifyBrowserDiarizationArtifact(bytes, wrongHash)).rejects.toThrow(
      'Контрольная сумма',
    );
  });
});
