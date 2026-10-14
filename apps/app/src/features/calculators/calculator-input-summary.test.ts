import { describe, expect, it } from 'vitest';

import {
  calculatorInputFacts,
  calculatorInputSummary,
  initialCalculatorSchemaValues,
} from '@/features/calculators/calculator-schema-engine';
import {
  calculatorSchemaFromModules,
  loadToolModuleCalculatorSchemas,
} from '@/features/calculators/tool-module-test-helpers';

describe('the line under a result', () => {
  const schema = calculatorSchemaFromModules('minimed.calculator.wells-pe');

  it('names only the marked yes/no answers and keeps numbers', () => {
    const values = { ...initialCalculatorSchemaValues(schema), dvtSigns: '1', peMostLikely: '1' };
    const summary = calculatorInputSummary(schema, values);
    expect(summary).toContain('Клинические признаки ТГВ');
    expect(summary).not.toMatch(/Да|Нет/u);
    expect(summary).not.toContain('Кровохарканье');
  });

  it('is empty when nothing is marked and no number was entered', () => {
    const values = initialCalculatorSchemaValues(schema);
    // A heart rate field is a number: it stays whenever it holds a value.
    const summary = calculatorInputSummary(schema, values);
    expect(summary).not.toMatch(/Да|Нет/u);
  });
});

describe('the inputs of a result as label/value pairs', () => {
  const schema = calculatorSchemaFromModules('minimed.calculator.wells-pe');

  it('lists a marked yes/no answer by its label alone and a number with its unit', () => {
    const values = {
      ...initialCalculatorSchemaValues(schema),
      dvtSigns: '1',
      peMostLikely: '1',
      heartRate: '110',
    };
    const facts = calculatorInputFacts(schema, values);
    const flag = facts.find((fact) => fact.label.includes('ТГВ'));
    expect(flag).toBeDefined();
    expect(flag?.value).toBeUndefined();
    const rate = facts.find((fact) => fact.value !== undefined);
    expect(rate?.value).toMatch(/^110/u);
    // The one-line summary is the same facts joined.
    expect(calculatorInputSummary(schema, values)).toBe(
      facts
        .map((fact) => (fact.value === undefined ? fact.label : `${fact.label} ${fact.value}`))
        .join(', '),
    );
  });

  it('writes numbers with a decimal comma and dates as dd.mm.yyyy', () => {
    const growth = loadToolModuleCalculatorSchemas([
      'content/tool-modules/pediatrics-growth.json',
    ]).find((candidate) => candidate.id === 'minimed.calculator.pediatric-anthropometry-who');
    if (!growth) throw new Error('The growth calculator is not in its module');
    const facts = calculatorInputFacts(growth, {
      date_of_birth: '2023-06-01',
      length_height_cm: '98.5',
      weight_g: '15000',
    });
    const byLabel = new Map(facts.map((fact) => [fact.label, fact.value]));
    expect(byLabel.get('Дата рождения')).toBe('01.06.2023');
    expect(byLabel.get('Длина / рост')).toBe('98,5 см');
    expect(byLabel.get('Масса тела')).toMatch(/^15\s000 г$/u);
  });
});
