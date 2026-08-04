import { describe, expect, it } from 'vitest';

import { loadAssessmentDefinition } from '@/features/assessments/assessment-catalog';
import { answeredQuestionCount, scoreAssessment } from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';

async function uniformAnswers(
  slug: string,
  value: AssessmentResponseValue,
): Promise<{
  readonly definition: AssessmentDefinition;
  readonly answers: AssessmentAnswers;
}> {
  const definition = await loadAssessmentDefinition(slug);
  return {
    definition,
    answers: Object.fromEntries(
      definition.questions.map((question) => [question.id, value]),
    ) as AssessmentAnswers,
  };
}

describe('assessment scoring', () => {
  it('requires every question to be answered', async () => {
    const definition = await loadAssessmentDefinition('paei-work-style');
    const result = scoreAssessment(definition, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Не заполнен пункт');
  });

  it('applies reverse-scored questions without exceeding normalized bounds', async () => {
    const { definition, answers } = await uniformAnswers('braverman-behavioral-profile', 5);
    const result = scoreAssessment(definition, answers, '2026-08-02T12:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scores.every((score) => score.percent >= 0 && score.percent <= 100)).toBe(
      true,
    );
    expect(result.value.completedAt).toBe('2026-08-02T12:00:00.000Z');
  });

  it('derives the classical temperament shorthand from two dimensions', async () => {
    const definition = await loadAssessmentDefinition('temperament-profile');
    const answers = Object.fromEntries(
      definition.questions.map((question) => [question.id, question.reverse ? 1 : 5]),
    ) as AssessmentAnswers;
    const result = scoreAssessment(definition, answers);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.headline).toContain('сангвинический');
  });

  it('reports questionnaire completion', async () => {
    const { definition, answers } = await uniformAnswers('personal-egogram', 3);
    expect(answeredQuestionCount(definition, answers)).toBe(definition.questions.length);
    expect(answeredQuestionCount(definition, {})).toBe(0);
  });
});
