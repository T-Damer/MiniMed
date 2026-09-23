import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createSqliteDefinitionReference } from '../../packages/storage-sqlite/src/definition-reference-reader';

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) {
  throw new Error('Usage: bun definition-catalog-growth-audit.ts BEFORE_DB AFTER_DB REPORT');
}
const fixturePath = 'tools/benchmarks/fixtures/definition-descriptions-2026-09-23.json';
const fixtureBytes = readFileSync(fixturePath);
const dataset = JSON.parse(fixtureBytes.toString('utf8')) as {
  cases: { id: string; query: string; expected: string; family: string }[];
  negativeControls: string[];
};
function connect(path: string) {
  const database = new Database(path, { readonly: true });
  return {
    database,
    reader: createSqliteDefinitionReference({
      read: async (sql, args) => database.query(sql).all(...args) as Record<string, unknown>[],
    }),
  };
}
const left = connect(beforePath);
const right = connect(afterPath);
try {
  const before = await left.reader;
  const after = await right.reader;
  const outcomes = [];
  for (const item of dataset.cases) {
    if (!(await before.getCard(item.expected)) || !(await after.getCard(item.expected))) {
      throw new Error('Frozen search target is missing from one of the compared editions');
    }
    const a = await before.search(item.query, 20);
    const b = await after.search(item.query, 20);
    outcomes.push({
      id: item.id,
      family: item.family,
      beforeRank: a.findIndex((row) => row.id === item.expected) + 1 || null,
      afterRank: b.findIndex((row) => row.id === item.expected) + 1 || null,
      beforeIds: a.map((row) => row.id),
      afterIds: b.map((row) => row.id),
    });
  }
  const negativeControls = [];
  for (const query of dataset.negativeControls) {
    negativeControls.push({
      query,
      before: (await before.search(query, 20)).map((row) => row.id),
      after: (await after.search(query, 20)).map((row) => row.id),
    });
  }
  const names = left.database
    .query('SELECT DISTINCT normalized_name FROM knowledge_names ORDER BY normalized_name')
    .all() as { normalized_name: string }[];
  const exactChanges = [];
  for (const row of names) {
    const a = await before.search(row.normalized_name, 20);
    const b = await after.search(row.normalized_name, 20);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      exactChanges.push({
        query: row.normalized_name,
        beforeIds: a.map((hit) => hit.id),
        afterIds: b.map((hit) => hit.id),
      });
    }
  }
  const regressions = outcomes.filter(
    (row) => row.beforeRank !== null && (row.afterRank === null || row.afterRank > row.beforeRank),
  );
  const report = {
    queryFixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
    beforeDatabaseSha256: createHash('sha256').update(readFileSync(beforePath)).digest('hex'),
    afterDatabaseSha256: createHash('sha256').update(readFileSync(afterPath)).digest('hex'),
    sameReaderDifferentDatabases: true,
    cases: outcomes.length,
    beforeTop1: outcomes.filter((row) => row.beforeRank === 1).length,
    afterTop1: outcomes.filter((row) => row.afterRank === 1).length,
    beforeTop20: outcomes.filter((row) => row.beforeRank !== null).length,
    afterTop20: outcomes.filter((row) => row.afterRank !== null).length,
    outcomes,
    negativeControls,
    exactNameQueriesChecked: names.length,
    exactChanges,
    regressions,
    boundary:
      'Catalog-growth regression using the same real reader and frozen authored developer queries, ' +
      'not a neural gain, independent medical validation or mobile performance benchmark. ' +
      'Metadata-only vocabulary must not displace previous exact identities or change source content.',
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    cases: report.cases,
    beforeTop20: report.beforeTop20,
    afterTop20: report.afterTop20,
    exactChecked: names.length,
    exactChanges: exactChanges.length,
    regressions: regressions.length,
  }));
  if (regressions.length || exactChanges.length) {
    throw new Error('Catalog-growth regression; full observations retained in the report');
  }
  if (negativeControls.some((row) => row.after.length > row.before.length)) {
    throw new Error('Negative-control result count increased; inspect the retained report');
  }
} finally {
  left.database.close();
  right.database.close();
}
