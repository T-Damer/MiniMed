// The doctor query sets run on the released corpus: core.db plus the companion packs. Lookup queries
// (clinical-guideline-, medication-lookup- and doctor-workflow-queries.json) name the documents of
// the full databases that answer them -- recommendations by official id (`kr.rf.714_2`), medications
// by ЕСКЛП МНН or Allmed instruction. Demo queries (the former kr.demo.* corpus) use the real targets
// recorded in real-corpus-demo-queries.json, where each re-targeted or excluded query says why.
// Nothing here expects a document of the retired pilot corpus (docs/research/pilot-corpus-retired-2026-10-02.md).
//
// The metrics are a ratchet, not a goal: `--check` fails when one falls more than the tolerance
// below the baseline in real-corpus-baseline.json, and `--write-baseline` records the current
// values after a search improvement (commit that separately).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { QueryBranchKind, QueryFactKind, SearchResultGroup } from '@localmed/contracts';
import { PortableHashEmbedder } from '@localmed/search-semantic';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
for (const arg of args)
  if (
    !/^(?:--path=(?:core|app)|--corpus=(?:core|all)|--check|--write-baseline|--core=.+)$/u.test(arg)
  )
    throw new Error(`Unknown argument ${arg}`);
/**
 * `core` is hybrid search over the whole corpus; `app` sends the
 * same clinical phrasing through «Клинический разбор», the path the app uses for it.
 */
const path = args.find((arg) => arg.startsWith('--path='))?.slice(7) ?? 'core';
/**
 * `core` mounts core.db alone, as CI has it; `all` adds every companion pack and the recommendation
 * modules the lookup queries target, whichever are present locally.
 */
const corpusScope = args.find((arg) => arg.startsWith('--corpus='))?.slice(9) ?? 'all';
const check = args.includes('--check');
const writeBaseline = args.includes('--write-baseline');
/** Mount a rebuild candidate instead of the released core.db without touching that file. */
const corePathOverride = args.find((arg) => arg.startsWith('--core='))?.slice('--core='.length);

interface LookupQuery {
  readonly id: string;
  readonly query: string;
  /** Any of these documents (or the document a catalog pointer stands for) is a correct answer. */
  readonly expectedDocumentIds: readonly string[];
  readonly requireTop1?: boolean;
  /** `medications`: asked on the «Лекарства» tab (plain lookup); default is «Клинический разбор». */
  readonly scope?: 'medications';
  readonly category: string;
}

interface DemoQuery {
  readonly id: string;
  readonly query: string;
  readonly category: string;
  readonly status: 'mapped' | 'retargeted' | 'excluded';
  readonly expectedTargets: readonly string[];
  readonly note?: string;
}

interface DemoCase {
  readonly id: string;
  readonly query: string;
  readonly expectedTargets: readonly string[];
  readonly expectedFactKinds: readonly QueryFactKind[];
  readonly expectedBranchKinds: readonly QueryBranchKind[];
  readonly negativeContains?: readonly string[];
  readonly excludedClinicalTerms?: readonly string[];
  readonly minimumWarnings?: number;
}

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8')) as T;
const lookupQueries = [
  'tools/benchmarks/clinical-guideline-queries.json',
  'tools/benchmarks/medication-lookup-queries.json',
  'tools/benchmarks/doctor-workflow-queries.json',
].flatMap((path) => read<readonly LookupQuery[]>(path));
const demo = read<{
  queries: readonly DemoQuery[];
  cases: readonly DemoCase[];
}>('tools/benchmarks/real-corpus-demo-queries.json');

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const percentile = (values: readonly number[], share: number) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;
};
/**
 * A catalog pointer in core.db carries a recommendation's title only; its text lives in the
 * recommendation module a user installs. `--corpus=all` therefore mounts the released module of
 * every recommendation the lookup queries expect (`kr.rf.<id>`), when it is present locally in
 * data/build/release-clinical (a local-only 3.6 GB set; CI has core.db alone).
 */
const RELEASED_RECOMMENDATIONS = resolve(REPOSITORY_ROOT, 'data/build/release-clinical');
const guidelineModules =
  corpusScope === 'all' && existsSync(RELEASED_RECOMMENDATIONS)
    ? [
        ...new Set(
          lookupQueries.flatMap((query) =>
            query.expectedDocumentIds.flatMap((id) => /^kr\.rf\.(.+)$/u.exec(id)?.[1] ?? []),
          ),
        ),
      ]
        .toSorted()
        .flatMap((recommendationId) => {
          const file = readdirSync(RELEASED_RECOMMENDATIONS).find((name) =>
            name.startsWith(`clinical-${recommendationId}-clinical-`),
          );
          return file
            ? [
                {
                  moduleId: `minimed.clinical.recommendation.${recommendationId}`,
                  path: resolve(RELEASED_RECOMMENDATIONS, file),
                },
              ]
            : [];
        })
    : [];
