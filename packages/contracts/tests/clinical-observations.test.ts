import { describe, expect, it } from 'vitest';

import {
  CalculatorPatientBindingSchema,
  HttpUrlSchema,
  ObservationMappingSchema,
  ReferenceVerdictSchema,
  ToolEvaluationSchema,
} from '../src/clinical-observations';

describe('clinical observation contracts', () => {
  it('accepts only HTTP(S) source URLs', () => {
    expect(HttpUrlSchema.parse('https://example.test/source')).toBe('https://example.test/source');
    expect(HttpUrlSchema.parse('http://example.test/source')).toBe('http://example.test/source');
    expect(HttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrlSchema.safeParse('data:text/html,<script>alert(1)</script>').success).toBe(false);
  });

  it('accepts every explicit evaluation state', () => {
    for (const status of ['missing-context', 'unavailable', 'not-applicable'] as const) {
      expect(
        ToolEvaluationSchema.parse({ status, rules: [], missingContext: [], sourceIds: [] }).status,
      ).toBe(status);
    }
    expect(
      ToolEvaluationSchema.parse({
        status: 'verdict',
        rules: [
          {
            when: 'score >= 0',
            verdict: {
              rangeId: 'test',
              title: 'Тест',
              explanation: 'Тестовое правило.',
              attentionLevel: 'none',
            },
          },
        ],
        missingContext: [],
        sourceIds: [],
      }).status,
    ).toBe('verdict');
  });

  it('requires an executable rule for a verdict evaluation', () => {
    expect(
      ToolEvaluationSchema.safeParse({
        status: 'verdict',
        rules: [],
        missingContext: [],
        sourceIds: [],
      }).success,
    ).toBe(false);
  });

  it('rejects a mapping without exactly one deterministic source', () => {
    expect(ObservationMappingSchema.safeParse({ metricId: 'bmi', unit: 'кг/м²' }).success).toBe(
      false,
    );
    expect(
      ObservationMappingSchema.safeParse({
        metricId: 'bmi',
        unit: 'кг/м²',
        inputId: 'weight',
        stepId: 'bmi',
      }).success,
    ).toBe(false);
  });

  it('requires a metric for latest-observation bindings', () => {
    expect(CalculatorPatientBindingSchema.safeParse({ kind: 'latestObservation' }).success).toBe(
      false,
    );
    expect(
      CalculatorPatientBindingSchema.parse({
        kind: 'latestObservation',
        metricId: 'body-mass',
        unit: 'кг',
        maxAgeDays: 30,
      }).metricId,
    ).toBe('body-mass');
  });

  it('keeps the reference verdict bounds and provenance in the snapshot shape', () => {
    const verdict = ReferenceVerdictSchema.parse({
      rangeId: 'normal',
      title: 'В пределах диапазона',
      explanation: 'Тестовый диапазон.',
      attentionLevel: 'none',
      lowerBound: 0,
      upperBound: 10,
      sourceIds: ['source-1'],
    });
    expect(verdict.sourceIds).toEqual(['source-1']);
    expect(verdict.lowerInclusive).toBe(true);
    expect(
      ReferenceVerdictSchema.safeParse({
        rangeId: 'invalid',
        title: 'Неверный диапазон',
        explanation: 'Нижняя граница выше верхней.',
        attentionLevel: 'none',
        lowerBound: 10,
        upperBound: 1,
      }).success,
    ).toBe(false);
  });
});
