export interface FrozenCandidateRow {
  readonly fixtureId: string;
  readonly query: string;
  readonly origin: string;
  readonly family: string;
  readonly goal: string;
  readonly analysis: {
    readonly primaryIntent: string | null;
    readonly intentConfidence: number;
    readonly needsClarification: boolean;
    readonly ageFacts: readonly string[];
    readonly positiveFindingCount: number;
    readonly negativeFindingCount: number;
    readonly currentMedicineCount: number;
  };
  readonly retrieval: {
    readonly originalRank: number;
    readonly groupBestScore: number;
    readonly maximumLexicalScore: number;
    readonly maximumSemanticScore: number | null;
    readonly maximumFinalScore: number;
    readonly resultCount: number;
    readonly matchedTermCount: number;
    readonly matchedBranchCount: number;
    readonly topSectionType: string | null;
    readonly terminologyMatch: string | null;
    readonly exactTitle: boolean;
    readonly exactNavigationAlias: boolean;
    readonly exactDeclaredAlias: boolean;
  };
  readonly candidate: {
    readonly documentId: string;
    readonly sourceType: string | null;
  };
  readonly label: {
    readonly relevanceGrade: number;
    readonly forbidden: boolean;
  };
}

export const LINEAR_RERANKER_FEATURES = [
  'reciprocalOriginalRank',
  'groupScoreNormalized',
  'lexicalScoreNormalized',
  'semanticScoreNormalized',
  'finalScoreNormalized',
  'matchedTermsNormalized',
  'matchedBranchesNormalized',
  'resultCountNormalized',
  'exactTitle',
  'exactNavigationAlias',
  'exactDeclaredAlias',
  'intentTreatmentSection',
  'intentDiagnosisSection',
  'intentCareGuidanceSection',
  'currentMedicineTreatmentSection',
  'negativeFindingSignal',
  'sectionClinicalPicture',
  'sectionDiagnostics',
  'sectionTreatment',
  'sectionRouting',
  'terminologyExact',
] as const;

export type LinearRerankerFeature = (typeof LINEAR_RERANKER_FEATURES)[number];

export interface LinearCandidate {
  readonly row: FrozenCandidateRow;
  readonly features: readonly number[];
}

export interface LinearRerankerModel {
  readonly featureNames: readonly LinearRerankerFeature[];
  readonly weights: readonly number[];
  readonly trainingPairs: number;
  readonly epochs: number;
  readonly learningRate: number;
  readonly l2: number;
}

