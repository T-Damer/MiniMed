import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import { loadCuratedClinicianQueries } from './curated-clinician-dataset';
import {
  aggregateHardQueryEvaluations,
  evaluateHardQuery,
  type HardQueryEvaluation,
} from './hard-query-scoring';

const root = resolve(import.meta.dirname, '../../..');
const databasePath = resolve(
  root,
  process.env.MINIMED_CLINICIAN_BENCHMARK_DB ?? 'data/build/private-pilot.db',
);
const modeValue = process.env.MINIMED_CLINICIAN_BENCHMARK_MODE ?? 'hybrid';
if (!['auto', 'lexical', 'semantic', 'hybrid'].includes(modeValue)) {
  throw new Error(`Unsupported MINIMED_CLINICIAN_BENCHMARK_MODE: ${modeValue}`);
}
const mode = modeValue as 'auto' | 'lexical' | 'semantic' | 'hybrid';

if (!existsSync(databasePath)) {
  throw new Error(
    `Clinician benchmark database does not exist: ${databasePath}. ` +
      'Build a combined corpus or set MINIMED_CLINICIAN_BENCHMARK_DB.',
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

const fixtures = loadCuratedClinicianQueries();
const rows: HardQueryEvaluation[] = [];
for (const fixture of fixtures) {
  const response = await core.search({
    query: fixture.query,
    mode,
    filters: {},
    limit: 5,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.query_id}: ${response.error.message}`);
  rows.push(evaluateHardQuery(fixture, response.value.groups, response.value.elapsedMs));
}
await core.close();

const aggregate = aggregateHardQueryEvaluations(rows);
const report = {
  generatedAt: new Date().toISOString(),
  dataset: 'minimed-curated-clinician-queries-v1',
  databasePath,
  corpus: initialized.value.contentPackIds,
  mode,
  ...aggregate,
  rows,
};

mkdirSync(resolve(root, 'data/build'), { recursive: true });
const reportPath = resolve(root, 'data/build/curated-clinician-benchmark.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...aggregate, reportPath }, null, 2));

const minRecallAt1 = Number(process.env.MINIMED_CLINICIAN_MIN_RECALL_AT_1 ?? '0.75');
const minRecallAt5 = Number(process.env.MINIMED_CLINICIAN_MIN_RECALL_AT_5 ?? '0.9');
const minSectionRecall = Number(process.env.MINIMED_CLINICIAN_MIN_SECTION_RECALL_AT_5 ?? '0.7');
const maxForbiddenRate = Number(process.env.MINIMED_CLINICIAN_MAX_FORBIDDEN_RATE_AT_5 ?? '0');
const failures: string[] = [];
if (aggregate.recallAt1 < minRecallAt1) {
  failures.push(`Recall@1 ${aggregate.recallAt1.toFixed(3)} < ${minRecallAt1.toFixed(3)}`);
}
if (aggregate.recallAt5 < minRecallAt5) {
  failures.push(`Recall@5 ${aggregate.recallAt5.toFixed(3)} < ${minRecallAt5.toFixed(3)}`);
}
if (aggregate.expectedSectionRecallAt5 < minSectionRecall) {
  failures.push(
    `section recall@5 ${aggregate.expectedSectionRecallAt5.toFixed(3)} < ${minSectionRecall.toFixed(3)}`,
  );
}
if (aggregate.forbiddenRateAt5 > maxForbiddenRate) {
  failures.push(
    `forbidden rate@5 ${aggregate.forbiddenRateAt5.toFixed(3)} > ${maxForbiddenRate.toFixed(3)}`,
  );
}
if (failures.length > 0) {
  console.error(`Curated clinician benchmark failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
