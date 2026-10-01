/**
 * Proves that a compacted module build searches exactly like the build it replaces.
 *
 *   bun tools/benchmarks/src/compare-module-search.ts \
 *     --before DIR --after DIR --kind esklp|clinical [--limit-titles N] [--report FILE]
 *
 * Both directories hold the module SQLite files under the same names. The released core is mounted
 * with every module of each directory exactly as the app mounts installed modules, then the same
 * queries run through the whole production search pipeline (MedicalCore.search, lexical mode).
 * Result groups, ranks, scores and hit order must be identical. Queries are every `query` of the
 * committed benchmark fixtures plus a deterministic sample of each module's own document titles.
 * Exits 1 on the first difference.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { SearchResponse } from '@localmed/contracts';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const { values } = parseArgs({
  options: {
    before: { type: 'string' },
    after: { type: 'string' },
    kind: { type: 'string' },
    'limit-titles': { type: 'string', default: '4' },
    report: { type: 'string' },
  },
});
const before = values.before;
const after = values.after;
const kind = values.kind;
if (!before || !after || (kind !== 'esklp' && kind !== 'clinical')) {
  throw new Error('Usage: --before DIR --after DIR --kind esklp|clinical');
}
const titlesPerModule = Number(values['limit-titles']);

const FIXTURES = [
  'esklp-full-medication-queries.json',
  'doctor-lookup-queries.json',
  'doctor-workflow-queries.json',
  'pilot-rf-drug-queries.json',
  'pilot-rf-queries.json',
  'curated-clinician-queries.json',
  'search-quality-v2.json',
  'respiratory-full-queries.json',
  'real-corpus-demo-queries.json',
  'typo-correction-queries.json',
];

function collectQueries(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectQueries(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'query' && typeof child === 'string' && child.trim()) into.add(child.trim());
      else collectQueries(child, into);
    }
  }
}

const queries = new Set<string>();
for (const file of FIXTURES) {
  try {
    collectQueries(
      JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks', file), 'utf8')),
      queries,
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
}

function moduleFiles(directory: string): { moduleId: string; path: string }[] {
  const names = readdirSyncSorted(directory);
  return names.map((name) => ({
    moduleId:
      kind === 'esklp'
        ? name.replace(/\.db$/u, '')
        : `minimed.clinical.recommendation.${/^clinical-(.+?)-clinical-json-/u.exec(name)?.[1] ?? name}`,
    path: resolve(directory, name),
  }));
}

function readdirSyncSorted(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .toSorted();
}

type Snapshot = Map<string, unknown>;

interface BunDatabase {
  query(sql: string): { all(...parameters: unknown[]): unknown[] };
  close(): void;
}

/** A deterministic, evenly spread sample of each module's own document titles. */
async function sampleTitles(paths: readonly string[]): Promise<string[]> {
  const sqlite = (await import('bun:sqlite' as string)) as unknown as {
    Database: new (path: string, options: { readonly: boolean }) => BunDatabase;
  };
  const titles: string[] = [];
  for (const path of paths) {
    const database = new sqlite.Database(path, { readonly: true });
    try {
      const rows = database
        .query('SELECT title FROM documents WHERE length(title) >= 4 ORDER BY id')
        .all() as { title: string }[];
      const stride = Math.max(1, Math.floor(rows.length / titlesPerModule));
      for (let index = 0; index < rows.length && titles.length < 100_000; index += stride) {
        const title = rows[index]?.title;
        if (title && index / stride < titlesPerModule) titles.push(title);
      }
    } finally {
      database.close();
    }
  }
  return titles;
}

async function run(directory: string): Promise<{ snapshot: Snapshot; titles: string[] }> {
  const files = moduleFiles(directory);
  const corpus = await openRealCorpus({ companions: false, installedModules: files });
  const titles = await sampleTitles(files.map((file) => file.path));
  const all = [...new Set([...queries, ...titles])].toSorted();
  const snapshot: Snapshot = new Map();
  for (const query of all) {
    const response = await corpus.core.search({
      query,
      mode: 'lexical',
      filters: {},
      limit: 20,
      includeSuggestions: false,
    });
    snapshot.set(query, response.ok ? stable(response.value) : { error: response.error.message });
  }
  return { snapshot, titles };
}

/** The response without timings: everything else must match exactly. */
function stable(response: SearchResponse): unknown {
  return JSON.parse(
    JSON.stringify(response, (key, value: unknown) =>
      key === 'elapsedMs' || key === 'requestId' || key === 'timings' ? undefined : value,
    ),
  );
}

const reference = await run(resolve(before));
const candidate = await run(resolve(after));
const differences: { query: string }[] = [];
let withResults = 0;
for (const [query, expected] of reference.snapshot) {
  const groups = (expected as { groups?: unknown[] }).groups ?? [];
  if (groups.length > 0) withResults += 1;
  if (JSON.stringify(expected) !== JSON.stringify(candidate.snapshot.get(query))) {
    differences.push({ query });
  }
}
const summary = {
  kind,
  modulesBefore: moduleFiles(before).length,
  modulesAfter: moduleFiles(after).length,
  queries: reference.snapshot.size,
  queriesWithResults: withResults,
  fixtureQueries: queries.size,
  titleQueries: reference.titles.length,
  differences: differences.length,
  firstDifferences: differences.slice(0, 5),
};
console.log(JSON.stringify(summary, null, 2));
if (values.report) writeFileSync(values.report, `${JSON.stringify(summary, null, 2)}\n`);
if (differences.length > 0) process.exit(1);
