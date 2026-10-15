import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type ToolDefinitionRecord, ToolDefinitionRecordSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import { evaluateCalculatorExpression } from '@/features/calculators/calculator-expression';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

// TOOLS-A: every result of these five modules is either interpretable (bands + a verdict rule with a
// cited source) or declares why it is not (not-applicable / missing-context). None is "unavailable".
const FILES = [
  'content/tool-modules/core-clinical.json',
  'content/tool-modules/emergency.json',
  'content/tool-modules/intensive-care.json',
  'content/tool-modules/medication-dosing.json',
  'content/tool-modules/metabolic-lab.json',
] as const;

function recordsOf(file: string): readonly ToolDefinitionRecord[] {
  const source = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as {
    tools: readonly unknown[];
  };
  return source.tools.map((tool) => ToolDefinitionRecordSchema.parse(tool));
}

const SCHEMAS = loadToolModuleCalculatorSchemas(FILES);

function schemaOf(name: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id.endsWith(name));
  if (!schema) throw new Error(`Missing calculator ${name}`);
  return schema;
}

type Inputs = Record<string, number | string>;

function verdictOf(name: string, inputs: Inputs): string | undefined {
  const result = evaluateCalculatorSchema(schemaOf(name), inputs);
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  return result.evaluation.verdict?.rangeId;
}

function interpretationOf(name: string, inputs: Inputs): string | undefined {
  const result = evaluateCalculatorSchema(schemaOf(name), inputs);
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  return result.warnings.find((warning) => warning.code === 'interpretation')?.message;
}

