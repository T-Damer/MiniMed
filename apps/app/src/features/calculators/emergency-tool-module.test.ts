import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CalculatorSchemaSchema, ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDownloadedAssessments,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import {
  clearDownloadedCalculators,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';
import type { CalculatorSchemaNumberOutput } from '@/features/calculators/calculator-schema-engine';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';

function loadEmergencyModule(): { tools: readonly unknown[] } {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'content/tool-modules/emergency.json'), 'utf8'),
  ) as { tools: readonly unknown[] };
}

function expectNumberOutput(
  output: { kind: string } | undefined,
): asserts output is CalculatorSchemaNumberOutput {
  if (output?.kind !== 'number') throw new Error('expected a numeric schema output');
}

describe('emergency tool module', () => {
  afterEach(() => {
    clearDownloadedCalculators();
    clearDownloadedAssessments();
  });

  it('validates every tool in the emergency package', () => {
    const source = loadEmergencyModule();
    expect(source.tools).toHaveLength(3);

    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      if (record.kind === 'calculator') {
        const schema = CalculatorSchemaSchema.parse(record.definition);
        expect(schema.id).toBe(record.id);
        registerDownloadedCalculator(record);
      } else {
        registerDownloadedAssessment(record);
      }
    }
  });

  describe('Glasgow Coma Scale', () => {
    it('scores minimum 3 and maximum 15', () => {
      const gcs = ToolDefinitionRecordSchema.parse(
        loadEmergencyModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.assessment.glasgow-coma-scale',
        ),
      );
      registerDownloadedAssessment(gcs);
      const definition = gcs.definition as unknown as AssessmentDefinition;

      const minimum = scoreAssessment(definition, {
        'gcs-eye-opening': 1,
        'gcs-verbal-response': 1,
        'gcs-motor-response': 1,
      });
      expect(minimum.ok).toBe(true);
      if (!minimum.ok) throw new Error('unreachable');
      expect(minimum.value.scores[0]?.rawScore).toBe(3);

      const maximum = scoreAssessment(definition, {
        'gcs-eye-opening': 4,
        'gcs-verbal-response': 5,
        'gcs-motor-response': 6,
      });
      expect(maximum.ok).toBe(true);
      if (!maximum.ok) throw new Error('unreachable');
      expect(maximum.value.scores[0]?.rawScore).toBe(15);
    });
  });

  describe('Alvarado score', () => {
    it('scores 0 when all absent and 10 for full MANTRELS positive', () => {
      const alvarado = ToolDefinitionRecordSchema.parse(
        loadEmergencyModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.assessment.alvarado-appendicitis',
        ),
      );
      registerDownloadedAssessment(alvarado);
      const definition = alvarado.definition as unknown as AssessmentDefinition;

      const absent = scoreAssessment(definition, {
        'alvarado-migration': 0,
        'alvarado-anorexia': 0,
        'alvarado-nausea': 0,
        'alvarado-rlq-tenderness': 0,
        'alvarado-rebound': 0,
        'alvarado-fever': 0,
        'alvarado-leukocytosis': 0,
        'alvarado-shift': 0,
      });
      expect(absent.ok).toBe(true);
      if (!absent.ok) throw new Error('unreachable');
      expect(absent.value.scores[0]?.rawScore).toBe(0);

      const full = scoreAssessment(definition, {
        'alvarado-migration': 1,
        'alvarado-anorexia': 1,
        'alvarado-nausea': 1,
        'alvarado-rlq-tenderness': 2,
        'alvarado-rebound': 1,
        'alvarado-fever': 1,
        'alvarado-leukocytosis': 2,
        'alvarado-shift': 1,
      });
      expect(full.ok).toBe(true);
      if (!full.ok) throw new Error('unreachable');
      expect(full.value.scores[0]?.rawScore).toBe(10);
    });
  });

  describe('Shock index', () => {
    it('computes SI = HR / SBP', () => {
      const shock = ToolDefinitionRecordSchema.parse(
        loadEmergencyModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.calculator.shock-index',
        ),
      );
      const schema = CalculatorSchemaSchema.parse(shock.definition);

      const result = evaluateCalculatorSchema(schema, {
        heartRateBpm: 90,
        systolicBpMmHg: 90,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expectNumberOutput(result.outputs[0]);
      expect(result.outputs[0].value).toBeCloseTo(1.0, 2);
    });
  });
});