export interface RerankerMetrics {
  readonly fixtureCount: number;
  readonly top1MaxGrade: number;
  readonly relevantRecallAt20: number;
  readonly relevantRecallAt40: number;
  readonly weightedRecallAt20: number;
  readonly weightedRecallAt40: number;
  readonly ndcgAt5: number;
  readonly ndcgAt10: number;
  readonly mrrAt20: number;
  readonly forbiddenRateAt5: number;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  return numberValue(value, label);
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be a string array.`);
  }
  return value;
}

export function parseFrozenCandidate(value: unknown, label = 'frozen candidate'): FrozenCandidateRow {
  const row = objectValue(value, label);
  const analysis = objectValue(row.analysis, `${label}.analysis`);
  const retrieval = objectValue(row.retrieval, `${label}.retrieval`);
  const candidate = objectValue(row.candidate, `${label}.candidate`);
  const relevance = objectValue(row.label, `${label}.label`);
  const relevanceGrade = numberValue(relevance.relevanceGrade, `${label}.label.relevanceGrade`);
  if (!Number.isInteger(relevanceGrade) || relevanceGrade < 0 || relevanceGrade > 3) {
    throw new Error(`${label}.label.relevanceGrade must be an integer from 0 through 3.`);
  }
  const originalRank = numberValue(retrieval.originalRank, `${label}.retrieval.originalRank`);
  if (!Number.isInteger(originalRank) || originalRank < 1) {
    throw new Error(`${label}.retrieval.originalRank must be a positive integer.`);
  }

  return {
    fixtureId: stringValue(row.fixtureId, `${label}.fixtureId`),
    query: stringValue(row.query, `${label}.query`),
    origin: stringValue(row.origin, `${label}.origin`),
    family: stringValue(row.family, `${label}.family`),
    goal: stringValue(row.goal, `${label}.goal`),
    analysis: {
      primaryIntent: nullableString(
        analysis.primaryIntent,
        `${label}.analysis.primaryIntent`,
      ),
      intentConfidence: numberValue(
        analysis.intentConfidence,
        `${label}.analysis.intentConfidence`,
      ),
      needsClarification: booleanValue(
        analysis.needsClarification,
        `${label}.analysis.needsClarification`,
      ),
      ageFacts: stringArray(analysis.ageFacts, `${label}.analysis.ageFacts`),
      positiveFindingCount: numberValue(
        analysis.positiveFindingCount,
        `${label}.analysis.positiveFindingCount`,
      ),
      negativeFindingCount: numberValue(
        analysis.negativeFindingCount,
        `${label}.analysis.negativeFindingCount`,
      ),
      currentMedicineCount: numberValue(
        analysis.currentMedicineCount,
        `${label}.analysis.currentMedicineCount`,
      ),
    },
    retrieval: {
      originalRank,
      groupBestScore: numberValue(
        retrieval.groupBestScore,
        `${label}.retrieval.groupBestScore`,
      ),
      maximumLexicalScore: numberValue(
        retrieval.maximumLexicalScore,
        `${label}.retrieval.maximumLexicalScore`,
      ),
      maximumSemanticScore: nullableNumber(
        retrieval.maximumSemanticScore,
        `${label}.retrieval.maximumSemanticScore`,
      ),
      maximumFinalScore: numberValue(
        retrieval.maximumFinalScore,
        `${label}.retrieval.maximumFinalScore`,
      ),
      resultCount: numberValue(retrieval.resultCount, `${label}.retrieval.resultCount`),
      matchedTermCount: numberValue(
        retrieval.matchedTermCount,
        `${label}.retrieval.matchedTermCount`,
      ),
      matchedBranchCount: numberValue(
        retrieval.matchedBranchCount,
        `${label}.retrieval.matchedBranchCount`,
      ),
      topSectionType: nullableString(
        retrieval.topSectionType,
        `${label}.retrieval.topSectionType`,
      ),
      terminologyMatch: nullableString(
        retrieval.terminologyMatch,
        `${label}.retrieval.terminologyMatch`,
      ),
      exactTitle: booleanValue(retrieval.exactTitle, `${label}.retrieval.exactTitle`),
      exactNavigationAlias: booleanValue(
        retrieval.exactNavigationAlias,
        `${label}.retrieval.exactNavigationAlias`,
      ),
      exactDeclaredAlias: booleanValue(
        retrieval.exactDeclaredAlias,
        `${label}.retrieval.exactDeclaredAlias`,
      ),
    },
    candidate: {
      documentId: stringValue(candidate.documentId, `${label}.candidate.documentId`),
      sourceType: nullableString(candidate.sourceType, `${label}.candidate.sourceType`),
    },
    label: {
      relevanceGrade,
      forbidden: booleanValue(relevance.forbidden, `${label}.label.forbidden`),
    },
  };
}

export function groupFrozenCandidates(
  rows: readonly FrozenCandidateRow[],
): ReadonlyMap<string, readonly FrozenCandidateRow[]> {
  const groups = new Map<string, FrozenCandidateRow[]>();
  for (const row of rows) {
    let group = groups.get(row.fixtureId);
    if (!group) {
      group = [];
      groups.set(row.fixtureId, group);
    }
    group.push(row);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.retrieval.originalRank - right.retrieval.originalRank);
  }
  return groups;
}

function maximumAbsolute(values: readonly number[]): number {
  const maximum = Math.max(0, ...values.map((value) => Math.abs(value)));
  return maximum > 0 ? maximum : 1;
}

function normalized(value: number, denominator: number): number {
  return value / denominator;
}

function sectionMatchesIntent(intent: string | null, section: string | null): {
  treatment: number;
  diagnosis: number;
  care: number;
} {
  const treatment =
    (intent === 'treatment' || intent === 'medication' || intent === 'mixed') &&
    section === 'treatment'
      ? 1
      : 0;
  const diagnosis =
    (intent === 'diagnosis' || intent === 'disease-reference' || intent === 'mixed') &&
    (section === 'clinical-picture' ||
      section === 'differential-diagnosis' ||
      section === 'diagnostics' ||
      section === 'definition')
      ? 1
      : 0;
  const care =
    intent === 'care-guidance' &&
    (section === 'routing' || section === 'treatment' || section === 'follow-up')
      ? 1
      : 0;
  return { treatment, diagnosis, care };
}

export function linearCandidatesForFixture(
  rows: readonly FrozenCandidateRow[],
): readonly LinearCandidate[] {
  if (rows.length === 0) return [];
  const groupScoreMax = maximumAbsolute(rows.map((row) => row.retrieval.groupBestScore));
  const lexicalMax = maximumAbsolute(rows.map((row) => row.retrieval.maximumLexicalScore));
  const semanticMax = maximumAbsolute(
    rows.map((row) => row.retrieval.maximumSemanticScore ?? 0),
  );
  const finalMax = maximumAbsolute(rows.map((row) => row.retrieval.maximumFinalScore));
  const matchedTermsMax = maximumAbsolute(rows.map((row) => row.retrieval.matchedTermCount));
  const matchedBranchesMax = maximumAbsolute(rows.map((row) => row.retrieval.matchedBranchCount));
  const resultCountMax = maximumAbsolute(rows.map((row) => row.retrieval.resultCount));

  return rows.map((row) => {
    const section = row.retrieval.topSectionType;
    const intent = sectionMatchesIntent(row.analysis.primaryIntent, section);
    const features = [
      1 / row.retrieval.originalRank,
      normalized(row.retrieval.groupBestScore, groupScoreMax),
      normalized(row.retrieval.maximumLexicalScore, lexicalMax),
      normalized(row.retrieval.maximumSemanticScore ?? 0, semanticMax),
      normalized(row.retrieval.maximumFinalScore, finalMax),
      normalized(row.retrieval.matchedTermCount, matchedTermsMax),
      normalized(row.retrieval.matchedBranchCount, matchedBranchesMax),
      normalized(row.retrieval.resultCount, resultCountMax),
      Number(row.retrieval.exactTitle),
      Number(row.retrieval.exactNavigationAlias),
      Number(row.retrieval.exactDeclaredAlias),
      intent.treatment,
      intent.diagnosis,
      intent.care,
      Number(row.analysis.currentMedicineCount > 0 && section === 'treatment'),
      Number(row.analysis.negativeFindingCount > 0),
      Number(section === 'clinical-picture'),
      Number(section === 'diagnostics'),
      Number(section === 'treatment'),
      Number(section === 'routing'),
      Number(row.retrieval.terminologyMatch === 'term'),
    ] satisfies number[];

    if (features.length !== LINEAR_RERANKER_FEATURES.length) {
      throw new Error('Linear reranker feature vector length mismatch.');
    }
    return { row, features };
  });
}

function dot(weights: readonly number[], features: readonly number[]): number {
  return weights.reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0);
}

export function scoreLinearCandidate(
  model: Pick<LinearRerankerModel, 'weights'>,
  candidate: LinearCandidate,
): number {
  return dot(model.weights, candidate.features);
}

interface TrainingPair {
  readonly difference: readonly number[];
}

function trainingPairs(
  groups: ReadonlyMap<string, readonly FrozenCandidateRow[]>,
): readonly TrainingPair[] {
  const pairs: TrainingPair[] = [];
  for (const rows of groups.values()) {
    const candidates = linearCandidatesForFixture(rows);
    for (const preferred of candidates) {
      for (const other of candidates) {
        if (preferred.row.label.relevanceGrade <= other.row.label.relevanceGrade) continue;
        pairs.push({
          difference: preferred.features.map(
            (value, index) => value - (other.features[index] ?? 0),
          ),
        });
      }
    }
  }
  return pairs;
}

export function trainPairwiseLinearReranker(
  rows: readonly FrozenCandidateRow[],
  options: {
    readonly epochs?: number;
    readonly learningRate?: number;
    readonly l2?: number;
  } = {},
): LinearRerankerModel {
  const epochs = options.epochs ?? 250;
  const learningRate = options.learningRate ?? 0.08;
  const l2 = options.l2 ?? 0.002;
  const groups = groupFrozenCandidates(rows);
  const pairs = trainingPairs(groups);
  if (pairs.length === 0) throw new Error('Linear reranker training requires graded candidate pairs.');

  const weights = Array<number>(LINEAR_RERANKER_FEATURES.length).fill(0);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const rate = learningRate / Math.sqrt(1 + epoch * 0.05);
    for (const pair of pairs) {
      const margin = Math.max(-30, Math.min(30, dot(weights, pair.difference)));
      const error = 1 / (1 + Math.exp(margin));
      for (let index = 0; index < weights.length; index += 1) {
        const weight = weights[index] ?? 0;
        const gradient = error * (pair.difference[index] ?? 0) - l2 * weight;
        weights[index] = weight + rate * gradient;
      }
    }
  }

  return {
    featureNames: LINEAR_RERANKER_FEATURES,
    weights,
    trainingPairs: pairs.length,
    epochs,
    learningRate,
    l2,
  };
}

export function rerankLinearCandidates(
  rows: readonly FrozenCandidateRow[],
  model: Pick<LinearRerankerModel, 'weights'>,
): readonly FrozenCandidateRow[] {
  return linearCandidatesForFixture(rows)
    .map((candidate) => ({
      candidate,
      score: scoreLinearCandidate(model, candidate),
    }))
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.candidate.row.retrieval.originalRank - right.candidate.row.retrieval.originalRank,
    )
    .map((entry) => entry.candidate.row);
}

function dcg(grades: readonly number[]): number {
  return grades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function fixtureMetrics(rows: readonly FrozenCandidateRow[]) {
  const maxGrade = Math.max(0, ...rows.map((row) => row.label.relevanceGrade));
  const relevant = rows.filter((row) => row.label.relevanceGrade > 0);
  const relevantWeight = relevant.reduce((sum, row) => sum + row.label.relevanceGrade, 0);
  const idsAt = (limit: number) => new Set(rows.slice(0, limit).map((row) => row.candidate.documentId));
  const recall = (limit: number, weighted: boolean) => {
    const selected = idsAt(limit);
    const numerator = relevant.reduce(
      (sum, row) =>
        sum +
        (selected.has(row.candidate.documentId)
          ? weighted
            ? row.label.relevanceGrade
            : 1
          : 0),
      0,
    );
    const denominator = weighted ? relevantWeight : relevant.length;
    return denominator === 0 ? 0 : numerator / denominator;
  };
  const idealGrades = relevant
    .map((row) => row.label.relevanceGrade)
    .toSorted((left, right) => right - left);
  const ndcg = (limit: number) => {
    const ideal = dcg(idealGrades.slice(0, limit));
    return ideal === 0
      ? 0
      : dcg(rows.slice(0, limit).map((row) => row.label.relevanceGrade)) / ideal;
  };
  const firstRelevant = rows.findIndex((row) => row.label.relevanceGrade > 0);

  return {
    top1MaxGrade: maxGrade > 0 && rows[0]?.label.relevanceGrade === maxGrade ? 1 : 0,
    relevantRecallAt20: recall(20, false),
    relevantRecallAt40: recall(40, false),
    weightedRecallAt20: recall(20, true),
    weightedRecallAt40: recall(40, true),
    ndcgAt5: ndcg(5),
    ndcgAt10: ndcg(10),
    mrrAt20: firstRelevant >= 0 && firstRelevant < 20 ? 1 / (firstRelevant + 1) : 0,
    forbiddenAt5: rows.slice(0, 5).some((row) => row.label.forbidden) ? 1 : 0,
  };
}

export function evaluateFrozenRanking(
  groups: ReadonlyMap<string, readonly FrozenCandidateRow[]>,
  rerank?: (rows: readonly FrozenCandidateRow[]) => readonly FrozenCandidateRow[],
): RerankerMetrics {
  const metrics = [...groups.values()].map((rows) => fixtureMetrics(rerank ? rerank(rows) : rows));
  const count = metrics.length;
  if (count === 0) {
    return {
      fixtureCount: 0,
      top1MaxGrade: 0,
      relevantRecallAt20: 0,
      relevantRecallAt40: 0,
      weightedRecallAt20: 0,
      weightedRecallAt40: 0,
      ndcgAt5: 0,
      ndcgAt10: 0,
      mrrAt20: 0,
      forbiddenRateAt5: 0,
    };
  }
  const average = (key: keyof (typeof metrics)[number]) =>
    metrics.reduce((sum, item) => sum + item[key], 0) / count;
  return {
    fixtureCount: count,
    top1MaxGrade: average('top1MaxGrade'),
    relevantRecallAt20: average('relevantRecallAt20'),
    relevantRecallAt40: average('relevantRecallAt40'),
    weightedRecallAt20: average('weightedRecallAt20'),
    weightedRecallAt40: average('weightedRecallAt40'),
    ndcgAt5: average('ndcgAt5'),
    ndcgAt10: average('ndcgAt10'),
    mrrAt20: average('mrrAt20'),
    forbiddenRateAt5: average('forbiddenAt5'),
  };
}

export function evaluationSlices(
  groups: ReadonlyMap<string, readonly FrozenCandidateRow[]>,
  rerank?: (rows: readonly FrozenCandidateRow[]) => readonly FrozenCandidateRow[],
): {
  readonly family: Readonly<Record<string, RerankerMetrics>>;
  readonly goal: Readonly<Record<string, RerankerMetrics>>;
} {
  const slice = (key: 'family' | 'goal') => {
    const values = [
      ...new Set(
        [...groups.values()].map((rows) => {
          const first = rows[0];
          if (!first) throw new Error('Frozen candidate fixture cannot be empty.');
          return first[key];
        }),
      ),
    ].toSorted();
    return Object.fromEntries(
      values.map((value) => {
        const selected = new Map(
          [...groups.entries()].filter(([, rows]) => rows[0]?.[key] === value),
        );
        return [value, evaluateFrozenRanking(selected, rerank)];
      }),
    );
  };
  return { family: slice('family'), goal: slice('goal') };
}