const {
  core,
  corpus: mounted,
  target,
} = await openRealCorpus({
  embedder: new PortableHashEmbedder(),
  companions: corpusScope === 'all',
  corePath: corePathOverride,
  installedModules: guidelineModules,
});
/** The baseline key names the recommendation modules by count, not one by one. */
const corpus = [
  ...mounted.filter((name) => !name.startsWith('minimed.clinical.recommendation.')),
  ...(guidelineModules.length > 0 ? [`recommendations×${guidelineModules.length}`] : []),
];
const clinical = new ScopedMedicalCore(core, 'diagnosis');
const medications = new ScopedMedicalCore(core, 'medications');
const searchClinical = (query: string, scope?: 'medications') =>
  path === 'app' && scope === 'medications'
    ? medications.search({
        query,
        mode: 'auto',
        analysisMode: 'lookup',
        filters: {},
        limit: 20,
        includeSuggestions: true,
      })
    : path === 'app'
      ? clinical.search({
          query,
          mode: 'auto',
          analysisMode: 'clinical',
          filters: {},
          limit: 20,
          includeSuggestions: true,
        })
      : core.search({ query, mode: 'hybrid', filters: {}, limit: 20, includeSuggestions: false });
/** Every search response, for the zero-result, mode and latency figures. */
const searches: { empty: boolean; hybrid: boolean; semantic: boolean; elapsedMs: number }[] = [];
const searchMeasured = async (query: string, scope?: 'medications') => {
  const response = await searchClinical(query, scope);
  if (response.ok)
    searches.push({
      empty: response.value.groups.length === 0,
      hybrid: response.value.modeUsed === 'hybrid',
      semantic: response.value.diagnostics.semantic.status === 'used',
      elapsedMs: response.value.elapsedMs,
    });
  return response;
};
/** A result counts under its own id and under the document its pointer stands for. */
const identities = (group: SearchResultGroup) => [group.documentId, target(group.documentId)];
const rankOf = (groups: readonly SearchResultGroup[], expected: ReadonlySet<string>, depth = 5) => {
  const index = groups
    .slice(0, depth)
    .findIndex((group) => identities(group).some((id) => expected.has(id)));
  return index >= 0 ? index + 1 : null;
};

const lookupRows = [];
for (const fixture of lookupQueries) {
  const response = await searchMeasured(fixture.query, fixture.scope);
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const rank = rankOf(response.value.groups, new Set(fixture.expectedDocumentIds));
  lookupRows.push({
    id: fixture.id,
    category: fixture.category,
    requireTop1: fixture.requireTop1 === true,
    hitAt1: rank === 1,
    hitAt5: rank !== null,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    top: response.value.groups.slice(0, 5).map((group) => target(group.documentId)),
  });
}

const demoRows = [];
for (const fixture of demo.queries.filter((item) => item.status !== 'excluded')) {
  const response = await searchMeasured(fixture.query);
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const rank = rankOf(response.value.groups, new Set(fixture.expectedTargets));
  demoRows.push({
    id: fixture.id,
    query: fixture.query,
    status: fixture.status,
    hitAt1: rank === 1,
    hitAt5: rank !== null,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    top: response.value.groups.slice(0, 5).map((group) => target(group.documentId)),
  });
}

const caseRows = [];
for (const fixture of demo.cases) {
  const analysis = await core.analyzeQuery({ query: fixture.query, includeSuggestions: true });
  if (!analysis.ok) throw new Error(`${fixture.id}: ${analysis.error.message}`);
  // Case descriptions are clinical phrasing: the same path as the lookup queries.
  const response = await searchMeasured(fixture.query);
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const factKinds = new Set<string>(analysis.value.facts.map((fact) => fact.kind));
  const branchKinds = new Set<string>(analysis.value.branches.map((branch) => branch.kind));
  const negatives = analysis.value.facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.normalizedValue);
  const clinicalTerms =
    analysis.value.branches.find((branch) => branch.kind === 'clinical')?.terms ?? [];
  const rank = rankOf(response.value.groups, new Set(fixture.expectedTargets));
  const checks = {
    targetInTop5: rank !== null,
    expectedFactsPresent: fixture.expectedFactKinds.every((kind) => factKinds.has(kind)),
    expectedBranchesPresent: fixture.expectedBranchKinds.every((kind) => branchKinds.has(kind)),
    negativeSpansPresent: (fixture.negativeContains ?? []).every((fragment) =>
      negatives.some((value) => value.includes(fragment)),
    ),
    negatedTermsExcludedFromClinicalBranch: (fixture.excludedClinicalTerms ?? []).every(
      (term) => !clinicalTerms.includes(term),
    ),
    warningCountSatisfied: analysis.value.warnings.length >= (fixture.minimumWarnings ?? 0),
  };
  const { targetInTop5, ...analysisChecks } = checks;
  caseRows.push({
    id: fixture.id,
    passed: Object.values(checks).every(Boolean),
    /** Query understanding alone: facts, branches, negation and warnings. */
    analysisPassed: Object.values(analysisChecks).every(Boolean),
    targetRank: rank,
    checks,
    top: response.value.groups.slice(0, 5).map((group) => target(group.documentId)),
  });
}
await core.close();

