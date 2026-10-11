/**
 * Latency of «Препараты» search with every drug package mounted (STATE PERF3): the app's
 * `ScopedMedicalCore('medications')` over core.db plus the decoded drug modules, per query total
 * time split into native SQLite time and JavaScript time, and the SQL statements that cost most.
 *
 *   bun tools/benchmarks/src/run-medication-latency.ts --packs=<decoded drug modules> \
 *     --packs=<decoded ЕСКЛП modules> [--model-dir=<dir holding minimed/kd1-query-encoder/…>] \
 *     [--mode=lexical|hybrid] [--out=report.json]
 *
 * Queries: `drug-indication-queries.json` and every tenth ГРЛС trade name (as `run-semantic-drugs.ts`).
 * Each query runs twice; the second run is reported (packs, statements and vector indexes warm),
 * the first is reported as `cold`. The top-five document ids of every query are written to `--out`,
 * so a change can be checked for identical results.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { createMedicalCore } from '@localmed/core';
import { KD1_FUSION, KD1_PROFILE, NeuralQueryEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { E5_MODEL_ID } from '../../../apps/app/src/features/semantic/e5-model';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

const sqlite = (await import('bun:sqlite' as string)) as {
  Database: { prototype: { query: (sql: string) => { all: (...a: unknown[]) => unknown[] } } };
};
let sqlMs = 0;
let sqlCalls = 0;
const perStatement = new Map<string, { ms: number; calls: number }>();
const wrapped = new WeakSet<object>();
const originalQuery = sqlite.Database.prototype.query;
sqlite.Database.prototype.query = function (this: unknown, sql: string) {
  const statement = originalQuery.call(this, sql);
  if (!wrapped.has(statement)) {
    wrapped.add(statement);
    const all = statement.all.bind(statement);
    const key = sql.replace(/\s+/gu, ' ').trim().slice(0, 160);
    statement.all = (...args: unknown[]) => {
      const started = performance.now();
      try {
        return all(...args);
      } finally {
        const ms = performance.now() - started;
        sqlMs += ms;
        sqlCalls += 1;
        const entry = perStatement.get(key) ?? { ms: 0, calls: 0 };
        entry.ms += ms;
        entry.calls += 1;
        perStatement.set(key, entry);
      }
    };
  }
  return statement;
};

const values = (name: string) =>
  process.argv
    .filter((item) => item.startsWith(`--${name}=`))
    .map((item) => item.slice(name.length + 3));
const ROOT = resolve(import.meta.dirname, '../../..');
const packs = values('packs').flatMap((directory) =>
  readdirSync(resolve(directory))
    .filter((name) => name.endsWith('.db'))
    .sort()
    .map((name) => resolve(directory, name)),
);
const mode = (values('mode')[0] ?? 'hybrid') as 'lexical' | 'hybrid';
const modelDir = values('model-dir')[0];

let embedder: NeuralQueryEmbedder | undefined;
if (mode === 'hybrid') {
  if (!modelDir) throw new Error('--model-dir is required for hybrid');
  env.allowRemoteModels = false;
  env.localModelPath = `${resolve(modelDir)}/`;
  const extractor = await pipeline('feature-extraction', E5_MODEL_ID, { dtype: 'q8' });
  embedder = new NeuralQueryEmbedder(
    KD1_PROFILE,
    async (text) =>
      (await extractor(text, { pooling: 'mean', normalize: true })).data as Float32Array,
    KD1_FUSION,
  );
}

const store = new MultiMedicalStore([
  {
    moduleId: 'core',
    store: await createBunFileMedicalStore(resolve(ROOT, 'apps/app/public/content/core.db')),
    required: true,
    searchWeight: 1,
  },
  ...(await Promise.all(
    packs.map(async (path) => ({
      moduleId: basename(path, '.db'),
      store: await createBunFileMedicalStore(path),
      required: true,
      searchWeight: 1,
    })),
  )),
]);
const core = createMedicalCore({ store, platform: 'test', ...(embedder ? { embedder } : {}) });
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);
const medications = new ScopedMedicalCore(core, 'medications');

const indications = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../drug-indication-queries.json'), 'utf8'),
  ) as { queries: { id: string; query: string }[] }
).queries.map((item) => item.query);
const tradeNames: string[] = [];
for (const path of packs.filter((item) => basename(item).includes('.instructions.'))) {
  const database = new (
    sqlite as unknown as {
      Database: new (
        path: string,
        options: { readonly: boolean },
      ) => {
        query(sql: string): { all(): readonly { metadata_json: string }[] };
        close(): void;
      };
    }
  ).Database(path, { readonly: true });
  for (const row of database.query('SELECT metadata_json FROM documents ORDER BY id').all()) {
    const name = (JSON.parse(row.metadata_json) as { tradeName?: unknown }).tradeName;
    if (typeof name === 'string' && name.length > 2)
      tradeNames.push(name.toLocaleLowerCase('ru-RU'));
  }
  database.close();
}
const names = [...new Set(tradeNames)].filter((_, index) => index % 10 === 0).slice(0, 100);

interface Row {
  readonly query: string;
  readonly kind: 'indication' | 'name';
  readonly coldMs: number;
  readonly ms: number;
  readonly sqlMs: number;
  readonly sqlCalls: number;
  readonly top: readonly string[];
}
const rows: Row[] = [];
const run = async (query: string) =>
  medications.search({
    query,
    mode,
    analysisMode: 'lookup',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
for (const [kind, list] of [
  ['indication', indications],
  ['name', names],
] as const) {
  for (const query of list) {
    let started = performance.now();
    await run(query);
    const coldMs = performance.now() - started;
    const sqlBefore = sqlMs;
    const callsBefore = sqlCalls;
    started = performance.now();
    const result = await run(query);
    const ms = performance.now() - started;
    if (!result.ok) throw new Error(`${query}: ${result.error.message}`);
    rows.push({
      query,
      kind,
      coldMs,
      ms,
      sqlMs: sqlMs - sqlBefore,
      sqlCalls: sqlCalls - callsBefore,
      top: result.value.groups.slice(0, 5).map((group) => group.documentId),
    });
  }
}

const percentile = (list: readonly number[], p: number) =>
  list.toSorted((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))] ?? 0;
for (const kind of ['indication', 'name'] as const) {
  const part = rows.filter((row) => row.kind === kind);
  console.log(
    `${kind.padEnd(10)} n ${part.length}  warm p50 ${Math.round(
      percentile(
        part.map((r) => r.ms),
        0.5,
      ),
    )} ms p90 ${Math.round(
      percentile(
        part.map((r) => r.ms),
        0.9,
      ),
    )} ms | cold p50 ${Math.round(
      percentile(
        part.map((r) => r.coldMs),
        0.5,
      ),
    )} ms | SQL share ${Math.round((100 * part.reduce((s, r) => s + r.sqlMs, 0)) / part.reduce((s, r) => s + r.ms, 0))} % | SQL calls p50 ${percentile(
      part.map((r) => r.sqlCalls),
      0.5,
    )}`,
  );
}
console.log('slowest warm queries:');
for (const row of rows.toSorted((a, b) => b.ms - a.ms).slice(0, 8)) {
  console.log(
    `  ${Math.round(row.ms).toString().padStart(6)} ms  sql ${Math.round(row.sqlMs)} ms / ${row.sqlCalls} calls  ${row.query}`,
  );
}
console.log('costliest SQL statements (all runs):');
for (const [sql, entry] of [...perStatement].toSorted((a, b) => b[1].ms - a[1].ms).slice(0, 10)) {
  console.log(
    `  ${Math.round(entry.ms).toString().padStart(7)} ms  ${String(entry.calls).padStart(6)} calls  ${sql}`,
  );
}
const out = values('out')[0];
if (out) writeFileSync(out, `${JSON.stringify({ mode, packs: packs.length, rows }, null, 2)}\n`);
await core.close();
