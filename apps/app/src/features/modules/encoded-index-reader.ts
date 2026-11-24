import { Decompress, decompress } from 'fzstd';
import { Sha256Stream } from './sha256-stream';
import { listZstdFrames, ZSTD_FRAME_CONTENT_BYTES, type ZstdFrame } from './zstd-frames';
import { MAX_ZSTD_WINDOW_BYTES, zstdWindowBytes } from './zstd-index-decode';

/** A module index as it travels: a compressed archive plus the identity of the SQLite it decodes to. */
export interface EncodedModuleIndex {
  readonly bytes: Uint8Array;
  readonly compression?: 'zstd' | 'gzip';
  readonly decodedSizeBytes: number;
  readonly decodedSha256: string;
}

/** Size of one write handed to the OPFS pool; also the progress granularity of an import. */
const OUTPUT_SLICE_BYTES = 4 * 1024 * 1024;
/** Input slice size when streaming a single-frame (>64 MiB) zstd archive through fzstd.Decompress. */
const ZSTD_STREAM_INPUT_BYTES = 256 * 1024;

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

function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function createGzipDecodedReader(
  encoded: EncodedModuleIndex,
  options: DecodedIndexReaderOptions,
): () => Promise<Uint8Array | undefined> {
  if (!hasGzipMagic(encoded.bytes)) throw new Error('Файл базы не похож на архив gzip.');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Потоковая распаковка gzip не поддерживается в этом браузере.');
  }
  const hash = new Sha256Stream();
  const bytesCopy = new Uint8Array(encoded.bytes.byteLength);
  bytesCopy.set(encoded.bytes);
  const stream = new Blob([bytesCopy]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let produced = 0;
  let streamDone = false;
  let finished = false;

  const takeSlice = (): Uint8Array => {
    if (pending.length === 1 && (pending[0]?.byteLength ?? 0) <= OUTPUT_SLICE_BYTES) {
      const only = pending.shift() as Uint8Array;
      pendingBytes = 0;
      return only;
    }
    const size = Math.min(OUTPUT_SLICE_BYTES, pendingBytes);
    const out = new Uint8Array(size);
    let cursor = 0;
    while (cursor < size && pending.length > 0) {
      const head = pending[0] as Uint8Array;
      const take = Math.min(head.byteLength, size - cursor);
      out.set(head.subarray(0, take), cursor);
      cursor += take;
      pendingBytes -= take;
      if (take === head.byteLength) pending.shift();
      else pending[0] = head.subarray(take);
    }
    return out;
  };

  return async () => {
    if (finished) return undefined;
    options.signal?.throwIfAborted();
    while (pendingBytes < OUTPUT_SLICE_BYTES && !streamDone) {
      const decodeStartedAt = performance.now();
      const result = await reader.read();
      if (options.stats) options.stats.decodeMs += performance.now() - decodeStartedAt;
      options.signal?.throwIfAborted();
      if (result.done) {
        streamDone = true;
        break;
      }
      if (result.value && result.value.byteLength > 0) {
        pending.push(result.value);
        pendingBytes += result.value.byteLength;
      }
    }
    if (pendingBytes === 0) {
      finished = true;
      if (produced !== encoded.decodedSizeBytes) {
        throw new Error('Распакованная база имеет неверный размер.');
      }
      if (`sha256:${hash.digestHex()}` !== encoded.decodedSha256) {
        throw new Error('Контрольная сумма распакованной базы не совпала.');
      }
      return undefined;
    }
    const slice = takeSlice();
    produced += slice.byteLength;
    if (produced > encoded.decodedSizeBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Распакованная база превышает размер из каталога.');
    }
    const hashStartedAt = performance.now();
    hash.update(slice);
    if (options.stats) options.stats.hashMs += performance.now() - hashStartedAt;
    return slice;
  };
}

/**
 * Streams a single large zstd frame (>64 MiB decoded, <=64 MiB window) in bounded chunks using
 * fzstd's streaming Decompress so a 200-630 MB legacy single-frame module never allocates its full
 * decoded size in WebView memory.
 */
interface LargeFrameStreamer {
  readonly frame: ZstdFrame;
  readonly archive: Uint8Array;
  readonly decoder: Decompress;
  readonly queue: Uint8Array[];
  inputOffset: number;
  produced: number;
  done: boolean;
}

function createLargeFrameStreamer(frame: ZstdFrame, archive: Uint8Array): LargeFrameStreamer {
  const queue: Uint8Array[] = [];
  const decoder = new Decompress((chunk) => {
    if (chunk.byteLength > 0) {
      // fzstd reuses its internal sliding window buffer between callbacks; copy the emitted slice.
      queue.push(chunk.slice());
    }
  });
  return { frame, archive, decoder, queue, inputOffset: 0, produced: 0, done: false };
}

/**
 * Streams the decoded SQLite of a compressed index in slices, keeping memory bounded (≤ 64 MiB
 * frame/window + 4 MiB output slice). The SHA-256 and byte count of everything produced are
 * verified when the last slice has been requested: the reader then throws instead of reporting the
 * end of the stream, so a consumer that commits only on a clean end never publishes unverified bytes.
 */
