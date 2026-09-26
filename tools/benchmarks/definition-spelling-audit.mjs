import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dbPath, baselinePath, currentPath, output, commit] = process.argv.slice(2);
if (!dbPath || !baselinePath || !currentPath || !output || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  throw new Error('DB BASELINE_READER CURRENT_READER OUTPUT CHECKED_COMMIT');
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const db = new Database(dbPath, { readonly: true });
const allNames = db.query('SELECT DISTINCT normalized_name FROM knowledge_names').all();
const known = new Set(allNames.map((row) => row.normalized_name));
const owners = db
  .query(
    `SELECT normalized_name AS name, MIN(entity_id) AS expected
     FROM knowledge_names GROUP BY normalized_name HAVING COUNT(DISTINCT entity_id) = 1`,
  )
  .all()
  .filter((row) => /^(?:[а-я]{6,48}|[a-z]{6,48})$/u.test(row.name))
  .map((row) => ({ ...row, seed: hash(`definition-spelling-v1\0${row.name}`) }))
  .sort((left, right) => left.seed.localeCompare(right.seed));

// Intentionally independent of the production candidate generator.
const cases = [];
const seen = new Set();
for (const owner of owners) {
  const letters = [...owner.name];
  const first = Number.parseInt(owner.seed.slice(0, 8), 16) % (letters.length - 1);
  for (let offset = 0; offset + 1 < letters.length; offset += 1) {
    const at = (first + offset) % (letters.length - 1);
    const copy = [...letters];
    [copy[at], copy[at + 1]] = [copy[at + 1], copy[at]];
    const query = copy.join('');
    if (query === owner.name || known.has(query) || seen.has(query)) continue;
    cases.push({ query, expected: owner.expected, sourceName: owner.name });
    seen.add(query);
    break;
  }
  if (cases.length === 100) break;
}
if (cases.length !== 100) throw new Error('Insufficient eligible real-name spelling cases');

async function sample(readerPath) {
  const { createSqliteDefinitionReference } = await import(pathToFileURL(resolve(readerPath)).href);
  let statements = 0;
  let fts = 0;
  let returnedBytes = 0;
  const reader = await createSqliteDefinitionReference({
    async read(sql, parameters) {
      statements += 1;
      if (sql.includes(' MATCH ')) fts += 1;
      const rows = db.query(sql).all(...parameters);
      returnedBytes += Buffer.byteLength(JSON.stringify(rows));
      return rows;
    },
  });
  const results = [];
  for (const item of cases) {
    statements = 0;
    fts = 0;
    returnedBytes = 0;
    const started = performance.now();
    const hits = await reader.search(item.query, 20);
    const elapsedMs = performance.now() - started;
    const position = hits.findIndex((hit) => hit.id === item.expected);
    results.push({
      ...item,
      rank: position < 0 ? null : position + 1,
      statements,
      fts,
      returnedBytes,
      elapsedMs,
      top: hits.slice(0, 3).map(({ id, title }) => ({ id, title })),
    });
  }
  return results;
}
function summarize(rows) {
  const times = rows.map((row) => row.elapsedMs).sort((left, right) => left - right);
  return {
    total: rows.length,
    top1: rows.filter((row) => row.rank === 1).length,
    top20: rows.filter((row) => row.rank !== null).length,
    p50Ms: times[Math.floor(times.length * 0.5)],
    p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    maximumStatements: Math.max(...rows.map((row) => row.statements)),
    maximumReturnedBytes: Math.max(...rows.map((row) => row.returnedBytes)),
    queriesUsingFts: rows.filter((row) => row.fts > 0).length,
  };
}
const before = await sample(baselinePath);
const after = await sample(currentPath);
const report = {
  baselineCommit: '2a6f1a098d407c05317d5879c2c412054e035c48',
  checkedCommit: commit,
  databaseSha256: hash(readFileSync(dbPath)),
  caseSha256: hash(JSON.stringify(cases)),
  sampling:
    '100 unique mechanically transposed queries from actual unambiguous source names; SHA-256 order, fixed seed, no production-generator reuse. Existing valid names are never corrupted into another existing valid name.',
  before: summarize(before),
  after: summarize(after),
  cases: after.map((row, index) => ({ ...row, beforeRank: before[index].rank })),
  limitations:
    'One adjacent-letter transposition in a single long alphabetic name, not arbitrary spelling, semantic search or clinical validation. Latency is one host run, not Android qualification.',
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
db.close();
if (report.after.top20 !== 100 || report.after.queriesUsingFts !== 0) {
  throw new Error('Indexed spelling retrieval gate failed; inspect committed-case report');
}
