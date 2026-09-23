import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DefinitionReferenceReader } from '@localmed/storage';
import { createSqliteDefinitionReference } from '../../packages/storage-sqlite/src/definition-reference-reader';

const [databasePath, baselinePath, outputPath] = process.argv.slice(2);
if (!databasePath || !baselinePath || !outputPath)
  throw new Error(
    'Usage: bun tools/benchmarks/definition-description-audit.ts DB BASELINE_READER REPORT',
  );
const inputPath = 'tools/benchmarks/fixtures/definition-descriptions-2026-09-23.json';
const inputBytes = readFileSync(inputPath);
const dataset = JSON.parse(inputBytes.toString('utf8')) as {
  cases: { id: string; query: string; expected: string; family: string }[];
  negativeControls: string[];
};
const database = new Database(databasePath, { readonly: true });
let rowsReturned = 0;
let bytesReturned = 0;
let reverseQueries = 0;
const executor = {
  async read(sql: string, args: readonly (string | number)[]) {
    const rows = database.query(sql).all(...args) as Record<string, unknown>[];
    rowsReturned += rows.length;
    bytesReturned += Buffer.byteLength(JSON.stringify(rows));
    if (sql.includes('definition-description')) reverseQueries += 1;
    return rows;
  },
};
const oldModule = (await import(pathToFileURL(resolve(baselinePath)).href)) as {
  createSqliteDefinitionReference: typeof createSqliteDefinitionReference;
};
const before: DefinitionReferenceReader = await oldModule.createSqliteDefinitionReference(executor);
const after: DefinitionReferenceReader = await createSqliteDefinitionReference(executor);
const reset = () => {
  rowsReturned = 0;
  bytesReturned = 0;
  reverseQueries = 0;
};
async function sample(reader: DefinitionReferenceReader, query: string, expected: string) {
  reset();
  const start = performance.now();
  const hits = await reader.search(query, 20);
  const latencyMs = performance.now() - start;
  const index = hits.findIndex((hit) => hit.id === expected);
  if (hits.length > 20) throw new Error('Reader result bound exceeded');
  return {
    rank: index < 0 ? null : index + 1,
    ids: hits.map((hit) => hit.id),
    latencyMs,
    rowsReturned,
    bytesReturned,
    reverseQueries,
  };
}
const outcomes = [];
for (const item of dataset.cases) {
  const target = await before.getCard(item.expected);
  if (!target) {
    outcomes.push({ ...item, corpusMissing: true, before: null, after: null });
    continue;
  }
  outcomes.push({
    ...item,
    corpusMissing: false,
    before: await sample(before, item.query, item.expected),
    after: await sample(after, item.query, item.expected),
  });
}
const negatives = [];
for (const query of dataset.negativeControls) {
  negatives.push({
    query,
    before: (await before.search(query, 20)).map((hit) => hit.id),
    after: (await after.search(query, 20)).map((hit) => hit.id),
  });
}
const names = database
  .query('SELECT DISTINCT normalized_name FROM knowledge_names ORDER BY normalized_name')
  .all() as { normalized_name: string }[];
let exactChecked = 0;
const exactChanges = [];
for (const item of names) {
  const left = await before.search(item.normalized_name, 20);
  reset();
  const right = await after.search(item.normalized_name, 20);
  if (reverseQueries !== 0) throw new Error('Exact lookup entered reverse retrieval');
  if (JSON.stringify(left) !== JSON.stringify(right)) exactChanges.push(item.normalized_name);
  exactChecked += 1;
}
const count = database
  .query(
    "SELECT json_extract(metadata_json,'$.coverage') AS coverage,count(*) AS records FROM knowledge_entities GROUP BY coverage",
  )
  .all();
const byFamily: Record<string, unknown> = {};
for (const family of [...new Set(dataset.cases.map((item) => item.family))]) {
  const eligible = outcomes.filter((row) => row.family === family && !row.corpusMissing);
  byFamily[family] = {
    total: eligible.length,
    beforeTop1: eligible.filter((row) => row.before?.rank === 1).length,
    afterTop1: eligible.filter((row) => row.after?.rank === 1).length,
    beforeTop20: eligible.filter((row) => row.before?.rank != null).length,
    afterTop20: eligible.filter((row) => row.after?.rank != null).length,
  };
}
const eligible = outcomes.filter((row) => !row.corpusMissing);
const stats = (key: 'before' | 'after') => {
  const latencies = eligible
    .flatMap((row) => (row[key] ? [row[key].latencyMs] : []))
    .sort((a, b) => a - b);
  return {
    top1: eligible.filter((row) => row[key]?.rank === 1).length,
    top5: eligible.filter((row) => row[key]?.rank != null && row[key].rank <= 5).length,
    top20: eligible.filter((row) => row[key]?.rank != null).length,
    p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? null,
    p95Ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? null,
    maximumReturnedBytes: Math.max(0, ...eligible.map((row) => row[key]?.bytesReturned ?? 0)),
  };
};
const beforeStats = stats('before');
const afterStats = stats('after');
const report = {
  baselineCommit: 'ed4c84a1ab6b461a7d345df06d880a35ae66f6a0',
  queryFixtureSha256: createHash('sha256').update(inputBytes).digest('hex'),
  databaseSha256: createHash('sha256').update(readFileSync(databasePath)).digest('hex'),
  sameDatabaseForBoth: true,
  cases: dataset.cases.length,
  corpusEligible: eligible.length,
  corpusMissing: outcomes.filter((row) => row.corpusMissing).map((row) => row.id),
  before: beforeStats,
  after: afterStats,
  byFamily,
  outcomes,
  negativeControls: negatives,
  exactIdentityGuard: {
    checked: exactChecked,
    changes: exactChanges,
    reverseHandlerBypassed: true,
  },
  regressions: outcomes
    .filter(
      (row) =>
        row.before?.rank != null && (row.after?.rank == null || row.after.rank > row.before.rank),
    )
    .map((row) => row.id),
  coverageCounts: count,
  boundary:
    'Authored source-derived developer cases, not an independent clinical or open-ended semantic-search benchmark. Both readers use the same complete corpus; content growth is not credited as a ranking gain. Bounds are at the SQL adapter, not total process/device memory. Lexical absence cues do not establish patient state, diagnosis or calibrated confidence. No query-specific aliases or gold changes.',
};
database.close();
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      before: beforeStats,
      after: afterStats,
      byFamily,
      exactChecked,
      exactChanges,
      missing: report.corpusMissing,
      regressions: report.regressions,
    },
    null,
    2,
  ),
);
if (exactChanges.length) throw new Error('Exact identity regression; report retained');
if (afterStats.top20 < beforeStats.top20)
  throw new Error('Aggregate reverse recall regressed; report retained');
if (negatives.some((row) => row.after.length > row.before.length))
  throw new Error('Unrelated-query false positive increased; report retained');
