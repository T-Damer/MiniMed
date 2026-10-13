import { describe, expect, it } from 'vitest';

import { KD1_PROFILE, NeuralQueryEmbedder, quantizeEmbedding } from '../src';

describe('neural query embeddings', () => {
  it('quantizes like the Python builder: L2, ×127, half away from zero', () => {
    // 0.6/0.8 is already unit length: 76.2 → 76, -101.6 → -102; zero stays zero.
    expect(quantizeEmbedding([0.6, -0.8, 0])).toEqual([76, -102, 0]);
    // 1/√2 × 127 = 89.8 → 90 on both signs.
    expect(quantizeEmbedding([3, -3])).toEqual([90, -90]);
    expect(quantizeEmbedding([0, 0])).toEqual([0, 0]);
  });

  it('embeds the original wording with the profile query prefix', async () => {
    const seen: string[] = [];
    const embedder = new NeuralQueryEmbedder(KD1_PROFILE, async (text) => {
      seen.push(text);
      return Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    });
    const vector = await embedder.embedQuery('кашель три недели');
    expect(seen).toEqual(['query: кашель три недели']);
    expect(embedder.input).toBe('original-query');
    expect(vector.profileId).toBe(KD1_PROFILE.id);
    expect(vector.values[0]).toBe(127);
    expect(vector.norm).toBe(127);
  });

  it('rejects a model output of another dimension', async () => {
    const embedder = new NeuralQueryEmbedder(KD1_PROFILE, async () => new Float32Array(8));
    await expect(embedder.embedQuery('x')).rejects.toThrow(RangeError);
  });

  it('reuses the last query vector and forgets a failed one', async () => {
    let calls = 0;
    let fail = true;
    const embedder = new NeuralQueryEmbedder(KD1_PROFILE, async () => {
      calls += 1;
      if (fail) throw new Error('semantic-model-not-installed');
      return Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    });
    await expect(embedder.embedQuery('кашель')).rejects.toThrow('semantic-model-not-installed');
    fail = false;
    const first = await embedder.embedQuery('кашель');
    const second = await embedder.embedQuery('кашель');
    expect(second).toBe(first);
    expect(calls).toBe(2);
  });
});
