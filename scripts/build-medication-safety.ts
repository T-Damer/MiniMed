/**
 * Builds the pregnancy / lactation / age-limit index (SAFE1) from the released ГРЛС / holder-site
 * instruction modules and the ЕСКЛП cards.
 *
 *   bun scripts/build-medication-safety.ts [--out <file>] [--report <file>] [--esklp-dir <dir>]
 *
 * Inputs and checks are those of `scripts/build-drug-interactions.ts`: the published `.db.zst` of
 * the instruction modules (SHA-256 checked against the catalog) and the published ЕСКЛП МНН cards.
 * The index uses no ATC code (ATC4 review: no rule here matches by ATC class or prefix; it matches
 * the substance names and registration numbers only), so the ATC fill does not change it. Output:
 * `apps/app/src/features/medication-safety/data/safety-index.json` (a lazy chunk) and
 * `data/build/medication-safety/report.json`. The index holds offsets into the instruction
 * sections, never instruction text. Every decompressed module is deleted after it is read.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { InteractionCard } from '../apps/app/src/features/drug-interactions/substance-names';
import {
  createSafetyBuilder,
  type SafetyBuildCard,
  type SafetyBuildDocument,
} from '../apps/app/src/features/medication-safety/safety-build';
import { normalizeRegistrationKey } from '../apps/app/src/features/medications/mfg-country';
import {
  type CatalogEsklpModule,
  readEsklpCardMetadata,
  withEsklpDirectory,
} from './lib/published-esklp';

const ROOT = resolve(import.meta.dirname, '..');
/** The checkout that holds the ignored local `data/` and `output/` (the main one, from a worktree). */
const DATA_ROOT = process.env['MINIMED_DATA_ROOT'] ?? ROOT;
const CATALOG = join(ROOT, 'apps/app/src/features/modules/catalog.preview.json');
const OUTPUT = resolve(
  argument('--out') ?? join(ROOT, 'apps/app/src/features/medication-safety/data/safety-index.json'),
);
const REPORT = resolve(
  argument('--report') ?? join(DATA_ROOT, 'data/build/medication-safety/report.json'),
);
/** Where the published instruction-module bytes are kept locally (the release copies). */
const MODULE_DIRECTORIES = [
  'output/module-zstd-grls-ocr1-kd1-2026-10-14/grls-instructions-2026.10.14-15ce0cf79f45-kd1',
  'output/module-zstd-manufacturer-ocr1-2026-10-14/manufacturer-instructions-2026.10.14-769c87d55bcc',
].map((directory) => join(DATA_ROOT, directory));
/** Already decompressed modules (a directory of `<module id>.db`), to skip the zstd step. */
const DECODED_DIRECTORY = process.env['SAFE1_DECODED_DIR'];

