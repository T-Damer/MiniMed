import { describe, expect, it, vi } from 'vitest';
import { RetainedNodeCache } from '@/components/retained-node-cache';

function createCache() {
  const tasks: (() => void)[] = [];
  const disposed: string[] = [];
  const create = vi.fn((key: string) => ({
    value: { key },
    dispose: () => disposed.push(key),
  }));
  const cache = new RetainedNodeCache(create, (task) => tasks.push(task));
  const flush = (): void => {
    for (const task of tasks.splice(0)) task();
  };
  return { cache, create, disposed, flush };
}

describe('RetainedNodeCache', () => {
  it('returns the same value while a key moves from one place to another', () => {
    const { cache, create, disposed, flush } = createCache();
    const first = cache.acquire('a');
    cache.release('a');
    const moved = cache.acquire('a');
    flush();
    expect(moved).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(disposed).toEqual([]);
  });

  it('disposes a key no place shows any more', () => {
    const { cache, disposed, flush } = createCache();
    cache.acquire('a');
    cache.acquire('b');
    cache.release('a');
    flush();
    expect(disposed).toEqual(['a']);
    expect(cache.size).toBe(1);
  });

  it('creates a fresh value after the old one was evicted', () => {
    const { cache, flush } = createCache();
    const first = cache.acquire('a');
    cache.release('a');
    flush();
    expect(cache.acquire('a')).not.toBe(first);
  });

  it('disposes everything on clear', () => {
    const { cache, disposed } = createCache();
    cache.acquire('a');
    cache.acquire('b');
    cache.clear();
    expect(disposed.toSorted()).toEqual(['a', 'b']);
    expect(cache.size).toBe(0);
  });
});
