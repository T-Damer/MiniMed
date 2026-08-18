import type { CalculatorInputDefinition, CalculatorSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  type CalculatorSchemaEvaluationOptions,
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import {
  loadToolModuleCalculatorSchemas,
  TOOL_MODULE_FILES,
} from '@/features/calculators/tool-module-test-helpers';

type InputRecord = Record<string, string | number>;

interface EvaluationCase {
  readonly schemaId: string;
  readonly caseName: string;
  readonly inputs: InputRecord;
  readonly options?: CalculatorSchemaEvaluationOptions;
}

const ALL_CALCULATOR_SCHEMAS = loadToolModuleCalculatorSchemas(TOOL_MODULE_FILES);

function numberBaseline(input: CalculatorInputDefinition): number {
  let value: number;
  if (input.minimum !== undefined && input.maximum !== undefined) {
    value = (input.minimum + input.maximum) / 2;
  } else if (input.minimum !== undefined) {
    value = input.minimum;
  } else if (input.maximum !== undefined) {
    value = input.maximum;
  } else {
    value = 1;
  }
  return input.integer === true ? Math.round(value) : value;
}

function numberMin(input: CalculatorInputDefinition): number {
  return input.minimum ?? 0;
}

function numberMax(input: CalculatorInputDefinition): number {
  return input.maximum ?? 1000;
}

function selectFirst(input: CalculatorInputDefinition): string | number {
  const option = input.options?.[0];
  if (!option) throw new Error(`select input ${input.id} has no options`);
  return option.value;
}

function selectLast(input: CalculatorInputDefinition): string | number {
  const options = input.options ?? [];
  const option = options[options.length - 1];
  if (!option) throw new Error(`select input ${input.id} has no options`);
  return option.value;
}

function valueForInput(
  input: CalculatorInputDefinition,
  mode: 'baseline' | 'all-min' | 'all-max',
): string | number {
  if (input.kind === 'number') {
    if (mode === 'baseline') return numberBaseline(input);
    if (mode === 'all-min') return numberMin(input);
    return numberMax(input);
  }
  if (input.kind === 'date') {
    if (mode === 'baseline') return '2024-06-15';
    if (mode === 'all-min') return '2000-01-01';
    return '2030-12-31';
  }
  if (mode === 'all-max') return selectLast(input);
  return selectFirst(input);
}

function buildFilledInputs(
  schema: CalculatorSchema,
  mode: 'baseline' | 'all-min' | 'all-max',
  options: {
    readonly requiredOnly?: boolean;
    readonly maxInputStep?: number;
  } = {},
): InputRecord {
  const inputs: InputRecord = {};
  for (const input of schema.inputs) {
    if (options.maxInputStep !== undefined && input.step > options.maxInputStep) continue;
    if (options.requiredOnly && !input.required) continue;
    inputs[input.id] = valueForInput(input, mode);
  }
  return inputs;
}

function hasStagedInputs(schema: CalculatorSchema): boolean {
  return schema.inputs.some((input) => input.step > 0);
}

function numberSweepValues(input: CalculatorInputDefinition): readonly (string | number)[] {
  const values: (string | number)[] = [];
  const seen = new Set<string>();
  const add = (value: string | number): void => {
    const key = typeof value === 'number' && Number.isNaN(value) ? 'NaN' : String(value);
    if (seen.has(key)) return;
    seen.add(key);
    values.push(value);
  };
  if (input.minimum !== undefined) add(input.minimum);
  if (input.minimum !== undefined && input.maximum !== undefined) {
    const mid = (input.minimum + input.maximum) / 2;
    add(input.integer === true ? Math.round(mid) : mid);
  }
  if (input.maximum !== undefined) add(input.maximum);
  if (input.minimum !== undefined) add(input.minimum - 1);
  if (input.maximum !== undefined) add(input.maximum + 1);
  add(0);
  if (input.integer === true) add(1.5);
  add(Number.NaN);
  add('not-a-number');
  return values;
}

const DATE_SWEEP_VALUES: readonly string[] = [
  '2020-01-01',
  '2024-02-29',
  '2023-02-29',
  '',
  'not-a-date',
  '2024-13-40',
];

function collectCasesForSchema(schema: CalculatorSchema): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  const schemaId = schema.id;

  cases.push({ schemaId, caseName: 'empty', inputs: {} });

  const baseline = buildFilledInputs(schema, 'baseline', { requiredOnly: true });
  cases.push({ schemaId, caseName: 'baseline-required', inputs: baseline });

  cases.push({
    schemaId,
    caseName: 'all-min',
    inputs: buildFilledInputs(schema, 'all-min'),
  });
  cases.push({
    schemaId,
    caseName: 'all-max',
    inputs: buildFilledInputs(schema, 'all-max'),
  });

  for (const input of schema.inputs) {
    if (input.kind === 'number') {
      for (const value of numberSweepValues(input)) {
        cases.push({
          schemaId,
          caseName: `sweep:${input.id}:${String(value)}`,
          inputs: { ...baseline, [input.id]: value },
        });
      }
    } else if (input.kind === 'select') {
      for (const option of input.options ?? []) {
        cases.push({
          schemaId,
          caseName: `sweep:${input.id}:${String(option.value)}`,
          inputs: { ...baseline, [input.id]: option.value },
        });
      }
    } else {
      for (const dateValue of DATE_SWEEP_VALUES) {
        cases.push({
          schemaId,
          caseName: `sweep:${input.id}:${dateValue || 'empty'}`,
          inputs: { ...baseline, [input.id]: dateValue },
        });
      }
    }
  }

  if (hasStagedInputs(schema)) {
    const baselineStep0 = buildFilledInputs(schema, 'baseline', {
      requiredOnly: true,
      maxInputStep: 0,
    });
    cases.push({
      schemaId,
      caseName: 'staged:maxStep-0',
      inputs: baselineStep0,
      options: { maxStep: 0 },
    });
    cases.push({
      schemaId,
      caseName: 'staged:all-steps',
      inputs: buildFilledInputs(schema, 'baseline', { requiredOnly: true }),
    });
  }

  return cases;
}

