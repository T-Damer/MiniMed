/**
 * Builds the drug-interaction index (INT1) from the released ГРЛС / holder-site instruction
 * modules and the ЕСКЛП cards.
 *
 *   bun scripts/build-drug-interactions.ts [--debug-dir <dir>] [--out <file>] [--report <file>]
 *                                          [--esklp-dir <dir>]
 *
 * Inputs (all local, none is changed):
 * - the published `.db.zst` of the 15 ГРЛС instruction modules and the holder-site module, checked
 *   against the SHA-256 the catalog states (`apps/app/src/features/modules/catalog.preview.json`);
 * - the published ЕСКЛП group modules (`scripts/lib/published-esklp.ts`, the same SHA-256 check;
 *   `--esklp-dir` takes a directory of decoded databases instead): names, components, ATC codes,
 *   registration numbers. The ATC codes are chosen by `selectAtcCodes` (ATC4, `atc-codes.ts`),
 *   the declared exceptions and the declared class additions (`addClasses`, ATC4c / CLS1: `primary`
 *   replaces a wrong code, `secondary` is an additional class one component brings; each quotes the
 *   product's own instruction, and the build refuses a quote that is not in it) in
 *   `data/atc-code-exceptions.json`;
 * - `MINIMED_DATA_ROOT`: the checkout that holds the ignored `data/` and `output/` (the main one,
 *   when this runs in a worktree);
 * - the НСИ «АТХ» names (`apps/app/src/features/medications/atc-names.json`).
 * Output: `apps/app/src/features/drug-interactions/data/interaction-index.json` (a lazy chunk) and
 * `data/build/drug-interactions/report.json`. The index holds offsets into the instruction
 * sections, never the instruction text. Each decompressed module is deleted after it is read.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type AtcClassAddition,
  type AtcCodeException,
  additionEvidenceHolds,
  parseAtcClassAdditions,
  parseAtcCodeExceptions,
  redundantSecondary,
  selectAtcCodesOfMetadata,
} from '../apps/app/src/features/drug-interactions/atc-codes';
import {
  type BuildCard,
  type BuildInputDocument,
  type BuildInputSection,
  createInteractionBuilder,
} from '../apps/app/src/features/drug-interactions/interaction-build';
import {
  checkPair,
  type DrugItem,
} from '../apps/app/src/features/drug-interactions/interaction-check';
import { SPAN_FLAG_INTERACTIONS } from '../apps/app/src/features/drug-interactions/interaction-extract';
import { createInteractionIndex } from '../apps/app/src/features/drug-interactions/interaction-index';
import type { InteractionCard } from '../apps/app/src/features/drug-interactions/substance-names';
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
const ATC_NAMES = join(ROOT, 'apps/app/src/features/medications/atc-names.json');
const EXCEPTIONS = join(
  ROOT,
  'apps/app/src/features/drug-interactions/data/atc-code-exceptions.json',
);
const OUTPUT = resolve(
  argument('--out') ??
    join(ROOT, 'apps/app/src/features/drug-interactions/data/interaction-index.json'),
);
const REPORT = resolve(
  argument('--report') ?? join(DATA_ROOT, 'data/build/drug-interactions/report.json'),
);
/** Where the published instruction-module bytes are kept locally (the release copies). */
const MODULE_DIRECTORIES = [
  'output/module-zstd-grls-ocr1-kd1-2026-10-14/grls-instructions-2026.10.14-15ce0cf79f45-kd1',
  'output/module-zstd-manufacturer-ocr1-2026-10-14/manufacturer-instructions-2026.10.14-769c87d55bcc',
].map((directory) => join(DATA_ROOT, directory));

interface CatalogModule {
  readonly id: string;
  readonly version: string;
  readonly artifacts: readonly { readonly url?: string | null; readonly sha256: string }[];
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

interface EsklpCardRow {
  readonly card: InteractionCard;
  readonly registrationKeys: readonly string[];
}

function loadEsklpCards(
  directory: string,
  exceptions: readonly AtcCodeException[],
  additions: readonly AtcClassAddition[],
): readonly EsklpCardRow[] {
  const rows: EsklpCardRow[] = [];
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
    const selection = selectAtcCodesOfMetadata(id, metadata, exceptions, additions);
    const redundant = redundantSecondary(selection);
    if (redundant.length > 0) {
      throw new Error(
        `addClasses: ${redundant.map((entry) => entry.code).join(', ')} (${id}) is already among the card's own codes; remove the secondary declaration`,
      );
    }
    rows.push({
      card: {
        id,
        name: textOf(metadata['standardizedInn']) ?? title,
        synonyms: stringList(metadata['inn']),
        components: stringList(metadata['componentInns']),
        atcCodes: selection.codes,
        ...(selection.secondary.length > 0 ? { secondaryClasses: selection.secondary } : {}),
      },
      registrationKeys: [...registrations].toSorted(),
    });
  }
  for (const addition of additions) {
    if (!rows.some((row) => row.card.id === addition.card)) {
      throw new Error(`addClasses: the card ${addition.card} is not in the ЕСКЛП modules`);
    }
  }
  return rows.toSorted((a, b) => a.card.id.localeCompare(b.card.id));
}

