import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BOOT_CONTENT_FILES,
  BUILD_MANIFEST_FILE,
  classifyBuildFile,
  createServiceWorkerBuild,
  injectServiceWorkerBuild,
  PRECACHE_MAX_WASM_BYTES,
  SERVICE_WORKER_BUILD_PLACEHOLDER,
  writeServiceWorkerBuild,
} from './service-worker-precache';

const role = (path: string, bytes = 1_000) => classifyBuildFile({ path, bytes });

describe('what the service worker precaches', () => {
  it('stores the shell: page, scripts, styles, fonts, small wasm, icons', () => {
    for (const path of [
      'index.html',
      'manifest.webmanifest',
      'favicon.ico',
      'icon-192.png',
      'assets/main-Dz4ntm2U.js',
      'assets/theme-DjvbwmGU.css',
      'assets/KaTeX_Main-Regular-Bx.woff2',
      'assets/pdf.worker.min-CHFwMXne.mjs',
      'fonts/CascadiaCode-Regular.woff2',
      'onboarding/mri/slice-1.jpg',
    ]) {
      expect(role(path), path).toBe('precache');
    }
    // What the app fetches on every start to open its core (about 2.6 MB in all).
    for (const path of BOOT_CONTENT_FILES) expect(role(path, 1_572_864), path).toBe('precache');
    expect(role('assets/sqlite3-BVKGSWc-.wasm', 900_000)).toBe('precache');
    // The 10 MB module catalog is a script the UI needs, however large.
    expect(role('assets/module-catalog-CGbRNI31.js', 10_660_000)).toBe('precache');
  });

  it('leaves models and the ONNX runtime to their first use', () => {
    expect(role('assets/ort-wasm-simd-threaded.asyncify-CvvOzbbq.wasm', 24_000_000)).toBe(
      'optional',
    );
    expect(role('assets/tesseract-core-lstm.wasm-DhgzXyTR.js', 3_900_000)).toBe('optional');
    expect(role('assets/big-codec-Abc.wasm', PRECACHE_MAX_WASM_BYTES + 1)).toBe('optional');
    expect(role('assets/small-codec-Abc.wasm', PRECACHE_MAX_WASM_BYTES)).toBe('precache');
    expect(role('pdfjs/wasm/openjpeg.wasm')).toBe('optional');
    expect(role('cornerstone-codecs/openjphjs.wasm')).toBe('optional');
    expect(role('excalidraw/fonts/Xiaolai/Xiaolai-Regular-1.woff2')).toBe('optional');
  });

  it('never touches content packs, modules, OCR data, the diary or its own files', () => {
    for (const path of [
      'content/core.db',
      'content/mkb.db',
      'content/modules/minimed-tools-1.db',
      'content/releases/models-preview-1/model.zip',
      'tessdata/rus.traineddata',
      'diary/index.html',
      'diary/sw.js',
      'sw.js',
      BUILD_MANIFEST_FILE,
      '.DS_Store',
      'assets/.hidden',
      'unknown/dir/file.js',
    ]) {
      expect(role(path), path).toBe('skip');
    }
  });
});