const ALL_CASES = ALL_CALCULATOR_SCHEMAS.flatMap((schema) => collectCasesForSchema(schema));

function assertEvaluationDoesNotThrow(
  schema: CalculatorSchema,
  inputs: InputRecord,
  options?: CalculatorSchemaEvaluationOptions,
): void {
  let result: ReturnType<typeof evaluateCalculatorSchema> | undefined;
  expect(() => {
    result = evaluateCalculatorSchema(schema, inputs, options);
  }).not.toThrow();

  expect(result).toBeDefined();
  if (!result) throw new Error('evaluation did not run');
  const evaluation = result;
  if (!evaluation.ok) {
    expect(evaluation.error.length).toBeGreaterThan(0);
    return;
  }
  expect(() => toStoredCalculationResult(evaluation)).not.toThrow();
}

describe('calculator schema evaluate-all', () => {
  it('loads every tool-module calculator schema', () => {
    expect(ALL_CALCULATOR_SCHEMAS.length).toBeGreaterThanOrEqual(40);

    const ids = ALL_CALCULATOR_SCHEMAS.map((schema) => schema.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'minimed.calculator.ballard-neonatal-gestational-age',
        'minimed.calculator.cha2ds2-vasc',
        'obstetric-bishop-score',
        'body-surface-area-mosteller',
      ]),
    );
  });

  it.each(ALL_CASES.map((testCase) => [testCase.schemaId, testCase.caseName, testCase]))(
    '%s — %s',
    (_schemaId, _caseName, testCase) => {
      const schema = ALL_CALCULATOR_SCHEMAS.find((entry) => entry.id === testCase.schemaId);
      if (!schema) throw new Error(`missing schema ${testCase.schemaId}`);
      assertEvaluationDoesNotThrow(schema, testCase.inputs, testCase.options);
    },
  );
});