interface CatalogModule {
  readonly id: string;
  readonly version: string;
  readonly artifacts: readonly { readonly sha256: string }[];
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256File(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
    : [];
}

function loadEsklpCards(directory: string): readonly SafetyBuildCard[] {
  const rows: SafetyBuildCard[] = [];
  for (const { id, title, metadata } of readEsklpCardMetadata(directory)) {
    const registrations = new Set<string>();
    const nodes = Array.isArray(metadata['smnnNodes']) ? metadata['smnnNodes'] : [];
    for (const node of nodes as readonly Record<string, unknown>[]) {
      for (const key of ['tradeNames', 'klpPositions']) {
        const list = node[key];
        if (!Array.isArray(list)) continue;
        for (const item of list as readonly Record<string, unknown>[]) {
          const registration = textOf(item['registrationNumber']);
          if (registration) registrations.add(normalizeRegistrationKey(registration));
        }
      }
    }
    // The safety index matches by name and registration only; the ATC field is carried empty.
    const card: InteractionCard = {
      id,
      name: textOf(metadata['standardizedInn']) ?? title,
      synonyms: stringList(metadata['inn']),
      components: stringList(metadata['componentInns']),
      atcCodes: [],
    };
    rows.push({ ...card, registrationKeys: [...registrations].toSorted() });
  }
  return rows.toSorted((a, b) => a.id.localeCompare(b.id));
}

function registrationNumbersOf(metadata: Record<string, unknown>): readonly string[] {
  const numbers = new Set<string>();
  const primary = textOf(metadata['registrationNumber']);
  if (primary) numbers.add(primary);
  for (const key of ['requestedRegistrationNumbers', 'registrationNumbers']) {
    for (const value of stringList(metadata[key])) numbers.add(value);
  }
  const matches = metadata['registrationMatches'];
  if (Array.isArray(matches)) {
    for (const item of matches as readonly Record<string, unknown>[]) {
      const value = textOf(item['registrationNumber']);
      if (value) numbers.add(value);
    }
  }
  return [...numbers].map(normalizeRegistrationKey).toSorted();
}

function* readModule(database: Database): Generator<SafetyBuildDocument> {
  const documents = database
    .query<{ id: string; metadata_json: string; current_version_id: string }, []>(
      'select id, metadata_json, current_version_id from documents order by id',
    )
    .all();
  const sectionRows = database.query<
    { id: string; title: string; section_type: string | null },
    [string]
  >(
    'select id, title, section_type from sections where document_version_id = ? order by order_index',
  );
  const chunkRows = database.query<{ original_text: string }, [string]>(
    'select original_text from chunks where section_id = ? order by order_index',
  );
  for (const document of documents) {
    const metadata = JSON.parse(document.metadata_json) as Record<string, unknown>;
    yield {
      id: document.id,
      kind: textOf(metadata['documentKind']) ?? 'unknown',
      sourceClass: metadata['sourceClass'] === 'manufacturer-site' ? 'manufacturer-site' : 'grls',
      tradeName: textOf(metadata['tradeName']),
      inn: textOf(metadata['inn']),
      dosageForm: textOf(metadata['dosageForm']),
      registrationKeys: registrationNumbersOf(metadata),
      sections: sectionRows.all(document.current_version_id).map((row) => ({
        id: row.id,
        type: row.section_type,
        title: row.title,
        chunks: () => chunkRows.all(row.id).map((chunk) => chunk.original_text),
      })),
    };
  }
}

function main(): void {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
    modules: readonly CatalogModule[];
  };
  const instructionModules = catalog.modules
    .filter((module) => module.id.startsWith('minimed.medications.instructions.'))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const cards = withEsklpDirectory(
    {
      directory: argument('--esklp-dir'),
      modules: catalog.modules as readonly CatalogEsklpModule[],
      dataRoot: DATA_ROOT,
    },
    loadEsklpCards,
  );
  console.log(`ЕСКЛП cards: ${cards.length}`);

  const builder = createSafetyBuilder({ cards });
  const scratch = join(tmpdir(), `safe1-modules-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  try {
    for (const module of instructionModules) {
      const artifact = module.artifacts[0];
      const fileName = `${module.id}.db.zst`;
      const source = MODULE_DIRECTORIES.map((directory) => join(directory, fileName)).find(
        existsSync,
      );
      if (!source || !artifact) throw new Error(`The published file of ${module.id} is missing`);
      const digest = sha256File(source);
      if (digest !== artifact.sha256) {
        throw new Error(`${fileName}: ${digest} does not match the catalog (${artifact.sha256})`);
      }
      let decoded = join(scratch, `${module.id}.db`);
      const preDecoded = DECODED_DIRECTORY ? join(DECODED_DIRECTORY, `${module.id}.db`) : null;
      if (preDecoded && existsSync(preDecoded)) decoded = preDecoded;
      else {
        const result = Bun.spawnSync(['zstd', '-d', '-q', '-f', source, '-o', decoded]);
        if (result.exitCode !== 0) throw new Error(`zstd failed on ${fileName}`);
      }
      const database = new Database(decoded, { readonly: true });
      builder.addModule(
        { id: module.id, version: module.version, sha256: artifact.sha256 },
        readModule(database),
      );
      console.log(`${module.id}: read`);
      database.close();
      if (decoded.startsWith(scratch)) rmSync(decoded, { force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const { asset, report } = builder.finish();
  mkdirSync(join(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(asset)}\n`);
  mkdirSync(join(REPORT, '..'), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
