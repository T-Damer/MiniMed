/**
 * Builds the dose-rule index (RX1) from the released ГРЛС / holder-site instruction modules and the
 * ЕСКЛП cards.
 *
 *   bun scripts/build-dose-rules.ts
 *
 * Inputs and checks are those of `scripts/build-medication-safety.ts`: the published `.db.zst` of the
 * instruction modules (SHA-256 checked against the catalog) and the ЕСКЛП МНН cards; the registry rows
 * (dosage form, strength, pack sizes) and the ЖНВЛП flag come from the ЕСКЛП positions, the conditions
 * of dispensing from the comparison index. Output:
 * `apps/app/src/features/prescription/data/dose-rules-index.json` (a lazy chunk) and
 * `data/build/dose-rules/report.json`. The index holds the numbers read from the «Способ применения
 * и дозы» sections and the offsets of their sentences, never instruction text. Every decompressed
 * module is deleted after it is read.
 *
 * The published module bytes and the ЕСКЛП release live in the main checkout: from a worktree set
 * `MINIMED_MAIN_CHECKOUT` to its absolute path.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PackUnit } from '@localmed/contracts';

import { normalizeRegistrationKey } from '../apps/app/src/features/medications/mfg-country';
import {
  createDoseBuilder,
  type DoseBuildCard,
  type DoseBuildDocument,
  type DoseBuildRow,
} from '../apps/app/src/features/prescription/dose-build';

const ROOT = resolve(import.meta.dirname, '..');
const MAIN = process.env['MINIMED_MAIN_CHECKOUT'] ?? ROOT;
const CATALOG = join(ROOT, 'apps/app/src/features/modules/catalog.preview.json');
const ESKLP_DIRECTORY = join(MAIN, 'data/build/release-esklp');
const COMPARISON = join(ROOT, 'apps/app/src/features/drug-comparison/data/comparison-index.json');
const OUTPUT = join(ROOT, 'apps/app/src/features/prescription/data/dose-rules-index.json');
const REPORT = join(ROOT, 'data/build/dose-rules/report.json');
/** Where the published instruction-module bytes are kept locally (the release copies). */
const MODULE_DIRECTORIES = [
  'output/module-zstd-grls-leaf1-2026-10-15/grls-instructions-2026.10.15-36a501e7f136-kd1',
  'output/module-zstd-manufacturer-leaf1-2026-10-15/manufacturer-instructions-2026.10.15-4054ceb93a8a',
].map((directory) => join(MAIN, directory));
/** Already decompressed modules (a directory of `<module id>.db`), to skip the zstd step. */
const DECODED_DIRECTORY = process.env['RX1_DECODED_DIR'];
const MAX_ROWS_PER_CARD = 160;
const MAX_PACKS_PER_ROW = 8;
const MAX_TRADES_PER_CARD = 12;

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

function packUnitOf(unit: string | null): PackUnit {
  if (unit === null) return 'other';
  if (/^шт/u.test(unit)) return 'piece';
  if (/^мл/u.test(unit)) return 'ml';
  if (/^г(?:\s|$)/u.test(unit)) return 'g';
  return 'other';
}

