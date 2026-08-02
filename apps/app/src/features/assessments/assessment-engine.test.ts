import { describe, expect, it } from 'vitest';

import { findAssessmentBySlug } from '@/features/assessments/assessment-catalog';
import {
  answeredQuestionCount,
  scoreAssessment,
} from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';

function uniformAnswers(
  slug: string,
  value: AssessmentResponseValue,
): {
  readonly definition: NonNullable<ReturnType<typeof findAssessmentBySlug>>;
  readonly answers: AssessmentAnswers;
} {
  const definition = findAssessmentBySlug(slug);
  if (!definition) throw new Error(`Missing fixture: ${slug}`);
  return {
    definition,
    answers: Object.fromEntries(
      definition.questions.map((question) => [question.id, value]),
    ) as AssessmentAnswers,
  };
}

describe('assessment scoring', () => {
  it('requires every question to be answered', () => {
    const definition = findAssessmentBySlug('paei-work-style');
    if (!definition) throw new Error('Missing PAEI fixture');
    const result = scoreAssessment(definition, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Не заполнен пункт');
  });

  it('applies reverse-scored questions without exceeding normalized bounds', () => {
    const { definition, answers } = uniformAnswers('braverman-behavioral-profile', 5);
    const result = scoreAssessment(definition, answers, '2026-08-02T12:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scores.every((score) => score.percent >= 0 && score.percent <= 100)).toBe(
      true,
    );
    expect(result.value.completedAt).toBe('2026-08-02T12:00:00.000Z');
  });

  it('derives the classical temperament shorthand from two dimensions', () => {
    const definition = findAssessmentBySlug('temperament-profile');
    if (!definition) throw new Error('Missing temperament fixture');
    const answers = Object.fromEntries(
      definition.questions.map((question) => [question.id, question.reverse ? 1 : 5]),
    ) as AssessmentAnswers;
    const result = scoreAssessment(definition, answers);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.headline).toContain('сангвинический');
  });

  it('reports questionnaire completion', () => {
    const { definition, answers } = uniformAnswers('personal-egogram', 3);
    expect(answeredQuestionCount(definition, answers)).toBe(definition.questions.length);
    expect(answeredQuestionCount(definition, {})).toBe(0);
  });
});
