import { describe, expect, it } from 'vitest';

import { createObjectUrlCache } from '@/features/skin/object-url-cache';

describe('object URL cache', () => {
  it('creates one URL per key and revokes them all', () => {
    const created: string[] = [];
    const released: string[] = [];
    const cache = createObjectUrlCache(
      () => {
        const url = `blob:${created.length}`;
        created.push(url);
        return url;
      },
      (url) => released.push(url),
    );
    const blob = new Blob(['x']);
    expect(cache.get('a', blob)).toBe(cache.get('a', blob));
    cache.get('b', blob);
    expect(created).toHaveLength(2);
    cache.revoke('a');
    expect(released).toEqual(['blob:0']);
    cache.revokeAll();
    expect(released).toEqual(['blob:0', 'blob:1']);
    expect(cache.get('a', blob)).toBe('blob:2');
  });
});
