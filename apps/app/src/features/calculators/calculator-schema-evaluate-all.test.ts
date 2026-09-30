import type { CalculatorSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildFilledInputs,
  collectCasesForSchema,
  type InputRecord,
} from '@/features/calculators/calculator-schema-cases';

import {
  type CalculatorSchemaEvaluationOptions,
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import {
  loadToolModuleCalculatorSchemas,
  TOOL_MODULE_FILES,
} from '@/features/calculators/tool-module-test-helpers';

const ALL_CALCULATOR_SCHEMAS = loadToolModuleCalculatorSchemas(TOOL_MODULE_FILES);

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

  it('does not turn a non-verdict declaration into a verdict', () => {
    const source = ALL_CALCULATOR_SCHEMAS.find(
      (schema) => schema.id === 'body-surface-area-mosteller',
    );
    if (!source) throw new Error('missing test schema');
    const result = evaluateCalculatorSchema(
      {
        ...source,
        evaluation: {
          status: 'missing-context',
          rules: [
            {
              when: '1',
              verdict: {
                rangeId: 'test',
                title: 'Не должно применяться',
                explanation: 'Проверочный вердикт.',
                attentionLevel: 'none',
                lowerInclusive: true,
                upperInclusive: true,
                sourceIds: [],
              },
            },
          ],
          missingContext: ['Контекст теста'],
          sourceIds: [],
        },
      },
      buildFilledInputs(source, 'baseline'),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.evaluation.status).toBe('missing-context');
  });
});
