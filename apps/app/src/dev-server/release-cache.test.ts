import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedReleaseUrl, resolveReleaseCacheTarget } from './release-cache';

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

  it('follows redirects only to GitHub release hosts over HTTPS', () => {
    expect(isAllowedReleaseUrl(new URL('https://objects.githubusercontent.com/x'))).toBe(true);
    expect(isAllowedReleaseUrl(new URL('https://release-assets.githubusercontent.com/x'))).toBe(
      true,
    );
    expect(isAllowedReleaseUrl(new URL('http://github.com/x'))).toBe(false);
    expect(isAllowedReleaseUrl(new URL('https://example.com/x'))).toBe(false);
  });
});
