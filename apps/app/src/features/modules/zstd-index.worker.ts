import { decodeZstdIndex } from './zstd-index-decode';

interface ZstdWorkerRequest {
  readonly bytes: Uint8Array;
  readonly expectedBytes: number;
}

type ZstdWorkerResponse =
  | { readonly buffer: ArrayBuffer; readonly byteOffset: number; readonly byteLength: number }
  | { readonly error: string };

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ZstdWorkerRequest>) => void) | null;
  postMessage: (message: ZstdWorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event) => {
  try {
    const decoded = decodeZstdIndex(event.data.bytes, event.data.expectedBytes);
    // The decoded bytes travel back without a copy; the view may start inside the buffer.
    workerScope.postMessage(
      {
        buffer: decoded.buffer as ArrayBuffer,
        byteOffset: decoded.byteOffset,
        byteLength: decoded.byteLength,
      },
      [decoded.buffer as ArrayBuffer],
    );
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : 'Не удалось распаковать базу.',
    });
  }
};
