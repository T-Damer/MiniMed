import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDownloadedCalculators,
  getCalculatorRegistry,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/metabolic-lab.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);
const ID = 'minimed.calculator.';
const EXPECTED_IDS = [
  'kdigo-aki-staging',
  'kdigo-ckd-risk',
  'akin-aki-staging',
  'rifle-aki-criteria',
  'egfr-mdrd-idms',
  'egfr-schwartz-lyon',
  'urea-creatinine-ratio',
  'calcium-creatinine-clearance-ratio',
  'adrenal-ct-washout',
  'burch-wartofsky',
  'findrisc',
  'homa-ir',
  'matsuda-isi',
  'quicki',
  'ogtt-interpretation',
  'basal-metabolic-rate',
  'body-roundness-index',
  'free-bioavailable-testosterone',
  'pulmonary-nodule-vdt',
  'albumin-corrected-calcium',
  'ldl-friedewald',
  'atherogenic-coefficient',
  'de-ritis-ratio',
  'ani-index',
  'reticulocyte-production-index',
  'lab-unit-conversion',
  'hba1c-conversion',
  'transferrin-saturation',
] as const;

type Inputs = Record<string, number | string>;

interface Run {
  /** Every numeric and text output by step id. */
  readonly values: ReadonlyMap<string, number | string>;
  readonly range: string | undefined;
  readonly explanation: string | undefined;
  readonly interpretation: string | undefined;
}

