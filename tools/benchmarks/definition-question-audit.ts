import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSqliteDefinitionReference } from '../../packages/storage-sqlite/src/definition-reference-reader';

const [databasePath, baselinePath, outputPath] = process.argv.slice(2);
if (!databasePath || !baselinePath || !outputPath) throw new Error('Usage: DB BASELINE_READER REPORT');
const database = new Database(databasePath, { readonly: true });
let ftsQueries = 0;
const executor = {
  async read(sql: string, args: readonly (string | number)[]) {
    if (sql.includes('MATCH')) ftsQueries += 1;
    return database.query(sql).all(...args) as Record<string, unknown>[];
  },
};
try {
  const baseline = await import(pathToFileURL(resolve(baselinePath)).href) as {
    createSqliteDefinitionReference: typeof createSqliteDefinitionReference;
  };
  const before = await baseline.createSqliteDefinitionReference(executor);
  const after = await createSqliteDefinitionReference(executor);
  const names = database.query('SELECT DISTINCT normalized_name FROM knowledge_names ORDER BY normalized_name').all() as { normalized_name: string }[];
  const values = names.map((row) => row.normalized_name);
  const allNames = new Set(values);
  const eligible = values.filter((name) => name.length <= 512 && !allNames.has(`что такое «${name}»?`));
  const exactChanges: string[] = [];
  const wrapperChanges: string[] = [];
  let wrappedFtsCalls = 0;
  for (const name of eligible) {
    const bare = await before.search(name, 20);
    const currentBare = await after.search(name, 20);
    if (JSON.stringify(bare) !== JSON.stringify(currentBare)) exactChanges.push(name);
    ftsQueries = 0;
    const wrapped = await after.search(`Что такое «${name}»?`, 20);
    wrappedFtsCalls += ftsQueries;
    if (JSON.stringify(bare) !== JSON.stringify(wrapped)) wrapperChanges.push(name);
  }
  // Fixed hash sampling across all names, never hand-selecting examples that looked good.
  const sample = eligible.map((name) => ({name, key: createHash('sha256').update(`question-v1:${name}`).digest('hex')}))
    .sort((a, b) => a.key.localeCompare(b.key)).slice(0, 96);
  const outcomes = [];
  for (const item of sample) {
    const query = `Что такое «${item.name}»?`;
    const expected = (await before.search(item.name, 20)).map((row) => row.id);
    const started = performance.now();
    const old = (await before.search(query, 20)).map((row) => row.id);
    const middle = performance.now();
    const current = (await after.search(query, 20)).map((row) => row.id);
    const ended = performance.now();
    outcomes.push({ query, expected, beforeIds: old, afterIds: current,
      beforeExact: JSON.stringify(old) === JSON.stringify(expected),
      afterExact: JSON.stringify(current) === JSON.stringify(expected),
      beforeMs: middle-started, afterMs: ended-middle });
  }
  const report = {
    databaseSha256: createHash('sha256').update(readFileSync(databasePath)).digest('hex'),
    baselineCommit: '7ae77243ef26a6633031fd2dfdbb981d4dea0fc9',
    totalNames: values.length, eligibleNames: eligible.length,
    excludedNames: values.length - eligible.length,
    exactChanges, wrapperChanges, wrappedFtsCalls,
    sample: { count: outcomes.length, beforeExact: outcomes.filter((row) => row.beforeExact).length,
      afterExact: outcomes.filter((row) => row.afterExact).length, outcomes },
    boundary: 'Literal name-question framing evaluated against the complete prior exact-name output. ' +
      'This does not supply medical definitions for empty names, merge senses, prove free paraphrase ' +
      'understanding or diagnose a clinical case. Long/ambiguous literal wrappers are reported as excluded. ' +
      'The 96-name baseline comparison is deterministic hash sampling, not independent clinical validation.',
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({eligible: eligible.length, exactChanges: exactChanges.length,
    wrapperChanges: wrapperChanges.length, wrappedFtsCalls, sampleBefore: report.sample.beforeExact,
    sampleAfter: report.sample.afterExact, sampleCount: outcomes.length}));
  if (exactChanges.length || wrapperChanges.length || wrappedFtsCalls) throw new Error('Named-question boundary failed; report retained');
} finally {
  database.close();
}
