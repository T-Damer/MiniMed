/**
 * Re-encodes a published gzip module index as zstd and points the catalog at it.
 *
 *   bun scripts/repack-module-index-zstd.ts MODULE_ID LOCAL.db.gz
 *
 * The gzip file must match the catalog's transport checksum and decode to its `decodedSha256`.
 * The zstd file is written next to it and decoded again with the app's own decoder (fzstd) before
 * the catalog changes; upload it to the same release tag afterwards. The decoded SQLite and the
 * module version stay the same, so installed copies are not re-downloaded.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeZstdIndex } from '../apps/app/src/features/modules/zstd-index-decode';
import {
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';

const CATALOG_PATH = 'apps/app/src/features/modules/catalog.preview.json';
// fzstd decodes a 64 MiB window exactly and corrupts 128 MiB; see zstd-index-decode.ts.
const ZSTD_ARGS = ['-19', '--long=26', '-T0', '-q', '-f'];

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const [moduleId, gzipPath] = process.argv.slice(2);
if (!moduleId || !gzipPath?.endsWith('.db.gz')) {
  throw new Error('Usage: bun scripts/repack-module-index-zstd.ts MODULE_ID LOCAL.db.gz');
}

const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as {
  modules: Array<Record<string, unknown> & { id: string }>;
};
const catalog = ContentModuleCatalogSchema.parse(raw);
const module = catalog.modules.find((entry) => entry.id === moduleId);
const artifact = module?.artifacts.find((entry) => entry.kind === 'index');
if (!module || !artifact) throw new Error(`No index artifact for ${moduleId}.`);
if (artifact.compression !== 'gzip' || !artifact.url || !artifact.decodedSha256) {
  throw new Error(`${moduleId} is not a published gzip index.`);
}

const gzip = readFileSync(gzipPath);
if (sha256(gzip) !== artifact.sha256) throw new Error('Local gzip differs from the catalog.');
const decoded = gunzipSync(gzip);
if (
  sha256(decoded) !== artifact.decodedSha256 ||
  decoded.byteLength !== artifact.decodedSizeBytes
) {
  throw new Error('Local gzip does not decode to the catalog SQLite.');
}

const decodedPath = gzipPath.replace(/\.gz$/u, '');
const zstdPath = `${decodedPath}.zst`;
writeFileSync(decodedPath, decoded);
try {
  const result = spawnSync('zstd', [...ZSTD_ARGS, '-o', zstdPath, decodedPath], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('zstd failed.');
} finally {
  rmSync(decodedPath);
}

const zstd = readFileSync(zstdPath);
const verified = decodeZstdIndex(zstd, decoded.byteLength);
if (sha256(verified) !== artifact.decodedSha256) {
  throw new Error('fzstd does not decode the zstd file to the catalog SQLite.');
}

const zstdSha = sha256(zstd);
const zstdUrl = artifact.url.replace(/\.db\.gz$/u, '.db.zst');
const rawModule = raw.modules.find((entry) => entry.id === moduleId);
if (!rawModule || zstdUrl === artifact.url) throw new Error('Cannot derive the zstd URL.');
rawModule['artifacts'] = (rawModule['artifacts'] as Array<Record<string, unknown>>).map((entry) =>
  entry['id'] === artifact.id
    ? { ...entry, compression: 'zstd', url: zstdUrl, sha256: zstdSha, sizeBytes: zstd.byteLength }
    : entry,
);
const sizes = rawModule['sizes'] as Record<string, unknown>;
rawModule['sizes'] = { ...sizes, downloadBytes: zstd.byteLength };
writeFileSync(CATALOG_PATH, serializeContentModuleCatalog(raw));

console.log(
  `${moduleId}: gzip ${gzip.byteLength} → zstd ${statSync(zstdPath).size} bytes (${zstdSha}); ` +
    `upload ${zstdPath} as ${zstdUrl.split('/').at(-1)}`,
);
