import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  apkModelProblems,
  fetchQueryModel,
  manifestFor,
  PINNED_QUERY_MODEL,
  type QueryModelSpec,
  QueryModelVerificationError,
  sha256Hex,
  stageQueryModel,
} from '../../../../scripts/lib/query-model';
import {
  E5_BUNDLED_DIR,
  E5_BUNDLED_MANIFEST,
  e5BundledManifest,
  isPinnedE5BundledManifest,
} from '../features/semantic/e5-model';

const encoder = new TextEncoder();
const part0 = encoder.encode('graph-part-zero|');
const part1 = encoder.encode('graph-part-one');
const graph = new Uint8Array([...part0, ...part1]);
const config = encoder.encode('{"model_type":"bert"}');
const digest = (bytes: Uint8Array) => sha256Hex(bytes);

const SPEC: QueryModelSpec = {
  revision: 'test-revision',
  url: (path) => `https://mirror.test/${path}`,
  files: [
    { path: 'config.json', sizeBytes: config.length, sha256: digest(config) },
    {
      path: 'onnx/model.onnx',
      sizeBytes: graph.length,
      sha256: digest(graph),
      parts: [
        { path: 'onnx/model.onnx.part-0', sizeBytes: part0.length, sha256: digest(part0) },
        { path: 'onnx/model.onnx.part-1', sizeBytes: part1.length, sha256: digest(part1) },
      ],
    },
  ],
};

const MIRROR = new Map<string, Uint8Array>([
  ['https://mirror.test/config.json', config],
  ['https://mirror.test/onnx/model.onnx.part-0', part0],
  ['https://mirror.test/onnx/model.onnx.part-1', part1],
]);

function mirror(overrides: Record<string, Uint8Array> = {}) {
  const requested: string[] = [];
  return {
    requested,
    download: async (url: string): Promise<Uint8Array> => {
      requested.push(url);
      const bytes = overrides[url] ?? MIRROR.get(url);
      if (!bytes) throw new Error(`unexpected request ${url}`);
      return bytes;
    },
  };
}

