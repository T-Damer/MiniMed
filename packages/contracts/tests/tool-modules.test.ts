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
      visuals: [
        {
          id: 'example_chart',
          title: 'Пример графика',
          kind: 'scatter',
          datasets: [
            {
              label: 'Результат',
              points: [{ x: 'percent_example_total', y: 50 }],
              render: 'point',
            },
          ],
          xAxis: { label: 'Ось X', minimum: 0, maximum: 100 },
          yAxis: { label: 'Ось Y', minimum: 0, maximum: 100, reverse: true },
          annotations: [
            {
              kind: 'quadrants',
              x: 50,
              y: 50,
              labels: {
                topLeft: 'A',
                topRight: 'B',
                bottomLeft: 'C',
                bottomRight: 'D',
              },
            },
          ],
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
    expect(result.visuals[0]?.kind).toBe('scatter');
  });

  it('accepts external assessment variants and rejects invalid numeric bounds', () => {
    const base = {
      schemaVersion: 2 as const,
      id: 'minimed.assessment.external-example',
      slug: 'external-example',
      title: 'Внешняя методика',
      shortTitle: 'Внешняя',
      aliases: ['external'],
      bankId: 'psychiatry',
      bankLabel: 'Психиатрия',
      category: 'cognitive-assessment',
      description: 'Результат вводится по внешнему лицензированному материалу.',
      estimatedMinutes: 10,
      audience: 'Взрослые',
      responseOptions: [],
      scales: [],
      questions: [],
      disclaimer: 'Тестовая запись.',
      evidenceNote: 'Автоматическая интерпретация отключена.',
      externalAdministration: {
        mode: 'external' as const,
        variants: [
          {
            id: 'standard',
            label: 'Стандартный вариант',
            shortLabel: 'SPM',
            description: 'Внешний вариант.',
            audience: 'Тест',
            resultFields: [
              {
                id: 'score',
                kind: 'number' as const,
                label: 'Балл',
                required: true,
                minimum: 0,
                maximum: 60,
                integer: true,
              },
            ],
          },
        ],
        material: {
          policy: 'user-local-file' as const,
          acceptedMimeTypes: ['application/pdf' as const, 'image/png' as const],
          note: 'Материал выбирается локально.',
        },
      },
      evaluation: {
        status: 'unavailable' as const,
        rules: [],
        missingContext: [],
        reason: 'Нет автоматической нормативной интерпретации.',
        sourceIds: [],
      },
      observationMappings: [],
      license: {
        kind: 'third-party-attributed' as const,
        notice: 'Внешняя методика.',
        sourceUrl: 'https://example.org/test',
      },
    };

    const parsed = AssessmentDefinitionSchema.parse(base);
    expect(parsed.externalAdministration?.variants[0]?.resultFields[0]).toMatchObject({
      id: 'score',
      minimum: 0,
      maximum: 60,
      integer: true,
    });

    const invalid = structuredClone(base);
    const field = invalid.externalAdministration.variants[0]?.resultFields[0];
    if (!field) throw new Error('Expected numeric field.');
    field.minimum = 61;
    expect(AssessmentDefinitionSchema.safeParse(invalid).success).toBe(false);

    const withQuestion = structuredClone(base);
    withQuestion.questions = [{ id: 'q1', prompt: 'Protected item', scaleId: 'total' }];
    expect(AssessmentDefinitionSchema.safeParse(withQuestion).success).toBe(false);

    const withVerdict = structuredClone(base);
    withVerdict.evaluation = {
      status: 'verdict',
      rules: [
        {
          when: '1',
          verdict: {
            rangeId: 'external-verdict',
            title: 'Should not be accepted',
            explanation: 'External results are not automatically interpreted.',
            attentionLevel: 'none',
            lowerInclusive: true,
            upperInclusive: true,
            sourceIds: [],
          },
        },
      ],
      missingContext: [],
      sourceIds: [],
    };
    expect(AssessmentDefinitionSchema.safeParse(withVerdict).success).toBe(false);

    const duplicateFields = structuredClone(base);
    const existingField = duplicateFields.externalAdministration.variants[0]?.resultFields[0];
    if (!existingField) throw new Error('Expected result field.');
    duplicateFields.externalAdministration.variants[0]?.resultFields.push(
      structuredClone(existingField),
    );
    expect(AssessmentDefinitionSchema.safeParse(duplicateFields).success).toBe(false);
  });

});
