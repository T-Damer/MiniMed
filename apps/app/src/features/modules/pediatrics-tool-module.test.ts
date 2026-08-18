import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AssessmentDefinitionSchema,
  CalculatorSchemaSchema,
  ToolDefinitionRecordSchema,
} from '@localmed/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDownloadedAssessments,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';

const MODULE_PATH = resolve(process.cwd(), 'content/tool-modules/pediatrics.json');

function loadPediatricsTools(): readonly unknown[] {
  const source = JSON.parse(readFileSync(MODULE_PATH, 'utf8')) as { tools: readonly unknown[] };
  return source.tools;
}

function uniformAssessmentAnswers(
  definition: AssessmentDefinition,
  value: AssessmentResponseValue,
): AssessmentAnswers {
  return Object.fromEntries(
    definition.questions.map((question) => [question.id, value]),
  ) as AssessmentAnswers;
}

function numberOutputValue(
  outputs: readonly { readonly kind: string; readonly label: string; readonly value?: number }[],
  label: string,
): number {
  const output = outputs.find((entry) => entry.kind === 'number' && entry.label === label);
  if (!output || output.value === undefined) {
    throw new Error(`Missing numeric output: ${label}`);
  }
  return output.value;
}

describe('pediatrics tool module', () => {
  afterEach(() => {
    clearDownloadedAssessments();
  });

  it('validates every tool record in the pediatrics package', () => {
    for (const rawTool of loadPediatricsTools()) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.id.startsWith('minimed.')).toBe(true);
    }
  });

  it('validates and scores FLACC with boundary sums', () => {
    const rawTool = loadPediatricsTools().find(
      (tool) => (tool as { id?: string }).id === 'minimed.assessment.flacc-pain-scale',
    );
    expect(rawTool).toBeDefined();
    const record = ToolDefinitionRecordSchema.parse(rawTool);
    expect(record.kind).toBe('assessment');

    const definition = AssessmentDefinitionSchema.parse(record.definition) as AssessmentDefinition;
    registerDownloadedAssessment(record);

    const allZeros = scoreAssessment(definition, uniformAssessmentAnswers(definition, 0));
    expect(allZeros.ok).toBe(true);
    if (allZeros.ok) {
      expect(allZeros.value.scores.find((score) => score.scaleId === 'flacc-total')?.rawScore).toBe(
        0,
      );
    }

    const allTwos = scoreAssessment(definition, uniformAssessmentAnswers(definition, 2));
    expect(allTwos.ok).toBe(true);
    if (allTwos.ok) {
      expect(allTwos.value.scores.find((score) => score.scaleId === 'flacc-total')?.rawScore).toBe(
        10,
      );
    }
  });

  it('validates and evaluates preterm corrected age', () => {
    const rawTool = loadPediatricsTools().find(
      (tool) => (tool as { id?: string }).id === 'minimed.calculator.preterm-corrected-age',
    );
    expect(rawTool).toBeDefined();
    const record = ToolDefinitionRecordSchema.parse(rawTool);
    expect(record.kind).toBe('calculator');

    const schema = CalculatorSchemaSchema.parse(record.definition);
    const result = evaluateCalculatorSchema(schema, {
      gestationalAgeWeeks: 32,
      chronologicalAgeWeeks: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(numberOutputValue(result.outputs, 'Корригированный возраст')).toBe(12);

    const termAssertion = evaluateCalculatorSchema(schema, {
      gestationalAgeWeeks: 38,
      chronologicalAgeWeeks: 20,
    });
    expect(termAssertion.ok).toBe(false);
    if (!termAssertion.ok) {
      expect(termAssertion.error).toContain('коррекция возраста');
    }
  });
});
