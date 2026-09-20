import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PORTABLE_HASH_PROFILE } from '@localmed/search-semantic';

import { rerankPortableEmbeddingCandidates } from './frozen-embedding-baseline';
import {
  evaluateFrozenRanking,
  evaluationSlices,
  type FrozenCandidateRow,
  groupFrozenCandidates,
  parseFrozenCandidate,
} from './linear-reranker-baseline';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);

for (const arg of args) {
  if (!/^--(?:test|report|repeats)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const projectPath = (value: string | undefined, fallback: string): string =>
  resolve(root, value ?? fallback);
const testPath = projectPath(
  option('test'),
  'data/build/search-quality-v2-frozen-candidates.jsonl',
);
const reportPath = projectPath(
  option('report'),
  'data/build/search-quality-frozen-embedding-report.json',
);
const repeats = Number(option('repeats') ?? '50');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 1000) {
  throw new Error('--repeats must be an integer from 1 through 1000.');
}
if (!existsSync(testPath)) {
  throw new Error(`Frozen embedding input does not exist: ${testPath}`);
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

const testRows = loadJsonl(testPath);
if (testRows.some((row) => row.origin === 'legacy-pilot-training')) {
  throw new Error('Frozen embedding qualification rows must not use legacy-pilot-training origin.');
}
const testGroups = groupFrozenCandidates(testRows);
const rerank = (rows: readonly FrozenCandidateRow[]) => rerankPortableEmbeddingCandidates(rows);

const original = evaluateFrozenRanking(testGroups);
const embedding = evaluateFrozenRanking(testGroups, rerank);
const deltas = {
  top1MaxGrade: embedding.top1MaxGrade - original.top1MaxGrade,
  relevantRecallAt20: embedding.relevantRecallAt20 - original.relevantRecallAt20,
  relevantRecallAt40: embedding.relevantRecallAt40 - original.relevantRecallAt40,
  weightedRecallAt20: embedding.weightedRecallAt20 - original.weightedRecallAt20,
  weightedRecallAt40: embedding.weightedRecallAt40 - original.weightedRecallAt40,
  ndcgAt5: embedding.ndcgAt5 - original.ndcgAt5,
  ndcgAt10: embedding.ndcgAt10 - original.ndcgAt10,
  mrrAt20: embedding.mrrAt20 - original.mrrAt20,
  forbiddenRateAt5: embedding.forbiddenRateAt5 - original.forbiddenRateAt5,
};

const scoringStartedAt = performance.now();
let scoredCandidates = 0;
for (let repeat = 0; repeat < repeats; repeat += 1) {
  for (const rows of testGroups.values()) {
    rerank(rows);
    scoredCandidates += rows.length;
  }
}
const elapsedMs = performance.now() - scoringStartedAt;
const microsecondsPerCandidate = scoredCandidates === 0 ? 0 : (elapsedMs * 1000) / scoredCandidates;

const rows = [...testGroups.entries()].map(([fixtureId, candidates]) => {
  const embedded = rerank(candidates);
  return {
    fixtureId,
    family: candidates[0]?.family ?? null,
    goal: candidates[0]?.goal ?? null,
    originalTop1DocumentId: candidates[0]?.candidate.documentId ?? null,
    originalTop1Grade: candidates[0]?.label.relevanceGrade ?? 0,
    embeddingTop1DocumentId: embedded[0]?.candidate.documentId ?? null,
    embeddingTop1Grade: embedded[0]?.label.relevanceGrade ?? 0,
    maximumAvailableGrade: Math.max(0, ...candidates.map((row) => row.label.relevanceGrade)),
    changedTop1: candidates[0]?.candidate.documentId !== embedded[0]?.candidate.documentId,
  };
});

const report = {
  schemaVersion: 1,
  experiment: 'minimed-frozen-candidate-portable-embedding',
  generatedAt: new Date().toISOString(),
  test: {
    path: testPath,
    sha256: sha256File(testPath),
    fixtureCount: testGroups.size,
    candidatePairCount: testRows.length,
    original,
    embedding,
    deltas,
    slices: {
      original: evaluationSlices(testGroups),
      embedding: evaluationSlices(testGroups, rerank),
    },
  },
  embeddingProfile: {
    id: PORTABLE_HASH_PROFILE.id,
    dimensions: PORTABLE_HASH_PROFILE.dimensions,
    vectorFormat: PORTABLE_HASH_PROFILE.vectorFormat,
    normalization: PORTABLE_HASH_PROFILE.normalization,
    candidateText:
      'canonicalName + shortTitle + navigationAliases + declaredAliases + evidence; internal IDs excluded',
  },
  runtime: {
    repeats,
    repeatedCandidateScores: scoredCandidates,
    elapsedMs,
    microsecondsPerCandidate,
  },
  abstention: {
    status: 'not-measured',
    reason:
      'The current frozen challenge does not contain a qualified negative/out-of-scope holdout set.',
  },
  rows,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      reportPath,
      testSha256: report.test.sha256,
      profileId: PORTABLE_HASH_PROFILE.id,
      originalTop1MaxGrade: original.top1MaxGrade,
      embeddingTop1MaxGrade: embedding.top1MaxGrade,
      top1Delta: deltas.top1MaxGrade,
      originalNdcgAt5: original.ndcgAt5,
      embeddingNdcgAt5: embedding.ndcgAt5,
      microsecondsPerCandidate,
    },
    null,
    2,
  ),
);
