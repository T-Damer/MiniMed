import { describe, expect, it, vi } from 'vitest';
import { moduleIndexBlob, moduleIndexBytes, moduleIndexSize, moduleIndexView } from './module-index-payload';

describe('module index payload', () => {
  it('reuses an ordinary byte view without copying its backing store', () => {
    const bytes = new Uint8Array([99, 1, 2, 3, 88]);
    const selected = bytes.subarray(1, 4);
    const view = moduleIndexView(selected);
    expect(view.buffer).toBe(bytes.buffer);
    expect(view.byteOffset).toBe(1);
    expect(view.byteLength).toBe(3);
    expect([...view]).toEqual([1, 2, 3]);
  });

  it('snapshots only selected bytes and remains immutable when the caller mutates them', async () => {
    const bytes = new Uint8Array([99, 1, 2, 3, 88]);
    const blob = moduleIndexBlob(bytes.subarray(1, 4));
    bytes.fill(0);
    expect(moduleIndexSize(blob)).toBe(3);
    expect(await moduleIndexBytes(blob)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('retains an existing Blob without reading or reconstructing it', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const spy = vi.spyOn(blob, 'arrayBuffer');
    expect(moduleIndexBlob(blob)).toBe(blob);
    expect(moduleIndexSize(blob)).toBe(3);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reads old ArrayBuffer records as an exact view and materializes blobs only on request', async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const bytes = await moduleIndexBytes(buffer);
    expect(bytes.buffer).toBe(buffer);
    expect(moduleIndexSize(buffer)).toBe(3);
    expect(await moduleIndexBytes(bytes)).toBe(bytes);
    const blob = moduleIndexBlob(buffer);
    expect(await moduleIndexBytes(blob)).toEqual(bytes);
  });

  it('copies shared-memory inputs into an ordinary buffer without widening the subrange', async () => {
    const shared = new Uint8Array(new SharedArrayBuffer(5));
    shared.set([99, 1, 2, 3, 88]);
    const selected = moduleIndexView(shared.subarray(1, 4));
    expect(selected.buffer).toBeInstanceOf(ArrayBuffer);
    expect(selected.buffer).not.toBe(shared.buffer);
    shared.fill(0);
    expect([...selected]).toEqual([1, 2, 3]);
    expect(await moduleIndexBytes(moduleIndexBlob(selected))).toEqual(selected);
  });
});
