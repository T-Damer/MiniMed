import { describe, expect, it } from 'vitest';

import {
  E5_MODEL_FILES,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
  e5FileUrl,
  pinnedE5File,
} from './e5-model';

const transformersUrl = (revision: string, path: string) =>
  `https://huggingface.co/${E5_MODEL_ID}/resolve/${revision}/${path}`;

describe('pinned query model files', () => {
  it('serves only the pinned snapshot, including transformers probes at main', () => {
    expect(
      pinnedE5File(transformersUrl(E5_MODEL_REVISION, 'onnx/model_quantized.onnx'))?.sizeBytes,
    ).toBe(118_972_175);
    expect(pinnedE5File(transformersUrl('main', 'config.json'))?.path).toBe('config.json');
    expect(pinnedE5File(transformersUrl(E5_MODEL_REVISION, 'onnx/model.onnx'))).toBeNull();
    expect(
      pinnedE5File(`${transformersUrl(E5_MODEL_REVISION, 'config.json')}?download=1`),
    ).toBeNull();
    expect(
      pinnedE5File(`https://example.org/${E5_MODEL_ID}/resolve/${E5_MODEL_REVISION}/config.json`),
    ).toBeNull();
    // The download host is never a transformers.js request.
    expect(pinnedE5File(e5FileUrl('config.json'))).toBeNull();
  });

  it('pins a checksum and size for every file and part', () => {
    for (const file of E5_MODEL_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.sizeBytes).toBeGreaterThan(0);
      for (const part of file.parts ?? []) expect(part.sha256).toMatch(/^[0-9a-f]{64}$/u);
      if (file.parts) {
        expect(file.parts.reduce((sum, part) => sum + part.sizeBytes, 0)).toBe(file.sizeBytes);
        // Every part fits a plain git blob on the mirror branch.
        for (const part of file.parts) expect(part.sizeBytes).toBeLessThan(100 * 1024 * 1024);
      }
    }
  });

  it('downloads from the datasets mirror branch of the pinned revision', () => {
    expect(e5FileUrl('onnx/model_quantized.onnx.part-0')).toBe(
      `https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/${E5_MODEL_REVISION}/models/kd1-query-encoder/onnx/model_quantized.onnx.part-0`,
    );
  });
});
