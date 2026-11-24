import { describe, expect, it } from 'vitest';

import {
  NATIVE_TRANSCRIPTION_MODEL_BYTES,
  NATIVE_TRANSCRIPTION_MODELS,
} from './native-transcription-models';

describe('native transcription model manifest', () => {
  it('pins every artifact to immutable content with a SHA-256 and exact size', () => {
    expect(NATIVE_TRANSCRIPTION_MODELS).toHaveLength(6);
    expect(new Set(NATIVE_TRANSCRIPTION_MODELS.map((artifact) => artifact.id)).size).toBe(6);
    expect(new Set(NATIVE_TRANSCRIPTION_MODELS.map((artifact) => artifact.fileName)).size).toBe(6);

    for (const artifact of NATIVE_TRANSCRIPTION_MODELS) {
      expect(artifact.expectedBytes).toBeGreaterThan(0);
      expect(artifact.expectedSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact.url).toMatch(/^https:\/\/huggingface\.co\//u);
      expect(artifact.url).not.toContain('/main/');
      expect(artifact.source).toMatch(/^https:\/\/huggingface\.co\//u);
    }
  });

  it('keeps the reviewed download footprint explicit', () => {
    expect(NATIVE_TRANSCRIPTION_MODEL_BYTES).toBe(263_034_686);
  });

  it('keeps the GigaAM v3 RNN-T transducer components coupled to one pinned revision', () => {
    const encoder = NATIVE_TRANSCRIPTION_MODELS.find(
      (artifact) => artifact.id === 'gigaam-encoder',
    );
    const decoder = NATIVE_TRANSCRIPTION_MODELS.find(
      (artifact) => artifact.id === 'gigaam-decoder',
    );
    const joiner = NATIVE_TRANSCRIPTION_MODELS.find((artifact) => artifact.id === 'gigaam-joiner');
    const tokens = NATIVE_TRANSCRIPTION_MODELS.find((artifact) => artifact.id === 'gigaam-tokens');
    for (const part of [encoder, decoder, joiner, tokens]) {
      expect(part?.url).toContain('/a6039be7cee829a9044a69ac0ebaf1c191217c97/');
    }
    expect(tokens?.expectedBytes).toBe(13_354);
    expect(tokens?.expectedSha256).toBe(
      '39abae20e692998290c574e606f11a9edef2902a1995463fcff63d1490cf22b7',
    );
  });
});
