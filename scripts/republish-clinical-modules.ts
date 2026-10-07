/**
 * Points already listed single-recommendation modules at rebuilt databases (STATE KR3): same
 * module id, document id and provenance, new content. Unlike `add-clinical-delta-modules.ts`
 * (new editions are appended) this rewrites the listed entry, and only the given modules: every
 * other catalog entry stays byte for byte as it was, so devices do not re-download them.
 *
 *   bun scripts/republish-clinical-modules.ts --decoded-dir DIR --out-dir DIR \
 *     --snapshot-id clinical-json-2026.10.07-<hash> --published-at 2026-10-07T15:40:00Z \
 *     [--catalog-version LABEL] [--build-artifacts artifacts.json …] [--write-catalog]
 *
 * DIR holds `<official id>.db` (compacted modules with their final vectors). Each is framed as
 * zstd (`scripts/lib/zstd-module-archive.ts`: ≤64 MiB independent frames, decoded again with the
 * app's reader and checked against the SQLite's SHA-256) under
 * `clinical-<official id>-<snapshot id>.db.zst`. The module gets the version
 * `0.6.0-json.<12 hex of sha256("<snapshot id>")>.e5` (same rule as `package-snapshot`, plus the
 * `.e5` marker of modules that carry e5 vectors), a new index artifact id, URL, checksums and
 * sizes, and a source-set digest / document-table checksum recomputed from the database (they
 * change only when the raw source file itself changed). Nothing is uploaded here.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';
import { encodeFramed, fileSha256, verifyFramed } from './lib/zstd-module-archive';

const CATALOG_PATH = 'apps/app/src/features/modules/catalog.preview.json';
const MODULE_PREFIX = 'minimed.clinical.recommendation.';
const RELEASE_BASE = 'https://github.com/T-Damer/MiniMed/releases/download';

type Raw = Record<string, unknown>;

const { values } = parseArgs({
  options: {
    'decoded-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    'snapshot-id': { type: 'string' },
    'published-at': { type: 'string' },
    'catalog-version': { type: 'string' },
    'build-artifacts': { type: 'string', multiple: true },
    'catalog-out': { type: 'string' },
    'write-catalog': { type: 'boolean', default: false },
  },
});
const decodedDir = values['decoded-dir'];
const outDir = values['out-dir'];
const snapshotId = values['snapshot-id'];
const publishedAt = values['published-at'];
if (
  !decodedDir ||
  !outDir ||
  !snapshotId ||
  !publishedAt ||
  !/^clinical-[a-z0-9][a-z0-9.-]+$/u.test(snapshotId) ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(publishedAt)
) {
  throw new Error(
    'Usage: bun scripts/republish-clinical-modules.ts --decoded-dir DIR --out-dir DIR --snapshot-id clinical-… --published-at YYYY-MM-DDTHH:MM:SSZ [--catalog-version L] [--write-catalog]',
  );
}

/** Same canonical JSON as the Python packager's `_checksum` (sorted keys, compact, UTF-8). */
function canonicalChecksum(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item as Raw)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, entry]) => [key, canonical(entry)]),
          )
        : item;
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

const snapshotHash = canonicalChecksum(snapshotId).slice('sha256:'.length, 'sha256:'.length + 12);
const baseVersion = `0.6.0-json.${snapshotHash}`;
const version = `${baseVersion}.e5`;

// Image / table flags per official id from the `build-documents` reports, when given.
const buildFlags = new Map<string, { structuredTables: boolean; images: boolean }>();
for (const path of values['build-artifacts'] ?? []) {
  const report = JSON.parse(readFileSync(path, 'utf8')) as { artifacts: Raw[] };
  for (const artifact of report.artifacts) {
    buildFlags.set(String(artifact['officialId']), {
      structuredTables: Number(artifact['structuredTables'] ?? 0) > 0,
      images: Number(artifact['images'] ?? 0) > 0,
    });
  }
}

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Raw & { modules: Raw[] };
ContentModuleCatalogSchema.parse(catalog);
const byId = new Map(catalog.modules.map((module) => [String(module['id']), module]));
mkdirSync(outDir, { recursive: true });

const changes: Array<{
  officialId: string;
  oldVersion: string;
  oldUrl: string;
  url: string;
  sizeBytes: number;
  decodedSizeBytes: number;
  oldSizeBytes: number;
  sourceSetDigestChanged: boolean;
  capabilitiesChanged: boolean;
}> = [];

