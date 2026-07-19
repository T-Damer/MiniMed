import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';

interface BenchmarkQuery {
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly category: string;
}

function parseQueries(value: unknown): readonly BenchmarkQuery[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Benchmark query fixture must be a non-empty array.');
  }
  return value.map((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new Error(`Benchmark query ${index} must be an object.`);
    }
    const record = candidate as {
      readonly query?: unknown;
      readonly expectedDocumentIds?: unknown;
      readonly category?: unknown;
    };
    const { query, expectedDocumentIds, category } = record;
    if (
      typeof query !== 'string' ||
      query.length === 0 ||
      typeof category !== 'string' ||
      category.length === 0 ||
      !Array.isArray(expectedDocumentIds) ||
      expectedDocumentIds.length === 0 ||
      !expectedDocumentIds.every((item) => typeof item === 'string' && item.length > 0)
    ) {
      throw new Error(`Benchmark query ${index} has an invalid shape.`);
    }
    return {
      query,
      expectedDocumentIds: expectedDocumentIds as string[],
      category,
    };
  });
}

const MEASUREMENT_RUNS = 3;

interface BenchmarkRow {
  readonly query: string;
  readonly category: string;
  readonly hitAt1: boolean;
  readonly hitAt5: boolean;
  readonly reciprocalRank: number;
  readonly elapsedMs: number;
  readonly topDocuments: readonly string[];
  readonly candidateCount: number;
  readonly modeUsed: 'lexical' | 'semantic' | 'hybrid';
  readonly semanticStatus: 'disabled' | 'used' | 'fallback';
  readonly semanticCandidateCount: number;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function expectedRank(query: BenchmarkQuery, topDocuments: readonly string[]): number | undefined {
  const rank = topDocuments.findIndex((documentId) =>
    query.expectedDocumentIds.includes(documentId),
  );
  return rank >= 0 ? rank + 1 : undefined;
}

function summarizeCategory(rows: readonly BenchmarkRow[]) {
  return {
    queryCount: rows.length,
    recallAt1: mean(rows.map((row) => Number(row.hitAt1))),
    recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
    mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  };
}

const root = resolve(import.meta.dirname, '../../..');
const queries = parseQueries(
  JSON.parse(readFileSync(resolve(root, 'tools/benchmarks/queries.json'), 'utf8')),
);
const store = await SqliteMedicalStore.create();
const core = createMedicalCore({
  store,
  seed: DEMO_CONTENT_PACK,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const warmup = await core.search({
  query: 'лихорадка кашель',
  mode: 'hybrid',
  filters: {},
  limit: 5,
  includeSuggestions: false,
});
if (!warmup.ok) throw new Error(warmup.error.message);

const rows: BenchmarkRow[] = [];
for (const benchmarkQuery of queries) {
  const measurements: number[] = [];
  let topDocuments: readonly string[] = [];
  let candidateCount = 0;
  let modeUsed: BenchmarkRow['modeUsed'] = 'lexical';
  let semanticStatus: BenchmarkRow['semanticStatus'] = 'disabled';
  let semanticCandidateCount = 0;

  for (let run = 0; run < MEASUREMENT_RUNS; run += 1) {
    const response = await core.search({
      query: benchmarkQuery.query,
      mode: 'hybrid',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(`${benchmarkQuery.query}: ${response.error.message}`);
    topDocuments = response.value.groups.map((group) => group.documentId).slice(0, 5);
    candidateCount = response.value.diagnostics.candidateCount;
    modeUsed = response.value.modeUsed;
    semanticStatus = response.value.diagnostics.semantic.status;
    semanticCandidateCount = response.value.diagnostics.semantic.candidateCount;
    measurements.push(response.value.elapsedMs);
  }

  const rank = expectedRank(benchmarkQuery, topDocuments);
  rows.push({
    query: benchmarkQuery.query,
    category: benchmarkQuery.category,
    hitAt1: rank === 1,
    hitAt5: rank !== undefined,
    reciprocalRank: rank === undefined ? 0 : 1 / rank,
    elapsedMs: percentile(measurements, 50),
    topDocuments,
    candidateCount,
    modeUsed,
    semanticStatus,
    semanticCandidateCount,
  });
}
await core.close();

const latencies = rows.map((row) => row.elapsedMs);
const categories = Object.fromEntries(
  [...new Set(rows.map((row) => row.category))]
    .toSorted()
    .map((category) => [
      category,
      summarizeCategory(rows.filter((row) => row.category === category)),
    ]),
);
const report = {
  generatedAt: new Date().toISOString(),
  corpus: DEMO_CONTENT_PACK.manifest.id,
  queryCount: rows.length,
  measurementRunsPerQuery: MEASUREMENT_RUNS,
  recallAt1: mean(rows.map((row) => Number(row.hitAt1))),
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  zeroResultRate: mean(rows.map((row) => Number(row.candidateCount === 0))),
  hybridUsageRate: mean(rows.map((row) => Number(row.modeUsed === 'hybrid'))),
  semanticUsageRate: mean(rows.map((row) => Number(row.semanticStatus === 'used'))),
  latencyMs: {
    min: Math.min(...latencies),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: Math.max(...latencies),
  },
  categories,
  rows,
};

mkdirSync(resolve(root, 'data/build'), { recursive: true });
writeFileSync(
  resolve(root, 'data/build/search-benchmark.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
const serializedReport = JSON.stringify(report, null, 2);
console.log(serializedReport);

const failures: string[] = [];
if (report.recallAt5 < 0.9) failures.push(`Recall@5 ${report.recallAt5.toFixed(3)} < 0.900`);
if (report.mrrAt5 < 0.8) failures.push(`MRR@5 ${report.mrrAt5.toFixed(3)} < 0.800`);
if (report.zeroResultRate > 0.1) {
  failures.push(`zero-result rate ${report.zeroResultRate.toFixed(3)} > 0.100`);
}
if (report.hybridUsageRate < 1) {
  failures.push(`hybrid usage rate ${report.hybridUsageRate.toFixed(3)} < 1.000`);
}
if (report.semanticUsageRate < 1) {
  failures.push(`semantic usage rate ${report.semanticUsageRate.toFixed(3)} < 1.000`);
}
if (failures.length > 0) {
  console.error(`Benchmark failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

// sqlite-wasm keeps an internal Node handle alive after the database is closed.
// This file is a CLI entry point, so exit explicitly after all synchronous writes complete.
process.exit(0);
