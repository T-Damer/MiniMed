import { describe, expect, it } from 'vitest';
import { findInstalledPackFile, resolveOpfsCacheFile } from '../src/opfs-cache-identity';

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
    expect(
      resolveOpfsCacheFile(name, null, [`/core.${'b'.repeat(64)}.db.4096`, `/${name}.extra.4096`]),
    ).toBe(`/${name}`);
  });
  it.each(['core.db', 'reference.db', 'core.abc.db'])(
    'does not recover an unqualified name %s',
    (unversioned) => {
      expect(resolveOpfsCacheFile(unversioned, null, [`/${unversioned}.4096`])).toBe(
        `/${unversioned}`,
      );
    },
  );
  it('rejects ambiguous installed variants rather than choosing the first', () => {
    expect(() => resolveOpfsCacheFile(name, null, [`/${name}.4096`, `/${name}.8192`])).toThrow(
      'Ambiguous',
    );
  });
  it('ignores invalid lengths and absent files', () => {
    expect(
      resolveOpfsCacheFile(name, null, [`/${name}.0`, `/${name}.4.5`, `/${name}.9007199254740992`]),
    ).toBe(`/${name}`);
    expect(resolveOpfsCacheFile(name, null, [])).toBe(`/${name}`);
  });
});

describe('installed module index file', () => {
  const module = 'minimed-module-minimed.rls.packaging.ru%402026.9.28%3Asha256%3Aabc.db';
  it('finds the unsuffixed name that blob: URL imports have always used', () => {
    expect(findInstalledPackFile(module, 221_089_792, [`/${module}`])).toBe(`/${module}`);
  });
  it('also accepts a file stored with its size', () => {
    expect(findInstalledPackFile(module, 221_089_792, [`/${module}.221089792`])).toBe(
      `/${module}.221089792`,
    );
  });
  it('does not mistake another size or another module for the installed file', () => {
    expect(findInstalledPackFile(module, 221_089_792, [`/${module}.5`, '/other.db'])).toBeNull();
    expect(findInstalledPackFile(module, 1, [])).toBeNull();
  });
});
