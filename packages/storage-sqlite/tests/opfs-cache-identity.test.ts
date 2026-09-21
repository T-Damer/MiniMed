import { describe, expect, it } from 'vitest';
import { resolveOpfsCacheFile } from '../src/opfs-cache-identity';

const name = `core.${'a'.repeat(64)}.db`;
describe('offline core cache identity', () => {
  it('recovers the size-suffixed file only for the exact checksum-qualified name', () => {
    expect(resolveOpfsCacheFile(name, null, [`/${name}.4096`])).toBe(`/${name}.4096`);
  });
  it('preserves the direct already-installed name', () => {
    expect(resolveOpfsCacheFile(name, null, [`/${name}`, `/${name}.4096`])).toBe(`/${name}`);
  });
  it('respects a known remote size instead of substituting a cached size', () => {
    expect(resolveOpfsCacheFile(name, 8192, [`/${name}.4096`])).toBe(`/${name}.8192`);
  });
  it('does not reuse a different checksum or shared prefix', () => {
    expect(resolveOpfsCacheFile(name, null, [`/core.${'b'.repeat(64)}.db.4096`, `/${name}.extra.4096`])).toBe(`/${name}`);
  });
  it.each(['core.db', 'reference.db', 'core.abc.db'])('does not recover an unqualified name %s', (unversioned) => {
    expect(resolveOpfsCacheFile(unversioned, null, [`/${unversioned}.4096`])).toBe(`/${unversioned}`);
  });
  it('rejects ambiguous installed variants rather than choosing the first', () => {
    expect(() => resolveOpfsCacheFile(name, null, [`/${name}.4096`, `/${name}.8192`])).toThrow('Ambiguous');
  });
  it('ignores invalid lengths and absent files', () => {
    expect(resolveOpfsCacheFile(name, null, [`/${name}.0`, `/${name}.4.5`, `/${name}.9007199254740992`])).toBe(`/${name}`);
    expect(resolveOpfsCacheFile(name, null, [])).toBe(`/${name}`);
  });
});
