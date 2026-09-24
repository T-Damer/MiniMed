import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { normalizeSurfaceText } from '@localmed/search-lexical';

import {
  calibrateLinearAbstentionGate,
  evaluateFrozenRanking,
  evaluationSlices,
  type FrozenCandidateRow,
  groupFrozenCandidates,
  LINEAR_RERANKER_FEATURES,
  parseFrozenCandidate,
  rerankLinearCandidates,
  rerankLinearCandidatesGated,
  trainPairwiseLinearReranker,
} from './linear-reranker-baseline';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);

for (const arg of args) {
  if (!/^--(?:train|test|report|epochs|learning-rate|l2)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const projectPath = (value: string | undefined, fallback: string): string =>
  resolve(root, value ?? fallback);
const trainPath = projectPath(
  option('train'),
  'data/build/search-quality-linear-training-candidates.jsonl',
);
const testPath = projectPath(
  option('test'),
  'data/build/search-quality-v2-frozen-candidates.jsonl',
);
const reportPath = projectPath(
  option('report'),
  'data/build/search-quality-linear-reranker-report.json',
);
const epochs = Number(option('epochs') ?? '250');
const learningRate = Number(option('learning-rate') ?? '0.08');
const l2 = Number(option('l2') ?? '0.002');

if (!Number.isInteger(epochs) || epochs < 1 || epochs > 5000) {
  throw new Error('--epochs must be an integer from 1 through 5000.');
}
if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 1) {
  throw new Error('--learning-rate must be > 0 and <= 1.');
}
if (!Number.isFinite(l2) || l2 < 0 || l2 > 1) {
  throw new Error('--l2 must be between 0 and 1.');
}
if (trainPath === testPath) throw new Error('Training and test candidate files must be different.');
for (const path of [trainPath, testPath]) {
  if (!existsSync(path)) throw new Error(`Linear-reranker input does not exist: ${path}`);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadJsonl(path: string): readonly FrozenCandidateRow[] {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error(`Frozen-candidate file is empty: ${path}`);
  return lines.map((line, index) =>
    parseFrozenCandidate(JSON.parse(line) as unknown, `${path}:${index + 1}`),
  );
}

function fixtureQueries(rows: readonly FrozenCandidateRow[]): ReadonlyMap<string, string> {
  const queries = new Map<string, string>();
  for (const row of rows) {
    const existing = queries.get(row.fixtureId);
    if (existing !== undefined && existing !== row.query) {
      throw new Error(`${row.fixtureId}: frozen rows disagree on query text.`);
    }
    queries.set(row.fixtureId, row.query);
  }
  return queries;
}

const trainRows = loadJsonl(trainPath);
const testRows = loadJsonl(testPath);
const trainQueries = fixtureQueries(trainRows);
const testQueries = fixtureQueries(testRows);

if (trainRows.some((row) => row.origin !== 'legacy-pilot-training')) {
  throw new Error('Linear baseline training rows must use origin=legacy-pilot-training.');
}
if (testRows.some((row) => row.origin === 'legacy-pilot-training')) {
  throw new Error('Linear baseline test rows must not use legacy-pilot-training origin.');
}

const overlappingFixtureIds = [...trainQueries.keys()].filter((id) => testQueries.has(id));
if (overlappingFixtureIds.length > 0) {
  throw new Error(`Training/test fixture IDs overlap: ${overlappingFixtureIds.join(', ')}`);
}
const normalizedTrainQueries = new Set(
  [...trainQueries.values()].map((query) => normalizeSurfaceText(query)),
);
const overlappingQueries = [...testQueries.entries()].filter(([, query]) =>
  normalizedTrainQueries.has(normalizeSurfaceText(query)),
);
if (overlappingQueries.length > 0) {
  throw new Error(
    `Training/test query text overlaps: ${overlappingQueries.map(([id]) => id).join(', ')}`,
  );
}

const trainGroups = groupFrozenCandidates(trainRows);
const testGroups = groupFrozenCandidates(testRows);
const model = trainPairwiseLinearReranker(trainRows, {
  epochs,
  learningRate,
  l2,
});
const rerank = (rows: readonly FrozenCandidateRow[]) => rerankLinearCandidates(rows, model);
const gate = calibrateLinearAbstentionGate(trainGroups, model);
const rerankGated = (rows: readonly FrozenCandidateRow[]) =>
  rerankLinearCandidatesGated(rows, model, gate);

const trainOriginal = evaluateFrozenRanking(trainGroups);
const trainLinear = evaluateFrozenRanking(trainGroups, rerank);
const trainGated = evaluateFrozenRanking(trainGroups, rerankGated);
const testOriginal = evaluateFrozenRanking(testGroups);
const testLinear = evaluateFrozenRanking(testGroups, rerank);
const testGated = evaluateFrozenRanking(testGroups, rerankGated);

const scoringStartedAt = performance.now();
let scoredCandidates = 0;
for (let repeat = 0; repeat < 100; repeat += 1) {
  for (const rows of testGroups.values()) {
    rerank(rows);
    scoredCandidates += rows.length;
  }
}
const scoringElapsedMs = performance.now() - scoringStartedAt;
const microsecondsPerCandidate =
  scoredCandidates === 0 ? 0 : (scoringElapsedMs * 1000) / scoredCandidates;

const rows = [...testGroups.entries()].map(([fixtureId, candidates]) => {
  const original = candidates;
  const linear = rerank(candidates);
  const gated = rerankGated(candidates);
  return {
    fixtureId,
    family: candidates[0]?.family ?? null,
    goal: candidates[0]?.goal ?? null,
    originalTop1DocumentId: original[0]?.candidate.documentId ?? null,
    originalTop1Grade: original[0]?.label.relevanceGrade ?? 0,
    linearTop1DocumentId: linear[0]?.candidate.documentId ?? null,
    linearTop1Grade: linear[0]?.label.relevanceGrade ?? 0,
    gatedTop1DocumentId: gated[0]?.candidate.documentId ?? null,
    gatedTop1Grade: gated[0]?.label.relevanceGrade ?? 0,
    maximumAvailableGrade: Math.max(0, ...candidates.map((row) => row.label.relevanceGrade)),
    changedTop1: original[0]?.candidate.documentId !== linear[0]?.candidate.documentId,
    gatedChangedTop1: original[0]?.candidate.documentId !== gated[0]?.candidate.documentId,
  };
});

const metricDeltas = (candidate: typeof testLinear) => ({
  top1MaxGrade: candidate.top1MaxGrade - testOriginal.top1MaxGrade,
  relevantRecallAt20: candidate.relevantRecallAt20 - testOriginal.relevantRecallAt20,
  relevantRecallAt40: candidate.relevantRecallAt40 - testOriginal.relevantRecallAt40,
  weightedRecallAt20: candidate.weightedRecallAt20 - testOriginal.weightedRecallAt20,
  weightedRecallAt40: candidate.weightedRecallAt40 - testOriginal.weightedRecallAt40,
  ndcgAt5: candidate.ndcgAt5 - testOriginal.ndcgAt5,
  ndcgAt10: candidate.ndcgAt10 - testOriginal.ndcgAt10,
  mrrAt20: candidate.mrrAt20 - testOriginal.mrrAt20,
  forbiddenRateAt5: candidate.forbiddenRateAt5 - testOriginal.forbiddenRateAt5,
});

const deltas = metricDeltas(testLinear);
const gatedDeltas = metricDeltas(testGated);

/* legacy inline shape retained in report via `deltas`; gated results are separate. */
const _legacyDeltaShape = {
  top1MaxGrade: testLinear.top1MaxGrade - testOriginal.top1MaxGrade,
  relevantRecallAt20: testLinear.relevantRecallAt20 - testOriginal.relevantRecallAt20,
  relevantRecallAt40: testLinear.relevantRecallAt40 - testOriginal.relevantRecallAt40,
  weightedRecallAt20: testLinear.weightedRecallAt20 - testOriginal.weightedRecallAt20,
  weightedRecallAt40: testLinear.weightedRecallAt40 - testOriginal.weightedRecallAt40,
  ndcgAt5: testLinear.ndcgAt5 - testOriginal.ndcgAt5,
  ndcgAt10: testLinear.ndcgAt10 - testOriginal.ndcgAt10,
  mrrAt20: testLinear.mrrAt20 - testOriginal.mrrAt20,
  forbiddenRateAt5: testLinear.forbiddenRateAt5 - testOriginal.forbiddenRateAt5,
};
void _legacyDeltaShape;

const report = {
  schemaVersion: 2,
  experiment: 'minimed-frozen-candidate-linear-reranker',
  generatedAt: new Date().toISOString(),
  caveat:
    'Training uses the old 42-case public pilot after answer-term masking. ' +
    'This is a weak, visible ' +
    'training source and not a substitute for a private clinician-authored qualification set.',
  train: {
    path: trainPath,
    sha256: sha256File(trainPath),
    fixtureCount: trainGroups.size,
    candidatePairCount: trainRows.length,
    original: trainOriginal,
    linear: trainLinear,
    gated: trainGated,
  },
  test: {
    path: testPath,
    sha256: sha256File(testPath),
    fixtureCount: testGroups.size,
    candidatePairCount: testRows.length,
    original: testOriginal,
    linear: testLinear,
    gated: testGated,
    deltas,
    gatedDeltas,
    slices: {
      original: evaluationSlices(testGroups),
      linear: evaluationSlices(testGroups, rerank),
      gated: evaluationSlices(testGroups, rerankGated),
    },
  },
  model: {
    ...model,
    weightsByFeature: Object.fromEntries(
      LINEAR_RERANKER_FEATURES.map((feature, index) => [feature, model.weights[index] ?? 0]),
    ),
    approximateWeightBytes: model.weights.length * Float64Array.BYTES_PER_ELEMENT,
    abstentionGate: gate,
  },
  runtime: {
    repeatedCandidateScores: scoredCandidates,
    elapsedMs: scoringElapsedMs,
    microsecondsPerCandidate,
  },
  abstention: {
    status: 'selective-top1-measured',
    policy: gate.policy,
    minMargin: Number.isFinite(gate.minMargin) ? gate.minMargin : 'Infinity',
    note:
      'The margin threshold is calibrated on legacy training fixtures only. ' +
      'Negative/out-of-scope holdout abstention is still not qualified.',
  },
  rows,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      reportPath,
      trainingFixtures: trainGroups.size,
      testFixtures: testGroups.size,
      trainingPairs: model.trainingPairs,
      hardTrainingPairs: model.hardTrainingPairs,
      easyTrainingPairs: model.easyTrainingPairs,
      weightedTrainingPairs: model.weightedTrainingPairs,
      originalTop1MaxGrade: testOriginal.top1MaxGrade,
      linearTop1MaxGrade: testLinear.top1MaxGrade,
      gatedTop1MaxGrade: testGated.top1MaxGrade,
      top1Delta: deltas.top1MaxGrade,
      gatedTop1Delta: gatedDeltas.top1MaxGrade,
      originalNdcgAt5: testOriginal.ndcgAt5,
      linearNdcgAt5: testLinear.ndcgAt5,
      gatedNdcgAt5: testGated.ndcgAt5,
      abstentionGate: {
        ...gate,
        minMargin: Number.isFinite(gate.minMargin) ? gate.minMargin : 'Infinity',
      },
      microsecondsPerCandidate,
    },
    null,
    2,
  ),
);