export function createDecodedIndexReader(
  encoded: EncodedModuleIndex,
  options: DecodedIndexReaderOptions = {},
): () => Promise<Uint8Array | undefined> {
  if (encoded.compression === 'gzip') {
    return createGzipDecodedReader(encoded, options);
  }
  const frames = listZstdFrames(encoded.bytes);
  if (frames.length === 0) throw new Error('Файл базы не похож на архив zstd.');
  const hash = new Sha256Stream();
  const pause = options.yieldToEventLoop ?? defaultYield;
  let frameIndex = 0;
  let current: Uint8Array | null = null;
  let streamer: LargeFrameStreamer | null = null;
  let offset = 0;
  let produced = 0;
  let finished = false;

  const openNextFrame = (): boolean => {
    const frame = frames[frameIndex];
    if (!frame) return false;
    frameIndex += 1;
    const archive = encoded.bytes.subarray(frame.start, frame.end);
    if (frame.contentBytes === null) {
      throw new Error('Архив zstd без объявленного размера нельзя распаковывать потоком.');
    }
    const window = zstdWindowBytes(archive);
    if (window !== null && window > MAX_ZSTD_WINDOW_BYTES) {
      throw new Error('Архив базы собран со слишком большим окном zstd.');
    }
    if (frame.contentBytes > ZSTD_FRAME_CONTENT_BYTES) {
      // Single-segment frames larger than 64 MiB have an effective window equal to their content.
      if (window === null) {
        throw new Error('Кадр архива zstd превышает допустимый размер.');
      }
      streamer = createLargeFrameStreamer(frame, archive);
      current = null;
      offset = 0;
      return true;
    }
    const decodeStartedAt = performance.now();
    const decoded = decompress(archive);
    if (options.stats) options.stats.decodeMs += performance.now() - decodeStartedAt;
    if (decoded.byteLength !== frame.contentBytes) {
      throw new Error('Распакованная база имеет неверный размер.');
    }
    current = decoded;
    streamer = null;
    offset = 0;
    return true;
  };

  const nextLargeSlice = async (): Promise<Uint8Array | null> => {
    if (!streamer) return null;
    while (streamer.queue.length === 0 && !streamer.done) {
      options.signal?.throwIfAborted();
      const start = streamer.inputOffset;
      const end = Math.min(start + ZSTD_STREAM_INPUT_BYTES, streamer.archive.byteLength);
      const isFinal = end >= streamer.archive.byteLength;
      streamer.inputOffset = end;
      const decodeStartedAt = performance.now();
      streamer.decoder.push(streamer.archive.subarray(start, end), isFinal);
      if (options.stats) options.stats.decodeMs += performance.now() - decodeStartedAt;
      if (isFinal) streamer.done = true;
      if (streamer.queue.length === 0 && !streamer.done) await pause();
    }
    if (streamer.queue.length === 0) {
      if (streamer.produced !== streamer.frame.contentBytes) {
        throw new Error('Распакованная база имеет неверный размер.');
      }
      streamer = null;
      return null;
    }
    // Coalesce queued chunks up to OUTPUT_SLICE_BYTES so OPFS writes stay large and steady.
    const batch: Uint8Array[] = [];
    let batchBytes = 0;
    while (streamer.queue.length > 0 && batchBytes < OUTPUT_SLICE_BYTES) {
      const head = streamer.queue[0] as Uint8Array;
      const room = OUTPUT_SLICE_BYTES - batchBytes;
      if (head.byteLength <= room) {
        batch.push(streamer.queue.shift() as Uint8Array);
        batchBytes += head.byteLength;
      } else {
        batch.push(head.subarray(0, room));
        streamer.queue[0] = head.subarray(room);
        batchBytes += room;
      }
    }
    streamer.produced += batchBytes;
    if (batch.length === 1) return batch[0] as Uint8Array;
    const merged = new Uint8Array(batchBytes);
    let cursor = 0;
    for (const part of batch) {
      merged.set(part, cursor);
      cursor += part.byteLength;
    }
    return merged;
  };

  return async () => {
    if (finished) return undefined;
    options.signal?.throwIfAborted();
    for (;;) {
      if (streamer) {
        const slice = await nextLargeSlice();
        if (slice !== null) {
          produced += slice.byteLength;
          if (produced > encoded.decodedSizeBytes) {
            throw new Error('Распакованная база превышает размер из каталога.');
          }
          const hashStartedAt = performance.now();
          hash.update(slice);
          if (options.stats) options.stats.hashMs += performance.now() - hashStartedAt;
          await pause();
          return slice;
        }
        await pause();
        continue;
      }
      if (current !== null && offset < current.byteLength) {
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
      }
      if (current !== null) await pause();
      options.signal?.throwIfAborted();
      if (!openNextFrame()) {
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
  };
}

/** True when every frame (or gzip stream) can be decoded into OPFS with bounded memory. */
export function canStreamEncodedIndex(
  bytes: Uint8Array,
  compression: 'zstd' | 'gzip' = 'zstd',
): boolean {
  if (compression === 'gzip') {
    return typeof DecompressionStream === 'function' && hasGzipMagic(bytes);
  }
  try {
    const frames = listZstdFrames(bytes);
    return (
      frames.length > 0 &&
      frames.every((frame) => {
        if (frame.contentBytes === null) return false;
        const archive = bytes.subarray(frame.start, frame.end);
        const window = zstdWindowBytes(archive);
        if (window !== null && window > MAX_ZSTD_WINDOW_BYTES) return false;
        return frame.contentBytes <= ZSTD_FRAME_CONTENT_BYTES || window !== null;
      })
    );
  } catch {
    return false;
  }
}
