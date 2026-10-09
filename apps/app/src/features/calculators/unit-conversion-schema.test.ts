import { describe, expect, it } from 'vitest';

import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import {
  applyCalculatorInputChange,
  calculatorInputOptions,
  evaluateCalculatorSchema,
  initialCalculatorSchemaValues,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import { UNIT_CONVERSION_SCHEMA } from '@/features/calculators/unit-conversion-schema';

const schema = UNIT_CONVERSION_SCHEMA;

function optionValue(inputId: string, label: string, quantity: string): string {
  const input = schema.inputs.find((candidate) => candidate.id === inputId);
  if (!input) throw new Error(`No input ${inputId}`);
  const option = calculatorInputOptions(input, { quantity }).find((entry) => entry.label === label);
  if (!option) throw new Error(`No unit ${label}`);
  return String(option.value);
}

function convert(quantity: string, amount: string, from: string, to: string) {
  const result = evaluateCalculatorSchema(schema, {
    quantity,
    amount,
    sourceUnit: optionValue('sourceUnit', from, quantity),
    targetUnit: optionValue('targetUnit', to, quantity),
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('the built-in unit converter', () => {
  it('is a valid declarative schema that needs no module and no patient', () => {
    expect(validateCalculatorSchema(schema).errors).toEqual([]);
    expect(getCalculatorSchema('unit-conversion')).toBe(schema);
    expect(schema.bundled).toBe(true);
    expect(schema.inputs.some((input) => input.patientBinding)).toBe(false);
  });

  it('converts mass through the base unit and writes the units in Cyrillic', () => {
    const result = convert('mass', '1', 'кг', 'мг');
    const stored = toStoredCalculationResult(result);
    expect(stored).toMatchObject({ ok: true, value: 1_000_000, unit: 'мг', displayPrecision: 8 });
    expect(result.trace.map((step) => [step.label, step.value, step.unit])).toEqual([
      ['Исходное значение', 1, 'кг'],
      ['В базовой единице', 1, 'базовых ед.'],
      ['Результат', 1_000_000, 'мг'],
    ]);
  });

  it('converts length and volume without hidden rounding', () => {
    expect(toStoredCalculationResult(convert('length', '172', 'см', 'м'))).toMatchObject({
      value: 1.72,
      unit: 'м',
    });
    expect(toStoredCalculationResult(convert('volume', '2.5', 'мл', 'л'))).toMatchObject({
      value: 0.0025,
      unit: 'л',
    });
    const micrograms = toStoredCalculationResult(convert('mass', '250', 'мкг', 'мг'));
    expect(micrograms).toMatchObject({ unit: 'мг' });
    expect('value' in micrograms && micrograms.value).toBeCloseTo(0.25, 12);
  });

  it('rejects a negative amount', () => {
    const result = evaluateCalculatorSchema(schema, {
      quantity: 'length',
      amount: '-1',
      sourceUnit: '0.01',
      targetUnit: '1',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a unit of another quantity', () => {
    const result = evaluateCalculatorSchema(schema, {
      quantity: 'volume',
      amount: '10',
      sourceUnit: optionValue('sourceUnit', 'мг', 'mass'),
      targetUnit: optionValue('targetUnit', 'мл', 'volume'),
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe('quantity-grouped unit selects', () => {
  const unitsOf = (inputId: string, quantity: string): string[] => {
    const input = schema.inputs.find((candidate) => candidate.id === inputId);
    return input ? calculatorInputOptions(input, { quantity }).map((option) => option.label) : [];
  };

  it('offer only the units of the chosen quantity', () => {
    expect(unitsOf('sourceUnit', 'mass')).toEqual(['кг', 'г', 'мг', 'мкг']);
    expect(unitsOf('sourceUnit', 'length')).toEqual(['м', 'см', 'мм']);
    expect(unitsOf('sourceUnit', 'volume')).toEqual(['л', 'мл']);
    for (const quantity of ['mass', 'length', 'volume'])
      for (const label of unitsOf('sourceUnit', quantity)) expect(label).toMatch(/^[а-я]+$/u);
  });

  it('open as the first unit into the second', () => {
    const values = initialCalculatorSchemaValues(schema);
    expect(values['quantity']).toBe('mass');
    const result = evaluateCalculatorSchema(schema, { ...values, amount: '5' });
    expect(result.ok && toStoredCalculationResult(result)).toMatchObject({
      value: 5000,
      unit: 'г',
    });
  });

  it('fall back to the first units of the new quantity when the quantity changes', () => {
    const start = { ...initialCalculatorSchemaValues(schema), amount: '2' };
    const next = applyCalculatorInputChange(schema, start, 'quantity', 'volume');
    expect(next['quantity']).toBe('volume');
    expect(next['amount']).toBe('2');
    const result = evaluateCalculatorSchema(schema, next);
    expect(result.ok && toStoredCalculationResult(result)).toMatchObject({
      value: 2000,
      unit: 'мл',
    });
  });

  it('never carry a unit over to another quantity that happens to share its factor', () => {
    const grams = applyCalculatorInputChange(
      schema,
      initialCalculatorSchemaValues(schema),
      'sourceUnit',
      optionValue('sourceUnit', 'г', 'mass'),
    );
    const length = applyCalculatorInputChange(schema, grams, 'quantity', 'length');
    expect(length['sourceUnit']).toBe(optionValue('sourceUnit', 'м', 'length'));
    expect(length['targetUnit']).toBe(optionValue('targetUnit', 'см', 'length'));
  });

  it('keep a unit that still belongs to the quantity', () => {
    const start = initialCalculatorSchemaValues(schema);
    const picked = applyCalculatorInputChange(
      schema,
      start,
      'sourceUnit',
      optionValue('sourceUnit', 'мг', 'mass'),
    );
    expect(picked['sourceUnit']).toBe(optionValue('sourceUnit', 'мг', 'mass'));
    expect(picked['targetUnit']).toBe(start['targetUnit']);
  });
});
