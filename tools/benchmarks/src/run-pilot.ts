import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

interface PilotQuery {
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly category: string;
}

interface PilotRow {
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
}

function parseQueries(value: unknown): readonly PilotQuery[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Public-pilot benchmark must be a non-empty array.');
  }
  return value as readonly PilotQuery[];
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
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

const root = resolve(import.meta.dirname, '../../..');
const queries = parseQueries(
  JSON.parse(readFileSync(resolve(root, 'tools/benchmarks/pilot-rf-queries.json'), 'utf8')),
);
const databaseBytes = new Uint8Array(
  readFileSync(resolve(root, 'data/build/rf-public-pilot.db')),
);
const store = await SqliteMedicalStore.createFromBytes(databaseBytes);
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const rows: PilotRow[] = [];
for (const fixture of queries) {
  const response = await core.search({
    query: fixture.query,
    mode: 'hybrid',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.query}: ${response.error.message}`);

  const topDocuments = response.value.groups.map((group) => group.documentId).slice(0, 5);
  const rankIndex = topDocuments.findIndex((id) => fixture.expectedDocumentIds.includes(id));
  const rank = rankIndex >= 0 ? rankIndex + 1 : undefined;
  rows.push({
    query: fixture.query,
    category: fixture.category,
    hitAt1: rank === 1,
    hitAt5: rank !== undefined,
    reciprocalRank: rank === undefined ? 0 : 1 / rank,
    elapsedMs: response.value.elapsedMs,
    topDocuments,
    candidateCount: response.value.diagnostics.candidateCount,
    modeUsed: response.value.modeUsed,
    semanticStatus: response.value.diagnostics.semantic.status,
  });
}
await core.close();

const latencies = rows.map((row) => row.elapsedMs);
const categories = Object.fromEntries(
  [...new Set(rows.map((row) => row.category))]
    .toSorted()
    .map((category) => {
      const categoryRows = rows.filter((row) => row.category === category);
      return [
        category,
        {
          queryCount: categoryRows.length,
          recallAt1: mean(categoryRows.map((row) => Number(row.hitAt1))),
          recallAt5: mean(categoryRows.map((row) => Number(row.hitAt5))),
          mrrAt5: mean(categoryRows.map((row) => row.reciprocalRank)),
        },
      ];
    }),
);
const report = {
  generatedAt: new Date().toISOString(),
  corpus: initialized.value.pack.id,
  queryCount: rows.length,
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
  resolve(root, 'data/build/rf-public-pilot-benchmark.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(report, null, 2));

const failures: string[] = [];
if (report.recallAt5 < 0.9) failures.push(`Recall@5 ${report.recallAt5.toFixed(3)} < 0.900`);
if (report.mrrAt5 < 0.65) failures.push(`MRR@5 ${report.mrrAt5.toFixed(3)} < 0.650`);
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
  console.error(`Public-pilot benchmark failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
process.exit(0);
