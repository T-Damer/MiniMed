/**
 * Frames re-embedded modules (`tools/ingest/scripts/embed_modules.py`) as zstd under new mirror
 * tags and points the catalog at them. Nothing is uploaded; the committed catalog is only written
 * with --write-catalog, after `scripts/publish-module-zstd-mirror.sh … --create` for every tag.
 *
 *   bun scripts/reframe-modules.ts --marker kd1 --family clinical \
 *     --decoded-dir data/build/clinical-kd1/decoded --out-dir output/module-zstd-kd1-2026-10-10 \
 *     --tag clinical-kd1-2026.10.10 [--write-catalog]
 *   bun scripts/reframe-modules.ts --marker kd1 --family medications \
 *     --decoded-dir data/build/drug-kd1/decoded --out-dir output/module-zstd-drug-kd1-2026-10-10
 *
 * clinical: `clinical-<id>-<old tag>.db.zst` becomes `clinical-<id>-<tag>.db.zst` under `--tag`.
 * medications (ГРЛС instructions, Allmed) and esklp (the 15 ЕСКЛП groups): the file name stays and
 * the tag becomes `<source tag>-<marker>` (an earlier embedding marker is replaced), so every source
 * release keeps its own mirror branch (`--family esklp` layout when publishing).
 *
 * The ATC fill (ATC2, `tools/ingest/scripts/build_atc_fill.py`) changes only `documents.metadata_json`
 * of the ЕСКЛП cards, so it is framed the same way:
 *
 *   bun scripts/reframe-modules.ts --marker atc2 --family esklp [--module-id ID ...] \
 *     --decoded-dir data/build/atc-fill/out/patched --out-dir output/module-zstd-esklp-atc2-2026-10-13 \
 *     --published-at 2026-10-13T20:00:00Z
 *
 * `--published-at` moves the catalog's `publishedAt` forward (a remote catalog replaces the bundled
 * one only when it is newer). ATC3 (the stub consensus of `atc_fill.py`) was reframed the same way
 * from the `atc2` modules, only the nine groups that hold a consensus node (`--module-id`):
 * the tag `esklp-2026-08-28-atc2` becomes `esklp-2026-08-28-atc3`, the version `…atc2` `…atc3`.
 *
 * Only `embedding_profiles`/`chunk_embeddings` differ from the published modules, so the source
 * set, document table and artifact ids stay; the module version's embedding suffix becomes
 * `.<marker>` and the artifact gets its new URL, checksums and sizes. Every archive is decoded again
 * and compared with the SQLite's SHA-256 before it is accepted.
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
  esklp: ['minimed.medications.'],
} as const;
/** The 15 ЕСКЛП group modules: `minimed.medications.<group>.ru`, not the instructions or Allmed. */
const ESKLP_MODULE_ID = /^minimed\.medications\.(?!instructions\.)[a-z-]+\.ru$/u;
const RELEASE_BASE = 'https://github.com/T-Damer/MiniMed/releases/download';
/** Same exclusion as `embed_modules.py`: published after E3 and never embedded. */
const EXCLUDED_IDS = new Set(['minimed.medications.instructions.manufacturer-site.ru']);

const { values } = parseArgs({
  options: {
    family: { type: 'string' },
    'decoded-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    tag: { type: 'string' },
    marker: { type: 'string' },
    'write-catalog': { type: 'boolean', default: false },
    'catalog-out': { type: 'string' },
    'published-at': { type: 'string' },
    'module-id': { type: 'string', multiple: true },
  },
});
const family = values.family as keyof typeof FAMILY_IDS | undefined;
const decodedDir = values['decoded-dir'];
const outDir = values['out-dir'];
const tag = values.tag;
const marker = values.marker;
/**
 * Markers of earlier and current vector profiles and of earlier ATC fills (`atc2`, `atc3`),
 * replaced rather than stacked: `esklp-2026-08-28-atc2` + marker `atc3` is `esklp-2026-08-28-atc3`.
 */
const EMBEDDING_MARKER = /[-.](?:e5|kd1|atc\d+)$/u;
if (
  !marker ||
  !/^[a-z0-9]+$/u.test(marker) ||
  !family ||
  !(family in FAMILY_IDS) ||
  !decodedDir ||
  !outDir ||
  (family === 'clinical' && (!tag || !/^clinical-[a-z0-9.-]+$/u.test(tag)))
) {
  throw new Error(
    'Usage: bun scripts/reframe-modules.ts --marker NAME --family clinical|medications|esklp --decoded-dir DIR --out-dir DIR [--tag clinical-…] [--write-catalog]',
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
  const newTag = `${oldTag.replace(EMBEDDING_MARKER, '')}-${marker}`;
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
  if (EXCLUDED_IDS.has(module.id)) continue;
  if (family === 'esklp' && !ESKLP_MODULE_ID.test(module.id)) continue;
  if (values['module-id']?.length && !values['module-id'].includes(module.id)) continue;
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
  module['version'] = `${String(module['version']).replace(EMBEDDING_MARKER, '')}.${marker}`;
  files.push({
    moduleId: module.id,
    tag: mapped.newTag,
    file: fileName,
    sizeBytes,
    decodedSizeBytes,
  });
}

if (files.length === 0) throw new Error(`No ${family} module was reframed.`);
if (values['published-at']) (raw as { publishedAt?: string }).publishedAt = values['published-at'];
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
