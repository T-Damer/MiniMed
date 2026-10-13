import { describe, expect, it } from 'vitest';

import {
  calculatorInputSummary,
  initialCalculatorSchemaValues,
} from '@/features/calculators/calculator-schema-engine';
import { calculatorSchemaFromModules } from '@/features/calculators/tool-module-test-helpers';

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