const summarize = (
  rows: readonly { hitAt1: boolean; hitAt5: boolean; reciprocalRank: number }[],
) => ({
  queryCount: rows.length,
  recallAt1: mean(rows.map((row) => Number(row.hitAt1))),
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
});
const requiredTop1 = lookupRows.filter((row) => row.requireTop1);
const latencies = searches.map((search) => search.elapsedMs);
const summary = {
  corpus,
  path,
  lookup: {
    ...summarize(lookupRows),
    requiredTop1Rate: mean(requiredTop1.map((row) => Number(row.hitAt1))),
  },
  demo: {
    ...summarize(demoRows),
    excluded: demo.queries.filter((item) => item.status === 'excluded').length,
    retargeted: demo.queries.filter((item) => item.status === 'retargeted').length,
  },
  cases: {
    caseCount: caseRows.length,
    passRate: mean(caseRows.map((row) => Number(row.passed))),
    targetInTop5Rate: mean(caseRows.map((row) => Number(row.checks.targetInTop5))),
    analysisPassRate: mean(caseRows.map((row) => Number(row.analysisPassed))),
  },
  search: {
    searchCount: searches.length,
    zeroResultRate: mean(searches.map((search) => Number(search.empty))),
    hybridUsageRate: mean(searches.map((search) => Number(search.hybrid))),
    semanticUsageRate: mean(searches.map((search) => Number(search.semantic))),
    // Reported, not gated: the modes depend on the embeddings a pack ships, latency on the machine.
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  },
};
const reportPath = resolve(REPOSITORY_ROOT, `data/build/real-corpus-benchmark-${path}.json`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify({ summary, lookupRows, demoRows, caseRows }, null, 2)}\n`,
);
console.log(JSON.stringify({ summary, lookupRows, demoRows, caseRows }, null, 2));

/** Gated metrics: higher is better, except the zero-result rate. */
const gated: Record<string, number> = {
  'lookup.recallAt1': summary.lookup.recallAt1,
  'lookup.recallAt5': summary.lookup.recallAt5,
  'lookup.mrrAt5': summary.lookup.mrrAt5,
  'lookup.requiredTop1Rate': summary.lookup.requiredTop1Rate,
  'demo.recallAt1': summary.demo.recallAt1,
  'demo.recallAt5': summary.demo.recallAt5,
  'demo.mrrAt5': summary.demo.mrrAt5,
  'cases.passRate': summary.cases.passRate,
  'cases.targetInTop5Rate': summary.cases.targetInTop5Rate,
  'cases.analysisPassRate': summary.cases.analysisPassRate,
  'search.zeroResultRate': summary.search.zeroResultRate,
};
const lowerIsBetter = new Set(['search.zeroResultRate']);
const round = (value: number) => Math.round(value * 1000) / 1000;
interface Baseline {
  readonly tolerance: number;
  readonly baselines: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
const baselinePath = resolve(REPOSITORY_ROOT, 'tools/benchmarks/real-corpus-baseline.json');
const baseline = read<Baseline>('tools/benchmarks/real-corpus-baseline.json');
/** A baseline belongs to one request path over one set of mounted databases. */
const baselineKey = `${path}:${corpus.join('+')}`;
if (writeBaseline) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify(
      {
        ...baseline,
        baselines: {
          ...baseline.baselines,
          [baselineKey]: Object.fromEntries(
            Object.entries(gated).map(([metric, value]) => [metric, round(value)]),
          ),
        },
      },
      null,
      2,
    )}\n`,
  );
  console.error(`Baseline ${baselineKey} written to ${baselinePath}.`);
}
if (check) {
  const recorded = baseline.baselines[baselineKey];
  if (!recorded) {
    console.error(`No baseline for ${baselineKey}; run with --write-baseline and commit it.`);
    process.exit(1);
  }
  const regressions = Object.entries(recorded).flatMap(([metric, expected]) => {
    const actual = gated[metric];
    if (actual === undefined) return [`${metric}: no longer measured`];
    const drop = lowerIsBetter.has(metric) ? actual - expected : expected - actual;
    return drop > baseline.tolerance
      ? [`${metric}: ${round(actual)} vs baseline ${expected} (tolerance ${baseline.tolerance})`]
      : [];
  });
  if (regressions.length > 0) {
    console.error(
      `Real-corpus benchmark regressed (${baselineKey}):\n- ${regressions.join('\n- ')}`,
    );
    process.exit(1);
  }
  console.error(`Real-corpus benchmark within tolerance of ${baselineKey}.`);
}
