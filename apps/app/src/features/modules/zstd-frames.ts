/**
 * Frame table of a Zstandard file (RFC 8878 §3.1.1). Module indexes are published as a series of
 * independent frames of at most {@link ZSTD_FRAME_CONTENT_BYTES} decoded bytes each (a plain
 * concatenation, valid for every zstd decoder). fzstd's streaming decoder copies its whole window
 * after every block (≈10 s for a 340 MB index with a 64 MiB window), while its one-shot decoder
 * writes straight into an output buffer of the frame's declared size (≈1 s). Decoding frame by
 * frame keeps the speed of the second and the memory of the first.
 */

const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MAGIC_MASK = 0xfffffff0;
const SKIPPABLE_MAGIC = 0x184d2a50;

/** Content cap per frame: also the largest window fzstd decodes exactly (see zstd-index-decode). */
export const ZSTD_FRAME_CONTENT_BYTES = 64 * 1024 * 1024;

export interface ZstdFrame {
  /** Offset of the frame's magic number in the file. */
  readonly start: number;
  /** Offset just past the frame (including its optional content checksum). */
  readonly end: number;
  /** Decoded size from the frame header; null when the encoder did not declare it. */
  readonly contentBytes: number | null;
}

function readLittleEndian(view: DataView, offset: number, byteLength: number): number {
  let value = 0;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    value = value * 256 + view.getUint8(offset + index);
  }
  return value;
}

const MALFORMED = 'Файл базы не похож на корректный архив zstd.';

/** Walks block headers only; no block is decoded. Throws on anything that is not whole frames. */
export function listZstdFrames(bytes: Uint8Array): readonly ZstdFrame[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: ZstdFrame[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error(MALFORMED);
    const magic = view.getUint32(offset, true);
    if ((magic & SKIPPABLE_MAGIC_MASK) >>> 0 === SKIPPABLE_MAGIC) {
      offset += 8 + view.getUint32(offset + 4, true);
      if (offset > bytes.byteLength) throw new Error(MALFORMED);
      continue;
    }
    if (magic !== ZSTD_MAGIC) throw new Error(MALFORMED);
    const start = offset;
    const descriptor = view.getUint8(offset + 4);
    const contentSizeFlag = descriptor >> 6;
    const singleSegment = (descriptor >> 5) & 1;
    const hasChecksum = (descriptor >> 2) & 1;
    const dictionaryFlag = descriptor & 3;
    if (dictionaryFlag !== 0)
      throw new Error('Архив zstd использует словарь, который не поддерживается.');
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment : 1 << contentSizeFlag;
    let cursor = offset + 5 + (singleSegment ? 0 : 1);
    if (cursor + contentSizeBytes > bytes.byteLength) throw new Error(MALFORMED);
    let contentBytes: number | null = null;
    if (contentSizeBytes > 0) {
      contentBytes = readLittleEndian(view, cursor, contentSizeBytes);
      if (contentSizeFlag === 1) contentBytes += 256;
    }
    cursor += contentSizeBytes;
    for (;;) {
      if (cursor + 3 > bytes.byteLength) throw new Error(MALFORMED);
      const header = readLittleEndian(view, cursor, 3);
      const last = header & 1;
      const type = (header >> 1) & 3;
      const size = header >> 3;
      if (type === 3) throw new Error(MALFORMED);
      cursor += 3 + (type === 1 ? 1 : size);
      if (cursor > bytes.byteLength) throw new Error(MALFORMED);
      if (last) break;
    }
    if (hasChecksum) cursor += 4;
    if (cursor > bytes.byteLength) throw new Error(MALFORMED);
    frames.push({ start, end: cursor, contentBytes });
    offset = cursor;
  }
  return frames;
}
