const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;

interface ZipEntry {
  readonly path: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function readUint16(data: Uint8Array, offset: number): number {
  const low = data[offset] ?? 0;
  const high = data[offset + 1] ?? 0;
  return low | (high << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  const b0 = data[offset] ?? 0;
  const b1 = data[offset + 1] ?? 0;
  const b2 = data[offset + 2] ?? 0;
  const b3 = data[offset + 3] ?? 0;
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const minOffset = Math.max(0, data.length - 65557);
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(data, offset) === END_OF_CENTRAL_DIR_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('ZIP: не найден конец центрального каталога.');
}

function readCentralDirectory(data: Uint8Array): readonly ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(data);
  const centralDirSize = readUint32(data, eocdOffset + 12);
  const centralDirOffset = readUint32(data, eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;

  while (offset < end) {
    if (readUint32(data, offset) !== CENTRAL_DIR_SIGNATURE) break;
    const method = readUint16(data, offset + 10);
    const compressedSize = readUint32(data, offset + 20);
    const uncompressedSize = readUint32(data, offset + 24);
    const fileNameLength = readUint16(data, offset + 28);
    const extraFieldLength = readUint16(data, offset + 30);
    const commentLength = readUint16(data, offset + 32);
    const localHeaderOffset = readUint32(data, offset + 42);
    const pathBytes = data.slice(offset + 46, offset + 46 + fileNameLength);
    const path = new TextDecoder('utf-8').decode(pathBytes);
    entries.push({
      path,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const copy = Uint8Array.from(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function extractStoredEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
  const localOffset = entry.localHeaderOffset;
  if (readUint32(data, localOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`ZIP: повреждённый локальный заголовок для ${entry.path}.`);
  }
  const fileNameLength = readUint16(data, localOffset + 26);
  const extraFieldLength = readUint16(data, localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;
  return data.slice(dataOffset, dataOffset + entry.compressedSize);
}

async function extractEntry(data: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const raw = extractStoredEntry(data, entry);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return await inflateRaw(raw);
  throw new Error(`ZIP: метод сжатия ${entry.method} не поддерживается для ${entry.path}.`);
}

export async function readZipEntry(data: ArrayBuffer, path: string): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(data);
  const entries = readCentralDirectory(bytes);
  const normalizedPath = path.replace(/\\/gu, '/');
  const entry = entries.find((item) => item.path.replace(/\\/gu, '/') === normalizedPath);
  if (!entry) return null;
  return await extractEntry(bytes, entry);
}

export async function listZipEntries(data: ArrayBuffer): Promise<readonly string[]> {
  const bytes = new Uint8Array(data);
  const entries = readCentralDirectory(bytes);
  return entries.map((entry) => entry.path.replace(/\\/gu, '/'));
}
