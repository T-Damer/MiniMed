import type {
  AssessmentAnswers,
  AssessmentDefinition,
} from '@/features/assessments/assessment-types';

/** How many pages the questions take: one unless the definition declares `pageSize`. */
export function questionPageCount(definition: AssessmentDefinition): number {
  const size = definition.pageSize;
  if (!size) return 1;
  return Math.max(1, Math.ceil(definition.questions.length / size));
}

/** The page holding the question at `index` (0-based). */
export function questionPageOf(definition: AssessmentDefinition, index: number): number {
  const size = definition.pageSize;
  if (!size || index < 0) return 0;
  return Math.min(Math.floor(index / size), questionPageCount(definition) - 1);
}

/** The questions of one page as indexes: `start` included, `end` excluded. */
export function questionPageRange(
  definition: AssessmentDefinition,
  page: number,
): { readonly start: number; readonly end: number } {
  const size = definition.pageSize;
  const total = definition.questions.length;
  if (!size) return { start: 0, end: total };
  const start = Math.min(page, questionPageCount(definition) - 1) * size;
  return { start, end: Math.min(start + size, total) };
}

/** Index of the first question with no answer; the last question when all are answered. */
export function firstUnansweredIndex(
  definition: AssessmentDefinition,
  answers: AssessmentAnswers,
): number {
  const index = definition.questions.findIndex((question) => answers[question.id] === undefined);
  return index === -1 ? Math.max(definition.questions.length - 1, 0) : index;
}
