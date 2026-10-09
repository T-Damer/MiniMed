import { decompress } from 'fzstd';
import { Sha256Stream } from './sha256-stream';
import { listZstdFrames, ZSTD_FRAME_CONTENT_BYTES } from './zstd-frames';
import { MAX_ZSTD_WINDOW_BYTES, zstdWindowBytes } from './zstd-index-decode';

/** A module index as it travels: a zstd file plus the identity of the SQLite it must decode to. */
export interface EncodedModuleIndex {
  readonly bytes: Uint8Array;
  readonly decodedSizeBytes: number;
  readonly decodedSha256: string;
}

/** Size of one write handed to the OPFS pool; also the progress granularity of an import. */
const OUTPUT_SLICE_BYTES = 4 * 1024 * 1024;

/** Wall time the reader spent decoding frames and hashing slices, for install timings. */
export interface DecodedIndexStats {
  decodeMs: number;
  hashMs: number;
}

export interface DecodedIndexReaderOptions {
  readonly signal?: AbortSignal;
  readonly stats?: DecodedIndexStats;
  /** Lets the caller's event loop breathe (progress, cancellation) between decoded frames. */
  readonly yieldToEventLoop?: () => Promise<void>;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Streams the decoded SQLite of a framed zstd index in slices, holding at most one decoded frame
 * (≤ 64 MiB) in memory. The SHA-256 and byte count of everything produced are verified when the
 * last slice has been requested: the reader then throws instead of reporting the end of the stream,
 * so a consumer that commits only on a clean end never publishes unverified bytes.
 */
export function createDecodedIndexReader(
  encoded: EncodedModuleIndex,
  options: DecodedIndexReaderOptions = {},
): () => Promise<Uint8Array | undefined> {
  const frames = listZstdFrames(encoded.bytes);
  if (frames.length === 0) throw new Error('Файл базы не похож на архив zstd.');
  const hash = new Sha256Stream();
  const pause = options.yieldToEventLoop ?? defaultYield;
  let frameIndex = 0;
  let current: Uint8Array | null = null;
  let offset = 0;
  let produced = 0;
  let finished = false;

  const nextFrame = (): Uint8Array | null => {
    const frame = frames[frameIndex];
    if (!frame) return null;
    frameIndex += 1;
    const archive = encoded.bytes.subarray(frame.start, frame.end);
    if (frame.contentBytes === null) {
      throw new Error('Архив zstd без объявленного размера нельзя распаковывать потоком.');
    }
    if (frame.contentBytes > ZSTD_FRAME_CONTENT_BYTES) {
      throw new Error('Кадр архива zstd превышает допустимый размер.');
    }
    const window = zstdWindowBytes(archive);
    if (window !== null && window > MAX_ZSTD_WINDOW_BYTES) {
      throw new Error('Архив базы собран со слишком большим окном zstd.');
    }
    const decodeStartedAt = performance.now();
    const decoded = decompress(archive);
    if (options.stats) options.stats.decodeMs += performance.now() - decodeStartedAt;
    if (decoded.byteLength !== frame.contentBytes) {
      throw new Error('Распакованная база имеет неверный размер.');
    }
    return decoded;
  };

  return async () => {
    if (finished) return undefined;
    options.signal?.throwIfAborted();
    while (current === null || offset >= current.byteLength) {
      if (current !== null) await pause();
      options.signal?.throwIfAborted();
      current = nextFrame();
      offset = 0;
      if (current === null) {
        finished = true;
        if (produced !== encoded.decodedSizeBytes) {
          throw new Error('Распакованная база имеет неверный размер.');
        }
        if (`sha256:${hash.digestHex()}` !== encoded.decodedSha256) {
          throw new Error('Контрольная сумма распакованной базы не совпала.');
        }
        return undefined;
      }
    }
    const slice = current.subarray(offset, offset + OUTPUT_SLICE_BYTES);
    offset += slice.byteLength;
    produced += slice.byteLength;
    if (produced > encoded.decodedSizeBytes) {
      throw new Error('Распакованная база превышает размер из каталога.');
    }
    const hashStartedAt = performance.now();
    hash.update(slice);
    if (options.stats) options.stats.hashMs += performance.now() - hashStartedAt;
    return slice;
  };
}

/** True when every frame declares a size within the per-frame cap, so memory stays bounded. */
export function canStreamEncodedIndex(bytes: Uint8Array): boolean {
  try {
    const frames = listZstdFrames(bytes);
    return (
      frames.length > 0 &&
      frames.every(
        (frame) =>
          frame.contentBytes !== null &&
          frame.contentBytes <= ZSTD_FRAME_CONTENT_BYTES &&
          (zstdWindowBytes(bytes.subarray(frame.start, frame.end)) ?? 0) <= MAX_ZSTD_WINDOW_BYTES,
      )
    );
  } catch {
    return false;
  }
}
