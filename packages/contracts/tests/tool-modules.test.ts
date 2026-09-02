import { describe, expect, it } from 'vitest';

import { AssessmentDefinitionSchema, ToolSourceLinkSchema } from '../src/tool-modules';

describe('tool module contracts', () => {
  it('rejects script and data source links', () => {
    const source = {
      id: 'source-1',
      kind: 'literature' as const,
      relation: 'methodology' as const,
      title: 'Источник',
      reviewedAt: '2026-08-29',
    };
    expect(ToolSourceLinkSchema.safeParse({ ...source, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(
      ToolSourceLinkSchema.safeParse({ ...source, url: 'data:text/html,alert(1)' }).success,
    ).toBe(false);
  });

  it('accepts optional interpretation bands on assessment definitions', () => {
    const result = AssessmentDefinitionSchema.parse({
      schemaVersion: 2,
      id: 'minimed.assessment.example',
      slug: 'example-assessment',
      title: 'Пример опросника',
      shortTitle: 'Пример',
      aliases: ['example'],
      bankId: 'neonatology',
      bankLabel: 'Неонатология',
      category: 'example',
      description: 'Пример для проверки контракта.',
      estimatedMinutes: 1,
      audience: 'Тест',
      responseOptions: [{ value: 0, label: '0' }],
      scales: [
        {
          id: 'example-total',
          label: 'Итог',
          shortLabel: 'Итог',
          description: 'Сумма пунктов.',
        },
      ],
      questions: [{ id: 'example-q1', prompt: 'Пункт 1', scaleId: 'example-total' }],
      disclaimer: 'Тестовый опросник не предназначен для клинического применения.',
      evidenceNote: 'Тестовые пороги для проверки контракта.',
      interpretations: [
        {
          minScore: 0,
          maxScore: 1,
          scaleId: 'example-total',
          headline: 'Низкий результат',
          message: '0–1 балл по тестовой шкале.',
        },
      ],
      evaluation: {
        status: 'unavailable',
        rules: [],
        missingContext: [],
        reason: 'В тестовом контракте вычисляемое правило намеренно не объявлено.',
        sourceIds: [],
      },
      observationMappings: [
        {
          metricId: 'example.example-total',
          label: 'Итог',
          unit: 'баллы',
          scaleId: 'example-total',
        },
      ],
      license: {
        kind: 'project-original',
        notice: 'Тестовый опросник MiniMed для проверки контракта.',
      },
      sources: [{ title: 'Extra source metadata should not break parsing.' }],
    });

    expect(result.interpretations).toHaveLength(1);
    expect(result.interpretations?.[0]?.headline).toBe('Низкий результат');
  });
});
