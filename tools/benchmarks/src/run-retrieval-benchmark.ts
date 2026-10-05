/**
 * Runs the retrieval benchmark (docs/research/query-datasets-2026-10.md) against the app engine
 * over the full databases: core.db + every companion pack + every clinical-recommendation module.
 *
 *   bun tools/benchmarks/src/run-retrieval-benchmark.ts [--path=core|app] [--split=dev|test|all]
 *     [--dataset=a.json,b.json] [--packs=data/build/release-clinical,data/build/core-clinical-new-editions/databases]
 *     [--limit=N]
 *
 * `core` is the unscoped hybrid search; `app` is the path the app takes (diagnosis scope with
 * clinical analysis for ICD rows, the medication scope with lookup analysis for drug rows). The
 * default split is `dev`: the test split is for reporting, not tuning.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';
import {
  type Aggregate,
  aggregateExact,
  aggregateMkb,
  aggregateRecommendations,
  DEPTH,
  loadRetrievalBenchmark,
  type QueryScore,
  type RetrievalQuery,
  scoreQuery,
} from './retrieval-benchmark';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}
for (const arg of process.argv.slice(2)) {
  if (!/^--(?:path|split|dataset|packs|limit|out)=.+$/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const path = option('path') ?? 'app';
if (path !== 'core' && path !== 'app') throw new Error('--path must be core or app.');
const splitOption = option('split') ?? 'dev';
if (!['dev', 'test', 'all'].includes(splitOption))
  throw new Error('--split must be dev, test or all.');
const datasetPaths = (
  option('dataset') ??
  'tools/benchmarks/retrieval-icd-queries.json,data/build/retrieval-drug-forum-queries.json'
)
  .split(',')
  .map((item) => resolve(REPOSITORY_ROOT, item))
  .filter((item) => existsSync(item));
if (datasetPaths.length === 0)
  throw new Error('No dataset file found; run build-retrieval-benchmark.ts.');
const packDirectories = (
  option('packs') ?? 'data/build/release-clinical,data/build/core-clinical-new-editions/databases'
)
  .split(',')
  .map((item) => resolve(REPOSITORY_ROOT, item));
const limit = option('limit') ? Number(option('limit')) : Number.POSITIVE_INFINITY;

const benchmarks = datasetPaths.map((item) => loadRetrievalBenchmark(item));
const queries: RetrievalQuery[] = benchmarks
  .flatMap((benchmark) => benchmark.queries)
  .filter((query) => splitOption === 'all' || query.split === splitOption)
  .slice(0, limit);

const modules = packDirectories.flatMap((directory) =>
  readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .toSorted()
    .map((name) => ({
      moduleId: `minimed.clinical.recommendation.${/^clinical-(.+?)-clinical-/u.exec(name)?.[1] ?? name}`,
      path: resolve(directory, name),
    })),
);
const mountStarted = performance.now();
const { core, corpus, target } = await openRealCorpus({
  installedModules: modules,
});
console.error(
  `[retrieval] mounted ${corpus.length - modules.length} base databases + ${modules.length} recommendation modules in ${((performance.now() - mountStarted) / 1000).toFixed(1)} s`,
);
const diagnosis = new ScopedMedicalCore(core, 'diagnosis');
const medications = new ScopedMedicalCore(core, 'medications');

function search(query: RetrievalQuery) {
  const isDrug = query.style.startsWith('drug-');
  if (path === 'core') {
    return core.search({
      query: query.query,
      mode: 'hybrid',
      filters: {},
      limit: DEPTH,
      includeSuggestions: false,
    });
  }
  return isDrug
    ? medications.search({
        query: query.query,
        mode: 'auto',
        analysisMode: 'lookup',
        filters: {},
        limit: DEPTH,
        includeSuggestions: true,
      })
    : diagnosis.search({
        query: query.query,
        mode: 'auto',
        analysisMode: 'clinical',
        filters: {},
        limit: DEPTH,
        includeSuggestions: true,
      });
}

const scores: QueryScore[] = [];
const rows: { id: string; query: string; top: readonly string[]; elapsedMs: number }[] = [];
const started = performance.now();
for (const [index, query] of queries.entries()) {
  const response = await search(query);
  if (!response.ok) throw new Error(`${query.id}: ${response.error.message}`);
  const ranked = response.value.groups.map((group) => target(group.documentId));
  scores.push(scoreQuery(query, ranked));
  rows.push({
    id: query.id,
    query: query.query,
    top: ranked.slice(0, 5),
    elapsedMs: response.value.elapsedMs,
  });
  if ((index + 1) % 50 === 0) {
    console.error(
      `[retrieval] ${index + 1}/${queries.length} · ${((performance.now() - started) / 60000).toFixed(1)} min`,
    );
  }
}
await core.close();

const pct = (value: number) => value.toFixed(3);
const line = (label: string, aggregate: Aggregate) =>
  `${label.padEnd(34)} n=${String(aggregate.queries).padStart(3)}  R@1 ${pct(aggregate.recallAt1)}  R@5 ${pct(aggregate.recallAt5)}  R@10 ${pct(aggregate.recallAt10)}  R@20 ${pct(aggregate.recallAt20)}  MRR@10 ${pct(aggregate.mrrAt10)}  nDCG@10 ${pct(aggregate.ndcgAt10)}  anyR@5 ${pct(aggregate.anyRecallAt5)}`;

const groups = new Map<string, QueryScore[]>([['all', scores]]);
for (const score of scores) {
  for (const key of [score.source, `${score.source}/${score.split}`, `split/${score.split}`]) {
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }
}
const styleOf = new Map(queries.map((query) => [query.id, query.style]));
for (const score of scores) {
  const key = `style/${styleOf.get(score.id)}`;
  groups.set(key, [...(groups.get(key) ?? []), score]);
}
const summary: Record<string, { exact: Aggregate; recommendations: Aggregate; mkb: Aggregate }> =
  {};
console.log(`path=${path} split=${splitOption} queries=${queries.length} depth=${DEPTH}`);
for (const [key, group] of [...groups].toSorted(([left], [right]) => left.localeCompare(right))) {
  summary[key] = {
    exact: aggregateExact(group),
    recommendations: aggregateRecommendations(group),
    mkb: aggregateMkb(group),
  };
  console.log(line(`${key} (any grade-3 doc)`, summary[key].exact));
  if (summary[key].recommendations.queries > 0) {
    console.log(line(`${key} (КР only)`, summary[key].recommendations));
  }
  if (summary[key].mkb.queries > 0) console.log(line(`${key} (МКБ card only)`, summary[key].mkb));
}
const latencies = rows.map((row) => row.elapsedMs).toSorted((left, right) => left - right);
const p = (share: number) =>
  latencies[Math.min(latencies.length - 1, Math.ceil(share * latencies.length) - 1)] ?? 0;
console.log(`latency p50 ${p(0.5).toFixed(0)} ms, p95 ${p(0.95).toFixed(0)} ms`);

const reportPath = resolve(
  REPOSITORY_ROOT,
  `data/build/retrieval-benchmark-${path}-${splitOption}.json`,
);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify({ path, split: splitOption, summary, latencyMs: { p50: p(0.5), p95: p(0.95) }, scores, rows }, null, 1)}\n`,
);
console.error(`[retrieval] report → ${reportPath}`);