function cleanStrength(value: string): string {
  return value
    .replace(/(\d)\.0+(?!\d)/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

interface ComparisonCard {
  readonly s: string;
  readonly x: readonly [number, number, number, number] | null;
}

/**
 * Latin names of the substances from the Allmed reference: for every Allmed entry that is named by
 * its active substances (not by a trade name) and linked to a ЕСКЛП card, the entry's `nameLat`.
 * The most common spelling wins. A Latin name is a fact of the INN list, not Allmed text.
 */
function loadLatinNames(): ReadonlyMap<string, string> {
  const path = join(MAIN, 'apps/app/public/content/medications.db');
  if (!existsSync(path)) {
    console.warn(`No Allmed reference at ${path}: no Latin names`);
    return new Map();
  }
  const database = new Database(path, { readonly: true });
  const counts = new Map<string, Map<string, number>>();
  const query = database.query<{ title: string; metadata_json: string }, []>(
    'select title, metadata_json from documents',
  );
  for (const row of query.all()) {
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    const linked = textOf(metadata['linkedMnnDocumentId']);
    const latin = textOf(metadata['nameLat']);
    const ingredients = stringList(metadata['ingredientNames']);
    if (!linked || !latin || ingredients.length === 0) continue;
    const generic = ingredients.join(' + ').toLocaleLowerCase('ru-RU');
    if (row.title.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ') !== generic) continue;
    if (!/^[A-Za-z][A-Za-z +-]*$/u.test(latin)) continue;
    const slug = linked.replace(/^esklp\.mnn\./u, '');
    const bucket = counts.get(slug) ?? new Map<string, number>();
    bucket.set(latin, (bucket.get(latin) ?? 0) + 1);
    counts.set(slug, bucket);
  }
  database.close();
  const result = new Map<string, string>();
  for (const [slug, bucket] of counts) {
    const best = [...bucket.entries()].toSorted(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    if (best) result.set(slug, best[0]);
  }
  return result;
}

function loadEsklpCards(): readonly DoseBuildCard[] {
  const latinNames = loadLatinNames();
  console.log(`Latin names: ${latinNames.size}`);
  const comparison = JSON.parse(readFileSync(COMPARISON, 'utf8')) as {
    cards: readonly ComparisonCard[];
  };
  const dispensing = new Map(comparison.cards.map((card) => [card.s, card.x]));
  const rows: DoseBuildCard[] = [];
  for (const file of readdirSync(ESKLP_DIRECTORY)
    .filter((name) => name.endsWith('.db'))
    .toSorted()) {
    const database = new Database(join(ESKLP_DIRECTORY, file), { readonly: true });
    const query = database.query<{ id: string; title: string; metadata_json: string }, []>(
      "select id, title, metadata_json from documents where id like 'esklp.mnn.%'",
    );
    for (const row of query.all()) {
      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const registrations = new Set<string>();
      const tradeCounts = new Map<string, number>();
      const registry = new Map<
        string,
        { row: Omit<DoseBuildRow, 'registrations'>; packs: Set<number>; registrations: Set<string> }
      >();
      let essential = false;
      const nodes = Array.isArray(metadata['smnnNodes']) ? metadata['smnnNodes'] : [];
      for (const node of nodes as readonly Record<string, unknown>[]) {
        for (const key of ['tradeNames', 'klpPositions']) {
          const list = node[key];
          if (!Array.isArray(list)) continue;
          for (const item of list as readonly Record<string, unknown>[]) {
            const registration = textOf(item['registrationNumber']);
            if (registration) registrations.add(normalizeRegistrationKey(registration));
            const trade = textOf(item['tradeName']);
            if (trade) tradeCounts.set(trade, (tradeCounts.get(trade) ?? 0) + 1);
          }
        }
        const positions = node['klpPositions'];
        if (!Array.isArray(positions)) continue;
        for (const position of positions as readonly Record<string, unknown>[]) {
          if (position['essentialDrug'] === true) essential = true;
          const form = textOf(position['dosageForm']);
          const strength = textOf(position['strength']);
          if (!form) continue;
          const unit = packUnitOf(textOf(position['unit']));
          const clean = cleanStrength(strength ?? '');
          const key = `${form.toLocaleLowerCase('ru-RU')}|${clean}|${unit}`;
          let entry = registry.get(key);
          if (!entry) {
            entry = {
              row: { form: form.toLocaleLowerCase('ru-RU'), strength: clean, unit, packs: [] },
              packs: new Set(),
              registrations: new Set(),
            };
            registry.set(key, entry);
          }
          const registration = textOf(position['registrationNumber']);
          if (registration) entry.registrations.add(normalizeRegistrationKey(registration));
          const count = position['unitCount'];
          if (typeof count === 'number' && count > 0) entry.packs.add(count);
        }
      }
      const card: InteractionCardLike = {
        id: row.id,
        name: textOf(metadata['standardizedInn']) ?? row.title,
        synonyms: stringList(metadata['inn']),
        components: stringList(metadata['componentInns']),
        atcCodes: stringList(metadata['atcCodes']),
      };
      const slug = row.id.replace(/^esklp\.mnn\./u, '');
      rows.push({
        ...card,
        registrationKeys: [...registrations].toSorted(),
        rows: [...registry.values()]
          .map(({ row: item, packs, registrations: keys }) => ({
            ...item,
            packs: [...packs].toSorted((a, b) => a - b).slice(0, MAX_PACKS_PER_ROW),
            registrations: [...keys].toSorted(),
          }))
          .toSorted(
            (a, b) =>
              a.form.localeCompare(b.form, 'ru') ||
              a.strength.localeCompare(b.strength, 'ru', { numeric: true }),
          )
          .slice(0, MAX_ROWS_PER_CARD),
        trades: [...tradeCounts.entries()]
          .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
          .slice(0, MAX_TRADES_PER_CARD)
          .map(([name]) => name),
        dispensing: dispensing.get(slug) ?? null,
        essential,
        ...(latinNames.has(slug) ? { latin: latinNames.get(slug) as string } : {}),
      });
    }
    database.close();
  }
  return rows.toSorted((a, b) => a.id.localeCompare(b.id));
}

type InteractionCardLike = Pick<
  DoseBuildCard,
  'id' | 'name' | 'synonyms' | 'components' | 'atcCodes'
>;

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

function* readModule(database: Database): Generator<DoseBuildDocument> {
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
        title: row.title,
        type: row.section_type,
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
  const cards = loadEsklpCards();
  console.log(`ЕСКЛП cards: ${cards.length}`);

  const builder = createDoseBuilder({ cards });
  const scratch = join(tmpdir(), `rx1-modules-${process.pid}`);
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
  const stamped = {
    ...asset,
    basis: { ...asset.basis, esklpEdition: esklpEdition() },
  };
  mkdirSync(join(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(stamped)}\n`);
  mkdirSync(join(REPORT, '..'), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
}

function esklpEdition(): string {
  const comparison = JSON.parse(readFileSync(COMPARISON, 'utf8')) as {
    basis: { esklp: { edition: string } };
  };
  return comparison.basis.esklp.edition;
}

main();