describe('the build id', () => {
  const digests: Record<string, string> = {};
  const digestOf = (path: string): string => digests[path] ?? 'same';
  const files = [
    { path: 'index.html', bytes: 12_000 },
    { path: 'assets/main-A1.js', bytes: 5_000 },
    { path: 'assets/ort-wasm-X.wasm', bytes: 24_000_000 },
    { path: 'pdfjs/wasm/openjpeg.wasm', bytes: 100 },
    { path: 'pdfjs/cmaps/a.bcmap', bytes: 100 },
    { path: 'content/core.db', bytes: 440_000_000 },
  ];

  it('lists the precache and optional files in a stable order', () => {
    const build = createServiceWorkerBuild([...files].reverse(), '0.6.60', digestOf);
    expect(build.precache).toEqual(['assets/main-A1.js', 'index.html']);
    expect(build.optional).toEqual(['assets/ort-wasm-X.wasm']);
    // A directory of rarely used files is one entry, not hundreds.
    expect(build.optionalPrefixes).toEqual(['pdfjs/']);
    expect(build.precacheBytes).toBe(17_000);
    expect(build).toEqual(createServiceWorkerBuild(files, '0.6.60', digestOf));
    expect(build.id).toMatch(/^[0-9a-f]{12}$/u);
  });

  it('changes when a hashed chunk, the page or the version changes, not for unrelated files', () => {
    const base = createServiceWorkerBuild(files, '0.6.60', digestOf).id;
    const renamed = files.map((file) =>
      file.path === 'assets/main-A1.js' ? { ...file, path: 'assets/main-B2.js' } : file,
    );
    expect(createServiceWorkerBuild(renamed, '0.6.60', digestOf).id).not.toBe(base);
    digests['index.html'] = 'edited';
    expect(createServiceWorkerBuild(files, '0.6.60', digestOf).id).not.toBe(base);
    delete digests['index.html'];
    expect(createServiceWorkerBuild(files, '0.6.61', digestOf).id).not.toBe(base);
    expect(
      createServiceWorkerBuild(
        [...files, { path: 'content/other.db', bytes: 1 }],
        '0.6.60',
        digestOf,
      ).id,
    ).toBe(base);
  });

  it('refuses a build without a page to open offline', () => {
    expect(() =>
      createServiceWorkerBuild([{ path: 'assets/main-A1.js', bytes: 1 }], '0.6.60', digestOf),
    ).toThrow(/index\.html/u);
  });
});

describe('injecting the build into sw.js', () => {
  const build = createServiceWorkerBuild(
    [{ path: 'index.html', bytes: 10 }],
    '0.6.60',
    () => 'digest',
  );

  it('replaces the placeholder with the JSON build and keeps `$` patterns literal', () => {
    const tricky = { ...build, precache: ['index.html', 'assets/a$&b.js'] };
    const source = `const BUILD = ${SERVICE_WORKER_BUILD_PLACEHOLDER};`;
    const result = injectServiceWorkerBuild(source, tricky);
    expect(result).toBe(`const BUILD = ${JSON.stringify(tricky)};`);
  });

  it('fails when the worker source has no placeholder', () => {
    expect(() => injectServiceWorkerBuild('const BUILD = null;', build)).toThrow(/placeholder/u);
  });

  it('is present in the shipped public/sw.js', () => {
    const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    expect(source.split(SERVICE_WORKER_BUILD_PLACEHOLDER)).toHaveLength(2);
  });
});

describe('writing a build output', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
  });

  it('writes the manifest and the worker, listing only the shell of this build', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'minimed-sw-'));
    directories.push(outDir);
    mkdirSync(join(outDir, 'assets'));
    mkdirSync(join(outDir, 'content'));
    writeFileSync(join(outDir, 'index.html'), '<html></html>');
    writeFileSync(join(outDir, 'assets/main-A1.js'), 'export {}');
    writeFileSync(join(outDir, 'content/core.db'), 'x'.repeat(100));
    writeFileSync(join(outDir, 'content/core-report.json'), '{}');
    mkdirSync(join(outDir, 'content/modules'));
    writeFileSync(join(outDir, 'content/modules/a.db'), 'y');
    writeFileSync(join(outDir, 'sw.js'), `const BUILD = ${SERVICE_WORKER_BUILD_PLACEHOLDER};\n`);

    const build = writeServiceWorkerBuild(outDir, '0.6.60');

    expect(build.precache).toEqual(['assets/main-A1.js', 'content/core-report.json', 'index.html']);
    const manifest = JSON.parse(readFileSync(join(outDir, BUILD_MANIFEST_FILE), 'utf8'));
    expect(manifest).toEqual(build);
    expect(readFileSync(join(outDir, 'sw.js'), 'utf8')).toBe(
      `const BUILD = ${JSON.stringify(build)};\n`,
    );
  });
});