const databases = [...new Bun.Glob('*.db').scanSync(decodedDir)].sort();
if (databases.length === 0) throw new Error(`No *.db in ${decodedDir}.`);
for (const name of databases) {
  const officialId = name.slice(0, -'.db'.length);
  const module = byId.get(`${MODULE_PREFIX}${officialId}`);
  if (!module) throw new Error(`${officialId} is not a catalog module.`);
  const decodedPath = join(decodedDir, name);
  const database = new Database(decodedPath, { readonly: true });
  const document = database
    .query<{ id: string; current_version_id: string }, []>(
      'SELECT id, current_version_id FROM documents',
    )
    .all();
  const versions = database
    .query<{ id: string; source_checksum: string }, []>(
      'SELECT id, source_checksum FROM document_versions',
    )
    .all();
  database.close();
  const [doc] = document;
  const [documentVersion] = versions;
  if (document.length !== 1 || versions.length !== 1 || !doc || !documentVersion) {
    throw new Error(`${officialId}: expected exactly one document with one version.`);
  }
  const sourceSetDigest = canonicalChecksum([
    {
      documentId: doc.id,
      documentVersionId: documentVersion.id,
      sourceChecksum: documentVersion.source_checksum,
      status: 'active',
    },
  ]);
  const table = module['documentTable'] as { indexArtifactId: string; rows: unknown[][] };
  const [row] = table.rows;
  if (table.rows.length !== 1 || !row || row[0] !== doc.id) {
    throw new Error(`${officialId}: document table does not list ${doc.id}.`);
  }
  const artifact = (module['artifacts'] as Raw[]).find((entry) => entry['kind'] === 'index');
  if (!artifact || (module['artifacts'] as Raw[]).length !== 1) {
    throw new Error(`${officialId}: expected exactly one index artifact.`);
  }
  const oldUrl = String(artifact['url']);
  const oldVersion = String(module['version']);
  const oldSizeBytes = Number(artifact['sizeBytes']);

  const fileName = `clinical-${officialId}-${snapshotId}.db.zst`;
  const archivePath = join(outDir, fileName);
  const decodedSha256 = fileSha256(decodedPath);
  const decodedSizeBytes = statSync(decodedPath).size;
  rmSync(archivePath, { force: true });
  try {
    encodeFramed(decodedPath, archivePath);
    await verifyFramed(archivePath, decodedSizeBytes, decodedSha256);
  } catch (cause) {
    rmSync(archivePath, { force: true });
    throw cause;
  }
  const sizeBytes = statSync(archivePath).size;

  const artifactId = `${module['id']}-index-${baseVersion}`;
  const sourceSetDigestChanged = module['sourceSetDigest'] !== sourceSetDigest;
  module['version'] = version;
  module['sourceSetDigest'] = sourceSetDigest;
  Object.assign(artifact, {
    id: artifactId,
    url: `${RELEASE_BASE}/${snapshotId}/${fileName}`,
    sha256: fileSha256(archivePath),
    sizeBytes,
    sourceSetDigest,
    decodedSha256,
    decodedSizeBytes,
  });
  table.indexArtifactId = artifactId;
  // The document-table checksum is the raw source checksum without its `sha256:` prefix.
  row[2] = documentVersion.source_checksum.replace(/^sha256:/u, '');
  module['sizes'] = {
    ...(module['sizes'] as Raw),
    downloadBytes: sizeBytes,
    installedBytes: decodedSizeBytes,
  };
  let capabilitiesChanged = false;
  const flags = buildFlags.get(officialId);
  if (flags) {
    const capabilities = module['capabilities'] as Raw;
    capabilitiesChanged =
      capabilities['structuredTables'] !== flags.structuredTables ||
      capabilities['images'] !== flags.images;
    module['capabilities'] = { ...capabilities, ...flags };
  }
  changes.push({
    officialId,
    oldVersion,
    oldUrl,
    url: String(artifact['url']),
    sizeBytes,
    decodedSizeBytes,
    oldSizeBytes,
    sourceSetDigestChanged,
    capabilitiesChanged,
  });
}

catalog['publishedAt'] = publishedAt;
if (values['catalog-version']) catalog['catalogVersion'] = values['catalog-version'];
ContentModuleCatalogSchema.parse(catalog);
const serialized = serializeContentModuleCatalog(catalog);
if (values['catalog-out']) writeFileSync(values['catalog-out'], serialized);
if (values['write-catalog']) writeFileSync(CATALOG_PATH, serialized);
const downloadBytes = changes.reduce((sum, item) => sum + item.sizeBytes, 0);
const previousBytes = changes.reduce((sum, item) => sum + item.oldSizeBytes, 0);
const report = {
  snapshotId,
  version,
  publishedAt,
  modules: changes.length,
  downloadBytes,
  previousDownloadBytes: previousBytes,
  decodedBytes: changes.reduce((sum, item) => sum + item.decodedSizeBytes, 0),
  sourceSetDigestChanged: changes
    .filter((item) => item.sourceSetDigestChanged)
    .map((i) => i.officialId),
  capabilitiesChanged: changes.filter((item) => item.capabilitiesChanged).map((i) => i.officialId),
  files: changes,
};
writeFileSync(join(outDir, 'republish-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!existsSync(join(outDir, 'republish-report.json'))) throw new Error('Report not written.');
console.log(
  `${changes.length} modules → ${snapshotId} (${version}): ${(downloadBytes / 1e6).toFixed(1)} MB (was ${(previousBytes / 1e6).toFixed(1)} MB)`,
);
