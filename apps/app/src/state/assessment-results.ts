import type {
  AssessmentAnswers,
  AssessmentRecord,
  CompletedAssessmentRecord,
  IncompleteAssessmentRecord,
  ScoredAssessment,
} from '@/features/assessments/assessment-types';

export const ASSESSMENT_RESULTS_KEY = 'minimed.assessment-results.v1';
export const ASSESSMENT_RESULTS_EVENT = 'minimed:assessment-results-changed';

function createId(): string {
  if ('crypto' in globalThis && typeof crypto.randomUUID === 'function') {
    return `assessment-${crypto.randomUUID()}`;
  }
  return `assessment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isStringRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isScoredAssessment(value: unknown): value is ScoredAssessment {
  if (!isStringRecord(value) || !Array.isArray(value['scores'])) return false;
  return (
    typeof value['assessmentId'] === 'string' &&
    typeof value['completedAt'] === 'string' &&
    Array.isArray(value['primaryScaleIds']) &&
    typeof value['headline'] === 'string' &&
    typeof value['summary'] === 'string' &&
    typeof value['disclaimer'] === 'string' &&
    value['scores'].every(
      (score) =>
        isStringRecord(score) &&
        typeof score['scaleId'] === 'string' &&
        typeof score['label'] === 'string' &&
        typeof score['shortLabel'] === 'string' &&
        typeof score['rawScore'] === 'number' &&
        typeof score['minimumScore'] === 'number' &&
        typeof score['maximumScore'] === 'number' &&
        typeof score['percent'] === 'number',
    )
  );
}

function isAssessmentAnswers(value: unknown): value is AssessmentAnswers {
  return (
    isStringRecord(value) &&
    Object.values(value).every(
      (answer) =>
        typeof answer === 'number' && Number.isInteger(answer) && answer >= 0 && answer <= 5,
    )
  );
}

function isAssessmentRecord(value: unknown): value is AssessmentRecord {
  if (!isStringRecord(value)) return false;
  const common =
    typeof value['id'] === 'string' &&
    typeof value['assessmentId'] === 'string' &&
    typeof value['subjectLabel'] === 'string' &&
    typeof value['createdAt'] === 'string';
  if (!common) return false;
  if (value['kind'] === 'manual') return typeof value['text'] === 'string';
  if (value['kind'] === 'incomplete') {
    return (
      isAssessmentAnswers(value['answers']) &&
      typeof value['totalQuestions'] === 'number' &&
      Number.isInteger(value['totalQuestions']) &&
      value['totalQuestions'] > 0
    );
  }
  return (
    value['kind'] === 'completed' &&
    isAssessmentAnswers(value['answers']) &&
    isScoredAssessment(value['result'])
  );
}

function persist(records: readonly AssessmentRecord[]): readonly AssessmentRecord[] {
  window.localStorage.setItem(ASSESSMENT_RESULTS_KEY, JSON.stringify(records));
  window.dispatchEvent(new CustomEvent(ASSESSMENT_RESULTS_EVENT, { detail: records }));
  return records;
}

export function loadAssessmentRecords(): readonly AssessmentRecord[] {
  try {
    const raw = window.localStorage.getItem(ASSESSMENT_RESULTS_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(isAssessmentRecord)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

export function createCompletedAssessmentRecord(input: {
  readonly id?: string;
  readonly assessmentId: string;
  readonly subjectLabel: string;
  readonly answers: AssessmentAnswers;
  readonly result: ScoredAssessment;
}): CompletedAssessmentRecord {
  const record: CompletedAssessmentRecord = {
    id: input.id ?? createId(),
    assessmentId: input.assessmentId,
    subjectLabel: input.subjectLabel.trim(),
    createdAt: input.result.completedAt,
    kind: 'completed',
    answers: input.answers,
    result: input.result,
  };
  persist([record, ...loadAssessmentRecords().filter((candidate) => candidate.id !== record.id)]);
  return record;
}

export function saveIncompleteAssessmentRecord(input: {
  readonly id?: string;
  readonly assessmentId: string;
  readonly subjectLabel: string;
  readonly answers: AssessmentAnswers;
  readonly totalQuestions: number;
}): IncompleteAssessmentRecord {
  const record: IncompleteAssessmentRecord = {
    id: input.id ?? createId(),
    assessmentId: input.assessmentId,
    subjectLabel: input.subjectLabel.trim(),
    createdAt: new Date().toISOString(),
    kind: 'incomplete',
    answers: input.answers,
    totalQuestions: input.totalQuestions,
  };
  persist([record, ...loadAssessmentRecords().filter((candidate) => candidate.id !== record.id)]);
  return record;
}

export function removeAssessmentRecord(recordId: string): readonly AssessmentRecord[] {
  return persist(loadAssessmentRecords().filter((record) => record.id !== recordId));
}

export function findAssessmentRecord(recordId: string): AssessmentRecord | undefined {
  return loadAssessmentRecords().find((record) => record.id === recordId);
}

export function latestIncompleteAssessmentRecord(
  records: readonly AssessmentRecord[],
  assessmentId: string,
): IncompleteAssessmentRecord | undefined {
  return records.find(
    (record): record is IncompleteAssessmentRecord =>
      record.kind === 'incomplete' && record.assessmentId === assessmentId,
  );
}
