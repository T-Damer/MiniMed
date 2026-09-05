import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

import type { MedicalCore, SearchMode } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';

import { createBunFileMedicalStore } from './bun-sqlite-medical-store';
import {
  aggregateFullCorpusSearchEvaluations,
  evaluateFullCorpusSearchQuery,
  type FullCorpusSearchEvaluation,
  type FullCorpusSearchFixture,
  type FullCorpusSourceFamily,
  validateFullCorpusSearchFixture,
} from './full-corpus-search-scoring';

const root = resolve(import.meta.dirname, '../../..');
const dataBuildRoot = resolve(root, 'data/build');
const modes = new Set<SearchMode>(['auto', 'lexical', 'semantic', 'hybrid']);

interface RunnerConfig {
  readonly sourceFamily: FullCorpusSourceFamily;
  readonly databasePath: string;
  readonly fixturePath: string;
  readonly reportPath: string;
  readonly mode: SearchMode;
}

function parseOptions(args: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (const arg of args) {
    const separator = arg.indexOf('=');
    const key = separator < 0 ? arg : arg.slice(0, separator);
    const value = separator < 0 ? undefined : arg.slice(separator + 1);
    if (!key.startsWith('--') || value === undefined || value.trim().length === 0) {
      throw new Error(`Arguments must use --name=value: ${arg}`);
    }
    if (options.has(key)) throw new Error(`Duplicate argument: ${key}`);
    options.set(key, value);
  }
  return options;
}

function inside(rootPath: string, value: string, label: string): string {
  const target = resolve(value);
  const relativePath = relative(rootPath, target);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.startsWith(sep)
  ) {
    throw new Error(`${label} must be inside ${rootPath}: ${target}`);
  }
  return target;
}

function config(args: readonly string[]): RunnerConfig {
  const options = parseOptions(args);
  const environment = process.env as {
    readonly MINIMED_FULL_CORPUS_SOURCE?: string;
    readonly MINIMED_FULL_CORPUS_DATABASE?: string;
    readonly MINIMED_FULL_CORPUS_FIXTURE?: string;
    readonly MINIMED_FULL_CORPUS_REPORT?: string;
    readonly MINIMED_FULL_CORPUS_MODE?: string;
  };
  const sourceValue = options.get('--source') ?? environment.MINIMED_FULL_CORPUS_SOURCE;
  if (sourceValue !== 'diseases' && sourceValue !== 'mkb-diseases') {
    throw new Error('--source=diseases or --source=mkb-diseases is required.');
  }
  const sourceFamily = sourceValue;
  const databasePath = inside(
    dataBuildRoot,
    options.get('--database') ??
      environment.MINIMED_FULL_CORPUS_DATABASE ??
      resolve(dataBuildRoot, `${sourceFamily}.db`),
    'Database path',
  );
  const fixturePath = inside(
    dataBuildRoot,
    options.get('--fixture') ??
      environment.MINIMED_FULL_CORPUS_FIXTURE ??
      resolve(dataBuildRoot, `${sourceFamily}-full-search-queries.json`),
    'Fixture path',
  );
  const reportPath = inside(
    dataBuildRoot,
    options.get('--report') ??
      environment.MINIMED_FULL_CORPUS_REPORT ??
      resolve(dataBuildRoot, `${sourceFamily}-full-search-report.json`),
    'Report path',
  );
  const modeValue = options.get('--mode') ?? environment.MINIMED_FULL_CORPUS_MODE ?? 'lexical';
  if (!modes.has(modeValue as SearchMode)) throw new Error(`Unsupported search mode: ${modeValue}`);
  if (basename(databasePath) !== `${sourceFamily}.db`) {
    throw new Error(`Database path must select data/build/${sourceFamily}.db.`);
  }
  if (basename(fixturePath) !== `${sourceFamily}-full-search-queries.json`) {
    throw new Error(`Fixture path must select ${sourceFamily}-full-search-queries.json.`);
  }
  if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
  if (!existsSync(fixturePath)) throw new Error(`Fixture does not exist: ${fixturePath}`);
  return { sourceFamily, databasePath, fixturePath, reportPath, mode: modeValue as SearchMode };
}

