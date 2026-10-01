import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createDecodedIndexReader, type EncodedModuleIndex } from './encoded-index-reader';
import { listZstdFrames } from './zstd-frames';

const zstdCompressSync = (zlib as { zstdCompressSync?: typeof zlib.zstdCompressSync })
  .zstdCompressSync;
const zstdAvailable = typeof zstdCompressSync === 'function';

function pseudoRandomText(length: number): Uint8Array {
  const words = ['бронхит', 'лечение', 'таблетки', 'регистрация', 'SQLite', 'format', '3', '0x00'];
  const bytes = new Uint8Array(length);
  let seed = 42;
  let offset = 0;
  const encoder = new TextEncoder();
  while (offset < length) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const word = encoder.encode(`${words[seed % words.length]} ${seed % 977} `);
    const take = Math.min(word.length, length - offset);
    bytes.set(word.subarray(0, take), offset);
    offset += take;
  }
  return bytes;
}

/** A zstd file made of independent frames, each declaring its content size. */
function framedZstd(decoded: Uint8Array, frameBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < decoded.length; offset += frameBytes) {
    const slice = decoded.subarray(offset, offset + frameBytes);
    // pledgedSrcSize makes zstd record the frame's content size, as `zstd file` does.
    const options = { pledgedSrcSize: slice.length } as unknown as zlib.ZstdOptions;
    parts.push((zstdCompressSync as typeof zlib.zstdCompressSync)(slice, options));
  }
  return Buffer.concat(parts);
}

function encodedIndex(decoded: Uint8Array, frameBytes: number): EncodedModuleIndex {
  return {
    bytes: framedZstd(decoded, frameBytes),
    decodedSizeBytes: decoded.length,
    decodedSha256: `sha256:${createHash('sha256').update(decoded).digest('hex')}`,
  };
}

async function drain(read: () => Promise<Uint8Array | undefined>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let chunk = await read(); chunk !== undefined; chunk = await read()) parts.push(chunk);
  return Buffer.concat(parts);
}

const noYield = (): Promise<void> => Promise.resolve();

describe.skipIf(!zstdAvailable)('framed zstd index reader', () => {
  const decoded = pseudoRandomText(900_000);

  it('lists the independent frames of a concatenated archive', () => {
    const encoded = encodedIndex(decoded, 250_000);
    const frames = listZstdFrames(encoded.bytes);
    expect(frames).toHaveLength(4);
    expect(frames.map((frame) => frame.contentBytes)).toEqual([250_000, 250_000, 250_000, 150_000]);
    expect(frames[0]?.start).toBe(0);
    expect(frames.at(-1)?.end).toBe(encoded.bytes.byteLength);
  });

  it('streams exactly the decoded bytes, one verified pass', async () => {
    const encoded = encodedIndex(decoded, 250_000);
    const read = createDecodedIndexReader(encoded, { yieldToEventLoop: noYield });
    expect(Buffer.from(await drain(read)).equals(Buffer.from(decoded))).toBe(true);
    await expect(read()).resolves.toBeUndefined();
  });

  it('does not report the end of a stream whose checksum differs', async () => {
    const encoded = encodedIndex(decoded, 250_000);
    const wrong = { ...encoded, decodedSha256: `sha256:${'0'.repeat(64)}` };
    await expect(
      drain(createDecodedIndexReader(wrong, { yieldToEventLoop: noYield })),
    ).rejects.toThrow('Контрольная сумма');
  });

  it('rejects a wrong declared size in either direction', async () => {
    const encoded = encodedIndex(decoded, 250_000);
    for (const delta of [-1, 1]) {
      await expect(
        drain(
          createDecodedIndexReader(
            { ...encoded, decodedSizeBytes: encoded.decodedSizeBytes + delta },
            { yieldToEventLoop: noYield },
          ),
        ),
      ).rejects.toThrow('размер');
    }
  });

  it('rejects truncated archives and honours cancellation', async () => {
    const encoded = encodedIndex(decoded, 250_000);
    expect(() =>
      createDecodedIndexReader({ ...encoded, bytes: encoded.bytes.subarray(0, -5) }),
    ).toThrow('не похож');
    const controller = new AbortController();
    const read = createDecodedIndexReader(encoded, {
      signal: controller.signal,
      yieldToEventLoop: noYield,
    });
    await read();
    controller.abort();
    await expect(read()).rejects.toThrow();
  });

  it('refuses frames that do not declare their size', () => {
    // pledgedSrcSize omitted and contentSizeFlag off: the decoder cannot bound its memory.
    const archive = (zstdCompressSync as typeof zlib.zstdCompressSync)(decoded.subarray(0, 1000), {
      params: { [zlib.constants.ZSTD_c_contentSizeFlag]: 0 },
    });
    const read = createDecodedIndexReader(
      {
        bytes: archive,
        decodedSizeBytes: 1000,
        decodedSha256: `sha256:${createHash('sha256').update(decoded.subarray(0, 1000)).digest('hex')}`,
      },
      { yieldToEventLoop: noYield },
    );
    return expect(read()).rejects.toThrow('без объявленного размера');
  });
});

describe('zstd frame table', () => {
  it('rejects bytes that are not zstd frames', () => {
    expect(() => listZstdFrames(new TextEncoder().encode('SQLite format 3\0 not zstd'))).toThrow(
      'не похож',
    );
  });
});
