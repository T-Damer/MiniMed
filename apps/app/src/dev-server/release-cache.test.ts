import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAllowedReleaseUrl,
  isReleaseCacheCurrent,
  resolveReleaseCacheTarget,
} from './release-cache';

const root = resolve('/tmp/minimed-release-cache');

describe('dev release cache', () => {
  it('maps a release asset inside the cache root', () => {
    expect(
      resolveReleaseCacheTarget(
        root,
        '/content/releases/models-preview-1/minimed-ecg-open-digitizer-2026.1-q8.zip?x=1',
      ),
    ).toEqual({
      tag: 'models-preview-1',
      fileName: 'minimed-ecg-open-digitizer-2026.1-q8.zip',
      path: join(root, 'models-preview-1', 'minimed-ecg-open-digitizer-2026.1-q8.zip'),
    });
  });

  it.each([
    '/content/releases/../secret/file.zip',
    '/content/releases/models/../../etc',
    '/content/releases/%2e%2e/file.zip',
    '/content/releases/models/%2e%2e%2fpasswd',
    '/content/releases/models/..%5c..%5cfile',
    '/content/releases/models/sub/file.zip',
    '/content/releases/.hidden/file.zip',
    '/content/releases/models/a..b.zip',
    '/content/releases//etc/passwd',
    '/content/releases/models/%E0%A4%A',
    '/other/models/file.zip',
  ])('rejects %s', (path) => {
    expect(resolveReleaseCacheTarget(root, path)).toBeUndefined();
  });

  it('carries only a well-formed catalog digest', () => {
    const sha256 = 'a'.repeat(64);
    expect(
      resolveReleaseCacheTarget(root, `/content/releases/models/pack.zip?sha256=${sha256}`)?.sha256,
    ).toBe(sha256);
    expect(
      resolveReleaseCacheTarget(root, '/content/releases/models/pack.zip?sha256=../../x'),
    ).toBeUndefined();
  });

  it('treats a cached copy with another digest as stale', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'minimed-release-cache-'));
    try {
      const path = join(directory, 'pack.zip');
      writeFileSync(path, 'old release');
      const current = createHash('sha256').update('old release').digest('hex');
      const base = { tag: 'models', fileName: 'pack.zip', path };
      await expect(isReleaseCacheCurrent({ ...base, sha256: current })).resolves.toBe(true);
      await expect(isReleaseCacheCurrent({ ...base, sha256: 'b'.repeat(64) })).resolves.toBe(false);
      await expect(isReleaseCacheCurrent(base)).resolves.toBe(true);
      await expect(
        isReleaseCacheCurrent({ ...base, path: join(directory, 'missing.zip') }),
      ).resolves.toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('follows redirects only to GitHub release hosts over HTTPS', () => {
    expect(isAllowedReleaseUrl(new URL('https://objects.githubusercontent.com/x'))).toBe(true);
    expect(isAllowedReleaseUrl(new URL('https://release-assets.githubusercontent.com/x'))).toBe(
      true,
    );
    expect(isAllowedReleaseUrl(new URL('http://github.com/x'))).toBe(false);
    expect(isAllowedReleaseUrl(new URL('https://example.com/x'))).toBe(false);
  });
});
