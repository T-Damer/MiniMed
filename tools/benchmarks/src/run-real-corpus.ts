// The former pilot (rf-public-pilot.db) and demo (kr.demo.*) query sets, run on the released
// corpus: core.db plus the companion packs. Pilot queries keep their request and scoring, so the
// numbers compare directly with benchmark:pilot; demo queries use the real targets recorded in
// real-corpus-demo-queries.json, where each re-targeted or excluded query says why.
//
// The metrics are a ratchet, not a goal: `--check` fails when one falls more than the tolerance
// below the baseline in real-corpus-baseline.json, and `--write-baseline` records the current
// values after a search improvement (commit that separately).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { QueryBranchKind, QueryFactKind, SearchResultGroup } from '@localmed/contracts';
import { PortableHashEmbedder } from '@localmed/search-semantic';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
for (const arg of args)
  if (!/^(?:--path=(?:core|app)|--corpus=(?:core|all)|--check|--write-baseline)$/u.test(arg))
    throw new Error(`Unknown argument ${arg}`);
/**
 * `core` repeats the former pilot request (hybrid search over the whole corpus); `app` sends the
 * same clinical phrasing through «Клинический разбор», the path the app uses for it.
 */
const path = args.find((arg) => arg.startsWith('--path='))?.slice(7) ?? 'core';
/** `core` mounts core.db alone, as CI has it; `all` adds every companion pack present locally. */
const corpusScope = args.find((arg) => arg.startsWith('--corpus='))?.slice(9) ?? 'all';
const check = args.includes('--check');
const writeBaseline = args.includes('--write-baseline');

interface PilotQuery {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly expectedOfficialId?: string;
  readonly expectedSectionTypes: readonly string[];
  readonly expectedAnchorPrefixes: readonly string[];
  readonly requireTop1?: boolean;
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
const pilotQueries = [
  'tools/benchmarks/pilot-rf-queries.json',
  'tools/benchmarks/pilot-rf-drug-queries.json',
  'tools/benchmarks/doctor-workflow-queries.json',
].flatMap((path) => read<readonly PilotQuery[]>(path));
const demo = read<{
  queries: readonly DemoQuery[];
  pilotAdditionalTargets: { targets: Readonly<Record<string, readonly string[]>> };
  cases: readonly DemoCase[];
}>('tools/benchmarks/real-corpus-demo-queries.json');

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const percentile = (values: readonly number[], share: number) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;
};
const { core, corpus, target } = await openRealCorpus({
  embedder: new PortableHashEmbedder(),
  companions: corpusScope === 'all',
});
const clinical = new ScopedMedicalCore(core, 'diagnosis');
const searchClinical = (query: string) =>
  path === 'app'
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
const searchMeasured = async (query: string) => {
  const response = await searchClinical(query);
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

const pilotRows = [];
for (const fixture of pilotQueries) {
  const response = await searchMeasured(fixture.query);
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const expected = new Set([
    ...fixture.expectedDocumentIds,
    ...(demo.pilotAdditionalTargets.targets[fixture.id] ?? []),
    // The same guideline reached through its catalog pointer.
    ...(fixture.expectedOfficialId ? [`kr.rf.${fixture.expectedOfficialId}`] : []),
  ]);
  const rank = rankOf(response.value.groups, expected);
  const sectionHit = response.value.groups.some(
    (group) =>
      fixture.expectedDocumentIds.includes(group.documentId) &&
      group.results.some(
        (result) =>
          result.sectionType !== null &&
          fixture.expectedSectionTypes.includes(result.sectionType) &&
          fixture.expectedAnchorPrefixes.some((prefix) =>
            result.anchor.startsWith(`${prefix}#chunk-`),
          ),
      ),
  );
  pilotRows.push({
    id: fixture.id,
    category: fixture.category,
    requireTop1: fixture.requireTop1 === true,
    hitAt1: rank === 1,
    hitAt5: rank !== null,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    sectionHit,
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
  // Case descriptions are clinical phrasing: the same path as the pilot queries.
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
const requiredTop1 = pilotRows.filter((row) => row.requireTop1);
const latencies = searches.map((search) => search.elapsedMs);
const summary = {
  corpus,
  path,
  pilot: {
    ...summarize(pilotRows),
    sectionRecall: mean(pilotRows.map((row) => Number(row.sectionHit))),
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
  `${JSON.stringify({ summary, pilotRows, demoRows, caseRows }, null, 2)}\n`,
);
console.log(JSON.stringify({ summary, pilotRows, demoRows, caseRows }, null, 2));

/** Gated metrics: higher is better, except the zero-result rate. */
const gated: Record<string, number> = {
  'pilot.recallAt1': summary.pilot.recallAt1,
  'pilot.recallAt5': summary.pilot.recallAt5,
  'pilot.mrrAt5': summary.pilot.mrrAt5,
  'pilot.sectionRecall': summary.pilot.sectionRecall,
  'pilot.requiredTop1Rate': summary.pilot.requiredTop1Rate,
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
