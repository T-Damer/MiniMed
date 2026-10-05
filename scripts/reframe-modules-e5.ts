/**
 * Frames the e5-embedded clinical-recommendation modules (`tools/ingest/scripts/
 * embed_clinical_modules_e5.py`) as zstd under a new mirror tag and points the catalog at them.
 * Nothing is uploaded; the committed catalog is only written with --write-catalog, after
 * `scripts/publish-module-zstd-mirror.sh --family clinical --tag TAG --source-dir OUT --create`.
 *
 *   bun scripts/reframe-clinical-e5.ts --decoded-dir data/build/clinical-e5/decoded \
 *     --out-dir output/module-zstd-e5-2026-10-05 --tag clinical-e5-2026.10.05 [--write-catalog]
 *
 * Only `embedding_profiles`/`chunk_embeddings` differ from the published modules, so the source
 * set, document table and artifact ids stay; the module version gets a `.e5` suffix and the
 * artifact its new URL, checksums and sizes. Every archive is decoded again and compared with the
 * SQLite's SHA-256 before it is accepted.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';
import { encodeFramed, fileSha256, verifyFramed } from './lib/zstd-module-archive';

const CATALOG_PATH = 'apps/app/src/features/modules/catalog.preview.json';
const ID_PREFIX = 'minimed.clinical.recommendation.';
const RELEASE_BASE = 'https://github.com/T-Damer/MiniMed/releases/download';

const { values } = parseArgs({
  options: {
    'decoded-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    tag: { type: 'string' },
    'write-catalog': { type: 'boolean', default: false },
    'catalog-out': { type: 'string' },
  },
});
const decodedDir = values['decoded-dir'];
const outDir = values['out-dir'];
const tag = values.tag;
if (!decodedDir || !outDir || !tag || !/^clinical-[a-z0-9.-]+$/u.test(tag)) {
  throw new Error(
    'Usage: bun scripts/reframe-clinical-e5.ts --decoded-dir DIR --out-dir DIR --tag clinical-… [--write-catalog]',
  );
}

const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as {
  modules: Array<
    Record<string, unknown> & { id: string; artifacts: Array<Record<string, unknown>> }
  >;
};
ContentModuleCatalogSchema.parse(raw);
mkdirSync(outDir, { recursive: true });

const files: Array<{
  moduleId: string;
  file: string;
  sizeBytes: number;
  decodedSizeBytes: number;
}> = [];
for (const module of raw.modules) {
  if (!module.id.startsWith(ID_PREFIX)) continue;
  const artifact = module.artifacts.find((entry) => entry['kind'] === 'index');
  const url = artifact?.['url'];
  if (!artifact || typeof url !== 'string' || artifact['compression'] !== 'zstd') continue;
  const [oldTag = '', fileName0 = ''] = url.slice(RELEASE_BASE.length + 1).split('/');
  const suffix = `-${oldTag}.db.zst`;
  if (
    !url.startsWith(`${RELEASE_BASE}/`) ||
    !fileName0.startsWith('clinical-') ||
    !fileName0.endsWith(suffix)
  )
    throw new Error(`Unexpected URL ${url}`);
  const stem = fileName0.slice(0, -suffix.length);
  if (oldTag === tag) continue;
  const fileName = `${stem}-${tag}.db.zst`;
  const archivePath = join(outDir, fileName);
  const decodedPath = join(decodedDir, `${stem}-${oldTag}.db`);
  let decodedSha256: string;
  let decodedSizeBytes: number;
  if (existsSync(decodedPath)) {
    decodedSha256 = fileSha256(decodedPath);
    decodedSizeBytes = statSync(decodedPath).size;
    if (!existsSync(archivePath)) {
      try {
        encodeFramed(decodedPath, archivePath);
      } catch (cause) {
        rmSync(archivePath, { force: true });
        throw cause;
      }
    }
  } else if (existsSync(archivePath)) {
    // Already framed and the decoded copy deleted: take the identity from the reference decoder.
    const temporary = join(outDir, `${fileName}.check.db`);
    const decoded = spawnSync('zstd', ['-dqf', '--long=27', archivePath, '-o', temporary]);
    if (decoded.status !== 0) throw new Error(`zstd could not decode ${archivePath}.`);
    decodedSha256 = fileSha256(temporary);
    decodedSizeBytes = statSync(temporary).size;
    rmSync(temporary, { force: true });
  } else {
    throw new Error(`Missing ${decodedPath} for ${module.id}.`);
  }
  try {
    await verifyFramed(archivePath, decodedSizeBytes, decodedSha256);
  } catch (cause) {
    if (existsSync(decodedPath)) rmSync(archivePath, { force: true });
    throw cause;
  }
  const sizeBytes = statSync(archivePath).size;
  artifact['url'] = `${RELEASE_BASE}/${tag}/${fileName}`;
  artifact['sha256'] = fileSha256(archivePath);
  artifact['sizeBytes'] = sizeBytes;
  artifact['decodedSha256'] = decodedSha256;
  artifact['decodedSizeBytes'] = decodedSizeBytes;
  module['sizes'] = {
    ...(module['sizes'] as Record<string, unknown>),
    downloadBytes: sizeBytes,
    installedBytes: decodedSizeBytes,
  };
  const version = String(module['version']);
  if (!version.endsWith('.e5')) module['version'] = `${version}.e5`;
  files.push({ moduleId: module.id, file: fileName, sizeBytes, decodedSizeBytes });
}

if (files.length === 0) throw new Error('No clinical module was reframed.');
ContentModuleCatalogSchema.parse(raw);
const candidate = serializeContentModuleCatalog(raw);
if (values['catalog-out']) writeFileSync(values['catalog-out'], candidate);
if (values['write-catalog']) writeFileSync(CATALOG_PATH, candidate);
const total = files.reduce((sum, item) => sum + item.sizeBytes, 0);
writeFileSync(
  join(outDir, 'reframe-report.json'),
  `${JSON.stringify({ tag, modules: files.length, downloadBytes: total, files }, null, 2)}\n`,
);
console.log(`${files.length} clinical modules → ${tag}: ${(total / 1e6).toFixed(1)} MB`);