export async function runFullCorpusSearch(
  core: Pick<MedicalCore, 'search'>,
  fixture: FullCorpusSearchFixture,
  mode: SearchMode,
): Promise<readonly FullCorpusSearchEvaluation[]> {
  const rows: FullCorpusSearchEvaluation[] = [];
  for (const query of fixture.queries) {
    const response = await core.search({
      query: query.query,
      mode,
      filters: {},
      limit: 5,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(`${query.id}: ${response.error.message}`);
    rows.push(
      evaluateFullCorpusSearchQuery(query, response.value.groups, response.value.elapsedMs),
    );
  }
  return rows;
}

function sliceReport(rows: readonly FullCorpusSearchEvaluation[]) {
  return aggregateFullCorpusSearchEvaluations(rows);
}

function groupedSlices(
  rows: readonly FullCorpusSearchEvaluation[],
  field: 'style' | 'sourceFamily',
): Readonly<Record<string, ReturnType<typeof sliceReport>>> {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[field]))]
      .toSorted()
      .map((value) => [value, sliceReport(rows.filter((row) => row[field] === value))]),
  );
}

function gate(value: number | null, minimum: number, denominator: number) {
  return {
    value,
    minimum,
    denominator,
    passed: denominator === 0 || (value !== null && value >= minimum),
  };
}

const runnerConfig = config(process.argv.slice(2));
const fixture = validateFullCorpusSearchFixture(
  JSON.parse(readFileSync(runnerConfig.fixturePath, 'utf8')) as unknown,
);
if (fixture.sourceFamily !== runnerConfig.sourceFamily) {
  throw new Error('Fixture sourceFamily does not match the selected source.');
}

let store: Awaited<ReturnType<typeof createBunFileMedicalStore>> | undefined;
let core: MedicalCore | undefined;
try {
  store = await createBunFileMedicalStore(runnerConfig.databasePath);
  core = createMedicalCore({ store, platform: 'test' });
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  const rows = await runFullCorpusSearch(core, fixture, runnerConfig.mode);
  const aggregate = aggregateFullCorpusSearchEvaluations(rows);
  const gates = {
    recallAt5: gate(aggregate.recallAt5, 0.9, aggregate.queryCount),
    mrrAt5: gate(aggregate.mrrAt5, 0.65, aggregate.queryCount),
    sectionRecallAt5: gate(aggregate.sectionRecallAt5, 0.9, aggregate.sectionQueryCount),
  };
  const failures = rows
    .filter((row) => row.recallAt5 < 1 || row.sectionRecallAt5 === false)
    .map((row) => ({
      queryId: row.queryId,
      style: row.style,
      expectedDocumentIds: row.expectedDocumentIds,
      foundDocumentIds: row.foundDocumentIds,
      recallAt5: row.recallAt5,
      sectionRecallAt5: row.sectionRecallAt5,
      topDocumentIds: row.topDocumentIds,
    }));
  const passed = Object.values(gates).every((item) => item.passed);
  const report = {
    schemaVersion: 1,
    fixture: {
      id: fixture.id,
      path: runnerConfig.fixturePath,
      sourceFamily: fixture.sourceFamily,
      queryCount: fixture.queries.length,
    },
    databasePath: runnerConfig.databasePath,
    corpus: {
      contentPackIds: initialized.value.contentPackIds,
      documentCount: initialized.value.documentCount,
    },
    mode: runnerConfig.mode,
    limit: 5,
    metrics: aggregate,
    gates,
    passed,
    failures,
    slices: {
      style: groupedSlices(rows, 'style'),
      sourceFamily: groupedSlices(rows, 'sourceFamily'),
    },
    rows,
  };
  mkdirSync(dataBuildRoot, { recursive: true });
  writeFileSync(runnerConfig.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        ...aggregate,
        gates,
        passed,
        failureCount: failures.length,
        reportPath: runnerConfig.reportPath,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
} finally {
  if (core) await core.close();
  else if (store) await store.close();
}
