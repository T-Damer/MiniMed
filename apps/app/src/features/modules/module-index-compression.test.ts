import { gzipSync } from 'node:zlib';
import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { decodeModuleIndex } from './module-index-compression';

const bytes = new TextEncoder().encode('SQLite format 3\0'.repeat(100));
const artifact: ContentModuleCatalogEntry['artifacts'][number] = {
  id: 'index',
  kind: 'index',
  required: true,
  url: 'https://example.test/index.db.gz',
  sha256: null,
  sizeBytes: null,
  compression: 'gzip',
  sourceSetDigest: `sha256:${'a'.repeat(64)}`,
  decodedSizeBytes: bytes.byteLength,
};

describe('compressed module index', () => {
  it('round-trips gzip and rejects corrupt, oversized, truncated and cancelled output', async () => {
    const signal = new AbortController().signal;
    const compressed = gzipSync(bytes);
    expect(await decodeModuleIndex(artifact, compressed, signal)).toEqual(bytes);
    await expect(decodeModuleIndex(artifact, compressed.subarray(0, -4), signal)).rejects.toThrow();
    for (const delta of [-1, 1]) {
      await expect(
        decodeModuleIndex(
          { ...artifact, decodedSizeBytes: bytes.length + delta },
          compressed,
          signal,
        ),
      ).rejects.toThrow();
    }
    const controller = new AbortController();
    controller.abort();
    await expect(decodeModuleIndex(artifact, compressed, controller.signal)).rejects.toThrow();
  });
});