function run(name: string, inputs: Inputs): Run {
  const id = `${ID}${name}`;
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const values = new Map<string, number | string>();
  for (const output of result.outputs) {
    if (output.kind === 'number') values.set(output.id, output.value);
    if (output.kind === 'text') values.set(output.id, output.text);
  }
  return {
    values,
    range: result.evaluation.verdict?.rangeId,
    explanation: result.evaluation.verdict?.explanation,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

function failure(name: string, inputs: Inputs): string {
  const id = `${ID}${name}`;
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (result.ok) throw new Error(`${id}: expected a refusal`);
  return result.error;
}

interface Case {
  readonly name: string;
  readonly inputs: Inputs;
  /** Expected numeric outputs by step id (digits: decimal places of agreement). */
  readonly expect: Readonly<Record<string, number | string>>;
  readonly range?: string;
  /** Text the band wording must carry (published figure). */
  readonly includes?: string;
  readonly digits?: number;
}

function expectCases(name: string, cases: readonly Case[]): void {
  for (const testCase of cases) {
    const result = run(name, testCase.inputs);
    const label = `${name} / ${testCase.name}`;
    for (const [key, expected] of Object.entries(testCase.expect)) {
      const actual = result.values.get(key);
      if (typeof expected === 'number') {
        expect(actual, `${label}: ${key}`).toBeTypeOf('number');
        expect(actual as number, `${label}: ${key}`).toBeCloseTo(expected, testCase.digits ?? 6);
      } else {
        expect(actual, `${label}: ${key}`).toBe(expected);
      }
    }
    if (testCase.range !== undefined) {
      expect(result.range, `${label}: band`).toBe(testCase.range);
      expect(result.interpretation, `${label}: interpretation`).toBe(result.explanation);
    }
    if (testCase.includes) {
      expect(result.interpretation, `${label}: published figure`).toContain(testCase.includes);
    }
  }
}

describe('metabolic and laboratory tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly unknown[];
    };
    expect(source.tools).toHaveLength(EXPECTED_IDS.length);
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length).toBeGreaterThan(0);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed|MedSolutions/iu);
        if (link.url) expect(link.url).toMatch(/^https:\/\//u);
      }
      registerDownloadedCalculator(record);
    }
    const registered = getCalculatorRegistry().filter(
      (calculator) => getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining(EXPECTED_IDS.map((name) => `${ID}${name}`)),
    );
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const schema of SCHEMAS) {
      if (schema.evaluation.status !== 'verdict') {
        expect(schema.interpretations, schema.id).toEqual([]);
        continue;
      }
      expect(schema.evaluation.rules.map((rule) => rule.when)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.when),
      );
      expect(schema.evaluation.rules.map((rule) => rule.verdict.explanation)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.message),
      );
    }
  });

  it('keeps ids and slugs unique inside the module', () => {
    expect(new Set(SCHEMAS.map((schema) => schema.id)).size).toBe(SCHEMAS.length);
    expect(new Set(SCHEMAS.map((schema) => schema.slug)).size).toBe(SCHEMAS.length);
  });

  describe('KDIGO AKI staging (KDIGO 2012 Table 2)', () => {
    const base: Inputs = {
      creatinineUnit: 'mg/dl',
      baselineCreatinine: 1,
      currentCreatinine: 1,
      interval: '48h',
      urineOutput: 0,
      renalReplacement: 0,
      pediatricEgfr: 0,
    };
    it('stages by creatinine ratio, absolute rise and the 48 h / 7 day windows', () => {
      expectCases('kdigo-aki-staging', [
        { name: 'no change', inputs: base, expect: { stage: 0 }, range: 'no-aki' },
        {
          name: 'rise 0.3 in 48 h',
          inputs: { ...base, currentCreatinine: 1.3 },
          expect: { stage: 1 },
          range: 'stage-1',
        },
        {
          name: 'rise 0.3 floating point (1.1 to 1.4)',
          inputs: { ...base, baselineCreatinine: 1.1, currentCreatinine: 1.4 },
          expect: { stage: 1 },
          range: 'stage-1',
        },
        {
          name: 'rise 0.3 over 7 days does not count',
          inputs: { ...base, currentCreatinine: 1.3, interval: '7d' },
          expect: { stage: 0 },
          range: 'no-aki',
        },
        {
          name: 'ratio exactly 1.5 over 7 days',
          inputs: { ...base, currentCreatinine: 1.5, interval: '7d' },
          expect: { stage: 1 },
          range: 'stage-1',
        },
        {
          name: 'ratio 1.49 over 7 days',
          inputs: { ...base, currentCreatinine: 1.49, interval: '7d' },
          expect: { stage: 0 },
        },
        { name: 'ratio 1.9', inputs: { ...base, currentCreatinine: 1.9 }, expect: { stage: 1 } },
        {
          name: 'ratio exactly 2.0',
          inputs: { ...base, currentCreatinine: 2 },
          expect: { stage: 2 },
          range: 'stage-2',
        },
        { name: 'ratio 2.9', inputs: { ...base, currentCreatinine: 2.9 }, expect: { stage: 2 } },
        {
          name: 'ratio exactly 3.0',
          inputs: { ...base, currentCreatinine: 3 },
          expect: { stage: 3 },
          range: 'stage-3',
        },
        {
          name: '4.0 mg/dl after a rise of 0.5',
          inputs: { ...base, baselineCreatinine: 3.5, currentCreatinine: 4 },
          expect: { stage: 3 },
        },
        {
          name: '4.0 mg/dl without AKI is chronic, not stage 3',
          inputs: { ...base, baselineCreatinine: 3.9, currentCreatinine: 4 },
          expect: { stage: 0 },
        },
        {
          name: '4.0 mg/dl with oliguria meets the definition',
          inputs: { ...base, baselineCreatinine: 3.9, currentCreatinine: 4, urineOutput: 1 },
          expect: { stage: 3 },
        },
        { name: 'urine output stage 1', inputs: { ...base, urineOutput: 1 }, expect: { stage: 1 } },
        {
          name: 'urine output stage 2 beats creatinine stage 1',
          inputs: { ...base, currentCreatinine: 1.5, urineOutput: 2 },
          expect: { stage: 2 },
        },
        { name: 'anuria stage 3', inputs: { ...base, urineOutput: 3 }, expect: { stage: 3 } },
        {
          name: 'renal replacement',
          inputs: { ...base, renalReplacement: 1 },
          expect: { stage: 3 },
        },
        {
          name: 'child with eGFR below 35',
          inputs: { ...base, pediatricEgfr: 1 },
          expect: { stage: 3 },
        },
        {
          name: 'umol/l rise 26.5 in 48 h',
          inputs: {
            ...base,
            creatinineUnit: 'umol/l',
            baselineCreatinine: 88.4,
            currentCreatinine: 114.9,
          },
          expect: { stage: 1 },
        },
        {
          name: 'umol/l rise 26.4 is below the limit',
          inputs: {
            ...base,
            creatinineUnit: 'umol/l',
            baselineCreatinine: 88.4,
            currentCreatinine: 114.8,
          },
          expect: { stage: 0 },
        },
        {
          name: 'umol/l 353.6 after a rise',
          inputs: {
            ...base,
            creatinineUnit: 'umol/l',
            baselineCreatinine: 300,
            currentCreatinine: 353.6,
          },
          expect: { stage: 3 },
        },
        {
          name: 'umol/l 353.5 stays stage 1',
          inputs: {
            ...base,
            creatinineUnit: 'umol/l',
            baselineCreatinine: 300,
            currentCreatinine: 353.5,
          },
          expect: { stage: 1 },
        },
      ]);
    });
  });

  describe('KDIGO CKD classification (G1-G5, A1-A3, risk heat map)', () => {
    it('cuts GFR at 90, 60, 45, 30 and 15', () => {
      const cases: readonly [number, string][] = [
        [90, 'G1'],
        [89.9, 'G2'],
        [60, 'G2'],
        [59.9, 'G3a'],
        [45, 'G3a'],
        [44.9, 'G3b'],
        [30, 'G3b'],
        [29.9, 'G4'],
        [15, 'G4'],
        [14.9, 'G5'],
      ];
      for (const [egfr, label] of cases) {
        expect(
          run('kdigo-ckd-risk', { egfr, acr: 1, acrUnit: 'mg/g' }).values.get('gLabel'),
          String(egfr),
        ).toBe(label);
      }
    });
    it('cuts albuminuria at 30 / 300 mg/g and 3 / 30 mg/mmol', () => {
      const cases: readonly [number, string, string][] = [
        [29.9, 'mg/g', 'A1'],
        [30, 'mg/g', 'A2'],
        [300, 'mg/g', 'A2'],
        [300.1, 'mg/g', 'A3'],
        [2.9, 'mg/mmol', 'A1'],
        [3, 'mg/mmol', 'A2'],
        [30, 'mg/mmol', 'A2'],
        [30.1, 'mg/mmol', 'A3'],
      ];
      for (const [acr, acrUnit, label] of cases) {
        expect(
          run('kdigo-ckd-risk', { egfr: 95, acr, acrUnit }).values.get('aLabel'),
          `${acr} ${acrUnit}`,
        ).toBe(label);
      }
    });
    it('reproduces the 18 cells of the prognosis heat map', () => {
      const risk = ['low', 'moderate', 'high', 'very-high'];
      const rows: readonly [number, readonly number[]][] = [
        [95, [0, 1, 2]],
        [75, [0, 1, 2]],
        [52, [1, 2, 3]],
        [38, [2, 3, 3]],
        [20, [3, 3, 3]],
        [10, [3, 3, 3]],
      ];
      for (const [egfr, cells] of rows) {
        cells.forEach((level, index) => {
          const acr = [10, 100, 500][index] as number;
          expect(
            run('kdigo-ckd-risk', { egfr, acr, acrUnit: 'mg/g' }).range,
            `${egfr}/${acr}`,
          ).toBe(risk[level]);
        });
      }
    });
  });

  describe('AKIN (Mehta 2007: 1.5-2x / >2-3x / >3x, 48 h window)', () => {
    const base: Inputs = {
      creatinineUnit: 'mg/dl',
      baselineCreatinine: 1,
      currentCreatinine: 1,
      urineOutput: 0,
      renalReplacement: 0,
      interval: '48h',
    };
    it('keeps exactly 2x in stage 1 and exactly 3x in stage 2', () => {
      expectCases('akin-aki-staging', [
        { name: 'no change', inputs: base, expect: { stage: 0 }, range: 'no-aki' },
        {
          name: 'rise 0.3',
          inputs: { ...base, currentCreatinine: 1.3 },
          expect: { stage: 1 },
          range: 'stage-1',
        },
        {
          name: 'ratio 2.0 is still stage 1',
          inputs: { ...base, currentCreatinine: 2 },
          expect: { stage: 1 },
        },
        {
          name: 'ratio 2.01',
          inputs: { ...base, currentCreatinine: 2.01 },
          expect: { stage: 2 },
          range: 'stage-2',
        },
        {
          name: 'ratio 3.0 is still stage 2',
          inputs: { ...base, currentCreatinine: 3 },
          expect: { stage: 2 },
        },
        {
          name: 'ratio 3.01',
          inputs: { ...base, currentCreatinine: 3.01 },
          expect: { stage: 3 },
          range: 'stage-3',
        },
        {
          name: '4.0 with an acute rise of 0.5',
          inputs: { ...base, baselineCreatinine: 3.5, currentCreatinine: 4 },
          expect: { stage: 3 },
        },
        {
          name: '4.0 with a rise of only 0.4',
          inputs: { ...base, baselineCreatinine: 3.6, currentCreatinine: 4 },
          expect: { stage: 1 },
        },
        {
          name: 'slower than 48 h gives no creatinine stage',
          inputs: { ...base, currentCreatinine: 3.5, interval: 'longer' },
          expect: { stage: 0 },
        },
        { name: 'urine output stage 2', inputs: { ...base, urineOutput: 2 }, expect: { stage: 2 } },
        {
          name: 'renal replacement is stage 3 whatever the interval',
          inputs: { ...base, interval: 'longer', renalReplacement: 1 },
          expect: { stage: 3 },
        },
        {
          name: 'umol/l rise 26.4',
          inputs: {
            ...base,
            creatinineUnit: 'umol/l',
            baselineCreatinine: 100,
            currentCreatinine: 126.4,
          },
          expect: { stage: 1 },
        },
        {
          name: 'umol/l rise 26.3',
          inputs: {
            ...base,
            creatinineUnit: 'umol/l',
            baselineCreatinine: 100,
            currentCreatinine: 126.3,
          },
          expect: { stage: 0 },
        },
      ]);
    });
  });

  describe('RIFLE (Bellomo 2004: R x1.5 / I x2 / F x3, L > 4 weeks, E > 3 months)', () => {
    const base: Inputs = {
      creatinineUnit: 'mg/dl',
      baselineCreatinine: 1,
      currentCreatinine: 1,
      urineOutput: 0,
      outcome: 0,
    };
    it('assigns the class from creatinine, GFR decrease, urine output and outcome', () => {
      expectCases('rifle-aki-criteria', [
        {
          name: 'nothing',
          inputs: base,
          expect: { rifleClass: 'Критерии не выполнены' },
          range: 'none',
        },
        {
          name: 'x1.49',
          inputs: { ...base, currentCreatinine: 1.49 },
          expect: { rifleClass: 'Критерии не выполнены' },
        },
        {
          name: 'x1.5',
          inputs: { ...base, currentCreatinine: 1.5 },
          expect: { rifleClass: 'R — риск' },
          range: 'risk',
        },
        {
          name: 'x2',
          inputs: { ...base, currentCreatinine: 2 },
          expect: { rifleClass: 'I — повреждение' },
          range: 'injury',
        },
        {
          name: 'x3',
          inputs: { ...base, currentCreatinine: 3 },
          expect: { rifleClass: 'F — недостаточность' },
          range: 'failure',
        },
        {
          name: 'GFR decrease 25 is not enough',
          inputs: { ...base, gfrDecrease: 25 },
          expect: { rifleClass: 'Критерии не выполнены' },
        },
        {
          name: 'GFR decrease 26',
          inputs: { ...base, gfrDecrease: 26 },
          expect: { rifleClass: 'R — риск' },
        },
        {
          name: 'GFR decrease 51',
          inputs: { ...base, gfrDecrease: 51 },
          expect: { rifleClass: 'I — повреждение' },
        },
        {
          name: 'GFR decrease 75 is still injury',
          inputs: { ...base, gfrDecrease: 75 },
          expect: { rifleClass: 'I — повреждение' },
        },
        {
          name: 'GFR decrease 76',
          inputs: { ...base, gfrDecrease: 76 },
          expect: { rifleClass: 'F — недостаточность' },
        },
        {
          name: '4.0 with acute rise 0.6 is failure (RIFLE-FC)',
          inputs: { ...base, baselineCreatinine: 3.4, currentCreatinine: 4 },
          expect: { rifleClass: 'F — недостаточность' },
        },
        {
          name: '4.0 with rise 0.4 is not',
          inputs: { ...base, baselineCreatinine: 3.6, currentCreatinine: 4 },
          expect: { rifleClass: 'Критерии не выполнены' },
        },
        {
          name: 'oliguria 12 h',
          inputs: { ...base, urineOutput: 2 },
          expect: { rifleClass: 'I — повреждение' },
        },
        {
          name: 'anuria',
          inputs: { ...base, urineOutput: 3 },
          expect: { rifleClass: 'F — недостаточность' },
        },
        {
          name: 'loss outranks failure',
          inputs: { ...base, currentCreatinine: 3, outcome: 4 },
          expect: { rifleClass: 'L — потеря функции' },
          range: 'loss',
        },
        {
          name: 'end-stage',
          inputs: { ...base, outcome: 5 },
          expect: { rifleClass: 'E — терминальная ХБП' },
          range: 'esrd',
        },
      ]);
    });
  });

  describe('MDRD with IDMS creatinine (Levey 2007: 175 x Scr^-1.154 x age^-0.203 x 0.742)', () => {
    const mdrd = (creatinineMg: number, age: number, female: boolean) =>
      175 * creatinineMg ** -1.154 * age ** -0.203 * (female ? 0.742 : 1);
    it('matches the published equation in both creatinine units', () => {
      expectCases('egfr-mdrd-idms', [
        {
          name: 'man 50 y, 1.0 mg/dl',
          inputs: { ageYears: 50, sex: 'male', creatinine: 1, creatinineUnit: 'mg/dl' },
          expect: { egfr: mdrd(1, 50, false) },
          range: 'g2',
        },
        {
          name: 'woman 60 y, 80 umol/l',
          inputs: { ageYears: 60, sex: 'female', creatinine: 80, creatinineUnit: 'umol/l' },
          expect: { egfr: mdrd(80 / 88.4, 60, true) },
          range: 'g2',
        },
        {
          name: 'man 40 y, 2.0 mg/dl',
          inputs: { ageYears: 40, sex: 'male', creatinine: 2, creatinineUnit: 'mg/dl' },
          expect: { egfr: mdrd(2, 40, false) },
          range: 'g3b',
        },
        {
          name: 'man 70 y, 5.0 mg/dl',
          inputs: { ageYears: 70, sex: 'male', creatinine: 5, creatinineUnit: 'mg/dl' },
          expect: { egfr: mdrd(5, 70, false) },
          range: 'g5',
        },
      ]);
      expect(mdrd(1, 50, false)).toBeCloseTo(79.0947, 4);
    });
  });

  describe('Schwartz-Lyon (De Souza 2012: k 36.5 for boys from 13 y, else 32.5)', () => {
    it('uses the age and sex coefficient and cuts the KDIGO categories on the rounded value', () => {
      expectCases('egfr-schwartz-lyon', [
        {
          name: 'boy 10 y',
          inputs: {
            ageYears: 10,
            sex: 'male',
            height: 140,
            creatinine: 60,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: (32.5 * 140) / 60 },
          range: 'g2',
        },
        {
          name: 'boy 12 y uses 32.5',
          inputs: {
            ageYears: 12,
            sex: 'male',
            height: 150,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 75 },
        },
        {
          name: 'boy 13 y uses 36.5',
          inputs: {
            ageYears: 13,
            sex: 'male',
            height: 150,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: (36.5 * 150) / 65 },
        },
        {
          name: 'girl 15 y uses 32.5',
          inputs: {
            ageYears: 15,
            sex: 'female',
            height: 160,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 80 },
        },
        {
          name: 'mg/dl input',
          inputs: {
            ageYears: 10,
            sex: 'female',
            height: 130,
            creatinine: 0.5,
            creatinineUnit: 'mg/dl',
          },
          expect: { egfr: (32.5 * 130) / (0.5 * 88.4) },
        },
        {
          name: 'exactly 90',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 144,
            creatinine: 52,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 90 },
          range: 'g1',
        },
        {
          name: '89.4 rounds to 89',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 178.8,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 89.4 },
          range: 'g2',
        },
        {
          name: 'exactly 60',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 120,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 60 },
          range: 'g2',
        },
        {
          name: 'exactly 45',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 90,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 45 },
          range: 'g3a',
        },
        {
          name: 'exactly 30',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 60,
            creatinine: 65,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 30 },
          range: 'g3b',
        },
        {
          name: 'exactly 15',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 60,
            creatinine: 130,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 15 },
          range: 'g4',
        },
        {
          name: 'below 15',
          inputs: {
            ageYears: 8,
            sex: 'female',
            height: 50,
            creatinine: 130,
            creatinineUnit: 'umol/l',
          },
          expect: { egfr: 12.5 },
          range: 'g5',
        },
      ]);
    });
  });

  describe('BUN:creatinine ratio (prerenal above 20:1; urea mmol/L x 2.8 = BUN)', () => {
    it('converts urea and creatinine units and cuts at 20', () => {
      expectCases('urea-creatinine-ratio', [
        {
          name: 'exactly 20',
          inputs: { urea: 20, ureaUnit: 'bun', creatinine: 1, creatinineUnit: 'mg/dl' },
          expect: { ratio: 20 },
          range: 'up-to-20',
        },
        {
          name: '20.1',
          inputs: { urea: 20.1, ureaUnit: 'bun', creatinine: 1, creatinineUnit: 'mg/dl' },
          expect: { ratio: 20.1 },
          range: 'above-20',
        },
        {
          name: 'SI units',
          inputs: { urea: 10, ureaUnit: 'mmol', creatinine: 100, creatinineUnit: 'umol/l' },
          expect: { ratio: 24.8, ratioSi: 0.1 },
          range: 'above-20',
          digits: 3,
        },
        {
          name: 'ratio 20 equals 0.081 in SI',
          inputs: { urea: 20, ureaUnit: 'bun', creatinine: 1, creatinineUnit: 'mg/dl' },
          expect: { ratioSi: 20 / 2.8 / 88.4 },
          digits: 6,
        },
      ]);
    });
  });

  describe('Calcium/creatinine clearance ratio (Khan 2017: <0.01 FHH, 0.01-0.02 overlap, >0.02 unlikely)', () => {
    const at = (urineCalcium: number): Inputs => ({
      urineCalcium,
      urineCreatinine: 8,
      plasmaCalcium: 2.5,
      plasmaCreatinine: 100,
    });
    it('computes (UCa x PCr) / (PCa x UCr) with plasma creatinine in umol/l and cuts at 0.01 and 0.02', () => {
      expectCases('calcium-creatinine-clearance-ratio', [
        {
          name: 'worked value',
          inputs: {
            urineCalcium: 1,
            urineCreatinine: 10,
            plasmaCalcium: 2.8,
            plasmaCreatinine: 90,
          },
          expect: { cccr: 0.0032 },
          range: 'fhh-suspected',
          digits: 4,
        },
        {
          name: '0.0095',
          inputs: at(1.9),
          expect: { cccr: 0.0095 },
          range: 'fhh-suspected',
          digits: 4,
        },
        { name: 'exactly 0.01', inputs: at(2), expect: { cccr: 0.01 }, range: 'grey-zone' },
        { name: 'exactly 0.02', inputs: at(4), expect: { cccr: 0.02 }, range: 'grey-zone' },
        {
          name: '0.0201',
          inputs: at(4.02),
          expect: { cccr: 0.0201 },
          range: 'fhh-unlikely',
          digits: 4,
        },
      ]);
    });
  });

  describe('Adrenal washout (Caoili 2002; ESE 2016: unenhanced <=10 HU, APW >=60 %, RPW >=40 %)', () => {
    it('computes both washouts and applies the three-way rule', () => {
      expectCases('adrenal-ct-washout', [
        {
          name: 'APW 80 %, RPW 60 %',
          inputs: { unenhancedHu: 25, portalHu: 100, delayedHu: 40 },
          expect: { apw: 80, rpw: 60 },
          range: 'washout-criteria',
        },
        {
          name: 'APW exactly 60 and RPW 60',
          inputs: { unenhancedHu: 20, portalHu: 100, delayedHu: 52 },
          expect: { apw: 60, rpw: 48 },
          range: 'washout-criteria',
        },
        {
          name: 'APW 59 %',
          inputs: { unenhancedHu: 20, portalHu: 100, delayedHu: 53 },
          expect: { apw: 58.8, rpw: 47 },
          range: 'indeterminate',
        },
        {
          name: 'APW 60 but RPW 39',
          inputs: { unenhancedHu: 35, portalHu: 100, delayedHu: 61 },
          expect: { apw: 60, rpw: 39 },
          range: 'indeterminate',
        },
        {
          name: 'RPW exactly 40 with APW above 60',
          inputs: { unenhancedHu: 35, portalHu: 100, delayedHu: 60 },
          expect: { apw: 61.5, rpw: 40 },
          range: 'washout-criteria',
        },
        {
          name: 'unenhanced exactly 10 HU',
          inputs: { unenhancedHu: 10, portalHu: 80, delayedHu: 70 },
          expect: { apw: 14.3 },
          range: 'lipid-rich',
          digits: 1,
        },
        {
          name: 'unenhanced 11 HU is not lipid-rich',
          inputs: { unenhancedHu: 11, portalHu: 80, delayedHu: 70 },
          expect: {},
          range: 'indeterminate',
        },
      ]);
      expect(
        failure('adrenal-ct-washout', { unenhancedHu: 40, portalHu: 40, delayedHu: 20 }),
      ).toContain('портальной');
      expect(
        failure('adrenal-ct-washout', { unenhancedHu: -20, portalHu: -10, delayedHu: -15 }),
      ).toContain('положительной');
    });
  });

  describe('Burch-Wartofsky Point Scale (1993: <25 / 25-44 / >=45)', () => {
    const base: Inputs = {
      temperature: 36.6,
      cns: 0,
      gastro: 0,
      heartRate: 80,
      heartFailure: 0,
      atrialFibrillation: 0,
      precipitant: 0,
    };
    it('scores temperature on the Fahrenheit boundaries converted to Celsius', () => {
      const steps: readonly [number, number][] = [
        [37.1, 0],
        [37.2, 5],
        [37.7, 5],
        [37.8, 10],
        [38.2, 10],
        [38.3, 15],
        [38.8, 15],
        [38.9, 20],
        [39.3, 20],
        [39.4, 25],
        [39.9, 25],
        [40, 30],
      ];
      for (const [temperature, points] of steps) {
        expect(
          run('burch-wartofsky', { ...base, temperature }).values.get('score'),
          `${temperature} C`,
        ).toBe(points);
      }
    });
    it('scores heart rate in steps of 20 beats from 90', () => {
      const steps: readonly [number, number][] = [
        [89, 0],
        [90, 5],
        [109, 5],
        [110, 10],
        [119, 10],
        [120, 15],
        [129, 15],
        [130, 20],
        [139, 20],
        [140, 25],
      ];
      for (const [heartRate, points] of steps) {
        expect(
          run('burch-wartofsky', { ...base, heartRate }).values.get('score'),
          `${heartRate}/min`,
        ).toBe(points);
      }
    });
    it('adds the categorical items and cuts at 25 and 45', () => {
      expectCases('burch-wartofsky', [
        { name: 'nothing', inputs: base, expect: { score: 0 }, range: 'unlikely' },
        {
          name: '20 points',
          inputs: { ...base, cns: 10, gastro: 10 },
          expect: { score: 20 },
          range: 'unlikely',
        },
        {
          name: '25 points',
          inputs: { ...base, cns: 20, heartFailure: 5 },
          expect: { score: 25 },
          range: 'impending',
        },
        {
          name: '40 points',
          inputs: { ...base, cns: 30, atrialFibrillation: 1 },
          expect: { score: 40 },
          range: 'impending',
        },
        {
          name: '45 points',
          inputs: { ...base, cns: 30, atrialFibrillation: 1, heartFailure: 5 },
          expect: { score: 45 },
          range: 'storm',
        },
        { name: 'precipitant adds 10', inputs: { ...base, precipitant: 1 }, expect: { score: 10 } },
        {
          name: 'every item at its maximum',
          inputs: {
            temperature: 40.5,
            cns: 30,
            gastro: 20,
            heartRate: 150,
            heartFailure: 15,
            atrialFibrillation: 1,
            precipitant: 1,
          },
          expect: { score: 140 },
          range: 'storm',
        },
      ]);
    });
  });

  describe('FINDRISC (Lindstrom 2003; Russian algorithms Appendix: 0-26, <7 / 7-11 / 12-14 / 15-20 / >20)', () => {
    const base: Inputs = {
      ageYears: 40,
      sex: 'male',
      height: 200,
      weight: 80,
      waist: 90,
      noActivity: 0,
      noDailyVegetables: 0,
      hypertensionTherapy: 0,
      highGlucose: 0,
      familyHistory: 0,
    };
    it('scores age bands at 45, 55 and 65', () => {
      const steps: readonly [number, number][] = [
        [44, 0],
        [45, 2],
        [54, 2],
        [55, 3],
        [64, 3],
        [65, 4],
      ];
      for (const [ageYears, points] of steps) {
        expect(run('findrisc', { ...base, ageYears }).values.get('score'), `${ageYears} y`).toBe(
          points,
        );
      }
    });
    it('scores BMI above 30 as 3 and 25-30 as 1', () => {
      const steps: readonly [number, number][] = [
        [99.6, 0],
        [100, 1],
        [120, 1],
        [120.4, 3],
      ];
      for (const [weight, points] of steps) {
        expect(
          run('findrisc', { ...base, weight }).values.get('score'),
          `${weight} kg at 200 cm`,
        ).toBe(points);
      }
    });
    it('uses separate waist limits for men (94 / 102) and women (80 / 88)', () => {
      const men: readonly [number, number][] = [
        [93, 0],
        [94, 3],
        [102, 3],
        [103, 4],
      ];
      const women: readonly [number, number][] = [
        [79, 0],
        [80, 3],
        [88, 3],
        [89, 4],
      ];
      for (const [waist, points] of men)
        expect(run('findrisc', { ...base, waist }).values.get('score'), `m ${waist}`).toBe(points);
      for (const [waist, points] of women)
        expect(
          run('findrisc', { ...base, sex: 'female', waist }).values.get('score'),
          `f ${waist}`,
        ).toBe(points);
    });
    it('adds the remaining items and reports the published 10-year risks', () => {
      expectCases('findrisc', [
        { name: 'nothing', inputs: base, expect: { score: 0 }, range: 'low', includes: '1%' },
        {
          name: '7',
          inputs: { ...base, noActivity: 1, highGlucose: 1 },
          expect: { score: 7 },
          range: 'slightly-elevated',
          includes: '4%',
        },
        {
          name: '11',
          inputs: {
            ...base,
            highGlucose: 1,
            familyHistory: 3,
            hypertensionTherapy: 1,
            noDailyVegetables: 1,
          },
          expect: { score: 11 },
          range: 'slightly-elevated',
        },
        {
          name: '12',
          inputs: { ...base, highGlucose: 1, familyHistory: 5, noActivity: 1 },
          expect: { score: 12 },
          range: 'moderate',
          includes: '17%',
        },
        {
          name: '14',
          inputs: {
            ...base,
            highGlucose: 1,
            familyHistory: 5,
            noActivity: 1,
            hypertensionTherapy: 1,
          },
          expect: { score: 14 },
          range: 'moderate',
        },
        {
          name: '15',
          inputs: {
            ...base,
            highGlucose: 1,
            familyHistory: 5,
            noActivity: 1,
            hypertensionTherapy: 1,
            noDailyVegetables: 1,
          },
          expect: { score: 15 },
          range: 'high',
          includes: '33%',
        },
        {
          name: '20',
          inputs: {
            ...base,
            ageYears: 65,
            weight: 100,
            highGlucose: 1,
            familyHistory: 5,
            noActivity: 1,
            hypertensionTherapy: 1,
            noDailyVegetables: 1,
          },
          expect: { score: 20 },
          range: 'high',
        },
        {
          name: '21',
          inputs: {
            ...base,
            ageYears: 65,
            weight: 125,
            highGlucose: 1,
            familyHistory: 5,
            noActivity: 1,
            hypertensionTherapy: 1,
          },
          expect: { score: 21 },
          range: 'very-high',
          includes: '50%',
        },
        {
          name: 'maximum 26',
          inputs: {
            ...base,
            ageYears: 66,
            weight: 140,
            waist: 110,
            highGlucose: 1,
            familyHistory: 5,
            noActivity: 1,
            hypertensionTherapy: 1,
            noDailyVegetables: 1,
          },
          expect: { score: 26 },
          range: 'very-high',
        },
      ]);
    });
  });

  describe('HOMA-IR and HOMA-B (Matthews 1985; Russian algorithms: adults < 2.77, children < 3.2)', () => {
    it('divides glucose x insulin by 22.5 and compares with the age-specific threshold', () => {
      expectCases('homa-ir', [
        {
          name: 'adult, 5.5 mmol/l, 15',
          inputs: { glucose: 5.5, glucoseUnit: 'mmol/l', insulin: 15, population: 'adult' },
          expect: { homaIr: 3.67, homaBeta: 150 },
          range: 'insulin-resistance',
          digits: 2,
        },
        {
          name: 'adult exactly 2.77',
          inputs: { glucose: 4.5, glucoseUnit: 'mmol/l', insulin: 13.85, population: 'adult' },
          expect: { homaIr: 2.77 },
          range: 'insulin-resistance',
        },
        {
          name: 'adult 2.76',
          inputs: { glucose: 4.6, glucoseUnit: 'mmol/l', insulin: 13.5, population: 'adult' },
          expect: { homaIr: 2.76 },
          range: 'below-threshold',
        },
        {
          name: 'child 2.93 is below 3.2',
          inputs: { glucose: 5.5, glucoseUnit: 'mmol/l', insulin: 12, population: 'child' },
          expect: { homaIr: 2.93 },
          range: 'below-threshold',
          digits: 2,
        },
        {
          name: 'child exactly 3.2',
          inputs: { glucose: 4.5, glucoseUnit: 'mmol/l', insulin: 16, population: 'child' },
          expect: { homaIr: 3.2 },
          range: 'insulin-resistance',
        },
        {
          name: 'mg/dl glucose',
          inputs: { glucose: 99, glucoseUnit: 'mg/dl', insulin: 10, population: 'adult' },
          expect: { homaIr: Math.round((((99 / 18.016) * 10) / 22.5) * 100) / 100 },
          range: 'below-threshold',
          digits: 2,
        },
      ]);
    });
    it('omits HOMA-B when glucose is not above 3.5 mmol/l', () => {
      const result = run('homa-ir', {
        glucose: 3.5,
        glucoseUnit: 'mmol/l',
        insulin: 5,
        population: 'adult',
      });
      expect(result.values.get('homaBeta')).toBeUndefined();
      expect(
        run('homa-ir', {
          glucose: 3.6,
          glucoseUnit: 'mmol/l',
          insulin: 5,
          population: 'adult',
        }).values.get('homaBeta'),
      ).toBeCloseTo(1000, 6);
    });
  });

  describe('Matsuda ISI (Matsuda 1999: 10000 / sqrt(G0 x I0 x Gmean x Imean))', () => {
    const mg: Inputs = {
      glucoseUnit: 'mg/dl',
      glucose0: 90,
      glucose30: 140,
      glucose60: 150,
      glucose90: 130,
      glucose120: 100,
      insulin0: 10,
      insulin30: 60,
      insulin60: 80,
      insulin90: 60,
      insulin120: 40,
      population: 'adult',
    };
    it('reproduces the formula in mg/dl and mmol/l', () => {
      expectCases('matsuda-isi', [
        {
          name: 'mg/dl, adult',
          inputs: mg,
          expect: { isi: 4.27 },
          range: 'above-threshold',
          digits: 2,
        },
        {
          name: 'mmol/l',
          inputs: {
            ...mg,
            glucoseUnit: 'mmol/l',
            glucose0: 5,
            glucose30: 8,
            glucose60: 9,
            glucose90: 8,
            glucose120: 7,
            insulin30: 60,
            insulin60: 80,
            insulin90: 70,
            insulin120: 50,
          },
          expect: { isi: 3.93 },
          range: 'above-threshold',
          digits: 2,
        },
      ]);
    });
    it('uses 3.4 for adults and 2.6 for children', () => {
      const high = {
        ...mg,
        insulin0: 13,
        insulin30: 78,
        insulin60: 104,
        insulin90: 78,
        insulin120: 52,
      };
      expect(run('matsuda-isi', { ...high, population: 'adult' }).values.get('isi')).toBeCloseTo(
        3.28,
        2,
      );
      expect(run('matsuda-isi', { ...high, population: 'adult' }).range).toBe('insulin-resistance');
      expect(run('matsuda-isi', { ...high, population: 'child' }).range).toBe('above-threshold');
    });
  });

  describe('QUICKI (Katz 2000; Hrebicek 2002: < 0.357 in adults)', () => {
    it('equals 1 / (log10 insulin + log10 glucose) and cuts at 0.357', () => {
      const quicki = (insulin: number, glucoseMg: number) =>
        1 / (Math.log10(insulin) + Math.log10(glucoseMg));
      expectCases('quicki', [
        {
          name: '90 mg/dl, 10',
          inputs: { glucose: 90, glucoseUnit: 'mg/dl', insulin: 10 },
          expect: { quicki: quicki(10, 90) },
          range: 'low',
          digits: 8,
        },
        {
          name: 'just below the limit',
          inputs: { glucose: 80, glucoseUnit: 'mg/dl', insulin: 8 },
          expect: { quicki: quicki(8, 80) },
          range: 'low',
          digits: 8,
        },
        {
          name: 'just above the limit',
          inputs: { glucose: 90, glucoseUnit: 'mg/dl', insulin: 7 },
          expect: { quicki: quicki(7, 90) },
          range: 'normal',
          digits: 8,
        },
        {
          name: 'mmol/l',
          inputs: { glucose: 5, glucoseUnit: 'mmol/l', insulin: 6 },
          expect: { quicki: quicki(6, 5 * 18.016) },
          range: 'normal',
          digits: 8,
        },
      ]);
    });
  });

  describe('OGTT categories (WHO 2006; Russian algorithms)', () => {
    it('classifies fasting and 2-hour venous plasma glucose on the published cut-offs', () => {
      const cases: readonly [number, number, string, string][] = [
        [5, 7, 'Норма', 'normal'],
        [6, 7.7, 'Норма', 'normal'],
        [6.1, 7.7, 'Нарушенная гликемия натощак', 'ifg'],
        [6.9, 7.7, 'Нарушенная гликемия натощак', 'ifg'],
        [5, 7.8, 'Нарушенная толерантность к глюкозе', 'igt'],
        [6, 11, 'Нарушенная толерантность к глюкозе', 'igt'],
        [6.1, 7.8, 'Нарушенная гликемия натощак и нарушенная толерантность к глюкозе', 'ifg-igt'],
        [6.9, 11, 'Нарушенная гликемия натощак и нарушенная толерантность к глюкозе', 'ifg-igt'],
        [7, 5, 'Сахарный диабет', 'diabetes'],
        [5, 11.1, 'Сахарный диабет', 'diabetes'],
        [6.5, 11.1, 'Сахарный диабет', 'diabetes'],
      ];
      for (const [fastingGlucose, glucose2h, label, range] of cases) {
        const result = run('ogtt-interpretation', { fastingGlucose, glucose2h });
        expect(result.values.get('categoryLabel'), `${fastingGlucose}/${glucose2h}`).toBe(label);
        expect(result.range, `${fastingGlucose}/${glucose2h}`).toBe(range);
      }
    });
  });

  describe('Resting energy expenditure (Mifflin 1990; Harris-Benedict 1918)', () => {
    it('reproduces both equations for men and women and the optional PAL product', () => {
      expectCases('basal-metabolic-rate', [
        {
          name: 'Mifflin man',
          inputs: {
            sex: 'male',
            ageYears: 30,
            weight: 80,
            height: 180,
            equation: 'mifflin',
            activityFactor: 1.5,
          },
          expect: { bmr: 1780, energy: 2670 },
        },
        {
          name: 'Mifflin woman',
          inputs: { sex: 'female', ageYears: 25, weight: 60, height: 165, equation: 'mifflin' },
          expect: { bmr: 1345.25 },
        },
        {
          name: 'Harris-Benedict man',
          inputs: { sex: 'male', ageYears: 30, weight: 80, height: 180, equation: 'harris' },
          expect: { bmr: 66.473 + 13.7516 * 80 + 5.0033 * 180 - 6.755 * 30 },
        },
        {
          name: 'Harris-Benedict woman',
          inputs: { sex: 'female', ageYears: 25, weight: 60, height: 165, equation: 'harris' },
          expect: { bmr: 1417.1935 },
        },
      ]);
      expect(
        run('basal-metabolic-rate', {
          sex: 'male',
          ageYears: 30,
          weight: 80,
          height: 180,
          equation: 'mifflin',
        }).values.get('energy'),
      ).toBeUndefined();
    });
  });

  describe('Body Roundness Index (Thomas 2013; Zhang 2024 quintiles 3.41 / 4.45 / 5.46 / 6.91)', () => {
    const bri = (height: number, waist: number) =>
      364.2 - 365.5 * Math.sqrt(1 - (waist / (2 * Math.PI)) ** 2 / (0.5 * height) ** 2);
    it('matches the published equation and places the value in the right quintile', () => {
      const band = (value: number) =>
        value < 3.41
          ? 'q1'
          : value < 4.45
            ? 'q2'
            : value < 5.46
              ? 'q3'
              : value < 6.91
                ? 'q4'
                : 'q5';
      for (const height of [160, 175, 190]) {
        for (let waist = 60; waist <= 140; waist += 5) {
          const result = run('body-roundness-index', { height, waist });
          expect(result.values.get('bri'), `${height}/${waist}`).toBeCloseTo(bri(height, waist), 8);
          expect(result.range, `${height}/${waist}`).toBe(band(bri(height, waist)));
        }
      }
    });
  });

  describe('Free and bioavailable testosterone (Vermeulen 1999; ISSAM calculator)', () => {
    it('reproduces the ISSAM worked example (SHBG 40 nmol/l, T 10 nmol/l, albumin 43 g/l)', () => {
      const result = run('free-bioavailable-testosterone', {
        totalTestosterone: 10,
        testosteroneUnit: 'nmol/l',
        shbg: 40,
      });
      expect(result.values.get('freePercent') as number).toBeCloseTo(1.74, 2);
      expect((result.values.get('freeT') as number) / 0.0347).toBeCloseTo(5.01, 1);
      expect((result.values.get('bioavailable') as number) / 0.0347).toBeCloseTo(117.4, 0);
    });
    it('solves the quadratic for other inputs', () => {
      expectCases('free-bioavailable-testosterone', [
        {
          name: 'T 10 / SHBG 40',
          inputs: { totalTestosterone: 10, testosteroneUnit: 'nmol/l', shbg: 40, albumin: 43 },
          expect: { freeT: 0.173884, bioavailable: 4.074926 },
          digits: 5,
        },
        {
          name: 'T 20 / SHBG 30',
          inputs: { totalTestosterone: 20, testosteroneUnit: 'nmol/l', shbg: 30 },
          expect: { freeT: 0.453823, freePercent: 2.269116, bioavailable: 10.635247 },
          digits: 5,
        },
        {
          name: 'T 15 / SHBG 60',
          inputs: { totalTestosterone: 15, testosteroneUnit: 'nmol/l', shbg: 60 },
          expect: { freeT: 0.204821, bioavailable: 4.799933 },
          digits: 5,
        },
        {
          name: 'T 8 / SHBG 25',
          inputs: { totalTestosterone: 8, testosteroneUnit: 'nmol/l', shbg: 25 },
          expect: { freeT: 0.179231 },
          digits: 5,
        },
        {
          name: 'lower albumin binds less',
          inputs: { totalTestosterone: 10, testosteroneUnit: 'nmol/l', shbg: 40, albumin: 35 },
          expect: { freeT: 0.18903, bioavailable: 3.640876 },
          digits: 5,
        },
        {
          name: 'ng/dl input',
          inputs: { totalTestosterone: 288.4, testosteroneUnit: 'ng/dl', shbg: 40 },
          expect: { freeT: 0.173861 },
          digits: 5,
        },
      ]);
    });
  });

  describe('Pulmonary nodule volume doubling time (NELSON: >=600 / 400-600 / <=400 days)', () => {
    it('computes interval x ln 2 / ln(V2/V1) and cuts on the rounded day count', () => {
      expectCases('pulmonary-nodule-vdt', [
        {
          name: 'volume doubled in 400 days',
          inputs: { volumeFirst: 200, volumeSecond: 400, interval: 400 },
          expect: { vdt: 400 },
          range: 'fast',
          includes: '9,9%',
        },
        {
          name: '401 days',
          inputs: { volumeFirst: 200, volumeSecond: 400, interval: 401 },
          expect: { vdt: 401 },
          range: 'intermediate',
          includes: '4,0%',
        },
        {
          name: '599 days',
          inputs: { volumeFirst: 200, volumeSecond: 400, interval: 599 },
          expect: { vdt: 599 },
          range: 'intermediate',
        },
        {
          name: '600 days',
          inputs: { volumeFirst: 200, volumeSecond: 400, interval: 600 },
          expect: { vdt: 600 },
          range: 'slow',
          includes: '0,8%',
        },
        {
          name: 'tripled in 300 days',
          inputs: { volumeFirst: 100, volumeSecond: 300, interval: 300 },
          expect: { vdt: (300 * Math.LN2) / Math.log(3) },
          range: 'fast',
          digits: 6,
        },
      ]);
      expect(
        failure('pulmonary-nodule-vdt', { volumeFirst: 300, volumeSecond: 300, interval: 90 }),
      ).toContain('не вырос');
      expect(
        failure('pulmonary-nodule-vdt', { volumeFirst: 300, volumeSecond: 200, interval: 90 }),
      ).toContain('не вырос');
    });
  });

  describe('Albumin-corrected calcium (Payne 1973: Ca - albumin + 4.0 in mg/100 ml)', () => {
    it('applies the Payne slope of 1.0 mg/dl per g/dl or the common 0.8', () => {
      expectCases('albumin-corrected-calcium', [
        {
          name: 'Payne, mg/dl and g/dl',
          inputs: {
            calcium: 8,
            calciumUnit: 'mg/dl',
            albumin: 3,
            albuminUnit: 'g/dl',
            formula: 'payne',
          },
          expect: { correctedMg: 9, correctedMmol: 9 * 0.2495 },
        },
        {
          name: 'common slope',
          inputs: {
            calcium: 8,
            calciumUnit: 'mg/dl',
            albumin: 3,
            albuminUnit: 'g/dl',
            formula: 'common',
          },
          expect: { correctedMg: 8.8 },
        },
        {
          name: 'SI units',
          inputs: {
            calcium: 2,
            calciumUnit: 'mmol/l',
            albumin: 30,
            albuminUnit: 'g/l',
            formula: 'payne',
          },
          expect: { correctedMmol: 2.2495 },
        },
        {
          name: 'normal albumin changes nothing',
          inputs: {
            calcium: 2.3,
            calciumUnit: 'mmol/l',
            albumin: 40,
            albuminUnit: 'g/l',
            formula: 'common',
          },
          expect: { correctedMmol: 2.3 },
        },
        {
          name: 'high albumin lowers the value',
          inputs: {
            calcium: 2,
            calciumUnit: 'mmol/l',
            albumin: 50,
            albuminUnit: 'g/l',
            formula: 'payne',
          },
          expect: { correctedMmol: 2 - 0.2495 },
        },
      ]);
    });
  });

  describe('Friedewald LDL-C (1972: TC - HDL - TG/5 mg/dl; TG limit 400 mg/dl)', () => {
    const mmol: Inputs = {
      lipidUnit: 'mmol/l',
      totalCholesterol: 5.2,
      hdl: 1.3,
      triglycerides: 1.8,
    };
    it('computes LDL in both units and compares it with the chosen risk target', () => {
      expectCases('ldl-friedewald', [
        {
          name: 'mmol/l without a target',
          inputs: mmol,
          expect: { ldl: 5.2 - 1.3 - 1.8 / 2.2 },
          range: 'no-target',
        },
        {
          name: 'mg/dl',
          inputs: { lipidUnit: 'mg/dl', totalCholesterol: 200, hdl: 50, triglycerides: 150 },
          expect: { ldl: 120 / 38.67 },
          range: 'no-target',
        },
        {
          name: 'above the moderate-risk target',
          inputs: { ...mmol, riskTarget: 2.6 },
          expect: {},
          range: 'above-target',
        },
        {
          name: 'below the low-risk target',
          inputs: { ...mmol, totalCholesterol: 5, riskTarget: 3 },
          expect: {},
          range: 'at-target',
        },
        {
          name: 'equal to the goal is not below it',
          inputs: {
            lipidUnit: 'mmol/l',
            totalCholesterol: 4.8,
            hdl: 1.5,
            triglycerides: 3.3,
            riskTarget: 1.8,
          },
          expect: {},
          range: 'above-target',
        },
        {
          name: 'just below the goal',
          inputs: {
            lipidUnit: 'mmol/l',
            totalCholesterol: 4.79,
            hdl: 1.5,
            triglycerides: 3.3,
            riskTarget: 1.8,
          },
          expect: {},
          range: 'at-target',
        },
      ]);
    });
    it('refuses triglycerides above 400 mg/dl and a non-positive result', () => {
      expect(
        run('ldl-friedewald', { ...mmol, triglycerides: 4.5 }).values.get('ldl'),
      ).toBeDefined();
      expect(failure('ldl-friedewald', { ...mmol, triglycerides: 4.52 })).toContain('400 мг/дл');
      expect(
        run('ldl-friedewald', {
          lipidUnit: 'mg/dl',
          totalCholesterol: 300,
          hdl: 40,
          triglycerides: 400,
        }).values.get('ldl'),
      ).toBeDefined();
      expect(
        failure('ldl-friedewald', {
          lipidUnit: 'mg/dl',
          totalCholesterol: 300,
          hdl: 40,
          triglycerides: 401,
        }),
      ).toContain('400 мг/дл');
      expect(
        failure('ldl-friedewald', {
          lipidUnit: 'mmol/l',
          totalCholesterol: 3,
          hdl: 2,
          triglycerides: 3.3,
        }),
      ).toContain('не положительно');
    });
  });

  describe('Atherogenic coefficient (Klimov: (TC - HDL) / HDL)', () => {
    it('returns the coefficient and the total cholesterol to HDL ratio', () => {
      expectCases('atherogenic-coefficient', [
        {
          name: 'TC 5.5, HDL 1.2',
          inputs: { totalCholesterol: 5.5, hdl: 1.2 },
          expect: { coefficient: 4.3 / 1.2, ratio: 5.5 / 1.2 },
        },
        {
          name: 'TC 4.0, HDL 2.0',
          inputs: { totalCholesterol: 4, hdl: 2 },
          expect: { coefficient: 1, ratio: 2 },
        },
      ]);
    });
  });

  describe('De Ritis ratio (Botros 2013: <1 / 1-1.5 / 1.5-2 / >=2)', () => {
    it('cuts at 1, 1.5 and 2', () => {
      expectCases('de-ritis-ratio', [
        {
          name: '0.99',
          inputs: { ast: 99, alt: 100 },
          expect: { ratio: 0.99 },
          range: 'below-one',
        },
        {
          name: '1.00',
          inputs: { ast: 100, alt: 100 },
          expect: { ratio: 1 },
          range: 'one-to-one-and-half',
        },
        {
          name: '1.49',
          inputs: { ast: 149, alt: 100 },
          expect: { ratio: 1.49 },
          range: 'one-to-one-and-half',
        },
        {
          name: '1.50',
          inputs: { ast: 150, alt: 100 },
          expect: { ratio: 1.5 },
          range: 'one-and-half-to-two',
        },
        {
          name: '1.99',
          inputs: { ast: 199, alt: 100 },
          expect: { ratio: 1.99 },
          range: 'one-and-half-to-two',
        },
        {
          name: '2.00',
          inputs: { ast: 200, alt: 100 },
          expect: { ratio: 2 },
          range: 'two-and-above',
        },
      ]);
    });
  });

  describe('ANI (Dunn 2006: -58.5 + 0.637 MCV + 3.91 AST/ALT - 0.406 BMI + 6.35 male)', () => {
    it('reproduces the two worked examples of the paper, including the MCV and ratio caps', () => {
      expectCases('ani-index', [
        {
          name: 'man, MCV 104 capped to 103, AST/ALT 4 capped to 3, BMI 40',
          inputs: { sex: 'male', ast: 160, alt: 40, mcv: 104, weight: 129.6, height: 180 },
          expect: { ani: 8.951, probability: 99.987 },
          range: 'alcohol',
          digits: 3,
        },
        {
          name: 'woman, MCV 95, AST/ALT 1, BMI 27',
          inputs: { sex: 'female', ast: 40, alt: 40, mcv: 95, weight: 78.03, height: 170 },
          expect: { ani: -5.037, probability: 0.645131 },
          range: 'nafld',
          digits: 4,
        },
        {
          name: 'MCV 90 is treated as 92',
          inputs: { sex: 'male', ast: 40, alt: 40, mcv: 90, weight: 78.03, height: 170 },
          expect: { ani: -58.5 + 0.637 * 92 + 3.91 - 0.406 * 27 + 6.35 },
          digits: 3,
        },
        {
          name: 'AST/ALT 3.5 is treated as 3',
          inputs: { sex: 'male', ast: 140, alt: 40, mcv: 100, weight: 78.03, height: 170 },
          expect: { ani: -58.5 + 0.637 * 100 + 3.91 * 3 - 0.406 * 27 + 6.35 },
          digits: 3,
        },
      ]);
    });
  });

  describe('Reticulocyte production index (Hillman and Finch 1969: retic % x Hct/45 / maturation)', () => {
    it('picks the maturation time by haematocrit band', () => {
      const bands: readonly [number, number][] = [
        [45, 1],
        [36, 1],
        [35.9, 1.5],
        [26, 1.5],
        [25.9, 2],
        [16, 2],
        [15.9, 2.5],
        [10, 2.5],
      ];
      for (const [hematocrit, maturation] of bands) {
        const expected = (4 * hematocrit) / 45 / maturation;
        expect(
          run('reticulocyte-production-index', { reticulocytes: 4, hematocrit }).values.get('rpi'),
          `Hct ${hematocrit}`,
        ).toBeCloseTo(expected, 2);
      }
    });
    it('cuts the response at 2 and 3', () => {
      expectCases('reticulocyte-production-index', [
        {
          name: '1.99',
          inputs: { reticulocytes: 1.99, hematocrit: 45 },
          expect: { rpi: 1.99 },
          range: 'inadequate',
        },
        {
          name: '2.00',
          inputs: { reticulocytes: 2, hematocrit: 45 },
          expect: { rpi: 2 },
          range: 'borderline',
        },
        {
          name: '2.99',
          inputs: { reticulocytes: 2.99, hematocrit: 45 },
          expect: { rpi: 2.99 },
          range: 'borderline',
        },
        {
          name: '3.00',
          inputs: { reticulocytes: 3, hematocrit: 45 },
          expect: { rpi: 3 },
          range: 'adequate',
        },
        {
          name: 'worked: 6 % at Hct 30',
          inputs: { reticulocytes: 6, hematocrit: 30 },
          expect: { rpi: 2.67 },
          range: 'borderline',
          digits: 2,
        },
      ]);
    });
  });

  describe('Laboratory unit conversion (AMA SI factors)', () => {
    const convert = (analyte: string, amount: number, sourceUnit: number, targetUnit: number) =>
      run('lab-unit-conversion', { analyte, amount, sourceUnit, targetUnit }).values.get(
        'converted',
      ) as number;
    it('converts conventional units to SI with the published factors', () => {
      expect(convert('glucose', 100, 0.0555, 1)).toBeCloseTo(5.55, 6);
      expect(convert('cholesterol', 200, 0.02586, 1)).toBeCloseTo(5.172, 6);
      expect(convert('triglycerides', 150, 0.01129, 1)).toBeCloseTo(1.6935, 6);
      expect(convert('creatinine', 1, 88.4, 1)).toBeCloseTo(88.4, 6);
      expect(convert('urea', 14, 0.357, 1)).toBeCloseTo(4.998, 6);
      expect(convert('urea', 30, 0.1665, 1)).toBeCloseTo(4.995, 6);
      expect(convert('uric-acid', 6, 59.48, 1)).toBeCloseTo(356.88, 6);
      expect(convert('bilirubin', 1, 17.104, 1)).toBeCloseTo(17.104, 6);
      expect(convert('calcium', 10, 0.2495, 1)).toBeCloseTo(2.495, 6);
      expect(convert('magnesium', 2, 0.4114, 1)).toBeCloseTo(0.8228, 6);
      expect(convert('phosphorus', 3, 0.3229, 1)).toBeCloseTo(0.9687, 6);
      expect(convert('lactate', 18, 0.111, 1)).toBeCloseTo(1.998, 6);
      expect(convert('hemoglobin', 14, 10, 1)).toBeCloseTo(140, 6);
      expect(convert('testosterone', 500, 0.0347, 1)).toBeCloseTo(17.35, 6);
      expect(convert('vitamin-d', 30, 2.496, 1)).toBeCloseTo(74.88, 6);
      expect(convert('insulin', 10, 6.945, 1)).toBeCloseTo(69.45, 6);
    });
    it('converts back from SI and between the two urea conventions', () => {
      expect(convert('glucose', 5.55, 1, 0.0555)).toBeCloseTo(100, 6);
      expect(convert('urea', 5, 1, 0.357)).toBeCloseTo(5 / 0.357, 6);
      expect(convert('urea', 14, 0.357, 0.1665)).toBeCloseTo((14 * 0.357) / 0.1665, 6);
    });
  });

  describe('HbA1c conversions (IFCC master equation, ADAG: 28.7 x A1C - 46.7)', () => {
    it('converts percent to mmol/mol and estimated average glucose', () => {
      expectCases('hba1c-conversion', [
        {
          name: '7.0 %',
          inputs: { hba1c: 7, hba1cUnit: 'percent' },
          expect: { ngsp: 7, ifcc: 53.00565, eagMmol: 8.54, eagMg: 154.2 },
          digits: 4,
        },
        {
          name: '6.5 %',
          inputs: { hba1c: 6.5, hba1cUnit: 'percent' },
          expect: { ifcc: 47.54, eagMg: 139.85 },
          digits: 2,
        },
        {
          name: '53 mmol/mol',
          inputs: { hba1c: 53, hba1cUnit: 'mmol/mol' },
          expect: { ngsp: 53 / 10.929 + 2.15, ifcc: 53 },
          digits: 6,
        },
      ]);
    });
  });

  describe('Transferrin saturation (CDC 1998 < 16 %; EASL 2022 > 45 %)', () => {
    it('divides iron by TIBC and cuts at 16 and 45', () => {
      expectCases('transferrin-saturation', [
        {
          name: '15.9',
          inputs: { serumIron: 15.9, tibc: 100 },
          expect: { tsat: 15.9 },
          range: 'low',
        },
        {
          name: '16.0',
          inputs: { serumIron: 16, tibc: 100 },
          expect: { tsat: 16 },
          range: 'intermediate',
        },
        {
          name: '16.7 worked',
          inputs: { serumIron: 10, tibc: 60 },
          expect: { tsat: 16.7 },
          range: 'intermediate',
          digits: 1,
        },
        {
          name: '45.0',
          inputs: { serumIron: 27, tibc: 60 },
          expect: { tsat: 45 },
          range: 'intermediate',
        },
        {
          name: '45.1',
          inputs: { serumIron: 45.1, tibc: 100 },
          expect: { tsat: 45.1 },
          range: 'high',
        },
      ]);
      expect(failure('transferrin-saturation', { serumIron: 70, tibc: 60 })).toContain('ОЖСС');
    });
  });
});