/**
 * Checks the quote of each class addition against the text of its instruction (a section of the
 * module just read). Returns the documents it found; the caller refuses additions left unchecked.
 */
function verifyAdditionEvidence(
  database: Database,
  additions: readonly AtcClassAddition[],
  verified: Set<string>,
): void {
  const documentRow = database.query<{ current_version_id: string }, [string]>(
    'select current_version_id from documents where id = ?',
  );
  const sectionRows = database.query<{ id: string; title: string }, [string]>(
    'select id, title from sections where document_version_id = ? order by order_index',
  );
  const chunkRows = database.query<{ original_text: string }, [string]>(
    'select original_text from chunks where section_id = ? order by order_index',
  );
  for (const addition of additions) {
    const document = documentRow.get(addition.evidence.document);
    if (!document) continue;
    const sections = sectionRows.all(document.current_version_id).map((section) => ({
      title: section.title,
      text: chunkRows
        .all(section.id)
        .map((chunk) => chunk.original_text)
        .join(' '),
    }));
    if (!additionEvidenceHolds(addition, sections)) {
      throw new Error(
        `addClasses: the quote for ${addition.card} is not in the section «${addition.evidence.section}» of ${addition.evidence.document}`,
      );
    }
    verified.add(addition.card);
  }
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

function* readModule(database: Database): Generator<BuildInputDocument> {
  const documents = database
    .query<{ id: string; title: string; metadata_json: string; current_version_id: string }, []>(
      'select id, title, metadata_json, current_version_id from documents order by id',
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
    const sections: BuildInputSection[] = sectionRows
      .all(document.current_version_id)
      .map((row) => ({
        id: row.id,
        type: row.section_type,
        title: row.title,
        chunks: () => chunkRows.all(row.id).map((chunk) => chunk.original_text),
      }));
    yield {
      id: document.id,
      title: document.title,
      kind: textOf(metadata['documentKind']) ?? 'unknown',
      sourceClass: metadata['sourceClass'] === 'manufacturer-site' ? 'manufacturer-site' : 'grls',
      tradeName: textOf(metadata['tradeName']),
      inn: textOf(metadata['inn']),
      registrationKeys: registrationNumbersOf(metadata),
      sections,
    };
  }
}

/**
 * How much the index covers: the share of МНН with an indexed interaction section, and how many
 * pairs among the 200 most common drugs have at least one sentence in either instruction. «Most
 * common» = single-substance cards with the most registrations in the ЕСКЛП (a market-breadth
 * proxy, not a prescription count).
 */
function measureCoverage(
  asset: Parameters<typeof createInteractionIndex>[0],
  cards: readonly EsklpCardRow[],
): Record<string, unknown> {
  const index = createInteractionIndex(asset);
  const top = cards
    .map((row, position) => ({ row, position }))
    .filter(({ row }) => row.card.components.length === 0 && !row.card.name.includes('+'))
    .toSorted(
      (a, b) =>
        b.row.registrationKeys.length - a.row.registrationKeys.length ||
        a.row.card.id.localeCompare(b.row.card.id),
    )
    .slice(0, 200);
  const items: DrugItem[] = top.map(({ row, position }) => ({
    id: row.card.id,
    kind: 'drug',
    card: position,
    label: row.card.name,
  }));
  let withDocument = 0;
  let withInteractionSection = 0;
  for (const item of items) {
    const documentId = index.documentsOfCard.get(item.card ?? -1)?.[0];
    if (!documentId) continue;
    withDocument += 1;
    if (index.asset.documents[documentId]?.x === 1) withInteractionSection += 1;
  }
  let pairs = 0;
  let pairsWithMention = 0;
  let pairsWithInteractionSectionMention = 0;
  let pairsBothInstructions = 0;
  let pairsBothInstructionsWithMention = 0;
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      const a = items[first];
      const b = items[second];
      if (!a || !b) continue;
      const pair = checkPair(index, a, b);
      pairs += 1;
      const both = pair.aReadsB.documentId !== null && pair.bReadsA.documentId !== null;
      if (both) pairsBothInstructions += 1;
      if (pair.found > 0) {
        pairsWithMention += 1;
        if (both) pairsBothInstructionsWithMention += 1;
        const fromSection = [...pair.aReadsB.sentences, ...pair.bReadsA.sentences].some(
          (sentence) => (sentence.flags & SPAN_FLAG_INTERACTIONS) !== 0,
        );
        if (fromSection) pairsWithInteractionSectionMention += 1;
      }
    }
  }
  return {
    top200Definition: 'single-substance ЕСКЛП cards with the most registrations',
    top200: items.map((item) => item.label),
    top200WithInstruction: withDocument,
    top200WithInteractionSection: withInteractionSection,
    pairs,
    pairsWithMention,
    pairsWithMentionShare: Number((pairsWithMention / pairs).toFixed(4)),
    pairsWithInteractionSectionMention,
    pairsBothInstructions,
    pairsBothInstructionsWithMention,
  };
}

