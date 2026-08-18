const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\u0000');

export function hasSqliteHeaderPrefix(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= SQLITE_HEADER.byteLength &&
    SQLITE_HEADER.every((byte, index) => bytes[index] === byte)
  );
}

export function createStreamChunkImporter(
  stream: ReadableStream<Uint8Array>,
): () => Promise<Uint8Array | undefined> {
  const reader = stream.getReader();
  let finished = false;
  let checkedHeader = false;
  return async () => {
    if (finished) return undefined;
    const next = await reader.read();
    if (next.done || !next.value) {
      finished = true;
      reader.releaseLock();
      return undefined;
    }
    if (!checkedHeader) {
      checkedHeader = true;
      if (!hasSqliteHeaderPrefix(next.value)) {
        finished = true;
        reader.releaseLock();
        throw new Error('OPFS pack is not a SQLite database.');
      }
    }
    return next.value;
  };
}

export function opfsVfsFileName(databaseName: string, byteLength: number | null): string {
  if (byteLength === null) return `/${databaseName}`;
  return `/${databaseName}.${byteLength}`;
}

export function sahPoolContextName(): string {
  return typeof (globalThis as { importScripts?: unknown }).importScripts === 'function'
    ? 'minimed-sah-worker'
    : 'minimed-sah-main';
}

export function parseContentSchemaVersion(value: unknown): number {
  if (typeof value === 'bigint' && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error(`Content pack schema_version is invalid: ${String(value)}.`);
}

export function hasOpfsSahPoolApis(): boolean {
  const fileHandlePrototype = globalThis.FileSystemFileHandle?.prototype as
    | { createSyncAccessHandle?: unknown }
    | undefined;
  return Boolean(
    globalThis.FileSystemHandle &&
      globalThis.FileSystemDirectoryHandle &&
      globalThis.FileSystemFileHandle &&
      fileHandlePrototype?.createSyncAccessHandle &&
      navigator.storage?.getDirectory,
  );
}
