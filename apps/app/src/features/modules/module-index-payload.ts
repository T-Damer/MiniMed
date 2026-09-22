/** Existing IndexedDB rows contain ArrayBuffer; new rows can retain an immutable Blob. */
export type ModuleIndexPayload = Blob | ArrayBuffer | Uint8Array;

export function moduleIndexSize(payload: ModuleIndexPayload): number {
  return payload instanceof Blob ? payload.size : payload.byteLength;
}

/** Preserve view offsets. Only shared-memory inputs need an explicit ordinary-buffer copy. */
export function moduleIndexView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
}

/** Blob construction snapshots the selected bytes; do not pre-copy the entire backing buffer. */
export function moduleIndexBlob(payload: ModuleIndexPayload): Blob {
  if (payload instanceof Blob) return payload;
  return new Blob(
    [payload instanceof ArrayBuffer ? payload : moduleIndexView(payload)],
    { type: 'application/vnd.sqlite3' },
  );
}

/** Only consumers explicitly requesting bytes (or small in-memory SQLite) materialize a Blob. */
export async function moduleIndexBytes(payload: ModuleIndexPayload): Promise<Uint8Array> {
  if (payload instanceof Blob) return new Uint8Array(await payload.arrayBuffer());
  return payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
}
