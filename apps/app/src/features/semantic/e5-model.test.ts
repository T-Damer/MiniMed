import { describe, expect, it } from 'vitest';

import { E5_MODEL_FILES, E5_MODEL_REVISION, e5FileUrl, pinnedE5File } from './e5-model';

describe('pinned e5 model files', () => {
  it('serves only the pinned snapshot, including transformers probes at main', () => {
    expect(pinnedE5File(e5FileUrl('onnx/model_quantized.onnx'))?.sizeBytes).toBe(118_308_185);
    expect(
      pinnedE5File('https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/config.json')
        ?.path,
    ).toBe('config.json');
    expect(pinnedE5File(e5FileUrl('onnx/model.onnx'))).toBeNull();
    expect(pinnedE5File(`${e5FileUrl('config.json')}?download=1`)).toBeNull();
    expect(
      pinnedE5File(
        `https://example.org/Xenova/multilingual-e5-small/resolve/${E5_MODEL_REVISION}/config.json`,
      ),
    ).toBeNull();
  });

  it('pins a checksum and size for every file', () => {
    for (const file of E5_MODEL_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.sizeBytes).toBeGreaterThan(0);
    }
  });
});
