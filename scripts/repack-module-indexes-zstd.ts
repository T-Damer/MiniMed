/**
 * Repacks the uncompressed (`none`) module indexes of a catalog family as framed zstd and writes a
 * candidate catalog that points at them. Nothing is uploaded and the committed catalog is only
 * written with --write-catalog, after the files are published.
 *
 *   bun scripts/repack-module-indexes-zstd.ts \
 *     --family esklp|clinical --source-dir DIR --out-dir DIR [--compacted] \
 *     [--catalog-in FILE] [--catalog-out FILE] [--write-catalog] [--module-id ID ...]
 *
 * The source directory holds the local SQLite files under the names of the catalog URLs. Without
 * --compacted they must match the catalog's current `sha256` (the decoded identity stays the same, so
 * installed copies are untouched). With --compacted they are the search-compacted builds of the same
 * modules (`medbase compact-module-search`): the decoded identity changes, the logical content does
 * not, and the catalog entry gets the new `decodedSha256`.
 *
 * Output format: a concatenation of independent frames of at most 64 MiB of decoded data, each made
 * by `zstd -19 --long=26` from a file (so each frame declares its content size). Any zstd decoder
 * reads it; the app decodes it frame by frame into OPFS (see encoded-index-reader.ts). The result is
 * decoded again with that reader and compared with the SQLite's SHA-256 before it is accepted.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ZSTD_FRAME_CONTENT_BYTES } from '../apps/app/src/features/modules/zstd-frames';
import {
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';
import { encodeFramed, fileSha256, verifyFramed, ZSTD_ARGS } from './lib/zstd-module-archive';

const CATALOG_PATH = 'apps/app/src/features/modules/catalog.preview.json';
/** The release whose app understands zstd module indexes (zstd-index-decode.ts landed in 0.6.45). */
const ZSTD_MIN_APP_VERSION = '0.6.45';

const FAMILIES = {
  esklp: { idPrefix: 'minimed.medications.', releasePrefix: 'esklp-' },
  clinical: { idPrefix: 'minimed.clinical.recommendation.', releasePrefix: 'clinical-json-' },
} as const;

const { values } = parseArgs({
  options: {
    family: { type: 'string' },
    'source-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    compacted: { type: 'boolean', default: false },
    /** Start from a candidate written by an earlier run (e.g. the other family) instead of the committed catalog. */
    'catalog-in': { type: 'string' },
    'catalog-out': { type: 'string' },
    'write-catalog': { type: 'boolean', default: false },
    'module-id': { type: 'string', multiple: true },
    report: { type: 'string' },
  },
});

const family = values.family as keyof typeof FAMILIES | undefined;
const sourceDir = values['source-dir'];
const outDir = values['out-dir'];
if (!family || !(family in FAMILIES) || !sourceDir || !outDir) {
  throw new Error(
    'Usage: bun scripts/repack-module-indexes-zstd.ts --family esklp|clinical --source-dir DIR --out-dir DIR [--compacted] [--catalog-out FILE] [--write-catalog]',
  );
}
const { idPrefix, releasePrefix } = FAMILIES[family];

