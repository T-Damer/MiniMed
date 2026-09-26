import { describe, expect, it } from 'vitest';

import {
  NATIVE_TRANSCRIPTION_MODEL_BYTES,
  NATIVE_TRANSCRIPTION_MODELS,
} from './native-transcription-models';

describe('native transcription model manifest', () => {
  it('pins every artifact to immutable content with a SHA-256 and exact size', () => {
    expect(NATIVE_TRANSCRIPTION_MODELS).toHaveLength(4);
    expect(new Set(NATIVE_TRANSCRIPTION_MODELS.map((artifact) => artifact.id)).size).toBe(4);
    expect(new Set(NATIVE_TRANSCRIPTION_MODELS.map((artifact) => artifact.fileName)).size).toBe(4);

    for (const artifact of NATIVE_TRANSCRIPTION_MODELS) {
      expect(artifact.expectedBytes).toBeGreaterThan(0);
      expect(artifact.expectedSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact.url).toMatch(/^https:\/\/huggingface\.co\//u);
      expect(artifact.url).not.toContain('/main/');
      expect(artifact.source).toMatch(/^https:\/\/huggingface\.co\//u);
    }
  });

  it('keeps the reviewed download footprint explicit', () => {
    expect(NATIVE_TRANSCRIPTION_MODEL_BYTES).toBe(256_033_152);
  });

  it('keeps the GigaAM vocabulary coupled to the pinned CTC model revision', () => {
    const asr = NATIVE_TRANSCRIPTION_MODELS.find((artifact) => artifact.id === 'gigaam-asr');
    const tokens = NATIVE_TRANSCRIPTION_MODELS.find((artifact) => artifact.id === 'gigaam-tokens');
    expect(asr?.url).toContain('/360529f65d9687a7b1c2177130262819e51557da/');
    expect(tokens?.url).toContain('/360529f65d9687a7b1c2177130262819e51557da/');
    expect(tokens?.expectedBytes).toBe(2_007);
    expect(tokens?.expectedSha256).toBe(
      '142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd',
    );
  });
});