describe('result interpretation of core-clinical, emergency, intensive-care, dosing and lab tools', () => {
  it('leaves no tool with an unavailable evaluation', () => {
    for (const file of FILES) {
      for (const record of recordsOf(file)) {
        const evaluation = (record.definition as { evaluation: { status: string } }).evaluation;
        expect(evaluation.status, record.id).not.toBe('unavailable');
      }
    }
  });

  it('gives every verdict a cited source that the tool lists, and every non-verdict a reason', () => {
    for (const file of FILES) {
      for (const record of recordsOf(file)) {
        const evaluation = (
          record.definition as {
            evaluation: {
              status: string;
              reason?: string;
              missingContext: string[];
              rules: { verdict: { sourceIds: string[] } }[];
            };
          }
        ).evaluation;
        const known = new Set(record.sources.map((source) => source.id));
        if (evaluation.status === 'verdict') {
          for (const rule of evaluation.rules) {
            expect(rule.verdict.sourceIds.length, record.id).toBeGreaterThan(0);
            for (const id of rule.verdict.sourceIds)
              expect(known.has(id), `${record.id}: ${id}`).toBe(true);
          }
        } else if (evaluation.status === 'missing-context') {
          expect(evaluation.missingContext.length, record.id).toBeGreaterThan(0);
        } else {
          expect(evaluation.reason, record.id).toBeTruthy();
        }
      }
    }
  });

  it('never leaves a pipeline phrase in a declared reason', () => {
    for (const file of FILES) {
      for (const record of recordsOf(file)) {
        const text = JSON.stringify((record.definition as { evaluation: unknown }).evaluation);
        expect(text, record.id).not.toMatch(/декларативн|ещё не объявлен|не заявлен/iu);
      }
    }
  });

  it('declares quantities without published bands as not applicable', () => {
    const quantities = [
      'cockcroft-gault',
      'anion-gap',
      'parkland-burn-resuscitation',
      'body-surface-area-mosteller',
      'pediatric-maintenance-fluids',
      'saps-ii',
      'mpm-ii-admission',
      'mpm-ii-24-48-72',
      'basal-metabolic-rate',
      'albumin-corrected-calcium',
      'atherogenic-coefficient',
      'paracetamol-dose',
    ];
    for (const name of quantities) {
      expect(schemaOf(name).evaluation.status, name).toBe('not-applicable');
    }
    for (const name of ['qtc-correction', 'free-bioavailable-testosterone']) {
      expect(schemaOf(name).evaluation.status, name).toBe('missing-context');
    }
  });

  describe('KDIGO G categories of the new eGFR tools', () => {
    const adult = (creatinine: number): Inputs => ({
      ageYears: 40,
      sex: 'male',
      creatinine,
      creatinineUnit: 'mg/dl',
    });

    it('classes CKD-EPI 2021 by the KDIGO thresholds', () => {
      expect(verdictOf('adult-egfr-ckd-epi-2021', adult(0.9))).toBe('g1');
      expect(verdictOf('adult-egfr-ckd-epi-2021', adult(1.4))).toBe('g2');
      expect(verdictOf('adult-egfr-ckd-epi-2021', adult(1.8))).toBe('g3a');
      expect(verdictOf('adult-egfr-ckd-epi-2021', adult(2.4))).toBe('g3b');
      expect(verdictOf('adult-egfr-ckd-epi-2021', adult(3.8))).toBe('g4');
      expect(verdictOf('adult-egfr-ckd-epi-2021', adult(8))).toBe('g5');
    });

    it('classes the bedside CKiD result and withholds categories under two years', () => {
      const child = (ageYears: number, creatinine: number): Inputs => ({
        ageYears,
        heightCm: 120,
        creatinine,
        creatinineUnit: 'mg/dl',
      });
      // 0.413 * 120 / 0.55 = 90.1
      expect(verdictOf('pediatric-egfr-schwartz-2009', child(7, 0.55))).toBe('g1');
      expect(verdictOf('pediatric-egfr-schwartz-2009', child(7, 0.95))).toBe('g3a');
      expect(verdictOf('pediatric-egfr-schwartz-2009', child(7, 2.5))).toBe('g4');
      expect(verdictOf('pediatric-egfr-schwartz-2009', child(1, 0.4))).toBe('under-two');
    });
  });

  it('reads the fractional excretion indices at their published thresholds', () => {
    const fena = (urineSodium: number): Inputs => ({
      urineSodium,
      plasmaSodium: 140,
      urineCreatinine: 100,
      plasmaCreatinine: 1,
    });
    // FENa = UNa * PCr / (PNa * UCr) * 100 = UNa / 140 (%)
    expect(verdictOf('fractional-excretion-sodium', fena(70))).toBe('fena-prerenal'); // 0.5
    expect(verdictOf('fractional-excretion-sodium', fena(150))).toBe('fena-intermediate'); // 1.07
    expect(verdictOf('fractional-excretion-sodium', fena(400))).toBe('fena-intermediate'); // 2.86
    expect(verdictOf('fractional-excretion-sodium', fena(448))).toBe('fena-atn'); // 3.2
    const feurea = (urineUrea: number): Inputs => ({
      urineUrea,
      plasmaUrea: 100,
      urineCreatinine: 100,
      plasmaCreatinine: 1,
    });
    // FeUrea = UUrea / 100 (%)
    expect(verdictOf('fractional-excretion-urea', feurea(3400))).toBe('feurea-prerenal');
    expect(verdictOf('fractional-excretion-urea', feurea(3600))).toBe('feurea-higher');
  });

  it('stages oliguria by the KDIGO urine-output criterion, using the observation time', () => {
    const output = (urineVolumeMl: number, hours: number): Inputs => ({
      urineVolumeMl,
      weightKg: 10,
      hours,
    });
    expect(verdictOf('pediatric-urine-output', output(60, 12))).toBe('kdigo-none');
    // rate = volume / (10 kg * hours)
    expect(verdictOf('pediatric-urine-output', output(15, 4))).toBe('kdigo-short'); // 0.375
    expect(verdictOf('pediatric-urine-output', output(30, 8))).toBe('kdigo-stage1'); // 0.375
    expect(verdictOf('pediatric-urine-output', output(50, 12))).toBe('kdigo-stage2'); // 0.42
    expect(verdictOf('pediatric-urine-output', output(100, 24))).toBe('kdigo-stage2'); // 0.42
    expect(verdictOf('pediatric-urine-output', output(60, 24))).toBe('kdigo-stage3'); // 0.25
    expect(verdictOf('pediatric-urine-output', output(0, 12))).toBe('kdigo-stage3-anuria');
  });

  it('flags hyponatraemia after the glucose correction and the HHS osmolality criterion', () => {
    const sodium = (value: number, glucose: number): Inputs => ({
      sodium: value,
      glucose,
      glucoseUnit: 'mg/dl',
    });
    // 128 + 0.024 * (600 - 100) = 140
    expect(verdictOf('corrected-sodium-hyperglycemia', sodium(128, 600))).toBe('corrected-normal');
    expect(verdictOf('corrected-sodium-hyperglycemia', sodium(120, 200))).toBe(
      'corrected-hyponatraemia',
    );
    expect(verdictOf('effective-osmolality', { sodium: 150, glucose: 900, bun: 20 })).toBe(
      'osm-hhs',
    );
    expect(verdictOf('effective-osmolality', { sodium: 138, glucose: 180, bun: 20 })).toBe(
      'osm-below',
    );
  });

  it('compares a measured PaCO2 with the Winter range only when it is entered', () => {
    // bicarbonate 12: expected 1.5 * 12 + 8 = 26 (24-28)
    expect(verdictOf('winter-formula', { bicarbonate: 12, measuredPco2: 20 })).toBe('winter-below');
    expect(verdictOf('winter-formula', { bicarbonate: 12, measuredPco2: 26 })).toBe(
      'winter-within',
    );
    expect(verdictOf('winter-formula', { bicarbonate: 12, measuredPco2: 33 })).toBe('winter-above');
    const without = evaluateCalculatorSchema(schemaOf('winter-formula'), { bicarbonate: 12 });
    expect(without.ok).toBe(true);
    expect(interpretationOf('winter-formula', { bicarbonate: 12 })).toBeUndefined();
  });

  it('applies the FIB-4, APRI and ANC cut-offs of their sources', () => {
    const fib = (ast: number): Inputs => ({ ageYears: 50, ast, alt: 100, platelets: 100 });
    // age * AST / (platelets * sqrt(ALT)) = 50 * AST / 1000
    expect(verdictOf('fib-4', fib(28))).toBe('fib4-low'); // 1.40
    expect(verdictOf('fib-4', fib(30))).toBe('fib4-intermediate'); // 1.50
    expect(verdictOf('fib-4', fib(66))).toBe('fib4-high'); // 3.30
    const apri = (ast: number): Inputs => ({ ast, astUpperLimit: 40, platelets: 100 });
    // APRI = AST / 40 * 100 / 100 = AST / 40
    expect(verdictOf('apri', apri(18))).toBe('apri-low'); // 0.45
    expect(verdictOf('apri', apri(40))).toBe('apri-intermediate'); // 1.0
    expect(verdictOf('apri', apri(70))).toBe('apri-significant'); // 1.75
    expect(verdictOf('apri', apri(100))).toBe('apri-high'); // 2.5
    const anc = (neutrophilsPercent: number): Inputs => ({
      whiteBloodCells: 10,
      neutrophilsPercent,
      bandsPercent: 0,
    });
    expect(verdictOf('absolute-neutrophil-count', anc(60))).toBe('anc-normal'); // 6.0
    expect(verdictOf('absolute-neutrophil-count', anc(12))).toBe('anc-grade2'); // 1.2
    expect(verdictOf('absolute-neutrophil-count', anc(7))).toBe('anc-grade3'); // 0.7
    expect(verdictOf('absolute-neutrophil-count', anc(3))).toBe('anc-grade4'); // 0.3
  });

  it('reads CHA2DS2-VASc with the sex-specific ESC thresholds and HAS-BLED at 3', () => {
    const base = {
      ageYears: 50,
      heartFailure: 0,
      hypertension: 0,
      diabetes: 0,
      strokeTia: 0,
      vascularDisease: 0,
      femaleSex: 0,
    };
    expect(verdictOf('cha2ds2-vasc', base)).toBe('cha2ds2-low');
    expect(verdictOf('cha2ds2-vasc', { ...base, femaleSex: 1 })).toBe('cha2ds2-low');
    expect(verdictOf('cha2ds2-vasc', { ...base, hypertension: 1 })).toBe('cha2ds2-consider');
    expect(verdictOf('cha2ds2-vasc', { ...base, hypertension: 1, femaleSex: 1 })).toBe(
      'cha2ds2-consider',
    );
    expect(verdictOf('cha2ds2-vasc', { ...base, hypertension: 1, diabetes: 1 })).toBe(
      'cha2ds2-anticoagulant',
    );
    expect(verdictOf('cha2ds2-vasc', { ...base, hypertension: 1, diabetes: 1, femaleSex: 1 })).toBe(
      'cha2ds2-anticoagulant',
    );
    const bled = {
      hypertension: 0,
      abnormalRenal: 0,
      abnormalLiver: 0,
      stroke: 0,
      bleeding: 0,
      labileInr: 0,
      ageOver65: 0,
      drugsAlcohol: 0,
    };
    expect(verdictOf('has-bled', { ...bled, hypertension: 1, stroke: 1 })).toBe(
      'has-bled-not-high',
    );
    expect(verdictOf('has-bled', { ...bled, hypertension: 1, stroke: 1, labileInr: 1 })).toBe(
      'has-bled-high',
    );
  });

  describe('assessments of the emergency module', () => {
    const records = recordsOf('content/tool-modules/emergency.json').filter(
      (record) => record.kind === 'assessment',
    );

    it('replays every score through the verdict rules and the interpretation bands', () => {
      for (const record of records) {
        const definition = record.definition as unknown as AssessmentDefinition;
        const rules = definition.evaluation?.rules ?? [];
        expect(rules.length, record.id).toBe(definition.interpretations?.length);
        const scale = definition.scales[0];
        if (!scale) throw new Error(`${record.id}: no scale`);
        const stable = scale.id.replaceAll('-', '_');
        for (const band of definition.interpretations ?? []) {
          if (band.minScore === undefined || band.maxScore === undefined) continue;
          for (let score = band.minScore; score <= band.maxScore; score += 1) {
            const matched = rules.find(
              (rule) =>
                evaluateCalculatorExpression(rule.when, { [`score_${stable}`]: score }) === 1,
            );
            expect(matched?.verdict.title, `${record.id} ${score}`).toBe(band.headline);
          }
        }
      }
    });

    it('reports the verdict of a scored Glasgow Coma Scale', () => {
      const record = records.find((candidate) => candidate.id.endsWith('glasgow-coma-scale'));
      if (!record) throw new Error('missing GCS');
      const definition = record.definition as unknown as AssessmentDefinition;
      const severe = scoreAssessment(definition, {
        'gcs-eye-opening': 1,
        'gcs-verbal-response': 1,
        'gcs-motor-response': 1,
      });
      expect(severe.ok && severe.value.evaluation?.verdict?.rangeId).toBe('gcs-severe');
      const mild = scoreAssessment(definition, {
        'gcs-eye-opening': 4,
        'gcs-verbal-response': 5,
        'gcs-motor-response': 6,
      });
      expect(mild.ok && mild.value.evaluation?.verdict?.rangeId).toBe('gcs-mild');
    });
  });
});
