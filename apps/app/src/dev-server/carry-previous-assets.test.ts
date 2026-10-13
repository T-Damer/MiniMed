import { describe, expect, it, vi } from 'vitest';

import {
  CARRIED_MAX_FILE_BYTES,
  CARRIED_MAX_TOTAL_BYTES,
  carryAssets,
  parsePreviousBuildManifest,
  selectCarriedAssets,
} from './carry-previous-assets';

describe('reading the previous build manifest', () => {
  it('accepts a manifest with a list of paths and nothing else', () => {
    expect(parsePreviousBuildManifest({ id: 'a', precache: ['index.html'] })).toEqual({
      precache: ['index.html'],
    });
    expect(parsePreviousBuildManifest(null)).toBeNull();
    expect(parsePreviousBuildManifest({})).toBeNull();
    expect(parsePreviousBuildManifest({ precache: ['a', 3] })).toBeNull();
    expect(parsePreviousBuildManifest('<html>')).toBeNull();
  });
});

describe('which files of the previous build are carried', () => {
  const previous = {
    precache: [
      'index.html',
      'sw.js',
      'assets/main-OLD.js',
      'assets/CalculatorsView-OLD.js',
      'assets/shared-S1.js',
      'assets/theme-OLD.css',
      'assets/KaTeX-OLD.woff2',
      'assets/sqlite3-OLD.wasm',
      'assets/../../content/core.db',
      'assets/nested/x.js',
      'fonts/CascadiaCode-Regular.woff2',
    ],
  };

  it('takes the dropped scripts, styles and fonts only', () => {
    expect(selectCarriedAssets(previous, (path) => path === 'assets/shared-S1.js')).toEqual([
      'assets/main-OLD.js',
      'assets/CalculatorsView-OLD.js',
      'assets/theme-OLD.css',
      'assets/KaTeX-OLD.woff2',
    ]);
  });

  it('carries nothing when the new build kept every file', () => {
    expect(selectCarriedAssets(previous, () => true)).toEqual([]);
  });
});

describe('carrying files', () => {
  const body = (bytes: number) => new Uint8Array(bytes);

  it('writes what it downloaded and skips what failed', async () => {
    const written: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await carryAssets(
      ['assets/a.js', 'assets/b.js', 'assets/c.js'],
      async (path) => {
        if (path === 'assets/b.js') return null;
        if (path === 'assets/c.js') throw new Error('network');
        return body(10);
      },
      async (path) => void written.push(path),
    );
    expect(written).toEqual(['assets/a.js']);
    expect(result).toEqual({
      carried: ['assets/a.js'],
      skipped: ['assets/b.js', 'assets/c.js'],
      bytes: 10,
    });
    warn.mockRestore();
  });

  it('respects the per-file and the total size caps', async () => {
    const huge = await carryAssets(
      ['assets/huge.js'],
      async () => body(CARRIED_MAX_FILE_BYTES + 1),
      async () => undefined,
    );
    expect(huge.skipped).toEqual(['assets/huge.js']);

    const many = await carryAssets(
      ['assets/1.js', 'assets/2.js', 'assets/3.js'],
      async () => body(CARRIED_MAX_FILE_BYTES),
      async () => undefined,
      1,
    );
    expect(many.bytes).toBeLessThanOrEqual(CARRIED_MAX_TOTAL_BYTES);
    expect(many.carried.length + many.skipped.length).toBe(3);
  });
});
