import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, ...args] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
if (mode === 'sample') {
  const [dbPath, readerPath, output, commit] = args;
  if (!dbPath || !readerPath || !output || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
    throw new Error('sample DB READER OUTPUT COMMIT');
  }
  const { createSqliteDefinitionReference } = await import(pathToFileURL(resolve(readerPath)).href);
  const db = new Database(dbPath, { readonly: true });
  let rowsRead = 0;
  let bytesRead = 0;
  const reader = await createSqliteDefinitionReference({
    async read(sql, parameters) {
      const rows = db.query(sql).all(...parameters);
      rowsRead += rows.length;
      bytesRead += Buffer.byteLength(JSON.stringify(rows));
      return rows;
    },
  });
  const fixtures = readFileSync('tools/benchmarks/fixtures/definition-descriptions-2026-09-23.json');
  const dataset = JSON.parse(fixtures);
  const additions = [
    ['original-voice', 'потерял голос и говорит только шёпотом', 'ruwiki.definition.194815'],
    ['original-mouth', 'постоянно пересыхает во рту', 'ruwiki.definition.7885823'],
    ['framed-voice', 'Что такое «Афония»?', 'ruwiki.definition.194815'],
    ['framed-mouth', 'Дай определение термина Ксеростомия', 'ruwiki.definition.7885823'],
    ['framed-method', 'Что означает Электромиография?', 'ruwiki.definition.920279'],
  ].map(([id, query, expected]) => ({ id, query, expected, family: 'additional-regression' }));
  const cases = [];
  for (const item of [...dataset.cases, ...additions]) {
    rowsRead = 0;
    bytesRead = 0;
    const start = performance.now();
    const hits = await reader.search(item.query, 20);
    const elapsedMs = performance.now() - start;
    const index = hits.findIndex((hit) => hit.id === item.expected);
    if (hits.length > 20) throw new Error('Result budget exceeded');
    cases.push({ ...item, rank: index < 0 ? null : index + 1, elapsedMs, rowsRead, bytesRead,
      top: hits.slice(0, 5).map(({ id, title }) => ({ id, title })) });
  }
  const controls = [];
  for (const query of [...dataset.negativeControls, 'как называется?', 'не помню название']) {
    controls.push({ query, ids: (await reader.search(query)).map((hit) => hit.id) });
  }
  const exact = {};
  const names = db.query('SELECT DISTINCT normalized_name FROM knowledge_names ORDER BY normalized_name').all();
  for (const { normalized_name: name } of names) {
    exact[name] = await reader.search(name, 20);
  }
  write(output, { commit, databaseSha256: digest(readFileSync(dbPath)), fixtureSha256: digest(fixtures),
    cases, controls, exact, integrity: db.query('PRAGMA integrity_check').all(),
    foreignKeys: db.query('PRAGMA foreign_key_check').all() });
  db.close();
} else if (mode === 'compare') {
  const [beforePath, afterPath, output] = args;
  if (!beforePath || !afterPath || !output) throw new Error('compare BEFORE AFTER OUTPUT');
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  if (before.databaseSha256 !== after.databaseSha256 || before.fixtureSha256 !== after.fixtureSha256) {
    throw new Error('Comparison must use the identical database and frozen source fixture');
  }
  const names = Object.keys(before.exact);
  const exactChanges = names.filter((name) => JSON.stringify(before.exact[name]) !== JSON.stringify(after.exact[name]));
  if (names.length !== Object.keys(after.exact).length) throw new Error('Name sets differ');
  const summarize = (sample, additional) => {
    const rows = sample.cases.filter((row) => (row.family === 'additional-regression') === additional);
    const times = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
    return { total: rows.length, top1: rows.filter((row) => row.rank === 1).length,
      top5: rows.filter((row) => row.rank !== null && row.rank <= 5).length,
      top20: rows.filter((row) => row.rank !== null).length,
      p50Ms: times[Math.floor(times.length * 0.5)] ?? null,
      p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? null,
      maximumReturnedBytes: Math.max(0, ...rows.map((row) => row.bytesRead)) };
  };
  const beforeById = new Map(before.cases.map((row) => [row.id, row]));
  const cases = after.cases.map((row) => {
    const old = beforeById.get(row.id);
    if (!old || old.query !== row.query || old.expected !== row.expected) throw new Error('Case identity changed');
    return { id: row.id, query: row.query, expected: row.expected, family: row.family,
      beforeRank: old.rank, afterRank: row.rank, top: row.top };
  });
  const regressions = cases.filter((row) => row.beforeRank !== null && (row.afterRank === null || row.afterRank > row.beforeRank));
  const report = { baselineCommit: before.commit, checkedCommit: after.commit,
    databaseSha256: after.databaseSha256, fixtureSha256: after.fixtureSha256, sameDatabaseForBoth: true,
    sourceDerived: { before: summarize(before, false), after: summarize(after, false) },
    additionalRegressions: { before: summarize(before, true), after: summarize(after, true) },
    exactChecked: names.length, exactChanges, regressions, cases,
    controls: { before: before.controls, after: after.controls },
    limitations: 'Authored regression cases, not a blinded clinical evaluation. One host run, not device latency. Exact-name and scoped evidence tests do not prove semantic understanding or diagnostic validity.' };
  write(output, report);
  console.log(JSON.stringify(report, null, 2));
  if (exactChanges.length || regressions.length) throw new Error('Search regression gate failed; inspect report');
} else {
  throw new Error('Use sample or compare');
}
