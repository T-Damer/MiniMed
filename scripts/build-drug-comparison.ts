/**
 * Builds the drug-comparison index (CMP1) from the released ГРЛС / holder-site instruction
 * modules, the ЕСКЛП cards and the ГРЛС register.
 *
 *   bun scripts/build-drug-comparison.ts
 *
 * Inputs and checks are those of `scripts/build-medication-safety.ts`: the published `.db.zst` of
 * the instruction modules (SHA-256 checked against the catalog) and the ЕСКЛП МНН cards. In
 * addition the ГРЛС register export `data/raw/official-grls-registry/catalog-*.json` gives the
 * conditions of dispensing (По рецепту / Без рецепта) of the valid registrations of each card.
 * Output: `apps/app/src/features/drug-comparison/data/comparison-index.json` (a lazy chunk) and
 * `data/build/drug-comparison/report.json`. The index holds registry facts and a map of which
 * sections each instruction has, never instruction text. Every decompressed module is deleted
 * after it is read.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type ComparisonBuildCard,
  type ComparisonBuildDocument,
  createComparisonBuilder,
  type Dispensing,
  registryFacts,
} from '../apps/app/src/features/drug-comparison/comparison-build';
import { normalizeRegistrationKey } from '../apps/app/src/features/medications/mfg-country';

const ROOT = resolve(import.meta.dirname, '..');
const CATALOG = join(ROOT, 'apps/app/src/features/modules/catalog.preview.json');
const ESKLP_DIRECTORY = join(ROOT, 'data/build/release-esklp');
const GRLS_DIRECTORY = join(ROOT, 'data/raw/official-grls-registry');
const OUTPUT = join(ROOT, 'apps/app/src/features/drug-comparison/data/comparison-index.json');
const REPORT = join(ROOT, 'data/build/drug-comparison/report.json');
const MODULE_DIRECTORIES = [
  'output/module-zstd-drug-e5-2026-10-05/grls-instructions-2026.10.05-056961ab2b54-e5',
  'data/build/manufacturer-instruction-module/zst',
].map((directory) => join(ROOT, directory));
/** Already decompressed modules (a directory of `<module id>.db`), to skip the zstd step. */
const DECODED_DIRECTORY = process.env['CMP1_DECODED_DIR'] ?? process.env['SAFE1_DECODED_DIR'];

/** Statuses of a ГРЛС registration that is in force (the others are expired, cancelled or changed). */
const VALID_STATUSES = new Set([
  'Действующий',
  'Выдано по правилам ЕАЭС',
  'Действует, на подтверждении государственной регистрации',
  'Действует, в иностранных упаковках',
]);

interface CatalogModule {
  readonly id: string;
  readonly version: string;
  readonly artifacts: readonly { readonly sha256: string }[];
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

function loadEsklpCards(): { cards: readonly ComparisonBuildCard[]; edition: string } {
  const rows: ComparisonBuildCard[] = [];
  let edition = '';
  for (const file of readdirSync(ESKLP_DIRECTORY)
    .filter((name) => name.endsWith('.db'))
    .toSorted()) {
    const database = new Database(join(ESKLP_DIRECTORY, file), { readonly: true });
    const query = database.query<{ id: string; title: string; metadata_json: string }, []>(
      "select id, title, metadata_json from documents where id like 'esklp.mnn.%'",
    );
    for (const row of query.all()) {
      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const facts = registryFacts(metadata, normalizeRegistrationKey);
      edition = textOf(metadata['sourceEdition']) ?? edition;
      rows.push({
        id: row.id,
        name: textOf(metadata['standardizedInn']) ?? row.title,
        synonyms: stringList(metadata['inn']),
        components: stringList(metadata['componentInns']),
        atcCodes: stringList(metadata['atcCodes']),
        registrationKeys: [...facts.registrations].toSorted(),
        facts,
      });
    }
    database.close();
  }
  return { cards: rows.toSorted((a, b) => a.id.localeCompare(b.id)), edition };
}

function loadRegister(): { register: Map<string, Dispensing>; edition: string } {
  const files = readdirSync(GRLS_DIRECTORY)
    .filter((name) => /^catalog-\d{2}\.\d{2}\.\d{4}\.json$/u.test(name))
    .toSorted((left, right) => {
      const key = (name: string): string => name.slice(8, 18).split('.').toReversed().join('');
      return key(left).localeCompare(key(right));
    });
  const file = files.at(-1);
  if (!file) throw new Error('No ГРЛС register export (catalog-DD.MM.YYYY.json) in data/raw');
  const catalog = JSON.parse(readFileSync(join(GRLS_DIRECTORY, file), 'utf8')) as {
    sourceEdition: string;
    records: readonly Record<string, unknown>[];
  };
  const register = new Map<string, Dispensing>();
  for (const record of catalog.records) {
    const number = textOf(record['registrationNumber']);
    if (!number || !VALID_STATUSES.has(textOf(record['status']) ?? '')) continue;
    const status = textOf(record['prescriptionStatus']);
    const value: Dispensing =
      status === 'По рецепту'
        ? 'rx'
        : status === 'Без рецепта'
          ? 'otc'
          : status === 'Смешанные условия отпуска'
            ? 'mixed'
            : 'unknown';
    register.set(normalizeRegistrationKey(number), value);
  }
  return { register, edition: catalog.sourceEdition };
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

function* readModule(database: Database): Generator<ComparisonBuildDocument> {
  const documents = database
    .query<{ id: string; metadata_json: string; current_version_id: string }, []>(
      'select id, metadata_json, current_version_id from documents order by id',
    )
    .all();
  const sectionsOfVersion = new Map<
    string,
    { type: string | null; title: string; hasText: boolean }[]
  >();
  const sections = database.query<
    { version: string; type: string | null; title: string; has: number },
    []
  >(
    `select s.document_version_id as version, s.section_type as type, s.title as title,
            exists(select 1 from chunks c where c.section_id = s.id and trim(c.original_text) <> '') as has
       from sections s order by s.document_version_id, s.order_index`,
  );
  for (const row of sections.all()) {
    const list = sectionsOfVersion.get(row.version);
    const entry = { type: row.type, title: row.title, hasText: row.has === 1 };
    if (list) list.push(entry);
    else sectionsOfVersion.set(row.version, [entry]);
  }
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
      sections: sectionsOfVersion.get(document.current_version_id) ?? [],
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
  const { cards, edition: esklpEdition } = loadEsklpCards();
  const { register, edition: grlsEdition } = loadRegister();
  console.log(
    `ЕСКЛП cards: ${cards.length} (${esklpEdition}); ГРЛС valid registrations: ${register.size} (${grlsEdition})`,
  );

  const builder = createComparisonBuilder({
    cards,
    register,
    editions: { esklp: esklpEdition, grls: grlsEdition },
  });
  const scratch = join(tmpdir(), `cmp1-modules-${process.pid}`);
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
