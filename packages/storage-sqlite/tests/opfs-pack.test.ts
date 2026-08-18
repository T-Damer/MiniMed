import { describe, expect, it } from 'vitest';

import {
  createStreamChunkImporter,
  hasOpfsSahPoolApis,
  hasSqliteHeaderPrefix,
  opfsVfsFileName,
  parseContentSchemaVersion,
} from '../src/opfs-pack';

describe('OPFS pack helpers', () => {
  it('parses content-pack schema versions and rejects missing values', () => {
    expect(parseContentSchemaVersion(2)).toBe(2);
    expect(parseContentSchemaVersion('2')).toBe(2);
    expect(parseContentSchemaVersion(2n)).toBe(2);
    expect(() => parseContentSchemaVersion(undefined)).toThrow('schema_version is invalid');
    expect(() => parseContentSchemaVersion(Number.NaN)).toThrow('schema_version is invalid');
    expect(() => parseContentSchemaVersion(0)).toThrow('schema_version is invalid');
  });

  it('accepts a SQLite header prefix and rejects HTML', () => {
    expect(hasSqliteHeaderPrefix(new TextEncoder().encode('SQLite format 3\u0000more'))).toBe(true);
    expect(hasSqliteHeaderPrefix(new TextEncoder().encode('<!doctype html>'))).toBe(false);
  });

  it('names the VFS file after the packaged size so a rebuilt pack is re-imported', () => {
    expect(opfsVfsFileName('medications.db', 421_000_000)).toBe('/medications.db.421000000');
    expect(opfsVfsFileName('medications.db', null)).toBe('/medications.db');
  });

  it('feeds stream chunks to the sqlite-wasm importDb callback until EOF', async () => {
    const first = new Uint8Array([...new TextEncoder().encode('SQLite format 3\u0000'), 1, 2]);
    const second = new Uint8Array([3, 4]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const next = createStreamChunkImporter(stream);
    expect(await next()).toEqual(first);
    expect(await next()).toEqual(second);
    expect(await next()).toBeUndefined();
    expect(await next()).toBeUndefined();
  });

  it('rejects a non-SQLite first chunk before more data is read', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<!doctype html>'));
        controller.close();
      },
    });
    const next = createStreamChunkImporter(stream);
    await expect(next()).rejects.toThrow('OPFS pack is not a SQLite database.');
  });

  it('reports missing OPFS SAH APIs when createSyncAccessHandle is unavailable', () => {
    const originalHandle = globalThis.FileSystemFileHandle;
    Object.defineProperty(globalThis, 'FileSystemFileHandle', {
      configurable: true,
      value: class FileSystemFileHandle {},
    });
    try {
      expect(hasOpfsSahPoolApis()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'FileSystemFileHandle', {
        configurable: true,
        value: originalHandle,
      });
    }
  });

  it('reports OPFS SAH APIs when the required handles and storage directory are available', () => {
    const originalHandle = globalThis.FileSystemHandle;
    const originalDirectoryHandle = globalThis.FileSystemDirectoryHandle;
    const originalFileHandle = globalThis.FileSystemFileHandle;
    const originalStorage = navigator.storage;
    Object.defineProperty(globalThis, 'FileSystemHandle', {
      configurable: true,
      value: class FileSystemHandle {},
    });
    Object.defineProperty(globalThis, 'FileSystemDirectoryHandle', {
      configurable: true,
      value: class FileSystemDirectoryHandle {},
    });
    Object.defineProperty(globalThis, 'FileSystemFileHandle', {
      configurable: true,
      value: class FileSystemFileHandle {
        createSyncAccessHandle(): Promise<unknown> {
          return Promise.resolve({});
        }
      },
    });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async () => ({}),
      },
    });
    try {
      expect(hasOpfsSahPoolApis()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'FileSystemHandle', {
        configurable: true,
        value: originalHandle,
      });
      Object.defineProperty(globalThis, 'FileSystemDirectoryHandle', {
        configurable: true,
        value: originalDirectoryHandle,
      });
      Object.defineProperty(globalThis, 'FileSystemFileHandle', {
        configurable: true,
        value: originalFileHandle,
      });
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
