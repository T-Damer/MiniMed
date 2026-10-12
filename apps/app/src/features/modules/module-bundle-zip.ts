/**
 * A minimal reader for the STORED ZIP of a personal-use module bundle. It reads the central
 * directory with a few small slices and an entry with one slice of the file, so a 100 MB bundle is
 * never held whole: only the artifact being installed is in memory.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const CENTRAL_FIXED_BYTES = 46;
const LOCAL_FIXED_BYTES = 30;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const STORED_METHOD = 0;
const ENCRYPTED_FLAG = 0x1;
const SENTINEL_16 = 0xffff;
const SENTINEL_32 = 0xffffffff;

export type ZipFailure =
  | 'not-a-zip'
  | 'unsupported-zip64'
  | 'encrypted'
  | 'compressed'
  | 'corrupt'
  | 'entry-missing';

export class ZipReadError extends Error {
  public constructor(
    public readonly failure: ZipFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ZipReadError';
  }
}

export interface ZipEntryInfo {
  readonly name: string;
  readonly size: number;
  readonly localHeaderOffset: number;
}

async function readRange(blob: Blob, start: number, end: number): Promise<DataView> {
  const buffer = await blob.slice(start, end).arrayBuffer();
  if (buffer.byteLength !== end - start) {
    throw new ZipReadError('corrupt', 'Архив обрезан.');
  }
  return new DataView(buffer);
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - EOCD_MIN_BYTES; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipReadError('not-a-zip', 'Это не ZIP-архив.');
}

export class BlobZipReader {
  private constructor(
    private readonly blob: Blob,
    private readonly entries: ReadonlyMap<string, ZipEntryInfo>,
  ) {}

  public static async open(blob: Blob): Promise<BlobZipReader> {
    if (blob.size < EOCD_MIN_BYTES) throw new ZipReadError('not-a-zip', 'Это не ZIP-архив.');
    const tailStart = Math.max(0, blob.size - EOCD_MIN_BYTES - MAX_COMMENT_BYTES);
    const tail = await readRange(blob, tailStart, blob.size);
    const eocd = findEndOfCentralDirectory(tail);
    const entryCount = tail.getUint16(eocd + 10, true);
    const directorySize = tail.getUint32(eocd + 12, true);
    const directoryOffset = tail.getUint32(eocd + 16, true);
    if (
      entryCount === SENTINEL_16 ||
      directorySize === SENTINEL_32 ||
      directoryOffset === SENTINEL_32
    ) {
      throw new ZipReadError('unsupported-zip64', 'ZIP64 не поддерживается.');
    }
    if (
      directorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
      directoryOffset + directorySize > blob.size
    ) {
      throw new ZipReadError('corrupt', 'Оглавление архива повреждено.');
    }
    const directory = await readRange(blob, directoryOffset, directoryOffset + directorySize);
    const decoder = new TextDecoder('utf-8');
    const entries = new Map<string, ZipEntryInfo>();
    let cursor = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (
        cursor + CENTRAL_FIXED_BYTES > directory.byteLength ||
        directory.getUint32(cursor, true) !== CENTRAL_SIGNATURE
      ) {
        throw new ZipReadError('corrupt', 'Оглавление архива повреждено.');
      }
      const flags = directory.getUint16(cursor + 8, true);
      const method = directory.getUint16(cursor + 10, true);
      const compressedSize = directory.getUint32(cursor + 20, true);
      const size = directory.getUint32(cursor + 24, true);
      const nameLength = directory.getUint16(cursor + 28, true);
      const extraLength = directory.getUint16(cursor + 30, true);
      const commentLength = directory.getUint16(cursor + 32, true);
      const localHeaderOffset = directory.getUint32(cursor + 42, true);
      const next = cursor + CENTRAL_FIXED_BYTES + nameLength + extraLength + commentLength;
      if (next > directory.byteLength) {
        throw new ZipReadError('corrupt', 'Оглавление архива повреждено.');
      }
      if (
        compressedSize === SENTINEL_32 ||
        size === SENTINEL_32 ||
        localHeaderOffset === SENTINEL_32
      ) {
        throw new ZipReadError('unsupported-zip64', 'ZIP64 не поддерживается.');
      }
      const name = decoder.decode(
        new Uint8Array(
          directory.buffer,
          directory.byteOffset + cursor + CENTRAL_FIXED_BYTES,
          nameLength,
        ),
      );
      cursor = next;
      if (name.endsWith('/')) continue;
      if (flags & ENCRYPTED_FLAG) throw new ZipReadError('encrypted', 'Архив зашифрован.');
      if (method !== STORED_METHOD || compressedSize !== size) {
        throw new ZipReadError('compressed', 'Архив сжат: нужен ZIP без сжатия.');
      }
      if (entries.has(name)) throw new ZipReadError('corrupt', 'В архиве повторяются имена.');
      entries.set(name, { name, size, localHeaderOffset });
    }
    return new BlobZipReader(blob, entries);
  }

  public has(name: string): boolean {
    return this.entries.has(name);
  }

  public size(name: string): number | null {
    return this.entries.get(name)?.size ?? null;
  }

  /** Reads one entry with a single slice of the file. */
  public async read(name: string): Promise<Uint8Array> {
    const info = this.entries.get(name);
    if (!info) throw new ZipReadError('entry-missing', `В архиве нет файла ${name}.`);
    const header = await readRange(
      this.blob,
      info.localHeaderOffset,
      info.localHeaderOffset + LOCAL_FIXED_BYTES,
    );
    if (header.getUint32(0, true) !== LOCAL_SIGNATURE) {
      throw new ZipReadError('corrupt', 'Заголовок файла в архиве повреждён.');
    }
    const dataStart =
      info.localHeaderOffset +
      LOCAL_FIXED_BYTES +
      header.getUint16(26, true) +
      header.getUint16(28, true);
    if (dataStart + info.size > this.blob.size) {
      throw new ZipReadError('corrupt', 'Архив обрезан.');
    }
    const buffer = await this.blob.slice(dataStart, dataStart + info.size).arrayBuffer();
    if (buffer.byteLength !== info.size) throw new ZipReadError('corrupt', 'Архив обрезан.');
    return new Uint8Array(buffer);
  }
}