function main(): void {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
    modules: readonly CatalogModule[];
  };
  const instructionModules = catalog.modules
    .filter((module) => module.id.startsWith('minimed.medications.instructions.'))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const atc = JSON.parse(readFileSync(ATC_NAMES, 'utf8')) as {
    version: string;
    publishDate: string;
    names: Record<string, string>;
  };
  const declarations: unknown = JSON.parse(readFileSync(EXCEPTIONS, 'utf8'));
  const exceptions = parseAtcCodeExceptions(declarations);
  const additions = parseAtcClassAdditions(declarations);
  for (const addition of additions) {
    for (const code of addition.classes) {
      if (!(code in atc.names)) {
        throw new Error(`addClasses: ${code} (${addition.card}) is not in the НСИ dictionary`);
      }
    }
  }
  const verifiedAdditions = new Set<string>();
  const cards = withEsklpDirectory(
    {
      directory: argument('--esklp-dir'),
      modules: catalog.modules as readonly CatalogEsklpModule[],
      dataRoot: DATA_ROOT,
    },
    (directory) => loadEsklpCards(directory, exceptions, additions),
  );
  console.log(
    `ЕСКЛП cards: ${cards.length}, ATC code exceptions: ${exceptions.length}, class additions: ${additions.length} (secondary: ${additions.filter((addition) => addition.role === 'secondary').length})`,
  );

  const debugDirectory = argument('--debug-dir');
  const debugLines: string[] = [];
  const builder = createInteractionBuilder({
    ...(debugDirectory
      ? {
          onSentence: (document, sentence) => {
            debugLines.push(
              JSON.stringify({
                doc: document.id,
                trade: document.tradeName,
                kind: document.kind,
                flags: sentence.flags,
                section: sentence.sectionTitle,
                targets: sentence.targets,
                surfaces: sentence.surfaces,
                text: sentence.text,
              }),
            );
          },
        }
      : {}),
    cards: cards.map((row): BuildCard => ({ ...row.card, registrationKeys: row.registrationKeys })),
    atcNames: atc.names,
    atcBasis: { version: atc.version, publishDate: atc.publishDate },
  });
  const scratch = join(tmpdir(), `int1-modules-${process.pid}`);
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
      const decoded = join(scratch, `${module.id}.db`);
      const result = Bun.spawnSync(['zstd', '-d', '-q', '-f', source, '-o', decoded]);
      if (result.exitCode !== 0) throw new Error(`zstd failed on ${fileName}`);
      const database = new Database(decoded, { readonly: true });
      builder.addModule(
        { id: module.id, version: module.version, sha256: artifact.sha256 },
        readModule(database),
      );
      verifyAdditionEvidence(database, additions, verifiedAdditions);
      console.log(`${module.id}: read`);
      database.close();
      rmSync(decoded, { force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const addition of additions) {
    if (!verifiedAdditions.has(addition.card)) {
      throw new Error(
        `addClasses: ${addition.evidence.document} (${addition.card}) is not in any instruction module`,
      );
    }
  }
  const { asset, report } = builder.finish();
  const coverage = measureCoverage(asset, cards);
  mkdirSync(join(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(asset)}\n`);
  mkdirSync(join(REPORT, '..'), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify({ ...report, coverage }, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(JSON.stringify(coverage, null, 2));
  if (debugDirectory) {
    mkdirSync(debugDirectory, { recursive: true });
    writeFileSync(join(debugDirectory, 'sentences.jsonl'), `${debugLines.join('\n')}\n`);
    console.log(`debug output: ${debugDirectory}/sentences.jsonl (${debugLines.length} sentences)`);
  }
}

main();
