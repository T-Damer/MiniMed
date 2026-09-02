import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import { type HardQuerySplit, loadHardMedicalQueries } from './hard-query-dataset';
import {
  aggregateHardQueryEvaluations,
  evaluateHardQuery,
  type HardQueryEvaluation,
} from './hard-query-scoring';

const root = resolve(import.meta.dirname, '../../..');
const benchmarkEnv = process.env as {
  readonly MINIMED_HARD_BENCHMARK_DB?: string;
  readonly MINIMED_HARD_BENCHMARK_SPLIT?: string;
  readonly MINIMED_HARD_BENCHMARK_MODE?: string;
  readonly MINIMED_HARD_BENCHMARK_MAX_QUERIES?: string;
  readonly MINIMED_HARD_BENCHMARK_MIN_RECALL_AT_5?: string;
  readonly MINIMED_HARD_BENCHMARK_MIN_HIT_AT_5?: string;
  readonly MINIMED_HARD_BENCHMARK_MIN_MRR_AT_5?: string;
  readonly MINIMED_HARD_BENCHMARK_MAX_FORBIDDEN_RATE_AT_5?: string;
  readonly MINIMED_HARD_BENCHMARK_MIN_SECTION_HIT_AT_5?: string;
};
const databasePath = resolve(
  root,
  benchmarkEnv.MINIMED_HARD_BENCHMARK_DB ?? 'data/build/rf-public-pilot.db',
);
const splitValue = benchmarkEnv.MINIMED_HARD_BENCHMARK_SPLIT ?? 'all';
if (!['all', 'dev', 'validation', 'hidden_test'].includes(splitValue)) {
  throw new Error(`Unsupported MINIMED_HARD_BENCHMARK_SPLIT: ${splitValue}`);
}
const split = splitValue as HardQuerySplit | 'all';
const modeValue = benchmarkEnv.MINIMED_HARD_BENCHMARK_MODE ?? 'hybrid';
if (!['auto', 'lexical', 'semantic', 'hybrid'].includes(modeValue)) {
  throw new Error(`Unsupported MINIMED_HARD_BENCHMARK_MODE: ${modeValue}`);
}
const mode = modeValue as 'auto' | 'lexical' | 'semantic' | 'hybrid';

if (!existsSync(databasePath)) {
  throw new Error(
    `Hard benchmark database does not exist: ${databasePath}. Build a corpus or set MINIMED_HARD_BENCHMARK_DB.`,
  );
}

const store = await SqliteMedicalStore.createFromBytes(new Uint8Array(readFileSync(databasePath)));
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const loadedFixtures = loadHardMedicalQueries({ split });
const maxQueriesValue = benchmarkEnv.MINIMED_HARD_BENCHMARK_MAX_QUERIES;
const maxQueries = maxQueriesValue === undefined ? loadedFixtures.length : Number(maxQueriesValue);
if (!Number.isInteger(maxQueries) || maxQueries <= 0) {
  throw new Error(
    `MINIMED_HARD_BENCHMARK_MAX_QUERIES must be a positive integer: ${maxQueriesValue}`,
  );
}
const fixtures = loadedFixtures.slice(0, maxQueries);
const rows: HardQueryEvaluation[] = [];
for (const [index, fixture] of fixtures.entries()) {
  const response = await core.search({
    query: fixture.query,
    mode,
    filters: {},
    limit: 5,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.query_id}: ${response.error.message}`);
  rows.push(evaluateHardQuery(fixture, response.value.groups, response.value.elapsedMs));
  if ((index + 1) % 100 === 0 || index + 1 === fixtures.length) {
    console.error(`hard benchmark: ${index + 1}/${fixtures.length}`);
  }
}
await core.close();

function sliceReport(values: readonly HardQueryEvaluation[]) {
  return aggregateHardQueryEvaluations(values);
}

function groupedSlices(field: 'style' | 'intent' | 'specialty') {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[field]))]
      .toSorted()
      .map((value) => [value, sliceReport(rows.filter((row) => row[field] === value))]),
  );
}

const aggregate = aggregateHardQueryEvaluations(rows);
const report = {
  generatedAt: new Date().toISOString(),
  dataset: 'minimed-hard-medical-queries-1500-v1',
  databasePath,
  corpus: initialized.value.contentPackIds,
  mode,
  split,
  ...aggregate,
  slices: {
    style: groupedSlices('style'),
    intent: groupedSlices('intent'),
    specialty: groupedSlices('specialty'),
  },
  rows,
};

mkdirSync(resolve(root, 'data/build'), { recursive: true });
const reportPath = resolve(root, `data/build/hard-medical-benchmark-${split}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...aggregate, reportPath }, null, 2));

const failures: string[] = [];
const minRecall = benchmarkEnv.MINIMED_HARD_BENCHMARK_MIN_RECALL_AT_5;
if (minRecall !== undefined && aggregate.recallAt5 < Number(minRecall)) {
  failures.push(`Recall@5 ${aggregate.recallAt5.toFixed(3)} < ${Number(minRecall).toFixed(3)}`);
}
const minHit = benchmarkEnv.MINIMED_HARD_BENCHMARK_MIN_HIT_AT_5;
if (minHit !== undefined && aggregate.hitAt5 < Number(minHit)) {
  failures.push(`Hit@5 ${aggregate.hitAt5.toFixed(3)} < ${Number(minHit).toFixed(3)}`);
}
const minMrr = benchmarkEnv.MINIMED_HARD_BENCHMARK_MIN_MRR_AT_5;
if (minMrr !== undefined && aggregate.mrrAt5 < Number(minMrr)) {
  failures.push(`MRR@5 ${aggregate.mrrAt5.toFixed(3)} < ${Number(minMrr).toFixed(3)}`);
}
const maxForbidden = benchmarkEnv.MINIMED_HARD_BENCHMARK_MAX_FORBIDDEN_RATE_AT_5;
if (maxForbidden !== undefined && aggregate.forbiddenRateAt5 > Number(maxForbidden)) {
  failures.push(
    `forbidden rate@5 ${aggregate.forbiddenRateAt5.toFixed(3)} > ${Number(maxForbidden).toFixed(3)}`,
  );
}
const minSectionHit = benchmarkEnv.MINIMED_HARD_BENCHMARK_MIN_SECTION_HIT_AT_5;
if (minSectionHit !== undefined && aggregate.sectionHitAt5 < Number(minSectionHit)) {
  failures.push(
    `SectionHit@5 ${aggregate.sectionHitAt5.toFixed(3)} < ${Number(minSectionHit).toFixed(3)}`,
  );
}
if (failures.length > 0) {
  console.error(`Hard benchmark failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
