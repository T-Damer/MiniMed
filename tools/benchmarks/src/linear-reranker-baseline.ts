import { lightStemRussian, normalizeSurfaceText, tokenize } from '@localmed/search-lexical';

export interface FrozenCandidateRow {
  readonly schemaVersion: 2;
  readonly fixtureId: string;
  readonly query: string;
  readonly origin: string;
  readonly family: string;
  readonly goal: string;
  readonly answerability: string;
  readonly analysis: {
    readonly primaryIntent: string | null;
    readonly secondaryIntents: readonly string[];
    readonly intentConfidence: number;
    readonly needsClarification: boolean;
    readonly ageFacts: readonly string[];
    readonly positiveFindingCount: number;
    readonly positiveFindings: readonly string[];
    readonly negativeFindingCount: number;
    readonly negativeFindings: readonly string[];
    readonly currentMedicineCount: number;
    readonly currentMedicines: readonly string[];
    readonly branchKinds: readonly string[];
  };
  readonly retrieval: {
    readonly requestedMode: string;
    readonly modeUsed: string;
    readonly originalRank: number;
    readonly groupBestScore: number;
    readonly maximumLexicalScore: number;
    readonly maximumSemanticScore: number | null;
    readonly maximumFinalScore: number;
    readonly resultCount: number;
    readonly matchedTermCount: number;
    readonly matchedBranchCount: number;
    readonly matchedTerms: readonly string[];
    readonly matchedBranches: readonly string[];
    readonly coreCandidateCount: number;
    readonly semanticStatus: string;
    readonly semanticCandidateCount: number;
    readonly sectionTypes: readonly string[];
    readonly topSectionType: string | null;
    readonly terminologyMatch: string | null;
    readonly exactTitle: boolean;
    readonly exactShortTitle: boolean;
    readonly exactNavigationAlias: boolean;
    readonly exactDeclaredAlias: boolean;
  };
  readonly candidate: {
    readonly documentId: string;
    readonly conceptId: string | null;
    readonly canonicalName: string;
    readonly shortTitle: string | null;
    readonly sourceType: string | null;
    readonly navigationAliases: readonly string[];
    readonly declaredAliases: readonly string[];
    readonly ageGroups: readonly string[];
    readonly evidence: string;
  };
  readonly label: {
    readonly relevanceGrade: number;
    readonly expectedSectionTypes: readonly string[];
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
  'exactShortTitle',
  'exactNavigationAlias',
  'exactDeclaredAlias',
  'intentTreatmentSection',
  'intentDiagnosisSection',
  'intentCareGuidanceSection',
  'currentMedicineTreatmentSection',
  'currentMedicineMatchDominance',
  'negativeFindingSignal',
  'negativeMatchedTermConflict',
  'positiveFindingMatchedTermCoverage',
  'pediatricAgeCompatibility',
  'sourceClinicalRecommendation',
  'sectionClinicalPicture',
  'sectionDiagnostics',
  'sectionTreatment',
  'sectionRouting',
  'terminologyExact',
  'candidateQueryTokenCoverage',
  'candidatePositiveFindingCoverage',
  'candidateCurrentMedicineCoverage',
  'clinicalNarrativeMedicationSource',
  'treatmentIntentClinicalRecommendation',
  'diagnosisIntentClinicalRecommendation',
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
  readonly hardTrainingPairs: number;
  readonly easyTrainingPairs: number;
  readonly weightedTrainingPairs: number;
  readonly epochs: number;
  readonly learningRate: number;
  readonly l2: number;
}

export interface LinearAbstentionGate {
  readonly minMargin: number;
  readonly trainingChangedTop1: number;
  readonly trainingFixedTop1: number;
  readonly trainingRegressedTop1: number;
  readonly trainingImprovedTop1: number;
  readonly trainingWorsenedTop1: number;
  readonly trainingGradeDelta: number;
  readonly trainingNdcgAt5: number;
  readonly candidateThresholdCount: number;
  readonly policy: 'zero-regression-max-fixes';
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

export function parseFrozenCandidate(
  value: unknown,
  label = 'frozen candidate',
): FrozenCandidateRow {
  const row = objectValue(value, label);
  if (row.schemaVersion !== 2) {
    throw new Error(`${label}.schemaVersion must be 2.`);
  }
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
    schemaVersion: 2,
    fixtureId: stringValue(row.fixtureId, `${label}.fixtureId`),
    query: stringValue(row.query, `${label}.query`),
    origin: stringValue(row.origin, `${label}.origin`),
    family: stringValue(row.family, `${label}.family`),
    goal: stringValue(row.goal, `${label}.goal`),
    answerability: stringValue(row.answerability, `${label}.answerability`),
    analysis: {
      primaryIntent: nullableString(analysis.primaryIntent, `${label}.analysis.primaryIntent`),
      secondaryIntents: stringArray(
        analysis.secondaryIntents,
        `${label}.analysis.secondaryIntents`,
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
      positiveFindings: stringArray(
        analysis.positiveFindings,
        `${label}.analysis.positiveFindings`,
      ),
      negativeFindingCount: numberValue(
        analysis.negativeFindingCount,
        `${label}.analysis.negativeFindingCount`,
      ),
      negativeFindings: stringArray(
        analysis.negativeFindings,
        `${label}.analysis.negativeFindings`,
      ),
      currentMedicineCount: numberValue(
        analysis.currentMedicineCount,
        `${label}.analysis.currentMedicineCount`,
      ),
      currentMedicines: stringArray(
        analysis.currentMedicines,
        `${label}.analysis.currentMedicines`,
      ),
      branchKinds: stringArray(analysis.branchKinds, `${label}.analysis.branchKinds`),
    },
    retrieval: {
      requestedMode: stringValue(retrieval.requestedMode, `${label}.retrieval.requestedMode`),
      modeUsed: stringValue(retrieval.modeUsed, `${label}.retrieval.modeUsed`),
      originalRank,
      groupBestScore: numberValue(retrieval.groupBestScore, `${label}.retrieval.groupBestScore`),
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
      matchedTerms: stringArray(retrieval.matchedTerms, `${label}.retrieval.matchedTerms`),
      matchedBranches: stringArray(retrieval.matchedBranches, `${label}.retrieval.matchedBranches`),
      coreCandidateCount: numberValue(
        retrieval.coreCandidateCount,
        `${label}.retrieval.coreCandidateCount`,
      ),
      semanticStatus: stringValue(retrieval.semanticStatus, `${label}.retrieval.semanticStatus`),
      semanticCandidateCount: numberValue(
        retrieval.semanticCandidateCount,
        `${label}.retrieval.semanticCandidateCount`,
      ),
      sectionTypes: stringArray(retrieval.sectionTypes, `${label}.retrieval.sectionTypes`),
      topSectionType: nullableString(retrieval.topSectionType, `${label}.retrieval.topSectionType`),
      terminologyMatch: nullableString(
        retrieval.terminologyMatch,
        `${label}.retrieval.terminologyMatch`,
      ),
      exactTitle: booleanValue(retrieval.exactTitle, `${label}.retrieval.exactTitle`),
      exactShortTitle: booleanValue(
        retrieval.exactShortTitle,
        `${label}.retrieval.exactShortTitle`,
      ),
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
      conceptId: nullableString(candidate.conceptId, `${label}.candidate.conceptId`),
      canonicalName: stringValue(candidate.canonicalName, `${label}.candidate.canonicalName`),
      shortTitle: nullableString(candidate.shortTitle, `${label}.candidate.shortTitle`),
      sourceType: nullableString(candidate.sourceType, `${label}.candidate.sourceType`),
      navigationAliases: stringArray(
        candidate.navigationAliases,
        `${label}.candidate.navigationAliases`,
      ),
      declaredAliases: stringArray(candidate.declaredAliases, `${label}.candidate.declaredAliases`),
      ageGroups: stringArray(candidate.ageGroups, `${label}.candidate.ageGroups`),
      evidence: stringValue(candidate.evidence, `${label}.candidate.evidence`),
    },
    label: {
      relevanceGrade,
      expectedSectionTypes: stringArray(
        relevance.expectedSectionTypes,
        `${label}.label.expectedSectionTypes`,
      ),
      forbidden: booleanValue(relevance.forbidden, `${label}.label.forbidden`),
    },
  };
}

function validateFrozenCandidateGroup(
  fixtureId: string,
  group: readonly FrozenCandidateRow[],
): void {
  const first = group[0];
  if (!first) throw new Error(`${fixtureId}: frozen candidate group is empty.`);

  const analysisKey = JSON.stringify(first.analysis);
  const seenDocuments = new Set<string>();
  const seenRanks = new Set<number>();
  for (const row of group) {
    if (
      row.query !== first.query ||
      row.origin !== first.origin ||
      row.family !== first.family ||
      row.goal !== first.goal ||
      row.answerability !== first.answerability
    ) {
      throw new Error(`${fixtureId}: frozen candidate rows disagree on fixture metadata.`);
    }
    if (JSON.stringify(row.analysis) !== analysisKey) {
      throw new Error(`${fixtureId}: frozen candidate rows disagree on query analysis.`);
    }
    if (
      row.retrieval.requestedMode !== first.retrieval.requestedMode ||
      row.retrieval.modeUsed !== first.retrieval.modeUsed ||
      row.retrieval.coreCandidateCount !== first.retrieval.coreCandidateCount ||
      row.retrieval.semanticStatus !== first.retrieval.semanticStatus ||
      row.retrieval.semanticCandidateCount !== first.retrieval.semanticCandidateCount
    ) {
      throw new Error(`${fixtureId}: frozen candidate rows disagree on retrieval context.`);
    }
    if (seenDocuments.has(row.candidate.documentId)) {
      throw new Error(
        `${fixtureId}: duplicate frozen candidate document ${row.candidate.documentId}.`,
      );
    }
    if (seenRanks.has(row.retrieval.originalRank)) {
      throw new Error(
        `${fixtureId}: duplicate frozen candidate rank ${row.retrieval.originalRank}.`,
      );
    }
    seenDocuments.add(row.candidate.documentId);
    seenRanks.add(row.retrieval.originalRank);
  }
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
  for (const [fixtureId, group] of groups) {
    validateFrozenCandidateGroup(fixtureId, group);
    group.sort((left, right) => left.retrieval.originalRank - right.retrieval.originalRank);
    for (const [index, row] of group.entries()) {
      const expectedRank = index + 1;
      if (row.retrieval.originalRank !== expectedRank) {
        throw new Error(
          `${fixtureId}: frozen candidate ranks must be contiguous from 1; expected ${expectedRank}, got ${row.retrieval.originalRank}.`,
        );
      }
    }
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

function stemSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.flatMap((value) => tokenize(value).map(lightStemRussian)));
}

function matchedFactCoverage(facts: readonly string[], matchedTerms: readonly string[]): number {
  const factStems = stemSet(facts);
  if (factStems.size === 0) return 0;
  const matchedStems = stemSet(matchedTerms);
  const covered = [...factStems].filter((stem) => matchedStems.has(stem)).length;
  return covered / factStems.size;
}

function candidateText(row: FrozenCandidateRow): string {
  return [
    row.candidate.canonicalName,
    row.candidate.shortTitle ?? '',
    ...row.candidate.navigationAliases,
    ...row.candidate.declaredAliases,
    row.candidate.evidence,
  ].join(' ');
}

function factCoverageInCandidate(facts: readonly string[], row: FrozenCandidateRow): number {
  return matchedFactCoverage(facts, tokenize(candidateText(row)));
}

function queryCoverageInCandidate(row: FrozenCandidateRow): number {
  const queryTerms = tokenize(row.query)
    .filter((term) => term.length >= 3)
    .map(lightStemRussian);
  if (queryTerms.length === 0) return 0;
  const candidateStems = stemSet([candidateText(row)]);
  const uniqueQueryStems = [...new Set(queryTerms)];
  const covered = uniqueQueryStems.filter((stem) => candidateStems.has(stem)).length;
  return covered / uniqueQueryStems.length;
}

function isMedicationSource(sourceType: string | null): boolean {
  return (
    sourceType === 'official_drug_instruction' ||
    sourceType === 'official_registry_summary' ||
    sourceType === 'allmed_reference'
  );
}

function isClinicalRecommendationSource(sourceType: string | null): boolean {
  return (
    sourceType === 'clinical_recommendation' || sourceType === 'clinical_recommendation_summary'
  );
}

function hasMatchedFactConflict(
  facts: readonly string[],
  matchedTerms: readonly string[],
): boolean {
  if (facts.length === 0 || matchedTerms.length === 0) return false;
  const factStems = stemSet(facts);
  return [...stemSet(matchedTerms)].some((stem) => factStems.has(stem));
}

function queryLooksPediatric(ageFacts: readonly string[], query: string): boolean {
  const normalized = normalizeSurfaceText([query, ...ageFacts].join(' '));
  if (/(?:ребен|ребён|младен|груднич|новорож|подрост|мальчик|девочк)/u.test(normalized)) {
    return true;
  }
  for (const match of normalized.matchAll(/(\d{1,2})\s*(?:лет|год|года|месяц|месяца|месяцев)/gu)) {
    const age = Number(match[1]);
    if (Number.isFinite(age) && age < 18) return true;
  }
  return false;
}

function pediatricCompatibility(row: FrozenCandidateRow): number {
  if (!queryLooksPediatric(row.analysis.ageFacts, row.query)) return 0;
  const ageGroups = new Set(row.candidate.ageGroups.map((value) => normalizeSurfaceText(value)));
  if (ageGroups.size === 0) return 0;
  if (
    [...ageGroups].some((value) =>
      /(?:child|pediatric|infant|newborn|adolescent|дет|младен|новорож|подрост)/u.test(value),
    )
  ) {
    return 1;
  }
  // Generic/all-age labels are not evidence of incompatibility. Only an explicitly adult-only
  // candidate should contribute a negative audience signal for a pediatric query.
  return [...ageGroups].every((value) => /(?:adult|взросл)/u.test(value)) ? -1 : 0;
}

function currentMedicineMatchDominance(row: FrozenCandidateRow): number {
  const medicineCoverage = matchedFactCoverage(
    row.analysis.currentMedicines,
    row.retrieval.matchedTerms,
  );
  if (medicineCoverage === 0) return 0;
  const clinicalCoverage = matchedFactCoverage(
    row.analysis.positiveFindings,
    row.retrieval.matchedTerms,
  );
  return medicineCoverage * (1 - clinicalCoverage);
}

function sectionMatchesIntent(
  intent: string | null,
  section: string | null,
): {
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
  const semanticMax = maximumAbsolute(rows.map((row) => row.retrieval.maximumSemanticScore ?? 0));
  const finalMax = maximumAbsolute(rows.map((row) => row.retrieval.maximumFinalScore));
  const matchedTermsMax = maximumAbsolute(rows.map((row) => row.retrieval.matchedTermCount));
  const matchedBranchesMax = maximumAbsolute(rows.map((row) => row.retrieval.matchedBranchCount));
  const resultCountMax = maximumAbsolute(rows.map((row) => row.retrieval.resultCount));

  return rows.map((row) => {
    const section = row.retrieval.topSectionType;
    const intent = sectionMatchesIntent(row.analysis.primaryIntent, section);
    // Retrieval already produced this frozen candidate set. Keep it as a weak prior rather than
    // letting the baseline simply relearn BM25/original rank and call that "reranking".
    const retrievalPriorScale = 0.25;
    const clinicalNarrative =
      row.analysis.primaryIntent !== 'medication' && row.analysis.positiveFindingCount > 0;
    const clinicalRecommendation = isClinicalRecommendationSource(row.candidate.sourceType);
    const features = [
      retrievalPriorScale / row.retrieval.originalRank,
      retrievalPriorScale * normalized(row.retrieval.groupBestScore, groupScoreMax),
      retrievalPriorScale * normalized(row.retrieval.maximumLexicalScore, lexicalMax),
      retrievalPriorScale * normalized(row.retrieval.maximumSemanticScore ?? 0, semanticMax),
      retrievalPriorScale * normalized(row.retrieval.maximumFinalScore, finalMax),
      retrievalPriorScale * normalized(row.retrieval.matchedTermCount, matchedTermsMax),
      retrievalPriorScale * normalized(row.retrieval.matchedBranchCount, matchedBranchesMax),
      retrievalPriorScale * normalized(row.retrieval.resultCount, resultCountMax),
      Number(row.retrieval.exactTitle),
      Number(row.retrieval.exactShortTitle),
      Number(row.retrieval.exactNavigationAlias),
      Number(row.retrieval.exactDeclaredAlias),
      intent.treatment,
      intent.diagnosis,
      intent.care,
      Number(row.analysis.currentMedicineCount > 0 && section === 'treatment'),
      currentMedicineMatchDominance(row),
      Number(row.analysis.negativeFindingCount > 0),
      Number(hasMatchedFactConflict(row.analysis.negativeFindings, row.retrieval.matchedTerms)),
      matchedFactCoverage(row.analysis.positiveFindings, row.retrieval.matchedTerms),
      pediatricCompatibility(row),
      Number(
        row.candidate.sourceType === 'clinical_recommendation' ||
          row.candidate.sourceType === 'clinical_recommendation_summary',
      ),
      Number(section === 'clinical-picture'),
      Number(section === 'diagnostics'),
      Number(section === 'treatment'),
      Number(section === 'routing'),
      Number(row.retrieval.terminologyMatch === 'term'),
      queryCoverageInCandidate(row),
      factCoverageInCandidate(row.analysis.positiveFindings, row),
      factCoverageInCandidate(row.analysis.currentMedicines, row),
      Number(clinicalNarrative && isMedicationSource(row.candidate.sourceType)),
      Number(
        clinicalRecommendation &&
          (row.analysis.primaryIntent === 'treatment' ||
            row.analysis.primaryIntent === 'care-guidance'),
      ),
      Number(
        clinicalRecommendation &&
          (row.analysis.primaryIntent === 'diagnosis' ||
            row.analysis.primaryIntent === 'disease-reference'),
      ),
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
  readonly weight: number;
  readonly hard: boolean;
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
        const relevanceGap = preferred.row.label.relevanceGrade - other.row.label.relevanceGrade;
        const hard = preferred.row.retrieval.originalRank > other.row.retrieval.originalRank;
        // Easy pairs mostly teach the model to imitate the existing search order. Hard pairs are the
        // actual reranking problem, so give them much more influence while retaining a small anchor
        // from correctly ordered pairs.
        const weight = relevanceGap * (hard ? 4 : 0.25);
        pairs.push({
          difference: preferred.features.map(
            (value, index) => value - (other.features[index] ?? 0),
          ),
          weight,
          hard,
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
  if (pairs.length === 0) {
    throw new Error('Linear reranker training requires graded candidate pairs.');
  }

  const weights = Array<number>(LINEAR_RERANKER_FEATURES.length).fill(0);
  const totalPairWeight = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const rate = learningRate / Math.sqrt(1 + epoch * 0.05);
    const gradient = Array<number>(weights.length).fill(0);
    for (const pair of pairs) {
      const margin = Math.max(-30, Math.min(30, dot(weights, pair.difference)));
      const error = 1 / (1 + Math.exp(margin));
      for (let index = 0; index < weights.length; index += 1) {
        gradient[index] =
          (gradient[index] ?? 0) + pair.weight * error * (pair.difference[index] ?? 0);
      }
    }
    for (let index = 0; index < weights.length; index += 1) {
      const weight = weights[index] ?? 0;
      const dataGradient = totalPairWeight > 0 ? (gradient[index] ?? 0) / totalPairWeight : 0;
      weights[index] = weight + rate * (dataGradient - l2 * weight);
    }
  }

  return {
    featureNames: LINEAR_RERANKER_FEATURES,
    weights,
    trainingPairs: pairs.length,
    hardTrainingPairs: pairs.filter((pair) => pair.hard).length,
    easyTrainingPairs: pairs.filter((pair) => !pair.hard).length,
    weightedTrainingPairs: totalPairWeight,
    epochs,
    learningRate,
    l2,
  };
}

function originalCandidateOrder(
  rows: readonly FrozenCandidateRow[],
): readonly FrozenCandidateRow[] {
  return rows.toSorted((left, right) => left.retrieval.originalRank - right.retrieval.originalRank);
}

function scoredLinearCandidates(
  rows: readonly FrozenCandidateRow[],
  model: Pick<LinearRerankerModel, 'weights'>,
) {
  return linearCandidatesForFixture(rows)
    .map((candidate) => ({
      candidate,
      score: scoreLinearCandidate(model, candidate),
    }))
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.candidate.row.retrieval.originalRank - right.candidate.row.retrieval.originalRank,
    );
}

export function rerankLinearCandidates(
  rows: readonly FrozenCandidateRow[],
  model: Pick<LinearRerankerModel, 'weights'>,
): readonly FrozenCandidateRow[] {
  return scoredLinearCandidates(rows, model).map((entry) => entry.candidate.row);
}

export function linearTop1Proposal(
  rows: readonly FrozenCandidateRow[],
  model: Pick<LinearRerankerModel, 'weights'>,
): {
  readonly changed: boolean;
  readonly margin: number;
  readonly originalTop1DocumentId: string | null;
  readonly proposedTop1DocumentId: string | null;
} {
  const original = originalCandidateOrder(rows);
  const scored = scoredLinearCandidates(rows, model);
  const originalTop = original[0] ?? null;
  const proposedTop = scored[0] ?? null;
  if (!originalTop || !proposedTop) {
    return {
      changed: false,
      margin: 0,
      originalTop1DocumentId: originalTop?.candidate.documentId ?? null,
      proposedTop1DocumentId: proposedTop?.candidate.row.candidate.documentId ?? null,
    };
  }
  const originalScore =
    scored.find(
      (entry) => entry.candidate.row.candidate.documentId === originalTop.candidate.documentId,
    )?.score ?? Number.NEGATIVE_INFINITY;
  return {
    changed: proposedTop.candidate.row.candidate.documentId !== originalTop.candidate.documentId,
    margin: Math.max(0, proposedTop.score - originalScore),
    originalTop1DocumentId: originalTop.candidate.documentId,
    proposedTop1DocumentId: proposedTop.candidate.row.candidate.documentId,
  };
}

export function rerankLinearCandidatesGated(
  rows: readonly FrozenCandidateRow[],
  model: Pick<LinearRerankerModel, 'weights'>,
  gate: Pick<LinearAbstentionGate, 'minMargin'> | number,
): readonly FrozenCandidateRow[] {
  const minMargin = typeof gate === 'number' ? gate : gate.minMargin;
  const proposal = linearTop1Proposal(rows, model);
  if (!proposal.changed || proposal.margin < minMargin) {
    return originalCandidateOrder(rows);
  }
  return rerankLinearCandidates(rows, model);
}

interface Top1ChangeStats {
  readonly changed: number;
  readonly fixed: number;
  readonly regressed: number;
  readonly improved: number;
  readonly worsened: number;
  readonly gradeDelta: number;
}

function top1ChangeStats(
  groups: ReadonlyMap<string, readonly FrozenCandidateRow[]>,
  rerank: (rows: readonly FrozenCandidateRow[]) => readonly FrozenCandidateRow[],
): Top1ChangeStats {
  let changed = 0;
  let fixed = 0;
  let regressed = 0;
  let improved = 0;
  let worsened = 0;
  let gradeDelta = 0;

  for (const rows of groups.values()) {
    const original = originalCandidateOrder(rows);
    const reranked = rerank(rows);
    const originalTop = original[0];
    const rerankedTop = reranked[0];
    if (!originalTop || !rerankedTop) continue;
    if (originalTop.candidate.documentId === rerankedTop.candidate.documentId) continue;

    changed += 1;
    const maximumGrade = Math.max(0, ...rows.map((row) => row.label.relevanceGrade));
    const originalGrade = originalTop.label.relevanceGrade;
    const rerankedGrade = rerankedTop.label.relevanceGrade;
    const originalBest = originalGrade === maximumGrade;
    const rerankedBest = rerankedGrade === maximumGrade;
    gradeDelta += rerankedGrade - originalGrade;

    if (!originalBest && rerankedBest) fixed += 1;
    else if (originalBest && !rerankedBest) regressed += 1;
    else if (rerankedGrade > originalGrade) improved += 1;
    else if (rerankedGrade < originalGrade) worsened += 1;
  }

  return { changed, fixed, regressed, improved, worsened, gradeDelta };
}

export function calibrateLinearAbstentionGate(
  groups: ReadonlyMap<string, readonly FrozenCandidateRow[]>,
  model: Pick<LinearRerankerModel, 'weights'>,
): LinearAbstentionGate {
  const margins = [
    ...new Set(
      [...groups.values()]
        .map((rows) => linearTop1Proposal(rows, model))
        .filter((proposal) => proposal.changed && Number.isFinite(proposal.margin))
        .map((proposal) => proposal.margin),
    ),
  ].toSorted((left, right) => left - right);

  // Infinity is an explicit "abstain everywhere" fallback. The calibration objective is deliberately
  // conservative: never trade a known-good Top-1 training case for a fix elsewhere.
  const thresholds = [Number.POSITIVE_INFINITY, 0, ...margins];
  const candidates = thresholds.map((minMargin) => {
    const rerank = (rows: readonly FrozenCandidateRow[]) =>
      rerankLinearCandidatesGated(rows, model, minMargin);
    const stats = top1ChangeStats(groups, rerank);
    const metrics = evaluateFrozenRanking(groups, rerank);
    return { minMargin, stats, metrics };
  });

  const selected = candidates.toSorted((left, right) => {
    if (left.stats.regressed !== right.stats.regressed) {
      return left.stats.regressed - right.stats.regressed;
    }
    if (left.stats.fixed !== right.stats.fixed) {
      return right.stats.fixed - left.stats.fixed;
    }
    if (left.stats.gradeDelta !== right.stats.gradeDelta) {
      return right.stats.gradeDelta - left.stats.gradeDelta;
    }
    if (left.metrics.ndcgAt5 !== right.metrics.ndcgAt5) {
      return right.metrics.ndcgAt5 - left.metrics.ndcgAt5;
    }
    return right.minMargin - left.minMargin;
  })[0];
  if (!selected) throw new Error('Linear abstention calibration requires at least one threshold.');

  return {
    minMargin: selected.minMargin,
    trainingChangedTop1: selected.stats.changed,
    trainingFixedTop1: selected.stats.fixed,
    trainingRegressedTop1: selected.stats.regressed,
    trainingImprovedTop1: selected.stats.improved,
    trainingWorsenedTop1: selected.stats.worsened,
    trainingGradeDelta: selected.stats.gradeDelta,
    trainingNdcgAt5: selected.metrics.ndcgAt5,
    candidateThresholdCount: thresholds.length,
    policy: 'zero-regression-max-fixes',
  };
}

function dcg(grades: readonly number[]): number {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function fixtureMetrics(rows: readonly FrozenCandidateRow[]) {
  const maxGrade = Math.max(0, ...rows.map((row) => row.label.relevanceGrade));
  const relevant = rows.filter((row) => row.label.relevanceGrade > 0);
  const relevantWeight = relevant.reduce((sum, row) => sum + row.label.relevanceGrade, 0);
  const idsAt = (limit: number) =>
    new Set(rows.slice(0, limit).map((row) => row.candidate.documentId));
  const recall = (limit: number, weighted: boolean) => {
    const selected = idsAt(limit);
    const numerator = relevant.reduce(
      (sum, row) =>
        sum +
        (selected.has(row.candidate.documentId) ? (weighted ? row.label.relevanceGrade : 1) : 0),
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
