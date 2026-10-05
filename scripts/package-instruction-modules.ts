/**
 * Packages finished, search-compacted module databases that have NO artifact in the catalog yet:
 * the ГРЛС instruction modules (one per ATC level-1 group) and the Allmed reference module.
 * Each database is repacked as framed zstd (verified with the app's own decoder), a catalog entry
 * is created (or, for an existing entry without artifacts, completed) and the whole catalog is
 * validated before the candidate is written. Nothing is uploaded and the committed catalog is
 * only written with --write-catalog, after the files are published.
 *
 *   bun scripts/package-instruction-modules.ts --family grls|allmed|manufacturer --source-dir DIR --out-dir DIR \
 *     --tag TAG --catalog-in FILE [--catalog-out FILE] [--write-catalog] \
 *     [--min-app-version 0.6.48] [--published-at ISO] [--catalog-version V]
 *
 * `--family grls`: every `minimed.medications.instructions.<group>.ru.db` in DIR becomes a new
 * module `kind: medication`, `releaseState: preview`, with its identity read from the database
 * (pack id/version/title, document versions and source checksums → `sourceSetDigest`).
 * `--family manufacturer`: the one module `minimed.medications.instructions.manufacturer-site.ru.db`
 * (instructions from the holders' own sites, not ГРЛС files; collection `manufacturer-instructions`,
 * kept apart from the per-ATC-group `grls-instructions` modules). `grls` skips that module.
 * `--family allmed`: `minimed.medications.ru.db` completes the existing `minimed.medications.ru`
 * entry (same version and source set: installed copies stay valid); its sizes and artifact change.
 *
 * URLs follow the mirrored-dataset convention `…/releases/download/<tag>/<file>.db.zst`, which the
 * app resolves to `raw.githubusercontent.com/<owner>/<repo>/datasets/<tag>/modules/<file>.db.zst`
 * (`artifact-url.ts`); `scripts/publish-module-zstd-mirror.sh --family esklp --tag <tag>` uploads them.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';
import {
  encodeFramed,
  fileSha256,
  verifyFramed,
  ZSTD_ARGS,
  ZSTD_FRAME_CONTENT_BYTES,
} from './lib/zstd-module-archive';

const CATALOG_PATH = 'apps/app/src/features/modules/catalog.preview.json';
const RELEASE_BASE = 'https://github.com/T-Damer/MiniMed/releases/download';
const GRLS_PREFIX = 'minimed.medications.instructions.';
const ALLMED_ID = 'minimed.medications.ru';
const MANUFACTURER_ID = 'minimed.medications.instructions.manufacturer-site.ru';

type Raw = Record<string, unknown>;

interface DocumentIdentity {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sourceChecksum: string;
}

interface PackIdentity {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly packChecksum: string;
  readonly documents: readonly DocumentIdentity[];
  readonly instructionKinds: Readonly<Record<string, number>>;
}

function readPackIdentity(path: string): PackIdentity {
  const database = new Database(path, { readonly: true });
  try {
    const packs = database
      .query('SELECT id, version, title, checksum AS packChecksum FROM content_packs')
      .all() as Array<{ id: string; version: string; title: string; packChecksum: string }>;
    if (packs.length !== 1 || !packs[0]) throw new Error(`${path}: expected exactly one pack.`);
    const rows = database
      .query(
        `SELECT d.id AS documentId, dv.id AS documentVersionId, dv.source_checksum AS sourceChecksum
         FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
         ORDER BY d.id, dv.id`,
      )
      .all() as DocumentIdentity[];
    const kinds: Record<string, number> = {};
    for (const row of database
      .query(
        `SELECT json_extract(metadata_json, '$.documentKind') AS kind, count(*) AS n
         FROM documents GROUP BY 1`,
      )
      .all() as Array<{ kind: string | null; n: number }>) {
      kinds[row.kind ?? 'none'] = row.n;
    }
    return { ...packs[0], documents: rows, instructionKinds: kinds };
  } finally {
    database.close();
  }
}

/** The digest of `esklp_release.py`: sorted identities as compact JSON. */
function sourceSetDigest(documents: readonly DocumentIdentity[]): string {
  const sorted = [...documents].sort((a, b) =>
    a.documentId === b.documentId
      ? a.documentVersionId < b.documentVersionId
        ? -1
        : 1
      : a.documentId < b.documentId
        ? -1
        : 1,
  );
  const payload = sorted.map((item) => ({
    documentId: item.documentId,
    documentVersionId: item.documentVersionId,
    sourceChecksum: item.sourceChecksum,
  }));
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

const GROUP_TITLES: Readonly<Record<string, string>> = {
  'alimentary-metabolism': 'Пищеварительный тракт и обмен веществ',
  antiinfectives: 'Противоинфекционные препараты системного действия',
  'antineoplastic-immunomodulating': 'Противоопухолевые и иммуномодулирующие средства',
  antiparasitic: 'Противопаразитарные препараты, инсектициды и репелленты',
  blood: 'Средства, влияющие на кроветворение и кровь',
  cardiovascular: 'Сердечно-сосудистая система',
  dermatological: 'Дерматологические препараты',
  'genitourinary-hormones': 'Мочеполовая система и половые гормоны',
  musculoskeletal: 'Костно-мышечная система',
  'nervous-system': 'Нервная система',
  respiratory: 'Дыхательная система',
  'sensory-organs': 'Органы чувств',
  'systemic-hormones': 'Гормональные препараты системного действия (исключая половые гормоны)',
  unclassified: 'Без кода АТХ',
  various: 'Прочие препараты',
};

function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string): number[] =>
    value.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = [parse(version), parse(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

const { values } = parseArgs({
  options: {
    family: { type: 'string' },
    'source-dir': { type: 'string' },
    'out-dir': { type: 'string' },
    tag: { type: 'string' },
    'catalog-in': { type: 'string' },
    'catalog-out': { type: 'string' },
    'write-catalog': { type: 'boolean', default: false },
    'min-app-version': { type: 'string', default: '0.6.48' },
    'published-at': { type: 'string' },
    'catalog-version': { type: 'string' },
    report: { type: 'string' },
  },
});
const family = values.family;
const sourceDir = values['source-dir'];
const outDir = values['out-dir'];
const tag = values.tag;
if (
  (family !== 'grls' && family !== 'allmed' && family !== 'manufacturer') ||
  !sourceDir ||
  !outDir ||
  !tag
) {
  throw new Error(
    'Usage: bun scripts/package-instruction-modules.ts --family grls|allmed|manufacturer --source-dir DIR --out-dir DIR --tag TAG [--catalog-in FILE] [--catalog-out FILE] [--write-catalog]',
  );
}
const minAppVersion = values['min-app-version'] as string;
mkdirSync(outDir, { recursive: true });

const catalog = JSON.parse(readFileSync(values['catalog-in'] ?? CATALOG_PATH, 'utf8')) as {
  modules: Raw[];
} & Raw;
ContentModuleCatalogSchema.parse(catalog);

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.db'))
  .filter((name) => {
    if (family === 'allmed') return name === `${ALLMED_ID}.db`;
    if (family === 'manufacturer') return name === `${MANUFACTURER_ID}.db`;
    // The manufacturer module shares the prefix but is its own family and collection.
    return name.startsWith(GRLS_PREFIX) && name !== `${MANUFACTURER_ID}.db`;
  })
  .sort();
if (files.length === 0) throw new Error(`No databases for family ${family} in ${sourceDir}.`);

interface Packaged {
  readonly moduleId: string;
  readonly file: string;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly decodedSha256: string;
  readonly decodedSizeBytes: number;
  readonly documents: number;
  readonly kinds: Readonly<Record<string, number>>;
  readonly mirror: string;
}
const packaged: Packaged[] = [];

for (const name of files) {
  const sourcePath = join(sourceDir, name);
  const identity = readPackIdentity(sourcePath);
  const decodedSha256 = fileSha256(sourcePath);
  const decodedSizeBytes = statSync(sourcePath).size;
  const archiveName = `${name}.zst`;
  const archivePath = join(outDir, archiveName);
  if (existsSync(archivePath)) throw new Error(`Refusing to overwrite ${archivePath}.`);
  try {
    encodeFramed(sourcePath, archivePath);
    await verifyFramed(archivePath, decodedSizeBytes, decodedSha256);
  } catch (cause) {
    rmSync(archivePath, { force: true });
    throw cause;
  }
  const sizeBytes = statSync(archivePath).size;
  if (sizeBytes >= 100 * 1024 * 1024) {
    throw new Error(
      `${archiveName} is ${sizeBytes} bytes: GitHub rejects blobs of 100 MB or more.`,
    );
  }
  const archiveSha256 = fileSha256(archivePath);
  const url = `${RELEASE_BASE}/${tag}/${archiveName}`;
  const digest = sourceSetDigest(identity.documents);
  const artifact: Raw = {
    id: `${identity.id}-index-${identity.version}`,
    kind: 'index',
    required: true,
    url,
    sha256: archiveSha256,
    sizeBytes,
    compression: 'zstd',
    decodedSha256,
    decodedSizeBytes,
    sourceSetDigest: digest,
  };
  const sizes = {
    downloadBytes: sizeBytes,
    installedBytes: decodedSizeBytes,
    sourceAssetsDownloadBytes: null,
    precision: 'exact',
  };

  if (family === 'allmed') {
    const index = catalog.modules.findIndex((module) => module['id'] === ALLMED_ID);
    const existing = catalog.modules[index];
    if (!existing) throw new Error('The catalog has no Allmed entry.');
    if (existing['version'] !== identity.version) {
      throw new Error(`Allmed version ${identity.version} differs from the catalog's.`);
    }
    // The catalog's digest is the pack checksum of the original source set: it must be the one the
    // database still records (the search compaction does not change the logical content).
    if (existing['sourceSetDigest'] !== identity.packChecksum) {
      throw new Error(
        `Allmed source set ${identity.packChecksum} differs from the catalog's ${String(existing['sourceSetDigest'])}.`,
      );
    }
    artifact['sourceSetDigest'] = existing['sourceSetDigest'];
    const compatibility = existing['compatibility'] as Raw;
    catalog.modules[index] = {
      ...existing,
      artifacts: [artifact],
      sizes,
      compatibility: {
        ...compatibility,
        minAppVersion: versionAtLeast(String(compatibility['minAppVersion']), minAppVersion)
          ? compatibility['minAppVersion']
          : minAppVersion,
      },
    };
  } else {
    const group = identity.id.slice(GRLS_PREFIX.length, -'.ru'.length);
    const manufacturer = family === 'manufacturer';
    const entry: Raw = {
      id: identity.id,
      version: identity.version,
      kind: 'medication',
      collection: manufacturer ? 'manufacturer-instructions' : 'grls-instructions',
      title: identity.title,
      description: manufacturer
        ? 'Инструкции, взятые с сайтов держателей регистрационных удостоверений, а не файлы ГРЛС: дословно, с адресом документа, датой получения и способом сопоставления с регистрацией (номер в тексте, номер на странице или название + форма + держатель), как записано в происхождении каждого документа.'
        : `Официальные инструкции ГРЛС: ${GROUP_TITLES[group] ?? group}. Листки-вкладыши, инструкции по применению и ОХЛП дословно, с редакцией, источником и пометкой OCR.`,
      required: false,
      releaseState: 'preview',
      specialties: [],
      populations: [],
      tags: manufacturer
        ? ['manufacturer-site', 'official-instruction', 'instructions']
        : ['grls', 'official-instruction', 'instructions'],
      compatibility: {
        minAppVersion,
        maxAppVersion: null,
        schemaVersion: 2,
        coreCatalogVersion: '1',
      },
      sourceSetDigest: digest,
      dependencies: [{ moduleId: 'minimed.core.ru', versionRange: '^1.0.0', required: true }],
      sizes,
      capabilities: {
        search: true,
        fullText: true,
        structuredTables: false,
        images: false,
        originalPdf: false,
        structuredKnowledge: false,
        calculations: false,
      },
      artifacts: [artifact],
      documents: [],
      previewDocumentCount: identity.documents.length,
    };
    const index = catalog.modules.findIndex((module) => module['id'] === identity.id);
    if (index === -1) catalog.modules.push(entry);
    else catalog.modules[index] = entry;
  }
  packaged.push({
    moduleId: identity.id,
    file: archiveName,
    url,
    sha256: archiveSha256,
    sizeBytes,
    decodedSha256,
    decodedSizeBytes,
    documents: identity.documents.length,
    kinds: identity.instructionKinds,
    mirror: `datasets/${tag}: modules/${archiveName}`,
  });
  console.log(
    `${archiveName}: ${(decodedSizeBytes / 1e6).toFixed(1)} → ${(sizeBytes / 1e6).toFixed(1)} MB`,
  );
}

if (values['published-at']) catalog['publishedAt'] = values['published-at'];
if (values['catalog-version']) catalog['catalogVersion'] = values['catalog-version'];
ContentModuleCatalogSchema.parse(catalog);
const candidate = serializeContentModuleCatalog(catalog);
if (values['catalog-out']) writeFileSync(values['catalog-out'], candidate);
if (values['write-catalog']) writeFileSync(CATALOG_PATH, candidate);

const summary = {
  family,
  tag,
  zstdArgs: ZSTD_ARGS,
  frameContentBytes: ZSTD_FRAME_CONTENT_BYTES,
  modules: packaged.length,
  documents: packaged.reduce((sum, item) => sum + item.documents, 0),
  decodedBytes: packaged.reduce((sum, item) => sum + item.decodedSizeBytes, 0),
  downloadBytes: packaged.reduce((sum, item) => sum + item.sizeBytes, 0),
  files: packaged,
};
writeFileSync(
  values.report ?? join(outDir, 'package-report.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(
  `${family}: ${summary.modules} modules, ${(summary.decodedBytes / 1e6).toFixed(1)} → ${(summary.downloadBytes / 1e6).toFixed(1)} MB`,
);
