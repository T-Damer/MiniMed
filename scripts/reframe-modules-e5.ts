/**
 * Frames e5-embedded modules (`tools/ingest/scripts/embed_modules_e5.py`) as zstd under new mirror
 * tags and points the catalog at them. Nothing is uploaded; the committed catalog is only written
 * with --write-catalog, after `scripts/publish-module-zstd-mirror.sh … --create` for every tag.
 *
 *   bun scripts/reframe-modules-e5.ts --family clinical --decoded-dir data/build/clinical-e5/decoded \
 *     --out-dir output/module-zstd-e5-2026-10-05 --tag clinical-e5-2026.10.05 [--write-catalog]
 *   bun scripts/reframe-modules-e5.ts --family medications --decoded-dir data/build/drug-e5/decoded \
 *     --out-dir output/module-zstd-drug-e5-2026-10-05 [--write-catalog]
 *
 * clinical: `clinical-<id>-<old tag>.db.zst` becomes `clinical-<id>-<tag>.db.zst` under `--tag`.
 * medications (ГРЛС instructions, Allmed): the file name stays and the tag becomes `<old tag>-e5`,
 * so every source release keeps its own mirror branch (`--family esklp` layout when publishing).
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
const FAMILY_IDS = {
  clinical: ['minimed.clinical.recommendation.'],
  medications: ['minimed.medications.instructions.', 'minimed.medications.ru'],
} as const;
const RELEASE_BASE = 'https://github.com/T-Damer/MiniMed/releases/download';

const { values } = parseArgs({
  options: {
    family: { type: 'string' },
    'decoded-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    tag: { type: 'string' },
    'write-catalog': { type: 'boolean', default: false },
    'catalog-out': { type: 'string' },
  },
});
const family = values.family as keyof typeof FAMILY_IDS | undefined;
const decodedDir = values['decoded-dir'];
const outDir = values['out-dir'];
const tag = values.tag;
if (
  !family ||
  !(family in FAMILY_IDS) ||
  !decodedDir ||
  !outDir ||
  (family === 'clinical' && (!tag || !/^clinical-[a-z0-9.-]+$/u.test(tag)))
) {
  throw new Error(
    'Usage: bun scripts/reframe-modules-e5.ts --family clinical|medications --decoded-dir DIR --out-dir DIR [--tag clinical-…] [--write-catalog]',
  );
}

/** Where a published archive's decoded copy lies and what it is published as. */
function target(
  oldTag: string,
  fileName: string,
): { decodedName: string; newTag: string; newFileName: string } | null {
  if (family === 'clinical') {
    const suffix = `-${oldTag}.db.zst`;
    if (!fileName.startsWith('clinical-') || !fileName.endsWith(suffix) || !tag) return null;
    const stem = fileName.slice(0, -suffix.length);
    return {
      decodedName: `${stem}-${oldTag}.db`,
      newTag: tag,
      newFileName: `${stem}-${tag}.db.zst`,
    };
  }
  if (!fileName.startsWith('minimed.medications.') || !fileName.endsWith('.db.zst')) return null;
  const newTag = oldTag.endsWith('-e5') ? oldTag : `${oldTag}-e5`;
  return { decodedName: fileName.slice(0, -'.zst'.length), newTag, newFileName: fileName };
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
  tag: string;
  file: string;
  sizeBytes: number;
  decodedSizeBytes: number;
}> = [];
for (const module of raw.modules) {
  const ids: readonly string[] = FAMILY_IDS[family];
  if (!ids.some((prefix) => module.id === prefix || module.id.startsWith(prefix))) continue;
  const artifact = module.artifacts.find((entry) => entry['kind'] === 'index');
  const url = artifact?.['url'];
  if (!artifact || typeof url !== 'string' || artifact['compression'] !== 'zstd') continue;
  const [oldTag = '', publishedName = ''] = url.slice(RELEASE_BASE.length + 1).split('/');
  const mapped = url.startsWith(`${RELEASE_BASE}/`) ? target(oldTag, publishedName) : null;
  if (!mapped) throw new Error(`Unexpected URL ${url}`);
  if (oldTag === mapped.newTag) continue;
  const fileName = mapped.newFileName;
  // Medication tags each get a subdirectory: that is the --source-dir their mirror branch takes.
  const archiveDir = family === 'clinical' ? outDir : join(outDir, mapped.newTag);
  const archivePath = join(archiveDir, fileName);
  mkdirSync(archiveDir, { recursive: true });
  const decodedPath = join(decodedDir, mapped.decodedName);
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
  artifact['url'] = `${RELEASE_BASE}/${mapped.newTag}/${fileName}`;
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
  files.push({
    moduleId: module.id,
    tag: mapped.newTag,
    file: fileName,
    sizeBytes,
    decodedSizeBytes,
  });
}

if (files.length === 0) throw new Error(`No ${family} module was reframed.`);
ContentModuleCatalogSchema.parse(raw);
const candidate = serializeContentModuleCatalog(raw);
if (values['catalog-out']) writeFileSync(values['catalog-out'], candidate);
if (values['write-catalog']) writeFileSync(CATALOG_PATH, candidate);
const total = files.reduce((sum, item) => sum + item.sizeBytes, 0);
writeFileSync(
  join(outDir, 'reframe-report.json'),
  `${JSON.stringify({ family, modules: files.length, downloadBytes: total, files }, null, 2)}\n`,
);
console.log(
  `${files.length} ${family} modules → ${[...new Set(files.map((item) => item.tag))].join(', ')}: ${(total / 1e6).toFixed(1)} MB`,
);
