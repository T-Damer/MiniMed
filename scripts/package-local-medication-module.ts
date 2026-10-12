/**
 * Packages a finished, search-compacted personal-use medication module (the local Vidal reference)
 * the way the ГРЛС instruction modules and Allmed are packaged: framed zstd, verified with the app's
 * own decoder, plus a catalog entry (`kind: medication`). The entry is never added to a catalog:
 * `medbase bundle-local-module` wraps it and the archive into a `*.minimed-module.zip` that the app
 * installs from a file. Nothing is uploaded; the output directory must be ignored by git.
 *
 *   bun scripts/package-local-medication-module.ts --database DB --out-dir output/local-modules \
 *     [--min-app-version 0.6.59] [--description TEXT] [--tags a,b]
 *
 * Every document of the pack must declare `rightsStatus: personal-use-only` and `localOnly: true`
 * (the preparer writes both); a pack with any other document is refused.
 */
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContentModuleCatalogEntrySchema } from '../packages/contracts/src/content-modules';
import { readPackIdentity, sourceSetDigest } from './lib/module-pack-identity';
import { encodeFramed, fileSha256, verifyFramed } from './lib/zstd-module-archive';

const LOCAL_URL_PREFIX = 'minimed-local:artifacts/';

const { values } = parseArgs({
  options: {
    database: { type: 'string' },
    'out-dir': { type: 'string' },
    'min-app-version': { type: 'string', default: '0.6.59' },
    description: { type: 'string' },
    tags: { type: 'string', default: 'drugs,personal-use,supplemental-reference' },
  },
});
const databasePath = values.database;
const outDir = values['out-dir'];
if (!databasePath || !outDir) {
  throw new Error(
    'Usage: bun scripts/package-local-medication-module.ts --database DB --out-dir DIR [--min-app-version V]',
  );
}
const minAppVersion = values['min-app-version'] as string;

function assertGitIgnored(path: string): void {
  const absolute = resolve(path);
  const probe = existsSync(absolute) ? absolute : join(absolute, '.probe');
  const result = spawnSync('git', ['check-ignore', '-q', '--', probe]);
  if (result.status !== 0) {
    throw new Error(
      `${path} is not ignored by git: personal-use modules may only be written there.`,
    );
  }
}

function assertPersonalUse(path: string): void {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .query(
        `SELECT count(*) AS total,
                sum(json_extract(metadata_json, '$.rightsStatus') = 'personal-use-only'
                    AND json_extract(metadata_json, '$.localOnly') = 1) AS personal
         FROM documents`,
      )
      .get() as { total: number; personal: number | null };
    if (row.total === 0 || row.personal !== row.total) {
      throw new Error(
        `${path}: ${row.total - (row.personal ?? 0)} of ${row.total} documents are not marked personal-use-only/localOnly.`,
      );
    }
  } finally {
    database.close();
  }
}

assertGitIgnored(outDir);
assertPersonalUse(databasePath);
mkdirSync(outDir, { recursive: true });

const identity = readPackIdentity(databasePath);
const decodedSha256 = fileSha256(databasePath);
const decodedSizeBytes = statSync(databasePath).size;
// Stable names: a personal-use module has one current build, the version is inside the entry.
const stem = identity.id;
const archiveName = `${stem}.db.zst`;
const archivePath = join(outDir, archiveName);
if (existsSync(archivePath)) throw new Error(`Refusing to overwrite ${archivePath}.`);
try {
  encodeFramed(databasePath, archivePath);
  await verifyFramed(archivePath, decodedSizeBytes, decodedSha256);
} catch (cause) {
  rmSync(archivePath, { force: true });
  throw cause;
}
const sizeBytes = statSync(archivePath).size;
const digest = sourceSetDigest(identity.documents);
const artifactId = `${identity.id}-index-${identity.version}`;
const entry = ContentModuleCatalogEntrySchema.parse({
  id: identity.id,
  version: identity.version,
  kind: 'medication',
  collection: 'shared',
  title: identity.title,
  description:
    values.description ??
    'Личный справочник лекарственных препаратов: описания, формы выпуска и торговые названия. Источник передан владельцу только для личного пользования, не распространяется и не публикуется; не официальная инструкция ГРЛС.',
  required: false,
  releaseState: 'preview',
  specialties: [],
  populations: ['all'],
  tags: (values.tags as string).split(',').filter(Boolean),
  compatibility: {
    minAppVersion,
    maxAppVersion: null,
    schemaVersion: 2,
    coreCatalogVersion: '1',
  },
  sourceSetDigest: digest,
  dependencies: [{ moduleId: 'minimed.core.ru', versionRange: '^1.0.0', required: true }],
  sizes: {
    downloadBytes: sizeBytes,
    installedBytes: decodedSizeBytes,
    sourceAssetsDownloadBytes: null,
    precision: 'exact',
  },
  capabilities: {
    search: true,
    fullText: true,
    structuredTables: true,
    images: false,
    originalPdf: false,
    structuredKnowledge: false,
    calculations: false,
  },
  artifacts: [
    {
      id: artifactId,
      kind: 'index',
      required: true,
      url: `${LOCAL_URL_PREFIX}${archiveName}`,
      sha256: fileSha256(archivePath),
      sizeBytes,
      compression: 'zstd',
      decodedSha256,
      decodedSizeBytes,
      sourceSetDigest: digest,
    },
  ],
  documents: [],
  previewDocumentCount: identity.documents.length,
});
const entryPath = join(outDir, `${stem}.catalog-entry.json`);
writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
const report = {
  moduleId: identity.id,
  version: identity.version,
  documents: identity.documents.length,
  archive: archivePath,
  archiveBytes: sizeBytes,
  installedBytes: decodedSizeBytes,
  sourceSetDigest: digest,
  catalogEntry: entryPath,
};
writeFileSync(join(outDir, `${stem}.package-report.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `${archiveName}: ${(decodedSizeBytes / 1e6).toFixed(1)} → ${(sizeBytes / 1e6).toFixed(1)} MB, ${identity.documents.length} documents`,
);
