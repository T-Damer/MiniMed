import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { moduleIndexBlob } from './module-index-payload';
import { decodeZstdIndex } from './zstd-index-decode';

async function decodeGzipIndex(
  bytes: Uint8Array,
  decodedSizeBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const output = new Uint8Array(decodedSizeBytes);
  let offset = 0;
  await moduleIndexBlob(bytes)
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

type ZstdWorkerResponse =
  | { readonly buffer: ArrayBuffer; readonly byteOffset: number; readonly byteLength: number }
  | { readonly error: string };

/** fzstd decodes in one synchronous pass (≈1 s per 300 MB on a laptop), so it runs off the UI thread. */
function decodeZstdInWorker(
  bytes: Uint8Array,
  decodedSizeBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(decodeZstdIndex(bytes, decodedSizeBytes));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./zstd-index.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (): void => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = (): void => {
      finish();
      reject(signal.reason ?? new DOMException('Installation cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ZstdWorkerResponse>) => {
      finish();
      const response = event.data;
      if ('error' in response) {
        reject(new Error(response.error));
        return;
      }
      resolve(new Uint8Array(response.buffer, response.byteOffset, response.byteLength));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Не удалось распаковать базу.'));
    };
    worker.postMessage({ bytes, expectedBytes: decodedSizeBytes });
  });
}

/** The installer verifies the archive first and the decoded identity before activation. */
export async function decodeModuleIndex(
  artifact: ContentModuleCatalogEntry['artifacts'][number],
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (
    (artifact.compression !== 'gzip' && artifact.compression !== 'zstd') ||
    !artifact.decodedSizeBytes
  ) {
    throw new Error('Для сжатой базы не указан поддерживаемый формат или размер распаковки.');
  }
  signal.throwIfAborted();
  return artifact.compression === 'gzip'
    ? decodeGzipIndex(bytes, artifact.decodedSizeBytes, signal)
    : decodeZstdInWorker(bytes, artifact.decodedSizeBytes, signal);
}
