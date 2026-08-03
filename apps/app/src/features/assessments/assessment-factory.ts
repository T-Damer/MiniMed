import type {
  AssessmentQuestion,
  AssessmentResponseOption,
} from '@/features/assessments/assessment-types';

export const STANDARD_RESPONSE_OPTIONS: readonly AssessmentResponseOption[] = [
  { value: 1, label: 'Совсем не похоже на меня' },
  { value: 2, label: 'Скорее не похоже' },
  { value: 3, label: 'Иногда / трудно сказать' },
  { value: 4, label: 'Скорее похоже' },
  { value: 5, label: 'Очень похоже на меня' },
];

export type AssessmentQuestionSeed =
  | readonly [scaleId: string, prompt: string]
  | readonly [scaleId: string, prompt: string, reverse: true];

export function buildAssessmentQuestions(
  slug: string,
  seeds: readonly AssessmentQuestionSeed[],
): readonly AssessmentQuestion[] {
  return seeds.map((seed, index) => {
    const id = `${slug}-${String(index + 1).padStart(2, '0')}`;
    return seed[2] === true
      ? { id, scaleId: seed[0], prompt: seed[1], reverse: true }
      : { id, scaleId: seed[0], prompt: seed[1] };
  });
}
