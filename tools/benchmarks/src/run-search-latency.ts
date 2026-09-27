/**
 * Search latency split: native SQLite time (inside statement.all) versus JavaScript core time,
 * over the committed benchmark queries against a real core.db. Run from the repository root:
 *   bun tools/benchmarks/src/run-search-latency.ts [path/to/core.db]
 * Under Node, map `bun:sqlite` to `node:sqlite` with a loader hook to compare engines and to use
 * `--cpu-prof`.
 */
import { readFileSync } from 'node:fs';
import { createMedicalCore } from '@localmed/core';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

const sqlite = (await import('bun:sqlite' as string)) as {
  Database: { prototype: { query: (sql: string) => { all: (...a: unknown[]) => unknown[] } } };
};
let sqlMs = 0;
let sqlCalls = 0;
const wrapped = new WeakSet<object>();
const originalQuery = sqlite.Database.prototype.query;
sqlite.Database.prototype.query = function (this: unknown, sql: string) {
  const statement = originalQuery.call(this, sql);
  if (!wrapped.has(statement)) {
    wrapped.add(statement);
    const all = statement.all.bind(statement);
    statement.all = (...args: unknown[]) => {
      const started = performance.now();
      try {
        return all(...args);
      } finally {
        sqlMs += performance.now() - started;
        sqlCalls += 1;
      }
    };
  }
  return statement;
};

const read = (file: string): string[] => {
  const data = JSON.parse(readFileSync(`tools/benchmarks/${file}`, 'utf8'));
  const list = Array.isArray(data) ? data : (data.queries ?? data.cases ?? []);
  return list.map((entry: { query: string }) => entry.query).filter(Boolean);
};
const queries = [
  ...read('search-quality-v2.json'),
  ...read('curated-clinician-queries.json'),
  ...read('doctor-workflow-queries.json'),
  ...read('pilot-rf-queries.json'),
  ...read('real-corpus-demo-queries.json'),
];
const store = await createBunFileMedicalStore(process.argv[2] ?? 'apps/app/public/content/core.db');
const core = createMedicalCore({ store, platform: 'test' });
const init = await core.initialize();
if (!init.ok) throw new Error(init.error.message);

const run = async (query: string) => {
  const response = await core.search({
    query,
    mode: 'lexical',
    // The ordinary search box uses lookup mode, not clinical parsing; measure the path users hit.
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(response.error.message);
};
for (const q of queries) await run(q); // warm-up
const rows: { total: number; sql: number; calls: number; q: string }[] = [];
for (const q of queries) {
  sqlMs = 0;
  sqlCalls = 0;
  const started = performance.now();
  await run(q);
  rows.push({ total: performance.now() - started, sql: sqlMs, calls: sqlCalls, q });
}
const pct = (values: number[], p: number) =>
  values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
const totals = rows.map((r) => r.total);
const js = rows.map((r) => r.total - r.sql);
const sql = rows.map((r) => r.sql);
const f = (n: number) => n.toFixed(1);
console.log(
  JSON.stringify(
    {
      queries: rows.length,
      totalMs: {
        p50: f(pct(totals, 0.5)),
        p90: f(pct(totals, 0.9)),
        p95: f(pct(totals, 0.95)),
        max: f(Math.max(...totals)),
      },
      sqlMs: { p50: f(pct(sql, 0.5)), p90: f(pct(sql, 0.9)), max: f(Math.max(...sql)) },
      jsMs: { p50: f(pct(js, 0.5)), p90: f(pct(js, 0.9)), max: f(Math.max(...js)) },
      jsShare: f((100 * js.reduce((a, b) => a + b, 0)) / totals.reduce((a, b) => a + b, 0)) + '%',
      sqlCallsP50: pct(
        rows.map((r) => r.calls),
        0.5,
      ),
      slowest: rows
        .toSorted((a, b) => b.total - a.total)
        .slice(0, 3)
        .map((r) => ({ total: f(r.total), sql: f(r.sql), js: f(r.total - r.sql), calls: r.calls })),
    },
    null,
    1,
  ),
);
