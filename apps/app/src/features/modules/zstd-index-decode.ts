import { decompress } from 'fzstd';

const ZSTD_MAGIC = 0xfd2fb528;

/**
 * fzstd 0.1.1 silently returns wrong bytes for a 128 MiB window (`zstd --long=27`) while 64 MiB
 * decodes exactly, so module indexes are packaged with `--long=26` at most and larger windows are
 * refused here. The installer still verifies the decoded SHA-256 either way.
 */
export const MAX_ZSTD_WINDOW_BYTES = 64 * 1024 * 1024;

/** Window size from the first frame header; for a single-segment frame the window is the frame. */
export function zstdWindowBytes(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 6) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ZSTD_MAGIC) return null;
  const descriptor = bytes[4] ?? 0;
  if ((descriptor >> 5) & 1) return null;
  const windowDescriptor = bytes[5] ?? 0;
  const base = 2 ** (10 + (windowDescriptor >> 3));
  return base + (base / 8) * (windowDescriptor & 7);
}

export function decodeZstdIndex(bytes: Uint8Array, expectedBytes: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 6 || view.getUint32(0, true) !== ZSTD_MAGIC) {
    throw new Error('Файл базы не похож на архив zstd.');
  }
  const window = zstdWindowBytes(bytes);
  if (window !== null && window > MAX_ZSTD_WINDOW_BYTES) {
    throw new Error('Архив базы собран со слишком большим окном zstd.');
  }
  // Without an output buffer fzstd allocates exactly the frame's declared size; passing one of
  // hundreds of megabytes makes 0.1.1 stringify it and run out of memory.
  const decoded = decompress(bytes);
  if (decoded.byteLength !== expectedBytes) {
    throw new Error('Распакованная база имеет неверный размер.');
  }
  return decoded;
}
