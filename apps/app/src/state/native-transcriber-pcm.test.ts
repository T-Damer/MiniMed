import { describe, expect, it } from 'vitest';

import { pcm16Base64 } from '@/state/native-transcriber';

describe('pcm16Base64', () => {
  it('writes little-endian 16-bit samples, clipped to the range', () => {
    const encoded = pcm16Base64(new Float32Array([0, 1, -1, 0.5, 2, -2]));
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const values = Array.from({ length: bytes.length / 2 }, (_, index) =>
      view.getInt16(index * 2, true),
    );
    expect(values).toEqual([0, 32_767, -32_768, 16_383, 32_767, -32_768]);
  });

  it('handles a 24 s stretch without overflowing the call stack', () => {
    const samples = new Float32Array(24 * 16_000).fill(0.25);
    expect(atob(pcm16Base64(samples)).length).toBe(samples.length * 2);
  });
});
