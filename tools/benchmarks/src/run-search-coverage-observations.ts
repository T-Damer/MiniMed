import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { normalizeSurfaceText } from '@localmed/search-lexical';
import { MultiMedicalStore } from '@localmed/storage';

import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

interface CoverageObservation {
  readonly id: string;
  readonly query: string;
  readonly origin: 'user-reported' | 'source-coverage-audit';
  readonly expectedTerms: readonly string[];
  readonly rationale: string;
}

function loadObservations(path: string): readonly CoverageObservation[] {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Search coverage observations must be a non-empty array.');
  }
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Observation ${index} must be an object.`);
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row['id'] !== 'string' ||
      typeof row['query'] !== 'string' ||
      (row['origin'] !== 'user-reported' && row['origin'] !== 'source-coverage-audit') ||
      !Array.isArray(row['expectedTerms']) ||
      row['expectedTerms'].length === 0 ||
      !row['expectedTerms'].every((term) => typeof term === 'string' && term.trim().length >= 2) ||
      typeof row['rationale'] !== 'string'
    ) {
      throw new Error(`Observation ${index} has an invalid shape.`);
    }
    if (ids.has(row['id'])) throw new Error(`Duplicate coverage observation id: ${row['id']}`);
    ids.add(row['id']);
    return {
      id: row['id'],
      query: row['query'],
      origin: row['origin'],
      expectedTerms: row['expectedTerms'],
      rationale: row['rationale'],
    };
  });
}

function resultText(group: {
  readonly title: string;
  readonly results: readonly {
    readonly title: string;
    readonly snippet: string;
    readonly matchedTerms: readonly string[];
  }[];
}): string {
  return normalizeSurfaceText(
    [
      group.title,
      ...group.results.flatMap((result) => [
        result.title,
        result.snippet,
        result.matchedTerms.join(' '),
      ]),
    ].join(' '),
  );
}

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args) {
  if (!/^--(?:core|pack|observations|report|require-all)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}
const projectPath = (value: string | undefined, fallback: string) =>
  resolve(root, value ?? fallback);
const corePath = projectPath(option('core'), 'apps/app/public/content/core.db');
const packs = args
  .filter((arg) => arg.startsWith('--pack='))
  .map((arg) => projectPath(arg.slice(7), ''));
const observationsPath = projectPath(
  option('observations'),
  'tools/benchmarks/search-coverage-observations.json',
);
const reportPath = projectPath(
  option('report'),
  'data/build/search-coverage-observations-report.json',
);
const requireAll = (option('require-all') ?? 'false') === 'true';

for (const path of [corePath, ...packs, observationsPath]) {
  if (!existsSync(path)) throw new Error(`Coverage benchmark input does not exist: ${path}`);
}

const observations = loadObservations(observationsPath);
const store = new MultiMedicalStore(
  await Promise.all(
    [corePath, ...packs].map(async (path, index) => ({
      moduleId: `${index}:${basename(path)}`,
      store: await createBunFileMedicalStore(path),
      required: true,
      searchWeight: index === 0 ? 1.1 : 1,
    })),
  ),
);
const core = createMedicalCore({ store, platform: 'test' });
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const rows = [];
for (const observation of observations) {
  const response = await core.search({
    query: observation.query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${observation.id}: ${response.error.message}`);

  const expectedTerms = observation.expectedTerms.map((term) => normalizeSurfaceText(term));
  const rank = response.value.groups.findIndex((group) => {
    const text = resultText(group);
    return expectedTerms.some((term) => text.includes(term));
  });
  const matchingGroup = rank < 0 ? null : (response.value.groups[rank] ?? null);
  rows.push({
    id: observation.id,
    origin: observation.origin,
    found: rank >= 0,
    firstVisibleRank: rank < 0 ? null : rank + 1,
    top1DocumentId: response.value.groups[0]?.documentId ?? null,
    matchingDocumentId: matchingGroup?.documentId ?? null,
    matchingConceptId: matchingGroup?.conceptId ?? null,
    elapsedMs: response.value.elapsedMs,
  });
}
await core.close();

const report = {
  schemaVersion: 1,
  dataset: 'minimed-search-coverage-observations',
  generatedAt: new Date().toISOString(),
  corpus: initialized.value.contentPackIds,
  observations: rows.length,
  visibleAt20: rows.filter((row) => row.found).length / rows.length,
  rows,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ reportPath, visibleAt20: report.visibleAt20, rows }, null, 2));

if (requireAll && rows.some((row) => !row.found)) {
  console.error('One or more observed search terms are still absent from the first 20 results.');
  process.exitCode = 1;
}
