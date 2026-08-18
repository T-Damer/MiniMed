import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolDefinitionRecord } from '@localmed/contracts';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { answeredQuestionCount, scoreAssessment } from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

afterEach(() => {
  clearDownloadedAssessments();
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

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

  describe('schema-driven interpretations', () => {
    afterEach(() => {
      for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
        if (record.kind === 'assessment') registerDownloadedAssessment(record);
      }
    });

    it('uses interpretation bands from a downloaded assessment definition', async () => {
      const record: ToolDefinitionRecord = {
        id: 'minimed.assessment.test-schema-interpretations',
        kind: 'assessment',
        version: '1.0.0',
        slug: 'test-schema-interpretations',
        title: 'Тестовая шкала интерпретаций',
        shortTitle: 'Тест интерпретаций',
        aliases: ['test schema interpretations'],
        bankId: 'neonatology',
        bankLabel: 'Неонатология',
        category: 'test',
        description: 'Минимальный опросник для проверки schema-driven интерпретаций.',
        estimatedMinutes: 1,
        audience: 'Тест',
        definition: {
          id: 'minimed.assessment.test-schema-interpretations',
          slug: 'test-schema-interpretations',
          title: 'Тестовая шкала интерпретаций',
          shortTitle: 'Тест интерпретаций',
          aliases: ['test schema interpretations'],
          bankId: 'neonatology',
          bankLabel: 'Неонатология',
          category: 'test',
          description: 'Минимальный опросник для проверки schema-driven интерпретаций.',
          estimatedMinutes: 1,
          audience: 'Тест',
          responseOptions: [
            { value: 0, label: '0' },
            { value: 1, label: '1' },
            { value: 2, label: '2' },
          ],
          scales: [
            {
              id: 'test-total',
              label: 'Итог',
              shortLabel: 'Итог',
              description: 'Сумма двух пунктов.',
            },
          ],
          questions: [
            { id: 'test-q1', prompt: 'Пункт 1', scaleId: 'test-total' },
            { id: 'test-q2', prompt: 'Пункт 2', scaleId: 'test-total' },
          ],
          disclaimer: 'Тестовый опросник не предназначен для клинического применения.',
          evidenceNote: 'Тестовые пороги: 0–1 низкий, 2–4 умеренный.',
          interpretations: [
            {
              minScore: 0,
              maxScore: 1,
              headline: 'Низкий результат',
              message: '0–1 балл: низкий результат по тестовой шкале.',
            },
            {
              minScore: 2,
              maxScore: 4,
              headline: 'Умеренный результат',
              message: '2–4 балла: умеренный результат по тестовой шкале.',
            },
          ],
          license: {
            kind: 'project-original',
            notice: 'Тестовый опросник MiniMed для проверки schema-driven интерпретаций.',
          },
        },
        sources: [],
      };

      registerDownloadedAssessment(record);
      const definition = await loadAssessmentDefinition('test-schema-interpretations');
      const lowResult = scoreAssessment(definition, { 'test-q1': 0, 'test-q2': 1 });
      expect(lowResult.ok).toBe(true);
      if (!lowResult.ok) return;
      expect(lowResult.value.headline).toBe('Низкий результат');
      expect(lowResult.value.summary).toContain('низкий результат');

      const moderateResult = scoreAssessment(definition, { 'test-q1': 2, 'test-q2': 2 });
      expect(moderateResult.ok).toBe(true);
      if (!moderateResult.ok) return;
      expect(moderateResult.value.headline).toBe('Умеренный результат');
      expect(moderateResult.value.summary).toContain('умеренный результат');
    });

    it('scores NIPS from neonatology tool module with schema interpretation bands', async () => {
      const module = JSON.parse(
        readFileSync(resolve(process.cwd(), 'content/tool-modules/neonatology.json'), 'utf8'),
      ) as { tools: readonly ToolDefinitionRecord[] };
      const nips = module.tools.find((tool) => tool.slug === 'neonatal-infant-pain-scale');
      expect(nips).toBeDefined();
      if (!nips) return;

      registerDownloadedAssessment(nips);
      const definition = await loadAssessmentDefinition('neonatal-infant-pain-scale');
      const answers = Object.fromEntries(
        definition.questions.map((question) => [question.id, 0]),
      ) as AssessmentAnswers;
      const result = scoreAssessment(definition, answers);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.headline).toBe('Признаков боли по NIPS не выявлено');
      expect(result.value.summary).toContain('0–1 балл');
    });
  });
});
