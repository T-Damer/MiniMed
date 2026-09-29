import { describe, expect, it } from 'vitest';
import { decodeZstdIndex, MAX_ZSTD_WINDOW_BYTES, zstdWindowBytes } from './zstd-index-decode';

// `zstd -19` of 'SQLite format 3\0' × 100 (1 600 bytes, single-segment frame).
const archive = Uint8Array.from(
  Buffer.from('KLUv/WBABcUAAIBTUUxpdGUgZm9ybWF0IDMAAQBanH8uAQ==', 'base64'),
);
const original = new TextEncoder().encode('SQLite format 3\0'.repeat(100));

/** A frame header with a windowed (not single-segment) descriptor: 2^(10 + exponent) bytes. */
function windowHeader(exponent: number): Uint8Array {
  return Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, exponent << 3, 0, 0]);
}

describe('zstd module index decoding', () => {
  it('decodes exactly the declared size', () => {
    expect(decodeZstdIndex(archive, original.byteLength)).toEqual(original);
    expect(() => decodeZstdIndex(archive, original.byteLength + 1)).toThrow('неверный размер');
  });

  it('rejects data that is not a zstd frame', () => {
    expect(() => decodeZstdIndex(original, original.byteLength)).toThrow('не похож на архив zstd');
  });

  it('reads the window and refuses windows above 64 MiB', () => {
    expect(zstdWindowBytes(archive)).toBeNull();
    expect(zstdWindowBytes(windowHeader(16))).toBe(MAX_ZSTD_WINDOW_BYTES);
    expect(zstdWindowBytes(windowHeader(17))).toBe(128 * 1024 * 1024);
    expect(() => decodeZstdIndex(windowHeader(17), 10)).toThrow('слишком большим окном');
  });
});