function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string): number[] =>
    value.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = [parse(version), parse(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

const raw = JSON.parse(readFileSync(values['catalog-in'] ?? CATALOG_PATH, 'utf8')) as {
  modules: Array<
    Record<string, unknown> & { id: string; artifacts: Array<Record<string, unknown>> }
  >;
};
ContentModuleCatalogSchema.parse(raw);
const wanted = new Set(values['module-id'] ?? []);
mkdirSync(outDir, { recursive: true });

interface Repacked {
  readonly moduleId: string;
  readonly file: string;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly decodedSha256: string;
  readonly decodedSizeBytes: number;
  readonly previousSizeBytes: number;
  readonly mirror: string;
}
const repacked: Repacked[] = [];
const zstdVersion = spawnSync('zstd', ['--version'], { encoding: 'utf8' }).stdout.trim();

for (const module of raw.modules) {
  if (!module.id.startsWith(idPrefix) || (wanted.size > 0 && !wanted.has(module.id))) continue;
  const artifact = module.artifacts.find((entry) => entry['kind'] === 'index');
  const url = artifact?.['url'];
  if (!artifact || typeof url !== 'string' || artifact['compression'] !== 'none') continue;
  const match = /\/releases\/download\/([^/]+)\/([^/]+)\.db$/u.exec(url);
  if (!match?.[1] || !match[2] || !match[1].startsWith(releasePrefix)) continue;
  const [, tag, stem] = match;
  const sourcePath = join(sourceDir, `${stem}.db`);
  if (!existsSync(sourcePath))
    throw new Error(`Missing local file ${sourcePath} for ${module.id}.`);

  const decodedSha256 = fileSha256(sourcePath);
  const decodedSizeBytes = statSync(sourcePath).size;
  if (!values.compacted && decodedSha256 !== artifact['sha256']) {
    throw new Error(`${sourcePath} differs from the catalog's published checksum.`);
  }
  const archivePath = join(outDir, `${stem}.db.zst`);
  if (existsSync(archivePath)) throw new Error(`Refusing to overwrite ${archivePath}.`);
  try {
    encodeFramed(sourcePath, archivePath);
    await verifyFramed(archivePath, decodedSizeBytes, decodedSha256);
  } catch (cause) {
    rmSync(archivePath, { force: true });
    throw cause;
  }
  const sizeBytes = statSync(archivePath).size;
  const zstdUrl = url.replace(/\.db$/u, '.db.zst');
  const previousSizeBytes = Number(artifact['sizeBytes']);
  artifact['compression'] = 'zstd';
  artifact['url'] = zstdUrl;
  artifact['sha256'] = fileSha256(archivePath);
  artifact['sizeBytes'] = sizeBytes;
  artifact['decodedSha256'] = decodedSha256;
  artifact['decodedSizeBytes'] = decodedSizeBytes;
  const sizes = module['sizes'] as Record<string, unknown>;
  module['sizes'] = { ...sizes, downloadBytes: sizeBytes, installedBytes: decodedSizeBytes };
  const compatibility = module['compatibility'] as Record<string, unknown>;
  if (!versionAtLeast(String(compatibility['minAppVersion']), ZSTD_MIN_APP_VERSION)) {
    compatibility['minAppVersion'] = ZSTD_MIN_APP_VERSION;
  }
  repacked.push({
    moduleId: module.id,
    file: basename(archivePath),
    url: zstdUrl,
    sha256: String(artifact['sha256']),
    sizeBytes,
    decodedSha256,
    decodedSizeBytes,
    previousSizeBytes,
    mirror:
      family === 'esklp'
        ? `datasets/${tag}: modules/${basename(archivePath)}`
        : `datasets/${tag}: apps/app/public/content/clinical/${basename(archivePath)}`,
  });
}

if (repacked.length === 0) throw new Error('No uncompressed module of this family was found.');
const validated = ContentModuleCatalogSchema.parse(raw);
void validated;
const candidate = serializeContentModuleCatalog(raw);
if (values['catalog-out']) writeFileSync(values['catalog-out'], candidate);
if (values['write-catalog']) writeFileSync(CATALOG_PATH, candidate);

const totalBefore = repacked.reduce((sum, item) => sum + item.previousSizeBytes, 0);
const totalAfter = repacked.reduce((sum, item) => sum + item.sizeBytes, 0);
const summary = {
  family,
  compacted: values.compacted,
  zstd: zstdVersion,
  zstdArgs: ZSTD_ARGS,
  frameContentBytes: ZSTD_FRAME_CONTENT_BYTES,
  modules: repacked.length,
  downloadBytesBefore: totalBefore,
  downloadBytesAfter: totalAfter,
  files: repacked,
};
const reportPath = values.report ?? join(outDir, 'repack-report.json');
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `${family}: ${repacked.length} modules, ${(totalBefore / 1e6).toFixed(1)} → ${(totalAfter / 1e6).toFixed(1)} MB (${(totalBefore / totalAfter).toFixed(1)}×); report ${reportPath}`,
);