describe('query model build script', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'minimed-query-model-test-'));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });
  const cacheDir = () => join(work, 'cache');

  it('joins the parts and caches verified files', async () => {
    const source = mirror();
    const root = await fetchQueryModel({
      cacheDir: cacheDir(),
      spec: SPEC,
      download: source.download,
    });
    expect(new Uint8Array(readFileSync(join(root, 'onnx/model.onnx')))).toEqual(graph);
    expect(source.requested).toHaveLength(3);
  });

  it('does not download again when the cache is intact, and repairs a damaged cache', async () => {
    const first = mirror();
    const root = await fetchQueryModel({
      cacheDir: cacheDir(),
      spec: SPEC,
      download: first.download,
    });
    const second = mirror();
    await fetchQueryModel({ cacheDir: cacheDir(), spec: SPEC, download: second.download });
    expect(second.requested).toEqual([]);

    writeFileSync(join(root, 'onnx/model.onnx'), 'rotten');
    const third = mirror();
    await fetchQueryModel({ cacheDir: cacheDir(), spec: SPEC, download: third.download });
    expect(third.requested).toEqual([
      'https://mirror.test/onnx/model.onnx.part-0',
      'https://mirror.test/onnx/model.onnx.part-1',
    ]);
    expect(new Uint8Array(readFileSync(join(root, 'onnx/model.onnx')))).toEqual(graph);
  });

  it('fails the build on a checksum mismatch and caches nothing for that file', async () => {
    const tampered = encoder.encode('graph-part-one'.replace('one', 'xyz'));
    const source = mirror({ 'https://mirror.test/onnx/model.onnx.part-1': tampered });
    await expect(
      fetchQueryModel({ cacheDir: cacheDir(), spec: SPEC, download: source.download }),
    ).rejects.toThrow(QueryModelVerificationError);
    expect(existsSync(join(cacheDir(), SPEC.revision, 'onnx/model.onnx'))).toBe(false);
  });

  it('fails the build on a wrong size, even when the joined bytes cannot match', async () => {
    const source = mirror({ 'https://mirror.test/config.json': config.slice(0, 5) });
    await expect(
      fetchQueryModel({ cacheDir: cacheDir(), spec: SPEC, download: source.download }),
    ).rejects.toThrow(/5 bytes, expected/u);
  });

  it('fails when the parts are individually valid but the joined file is not', async () => {
    const wrongJoin: QueryModelSpec = {
      ...SPEC,
      files: SPEC.files.map((file) =>
        file.parts ? { ...file, sha256: digest(encoder.encode('something else')) } : file,
      ),
    };
    const source = mirror();
    await expect(
      fetchQueryModel({ cacheDir: cacheDir(), spec: wrongJoin, download: source.download }),
    ).rejects.toThrow(/onnx\/model\.onnx: SHA-256/u);
  });

  it('stages the verified files with the manifest written last', async () => {
    await fetchQueryModel({ cacheDir: cacheDir(), spec: SPEC, download: mirror().download });
    const publicDir = join(work, 'public');
    mkdirSync(join(publicDir, E5_BUNDLED_DIR), { recursive: true });
    writeFileSync(join(publicDir, E5_BUNDLED_DIR, 'stale.bin'), 'old');
    const target = stageQueryModel({ cacheDir: cacheDir(), publicDir, spec: SPEC });
    expect(target).toBe(join(publicDir, E5_BUNDLED_DIR));
    expect(existsSync(join(target, 'stale.bin'))).toBe(false);
    expect(new Uint8Array(readFileSync(join(target, 'onnx/model.onnx')))).toEqual(graph);
    expect(JSON.parse(readFileSync(join(target, E5_BUNDLED_MANIFEST), 'utf8'))).toEqual(
      manifestFor(SPEC),
    );
  });

  it('refuses to stage from a damaged cache', async () => {
    const root = await fetchQueryModel({
      cacheDir: cacheDir(),
      spec: SPEC,
      download: mirror().download,
    });
    writeFileSync(join(root, 'config.json'), 'tampered after the fetch');
    expect(() =>
      stageQueryModel({ cacheDir: cacheDir(), publicDir: join(work, 'public'), spec: SPEC }),
    ).toThrow(QueryModelVerificationError);
    expect(existsSync(join(work, 'public', E5_BUNDLED_DIR, E5_BUNDLED_MANIFEST))).toBe(false);
  });

  it('writes the manifest the app accepts, from the same pinned checksums', () => {
    const written = manifestFor(PINNED_QUERY_MODEL);
    expect(written).toEqual(e5BundledManifest());
    expect(isPinnedE5BundledManifest(written)).toBe(true);
    // Every pinned file is one the script knows how to download from the mirror.
    for (const file of PINNED_QUERY_MODEL.files) {
      for (const part of file.parts ?? [file]) {
        expect(PINNED_QUERY_MODEL.url(part.path)).toContain(
          `/datasets/${PINNED_QUERY_MODEL.revision}/`,
        );
      }
    }
  });

  it('recognises an APK that carries the model and reports what is missing or truncated', () => {
    const base = `assets/public/${E5_BUNDLED_DIR}`;
    const rows = PINNED_QUERY_MODEL.files.map(
      (file) => `${String(file.sizeBytes).padStart(12)}  2026-10-15 12:00   ${base}/${file.path}`,
    );
    const manifestRow = `        1234  2026-10-15 12:00   ${base}/${E5_BUNDLED_MANIFEST}`;
    const listing = ['Archive:  app-debug.apk', ...rows, manifestRow].join('\n');
    expect(apkModelProblems(listing)).toEqual([]);

    const withoutGraph = ['Archive:  app-debug.apk', rows[0], rows[1], rows[2], manifestRow].join(
      '\n',
    );
    expect(apkModelProblems(withoutGraph)).toEqual([`missing ${base}/onnx/model_quantized.onnx`]);
    expect(apkModelProblems(rows.join('\n'))).toContain(`missing ${base}/${E5_BUNDLED_MANIFEST}`);
    expect(
      apkModelProblems(listing.replace(String(PINNED_QUERY_MODEL.files[0]?.sizeBytes), '1'))[0],
    ).toMatch(/is 1 bytes, expected/u);
  });
});
