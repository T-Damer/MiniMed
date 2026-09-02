import { type CalculatorSchema, CalculatorSchemaSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';

const BASE_SCHEMA = {
  schemaVersion: 2 as const,
  id: 'visual-test-calc',
  slug: 'visual-test-calc',
  title: 'ИМТ (тест визуализации)',
  shortTitle: 'ИМТ',
  aliases: [],
  summary: 'Тестовый калькулятор с визуализацией.',
  audience: 'all' as const,
  category: 'anthropometry' as const,
  clinical: false,
  formulaDisplay: 'ИМТ = вес / рост²',
  population: 'взрослые',
  limitations: ['Тестовая схема.'],
  inputs: [
    { id: 'weight_kg', label: 'Вес', unit: 'кг', kind: 'number', required: true },
    { id: 'height_m', label: 'Рост', unit: 'м', kind: 'number', required: true },
  ],
  steps: [
    {
      id: 'bmi',
      label: 'ИМТ',
      unit: 'кг/м²',
      expression: 'weight_kg / (height_m * height_m)',
      isOutput: true,
    },
  ],
  sources: [{ title: 'Test source', publisher: 'Test', version: '1', reviewedAt: '2026-01-01' }],
  evaluation: { status: 'unavailable' as const, rules: [], missingContext: [], sourceIds: [] },
  observationMappings: [
    { metricId: 'visual-test-calc.bmi', label: 'ИМТ', unit: 'кг/м²', stepId: 'bmi' },
  ],
};

function schemaWithVisuals(visuals: unknown[]): CalculatorSchema {
  return CalculatorSchemaSchema.parse({ ...BASE_SCHEMA, visuals });
}

const INPUTS = { weight_kg: 70, height_m: 1.75 } as const;

describe('calculator visuals', () => {
  it('evaluates dataset expressions and emits a serializable chart spec', () => {
    const schema = schemaWithVisuals([
      {
        id: 'bmi_chart',
        title: 'ИМТ до и после',
        kind: 'bar',
        labels: ['до', 'после'],
        datasets: [{ label: 'ИМТ', data: ['bmi', 24] }],
      },
    ]);
    const result = evaluateCalculatorSchema(schema, INPUTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const visual = result.outputs.find((output) => output.kind === 'visual');
    expect(visual).toBeDefined();
    if (visual?.kind !== 'visual') return;
    expect(visual.chart).toEqual({
      type: 'bar',
      labels: ['до', 'после'],
      datasets: [{ label: 'ИМТ', data: [expect.closeTo(22.857, 2), 24] }],
    });

    const stored = toStoredCalculationResult(result);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.visuals).toHaveLength(1);
    expect(JSON.stringify(stored.visuals)).toContain('"data"');
  });

  it('accepts literal-only pie charts', () => {
    const schema = schemaWithVisuals([
      {
        id: 'pie_chart',
        title: 'Состав',
        kind: 'pie',
        datasets: [{ label: 'Доли', data: [30, 70] }],
      },
    ]);
    const result = evaluateCalculatorSchema(schema, INPUTS);
    expect(result.ok).toBe(true);
  });

  it('fails when a dataset expression references an unknown variable', () => {
    const schema = schemaWithVisuals([
      {
        id: 'broken_chart',
        title: 'Сломано',
        kind: 'line',
        datasets: [{ label: 'Ряд', data: ['undeclared_var'] }],
      },
    ]);
    const result = evaluateCalculatorSchema(schema, INPUTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Визуализация');
  });

  it('fails when bar data points do not match labels', () => {
    const schema = schemaWithVisuals([
      {
        id: 'mismatch_chart',
        title: 'Не сходится',
        kind: 'bar',
        labels: ['а', 'б', 'в'],
        datasets: [{ label: 'Ряд', data: [1, 2] }],
      },
    ]);
    const result = evaluateCalculatorSchema(schema, INPUTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('не совпадает');
  });
});
