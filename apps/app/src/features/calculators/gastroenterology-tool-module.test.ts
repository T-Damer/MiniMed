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
  getCalculatorRegistry,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';
import type { CalculatorSchemaNumberOutput } from '@/features/calculators/calculator-schema-engine';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';

function loadGastroModule(): { tools: readonly unknown[] } {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'content/tool-modules/gastroenterology.json'), 'utf8'),
  ) as { tools: readonly unknown[] };
}

function expectNumberOutput(
  output: { kind: string } | undefined,
): asserts output is CalculatorSchemaNumberOutput {
  if (output?.kind !== 'number') throw new Error('expected a numeric schema output');
}

describe('gastroenterology tool module', () => {
  afterEach(() => {
    clearDownloadedCalculators();
    clearDownloadedAssessments();
  });

  it('validates and registers every calculator in the gastro package', () => {
    const source = loadGastroModule();

    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      if (record.kind === 'calculator') {
        CalculatorSchemaSchema.parse(record.definition);
        registerDownloadedCalculator(record);
      } else {
        registerDownloadedAssessment(record);
      }
    }

    const downloaded = getCalculatorRegistry().filter((calculator) =>
      calculator.id.startsWith('minimed.calculator.'),
    );
    expect(downloaded).toHaveLength(3);
    expect(downloaded.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining([
        'minimed.calculator.pediatric-ors-ongoing-losses',
        'minimed.calculator.bristol-stool-form-scale',
        'minimed.calculator.harvey-bradshaw-index',
      ]),
    );
  });

  describe('PUCAI interpretations', () => {
    it('uses schema-driven remission band below 10', () => {
      const pucai = ToolDefinitionRecordSchema.parse(
        loadGastroModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.assessment.pucai',
        ),
      );
      registerDownloadedAssessment(pucai);
      const definition = pucai.definition as unknown as AssessmentDefinition;

      const result = scoreAssessment(definition, {
        'pucai-abdominal-pain': 0,
        'pucai-rectal-bleeding': 0,
        'pucai-stool-consistency': 0,
        'pucai-stool-frequency': 0,
        'pucai-nocturnal-stools': 0,
        'pucai-activity': 0,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.scores[0]?.rawScore).toBe(0);
      expect(result.value.headline).toContain('ремиссия');
    });
  });

  describe('Harvey–Bradshaw Index', () => {
    it('matches a worked example from the original scoring system', () => {
      const hbi = ToolDefinitionRecordSchema.parse(
        loadGastroModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.calculator.harvey-bradshaw-index',
        ),
      );
      const schema = CalculatorSchemaSchema.parse(hbi.definition);

      const result = evaluateCalculatorSchema(schema, {
        generalWellbeing: 2,
        abdominalPain: 1,
        liquidStoolsPerDay: 3,
        abdominalMass: 1,
        arthralgia: 1,
        uveitis: 0,
        erythemaNodosum: 0,
        aphthousUlcers: 0,
        pyodermaGangrenosum: 0,
        analFissure: 0,
        newFistula: 0,
        abscess: 0,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expectNumberOutput(result.outputs[0]);
      expect(result.outputs[0].value).toBe(8);
    });
  });

  describe('Vesikari score', () => {
    it('scores 0 when all components are minimal', () => {
      const vesikari = ToolDefinitionRecordSchema.parse(
        loadGastroModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.assessment.vesikari-gastroenteritis',
        ),
      );
      registerDownloadedAssessment(vesikari);
      const definition = vesikari.definition as unknown as AssessmentDefinition;

      const result = scoreAssessment(definition, {
        'vesikari-diarrhea-duration': 0,
        'vesikari-stool-frequency': 0,
        'vesikari-vomiting-frequency': 0,
        'vesikari-fever': 0,
        'vesikari-dehydration': 0,
        'vesikari-treatment': 0,
        'vesikari-vomiting-duration': 0,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.scores[0]?.rawScore).toBe(0);
    });

    it('scores 20 for a maximal severe case on the 20-point Ruuska–Vesikari scale', () => {
      const vesikari = ToolDefinitionRecordSchema.parse(
        loadGastroModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.assessment.vesikari-gastroenteritis',
        ),
      );
      registerDownloadedAssessment(vesikari);
      const definition = vesikari.definition as unknown as AssessmentDefinition;

      const result = scoreAssessment(definition, {
        'vesikari-diarrhea-duration': 3,
        'vesikari-stool-frequency': 3,
        'vesikari-vomiting-duration': 3,
        'vesikari-vomiting-frequency': 3,
        'vesikari-fever': 3,
        'vesikari-dehydration': 3,
        'vesikari-treatment': 2,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.scores[0]?.rawScore).toBe(20);
      expect(result.value.headline).toContain('Тяжёлый');
    });
  });

  describe('Partial Mayo score', () => {
    it('scores 0 and 9 at the extremes', () => {
      const partialMayo = ToolDefinitionRecordSchema.parse(
        loadGastroModule().tools.find(
          (tool) => (tool as { id?: string }).id === 'minimed.assessment.partial-mayo-score',
        ),
      );
      registerDownloadedAssessment(partialMayo);
      const definition = partialMayo.definition as unknown as AssessmentDefinition;

      const minimum = scoreAssessment(definition, {
        'partial-mayo-stool-frequency': 0,
        'partial-mayo-rectal-bleeding': 0,
        'partial-mayo-physician-global': 0,
      });
      expect(minimum.ok).toBe(true);
      if (!minimum.ok) throw new Error('unreachable');
      expect(minimum.value.scores[0]?.rawScore).toBe(0);

      const maximum = scoreAssessment(definition, {
        'partial-mayo-stool-frequency': 3,
        'partial-mayo-rectal-bleeding': 3,
        'partial-mayo-physician-global': 3,
      });
      expect(maximum.ok).toBe(true);
      if (!maximum.ok) throw new Error('unreachable');
      expect(maximum.value.scores[0]?.rawScore).toBe(9);
    });
  });
});
