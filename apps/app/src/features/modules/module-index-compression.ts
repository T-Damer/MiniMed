import type { ContentModuleCatalogEntry } from '@localmed/contracts';

/** The installer verifies the archive first and the decoded identity before activation. */
export async function decodeModuleIndex(
  artifact: ContentModuleCatalogEntry['artifacts'][number],
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (artifact.compression !== 'gzip' || !artifact.decodedSizeBytes) {
    throw new Error('Для сжатой базы не указан поддерживаемый формат или размер распаковки.');
  }
  signal.throwIfAborted();
  const output = new Uint8Array(artifact.decodedSizeBytes);
  let offset = 0;
  await new Blob([Uint8Array.from(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          if (chunk.byteLength > output.byteLength - offset) {
            throw new Error('Распакованная база превышает размер из каталога.');
          }
          output.set(chunk, offset);
          offset += chunk.byteLength;
        },
      }),
      { signal },
    );
  if (offset !== output.byteLength) throw new Error('Распакованная база имеет неверный размер.');
  return output;
}
