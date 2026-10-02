// Writes `core-report.json` for a built discovery core: counts, integrity, checksums of the inputs
// that produced it and both distributions (browser bundle and Android download). It is the tracked
// description the app, the Android release workflow and `restore-core.mjs` verify the core against.
//
//   bun scripts/write-core-report.mjs --db data/build/core.0.6.47.db --version 0.6.47 \
//     --gzip content/bundled/core.db.gz --release-tag core-0.6.45 --output core-report.json
//
// The gzip is the transfer for both distributions (browser and Android share one 16 KiB-page file;
// when they diverge, publish a separate gzip and edit `distributions.android` by hand). The raw
// `MiniMed-<version>-core.db` release asset stays published for older app builds.

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split('=');
      return [key, rest.join('=')];
    }),
);
for (const key of ['db', 'version', 'gzip', 'release-tag', 'output']) {
  if (!args[key]) throw new Error(`--${key}=... is required.`);
}

const sha256 = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
const dbPath = resolve(args.db);
const manifestPath = dbPath.replace(/\.db$/u, '.manifest.json');
const identityPath = `${dbPath}.identity-report.json`;
const identity = JSON.parse(readFileSync(identityPath, 'utf8'));

const db = new Database(dbPath, { readonly: true });
const scalar = (sql) => Object.values(db.query(sql).get())[0];
const outputChecksum = sha256(dbPath);
if (identity.outputChecksum !== outputChecksum) {
  throw new Error('The identity report does not describe this database file.');
}
const integrity = scalar('PRAGMA integrity_check');
const foreignKeyViolations = db.query('PRAGMA foreign_key_check').all().length;
const pack = db.query('SELECT version FROM content_packs').get();
if (pack.version !== args.version) {
  throw new Error(`Database pack version ${pack.version} differs from --version ${args.version}.`);
}
const report = {
  builtAt: db.query('SELECT installed_at FROM content_packs').get().installed_at,
  coreBuildVersion: args.version,
  documents: scalar('SELECT COUNT(*) FROM documents'),
  sections: scalar('SELECT COUNT(*) FROM sections'),
  chunks: scalar('SELECT COUNT(*) FROM chunks'),
  aliases: scalar('SELECT COUNT(*) FROM aliases'),
  embeddingProfiles: scalar('SELECT COUNT(*) FROM embedding_profiles'),
  embeddings: scalar('SELECT COUNT(*) FROM chunk_embeddings'),
  warnings: [],
  errors: [],
  outputChecksum,
  sqliteIntegrity: integrity,
  foreignKeyViolations,
  outputSizeBytes: statSync(dbPath).size,
  sqlitePageSizeBytes: scalar('PRAGMA page_size'),
  sourceChecksums: {
    editionManifest: sha256(manifestPath),
    identityReport: sha256(identityPath),
  },
  coreIdentityIndex: identity,
};
db.close();
if (report.sqliteIntegrity !== 'ok' || report.foreignKeyViolations !== 0) {
  throw new Error('The database failed its integrity checks.');
}

const gzipChecksum = sha256(args.gzip);
const gzipSize = statSync(args.gzip).size;
const baseUrl = `https://github.com/T-Damer/MiniMed/releases/download/${args['release-tag']}`;
report.distributions = {
  browser: {
    checksum: outputChecksum,
    compressedChecksum: gzipChecksum,
    compressedSizeBytes: gzipSize,
    pageSizeBytes: report.sqlitePageSizeBytes,
  },
  android: {
    url: `${baseUrl}/core.db.gz`,
    compression: 'gzip',
    transferSha256: gzipChecksum,
    transferSizeBytes: gzipSize,
    checksum: outputChecksum,
    sizeBytes: report.outputSizeBytes,
    pageSizeBytes: report.sqlitePageSizeBytes,
    rawUrl: `${baseUrl}/MiniMed-${args.version}-core.db`,
  },
};
writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: args.output, documents: report.documents, outputChecksum }));
