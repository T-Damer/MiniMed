import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

type Surface = 'lookup' | 'clinical';

interface SearchQualityFixture {
  readonly id: string;
  readonly surface: Surface;
  readonly query: string;
  readonly relevantDocumentIds: readonly string[];
  readonly strictTop1: boolean;
  readonly rationale: string;
}

interface SearchQualityRow {
  readonly id: string;
  readonly surface: Surface;
  readonly query: string;
  readonly relevantDocumentIds: readonly string[];
  readonly firstRelevantRank: number | null;
  readonly top1DocumentId: string | null;
  readonly top5DocumentIds: readonly string[];
  readonly top20DocumentIds: readonly string[];
  readonly top1Pass: boolean | null;
  readonly hitAt5: boolean;
  readonly hitAt20: boolean;
  readonly reciprocalRankAt20: number;
  readonly elapsedMs: number;
}

function loadFixtures(path: string): readonly SearchQualityFixture[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('search-quality-v2 fixture must be a non-empty array.');
  }

  return parsed.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Fixture ${index} must be an object.`);
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      (row.surface !== 'lookup' && row.surface !== 'clinical') ||
      typeof row.query !== 'string' ||
      !Array.isArray(row.relevantDocumentIds) ||
      row.relevantDocumentIds.length === 0 ||
      !row.relevantDocumentIds.every((item) => typeof item === 'string' && item.length > 0) ||
      typeof row.strictTop1 !== 'boolean' ||
      typeof row.rationale !== 'string'
    ) {
      throw new Error(`Fixture ${index} has an invalid shape.`);
    }
    return {
      id: row.id,
      surface: row.surface,
      query: row.query,
      relevantDocumentIds: row.relevantDocumentIds,
      strictTop1: row.strictTop1,
      rationale: row.rationale,
    };
  });
}

function aggregate(rows: readonly SearchQualityRow[]) {
  const strictRows = rows.filter((row) => row.top1Pass !== null);
  const foundRanks = rows
    .map((row) => row.firstRelevantRank)
    .filter((rank): rank is number => rank !== null);
  return {
    cases: rows.length,
    strictLookupCases: strictRows.length,
    strictLookupTop1:
      strictRows.length === 0
        ? null
        : strictRows.filter((row) => row.top1Pass === true).length / strictRows.length,
    hitAt5: rows.filter((row) => row.hitAt5).length / rows.length,
    candidateRecallAt20: rows.filter((row) => row.hitAt20).length / rows.length,
    mrrAt20: rows.reduce((sum, row) => sum + row.reciprocalRankAt20, 0) / rows.length,
    meanFoundRank:
      foundRanks.length === 0
        ? null
        : foundRanks.reduce((sum, rank) => sum + rank, 0) / foundRanks.length,
  };
}

const root = resolve(import.meta.dirname, '../../..');
const databasePath = resolve(
  root,
  process.env.MINIMED_SEARCH_QUALITY_DB ?? 'data/build/rf-public-pilot.db',
);
const fixturePath = resolve(root, 'tools/benchmarks/search-quality-v2.json');
const reportPath = resolve(root, 'data/build/search-quality-v2-report.json');

if (!existsSync(databasePath)) {
  throw new Error(
    `Search-quality database does not exist: ${databasePath}. Build it or set MINIMED_SEARCH_QUALITY_DB.`,
  );
}

const fixtures = loadFixtures(fixturePath);
const store = await SqliteMedicalStore.createFromBytes(
  new Uint8Array(readFileSync(databasePath)),
);
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const rows: SearchQualityRow[] = [];
for (const fixture of fixtures) {
  const relevant = new Set(fixture.relevantDocumentIds);
  const response = await core.search({
    query: fixture.query,
    mode: fixture.surface === 'lookup' ? 'lexical' : 'hybrid',
    analysisMode: fixture.surface,
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);

  const documentIds = response.value.groups.map((group) => group.documentId);
  const firstRelevantIndex = documentIds.findIndex((documentId) => relevant.has(documentId));
  const firstRelevantRank = firstRelevantIndex < 0 ? null : firstRelevantIndex + 1;
  rows.push({
    id: fixture.id,
    surface: fixture.surface,
    query: fixture.query,
    relevantDocumentIds: fixture.relevantDocumentIds,
    firstRelevantRank,
    top1DocumentId: documentIds[0] ?? null,
    top5DocumentIds: documentIds.slice(0, 5),
    top20DocumentIds: documentIds.slice(0, 20),
    top1Pass: fixture.strictTop1 ? firstRelevantRank === 1 : null,
    hitAt5: firstRelevantRank !== null && firstRelevantRank <= 5,
    hitAt20: firstRelevantRank !== null && firstRelevantRank <= 20,
    reciprocalRankAt20:
      firstRelevantRank !== null && firstRelevantRank <= 20 ? 1 / firstRelevantRank : 0,
    elapsedMs: response.value.elapsedMs,
  });
}
await core.close();

const lookupRows = rows.filter((row) => row.surface === 'lookup');
const clinicalRows = rows.filter((row) => row.surface === 'clinical');
const report = {
  generatedAt: new Date().toISOString(),
  dataset: 'minimed-search-quality-v2-visible-smoke',
  databasePath,
  corpus: initialized.value.contentPackIds,
  note:
    'Visible research smoke only. Do not use this checked-in set as blind qualification for a trained reranker.',
  aggregate: aggregate(rows),
  lookup: aggregate(lookupRows),
  clinical: aggregate(clinicalRows),
  rows,
};

mkdirSync(resolve(root, 'data/build'), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...report.aggregate, reportPath }, null, 2));
