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
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/pulmonology.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;

interface ScoreCase {
  readonly name: string;
  readonly inputs: Inputs;
  readonly score: number;
  readonly range: string;
  /** Text of the published rate or band that the interpretation must carry. */
  readonly includes?: string;
}

function schemaOf(id: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return schema;
}

function run(id: string, inputs: Inputs) {
  const result = evaluateCalculatorSchema(schemaOf(id), inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${id}: expected a numeric output`);
  return {
    score: output.value,
    verdict: result.evaluation.verdict,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
    trace: (stepId: string) => result.trace.find((entry) => entry.id === stepId)?.value,
  };
}

function failure(id: string, inputs: Inputs): string {
  const result = evaluateCalculatorSchema(schemaOf(id), inputs);
  if (result.ok) throw new Error(`${id}: expected a failure`);
  return result.error;
}

function expectCases(id: string, cases: readonly ScoreCase[]): void {
  for (const testCase of cases) {
    const { score, verdict, interpretation } = run(id, testCase.inputs);
    expect(score, `${id} / ${testCase.name}: score`).toBeCloseTo(testCase.score, 6);
    expect(verdict?.rangeId, `${id} / ${testCase.name}: band`).toBe(testCase.range);
    expect(interpretation, `${id} / ${testCase.name}: interpretation`).toBe(verdict?.explanation);
    if (testCase.includes) {
      expect(interpretation, `${id} / ${testCase.name}: published figure`).toContain(
        testCase.includes,
      );
    }
  }
}

describe('pulmonology tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly unknown[];
    };
    expect(source.tools).toHaveLength(6);
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(validateCalculatorSchema(record.definition).errors, record.id).toEqual([]);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        if (link.kind === 'literature') {
          expect(link.url).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/u);
        } else {
          expect(link.moduleId).toMatch(/^minimed\.clinical\.recommendation\.\d+_\d+$/u);
        }
      }
      registerDownloadedCalculator(record);
    }
    const registered = getCalculatorRegistry().filter(
      (calculator) =>
        calculator.category === 'pulmonology' && getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining([
        'minimed.calculator.curb-65',
        'minimed.calculator.crb-65',
        'minimed.calculator.psi-port',
        'minimed.calculator.smart-cop',
        'minimed.calculator.smrt-co',
        'minimed.calculator.mcisaac-pharyngitis',
      ]),
    );
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const schema of SCHEMAS) {
      expect(schema.evaluation.status, schema.id).toBe('verdict');
      expect(schema.evaluation.rules.map((rule) => rule.when)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.when),
      );
      expect(schema.evaluation.rules.map((rule) => rule.verdict.explanation)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.message),
      );
    }
  });

  describe('CURB-65 (Lim 2003: 5 items, 0–1 / 2 / 3 / 4–5)', () => {
    const id = 'minimed.calculator.curb-65';
    const base: Inputs = {
      confusion: 0,
      urea: 5,
      respiratoryRate: 20,
      systolicBp: 120,
      diastolicBp: 80,
      ageYears: 40,
    };
    it('scores every item and cuts at its published threshold', () => {
      expectCases(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'low', includes: '0,7–3,2 %' },
        {
          name: 'urea exactly 7 does not score',
          inputs: { ...base, urea: 7 },
          score: 0,
          range: 'low',
        },
        { name: 'urea above 7', inputs: { ...base, urea: 7.1 }, score: 1, range: 'low' },
        { name: 'RR 29', inputs: { ...base, respiratoryRate: 29 }, score: 0, range: 'low' },
        { name: 'RR 30', inputs: { ...base, respiratoryRate: 30 }, score: 1, range: 'low' },
        { name: 'SBP 90', inputs: { ...base, systolicBp: 90 }, score: 0, range: 'low' },
        {
          name: 'SBP 89',
          inputs: { ...base, systolicBp: 89, diastolicBp: 70 },
          score: 1,
          range: 'low',
        },
        { name: 'DBP 61', inputs: { ...base, diastolicBp: 61 }, score: 0, range: 'low' },
        { name: 'DBP 60', inputs: { ...base, diastolicBp: 60 }, score: 1, range: 'low' },
        {
          name: 'low SBP and low DBP count once',
          inputs: { ...base, systolicBp: 80, diastolicBp: 50 },
          score: 1,
          range: 'low',
        },
        { name: 'age 64', inputs: { ...base, ageYears: 64 }, score: 0, range: 'low' },
        { name: 'age 65', inputs: { ...base, ageYears: 65 }, score: 1, range: 'low' },
        {
          name: 'two points: intermediate',
          inputs: { ...base, confusion: 1, ageYears: 70 },
          score: 2,
          range: 'intermediate',
        },
        {
          name: 'three points: high',
          inputs: { ...base, confusion: 1, ageYears: 70, urea: 9 },
          score: 3,
          range: 'high',
          includes: '17 %',
        },
        {
          name: 'four points: very high',
          inputs: { ...base, confusion: 1, ageYears: 70, urea: 9, respiratoryRate: 32 },
          score: 4,
          range: 'very-high',
          includes: '41,5',
        },
        {
          name: 'all five items',
          inputs: {
            confusion: 1,
            urea: 12,
            respiratoryRate: 35,
            systolicBp: 80,
            diastolicBp: 50,
            ageYears: 80,
          },
          score: 5,
          range: 'very-high',
          includes: '57 %',
        },
      ]);
    });
    it('rejects a diastolic pressure above the systolic one', () => {
      expect(failure(id, { ...base, systolicBp: 100, diastolicBp: 110 })).toContain(
        'Диастолическое АД',
      );
    });
  });

  describe('CRB-65 (Bauer 2006: 4 items, 0 / 1–2 / 3–4)', () => {
    const id = 'minimed.calculator.crb-65';
    const base: Inputs = {
      confusion: 0,
      respiratoryRate: 20,
      systolicBp: 120,
      diastolicBp: 80,
      ageYears: 40,
    };
    it('scores the four items without urea and cuts at 0, 2 and 4', () => {
      expectCases(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'low' },
        { name: 'RR 29', inputs: { ...base, respiratoryRate: 29 }, score: 0, range: 'low' },
        {
          name: 'RR 30',
          inputs: { ...base, respiratoryRate: 30 },
          score: 1,
          range: 'intermediate',
        },
        { name: 'SBP 90', inputs: { ...base, systolicBp: 90 }, score: 0, range: 'low' },
        {
          name: 'SBP 89',
          inputs: { ...base, systolicBp: 89, diastolicBp: 70 },
          score: 1,
          range: 'intermediate',
        },
        { name: 'DBP 61', inputs: { ...base, diastolicBp: 61 }, score: 0, range: 'low' },
        {
          name: 'DBP 60',
          inputs: { ...base, diastolicBp: 60 },
          score: 1,
          range: 'intermediate',
        },
        { name: 'age 64', inputs: { ...base, ageYears: 64 }, score: 0, range: 'low' },
        {
          name: 'age 65',
          inputs: { ...base, ageYears: 65 },
          score: 1,
          range: 'intermediate',
        },
        {
          name: 'two points: top of intermediate',
          inputs: { ...base, confusion: 1, ageYears: 80 },
          score: 2,
          range: 'intermediate',
        },
        {
          name: 'three points: high',
          inputs: { ...base, confusion: 1, ageYears: 80, respiratoryRate: 31 },
          score: 3,
          range: 'high',
          includes: 'неотложная госпитализация',
        },
        {
          name: 'all four items',
          inputs: {
            confusion: 1,
            respiratoryRate: 35,
            systolicBp: 80,
            diastolicBp: 50,
            ageYears: 80,
          },
          score: 4,
          range: 'high',
        },
      ]);
    });
  });

  describe('PSI/PORT (Fine 1997: class I by criteria, II ≤70, III 71–90, IV 91–130, V >130)', () => {
    const id = 'minimed.calculator.psi-port';
    const normal: Inputs = {
      ageYears: 70,
      sex: 'male',
      nursingHome: 0,
      neoplasm: 0,
      liverDisease: 0,
      heartFailure: 0,
      cerebrovascular: 0,
      renalDisease: 0,
      alteredMentalStatus: 0,
      respiratoryRate: 20,
      systolicBp: 120,
      temperature: 37,
      heartRate: 90,
      arterialPh: 7.4,
      urea: 6,
      sodium: 138,
      glucose: 6,
      hematocrit: 40,
      pao2: 80,
      spo2: 97,
      pleuralEffusion: 0,
    };
    const klass = (inputs: Inputs) => run(id, inputs).score;
    const points = (inputs: Inputs) => run(id, inputs).trace('points');

    it('adds age, with 10 points off for women, and cuts classes at 70/71, 90/91 and 130/131', () => {
      expectCases(id, [
        {
          name: 'man 70 = 70 points',
          inputs: normal,
          score: 2,
          range: 'class-2',
          includes: '0,6–0,7 %',
        },
        {
          name: 'man 71 = 71 points',
          inputs: { ...normal, ageYears: 71 },
          score: 3,
          range: 'class-3',
          includes: '0,9–2,8 %',
        },
        {
          name: 'man 90 = 90 points',
          inputs: { ...normal, ageYears: 90 },
          score: 3,
          range: 'class-3',
        },
        {
          name: 'man 91 = 91 points',
          inputs: { ...normal, ageYears: 91 },
          score: 4,
          range: 'class-4',
          includes: '8,2–9,3 %',
        },
        {
          name: 'man 100 + cancer = 130 points',
          inputs: { ...normal, ageYears: 100, neoplasm: 1 },
          score: 4,
          range: 'class-4',
        },
        {
          name: 'man 101 + cancer = 131 points',
          inputs: { ...normal, ageYears: 101, neoplasm: 1 },
          score: 5,
          range: 'class-5',
          includes: '27,0–31,1 %',
        },
        {
          name: 'woman 80 = 70 points',
          inputs: { ...normal, sex: 'female', ageYears: 80 },
          score: 2,
          range: 'class-2',
        },
        {
          name: 'woman 81 = 71 points',
          inputs: { ...normal, sex: 'female', ageYears: 81 },
          score: 3,
          range: 'class-3',
        },
      ]);
      expect(points({ ...normal, sex: 'female', ageYears: 80 })).toBe(70);
    });

    it('assigns class I from the first step without laboratory data', () => {
      const youngWell: Inputs = {
        ageYears: 50,
        sex: 'male',
        nursingHome: 0,
        neoplasm: 0,
        liverDisease: 0,
        heartFailure: 0,
        cerebrovascular: 0,
        renalDisease: 0,
        alteredMentalStatus: 0,
        respiratoryRate: 29,
        systolicBp: 90,
        temperature: 35,
        heartRate: 124,
      };
      expectCases(id, [
        {
          name: 'age 50, every limit just inside',
          inputs: youngWell,
          score: 1,
          range: 'class-1',
          includes: '0,1–0,4 %',
        },
        {
          name: 'nursing home is scored but is not a step-1 criterion',
          inputs: { ...youngWell, nursingHome: 1 },
          score: 1,
          range: 'class-1',
        },
      ]);
      const notClassOne: Inputs[] = [
        { ...youngWell, ageYears: 51 },
        { ...youngWell, neoplasm: 1 },
        { ...youngWell, liverDisease: 1 },
        { ...youngWell, heartFailure: 1 },
        { ...youngWell, cerebrovascular: 1 },
        { ...youngWell, renalDisease: 1 },
        { ...youngWell, alteredMentalStatus: 1 },
        { ...youngWell, respiratoryRate: 30 },
        { ...youngWell, systolicBp: 89 },
        { ...youngWell, temperature: 34.9 },
        { ...youngWell, temperature: 40 },
        { ...youngWell, heartRate: 125 },
      ];
      for (const inputs of notClassOne) {
        // Not class I any more, so the laboratory block becomes mandatory.
        expect(failure(id, inputs), JSON.stringify(inputs)).toContain('Для классов II–V');
        expect(
          klass({ ...inputs, ...labsNormal() }),
          JSON.stringify(inputs),
        ).toBeGreaterThanOrEqual(2);
      }
    });

    function labsNormal(): Inputs {
      return {
        arterialPh: 7.4,
        urea: 6,
        sodium: 138,
        glucose: 6,
        hematocrit: 40,
        pao2: 80,
        spo2: 97,
        pleuralEffusion: 0,
      };
    }

    it('scores each comorbidity, finding and laboratory item at its published cut-point', () => {
      const withBase = (extra: Inputs): number => points({ ...normal, ...extra }) ?? Number.NaN;
      // normal = man 70, so the quiet baseline is 70 points.
      const baseline = 70;
      const delta = (extra: Inputs): number => withBase(extra) - baseline;
      expect(delta({ nursingHome: 1 })).toBe(10);
      expect(delta({ neoplasm: 1 })).toBe(30);
      expect(delta({ liverDisease: 1 })).toBe(20);
      expect(delta({ heartFailure: 1 })).toBe(10);
      expect(delta({ cerebrovascular: 1 })).toBe(10);
      expect(delta({ renalDisease: 1 })).toBe(10);
      expect(delta({ alteredMentalStatus: 1 })).toBe(20);
      expect(delta({ respiratoryRate: 29 })).toBe(0);
      expect(delta({ respiratoryRate: 30 })).toBe(20);
      expect(delta({ systolicBp: 90 })).toBe(0);
      expect(delta({ systolicBp: 89 })).toBe(20);
      expect(delta({ temperature: 35 })).toBe(0);
      expect(delta({ temperature: 34.9 })).toBe(15);
      expect(delta({ temperature: 39.9 })).toBe(0);
      expect(delta({ temperature: 40 })).toBe(15);
      expect(delta({ heartRate: 124 })).toBe(0);
      expect(delta({ heartRate: 125 })).toBe(10);
      expect(delta({ arterialPh: 7.35 })).toBe(0);
      expect(delta({ arterialPh: 7.34 })).toBe(30);
      expect(delta({ urea: 10.6 })).toBe(0);
      expect(delta({ urea: 10.7 })).toBe(20);
      expect(delta({ sodium: 130 })).toBe(0);
      expect(delta({ sodium: 129 })).toBe(20);
      expect(delta({ glucose: 13.8 })).toBe(0);
      expect(delta({ glucose: 13.9 })).toBe(10);
      expect(delta({ hematocrit: 30 })).toBe(0);
      expect(delta({ hematocrit: 29.9 })).toBe(10);
      expect(delta({ pao2: 60 })).toBe(0);
      expect(delta({ pao2: 59 })).toBe(10);
      expect(delta({ spo2: 90 })).toBe(0);
      expect(delta({ spo2: 89 })).toBe(10);
      expect(delta({ pao2: 55, spo2: 85 }), 'oxygenation scores once').toBe(10);
      expect(delta({ pao2: 80, spo2: 85 }), 'either PaO2 or SaO2 is enough').toBe(10);
      expect(delta({ pleuralEffusion: 1 })).toBe(10);
    });

    it('classifies a worked high-risk example', () => {
      // Woman 78 (68) + heart failure 10 + RR 32 20 + pH 7.30 30 + urea 12 20 + Na 128 20
      // + Ht 28 % 10 + PaO2 55 10 + effusion 10 = 198 points: class V.
      const inputs: Inputs = {
        ...normal,
        sex: 'female',
        ageYears: 78,
        heartFailure: 1,
        respiratoryRate: 32,
        arterialPh: 7.3,
        urea: 12,
        sodium: 128,
        hematocrit: 28,
        pao2: 55,
        pleuralEffusion: 1,
      };
      expect(points(inputs)).toBe(198);
      expectCases(id, [{ name: 'class V', inputs, score: 5, range: 'class-5' }]);
    });

    it('asks for every laboratory item for classes II–V and accepts either oxygen value', () => {
      const { pleuralEffusion: _effusion, ...withoutEffusion } = normal;
      expect(failure(id, withoutEffusion)).toContain('Для классов II–V');
      for (const key of ['arterialPh', 'urea', 'sodium', 'glucose', 'hematocrit']) {
        const { [key]: _omitted, ...rest } = normal;
        expect(failure(id, rest), key).toContain('Для классов II–V');
      }
      const { pao2: _pao2, spo2: _spo2, ...noOxygen } = normal;
      expect(failure(id, noOxygen)).toContain('Для классов II–V');
      const { pao2: _only, ...spo2Only } = normal;
      expect(klass(spo2Only)).toBe(2);
      const { spo2: _sat, ...pao2Only } = normal;
      expect(klass(pao2Only)).toBe(2);
    });
  });

  describe('SMART-COP (Charles 2008: 8 items, 0–2 / 3–4 / 5–6 / ≥7)', () => {
    const id = 'minimed.calculator.smart-cop';
    const base: Inputs = {
      ageYears: 40,
      systolicBp: 120,
      multilobar: 0,
      albumin: 40,
      respiratoryRate: 16,
      heartRate: 80,
      confusion: 0,
      spo2: 98,
      arterialPh: 7.4,
    };
    it('scores each item at its published threshold and age-specific cut', () => {
      const cases: ScoreCase[] = [
        { name: 'nothing', inputs: base, score: 0, range: 'low' },
        { name: 'SBP 90', inputs: { ...base, systolicBp: 90 }, score: 0, range: 'low' },
        { name: 'SBP 89 = 2', inputs: { ...base, systolicBp: 89 }, score: 2, range: 'low' },
        { name: 'multilobar = 1', inputs: { ...base, multilobar: 1 }, score: 1, range: 'low' },
        { name: 'albumin 35', inputs: { ...base, albumin: 35 }, score: 0, range: 'low' },
        { name: 'albumin 34.9 = 1', inputs: { ...base, albumin: 34.9 }, score: 1, range: 'low' },
        {
          name: 'age 50 RR 24',
          inputs: { ...base, ageYears: 50, respiratoryRate: 24 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 50 RR 25 = 1',
          inputs: { ...base, ageYears: 50, respiratoryRate: 25 },
          score: 1,
          range: 'low',
        },
        {
          name: 'age 51 RR 25',
          inputs: { ...base, ageYears: 51, respiratoryRate: 25 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 RR 29',
          inputs: { ...base, ageYears: 51, respiratoryRate: 29 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 RR 30 = 1',
          inputs: { ...base, ageYears: 51, respiratoryRate: 30 },
          score: 1,
          range: 'low',
        },
        { name: 'HR 124', inputs: { ...base, heartRate: 124 }, score: 0, range: 'low' },
        { name: 'HR 125 = 1', inputs: { ...base, heartRate: 125 }, score: 1, range: 'low' },
        { name: 'confusion = 1', inputs: { ...base, confusion: 1 }, score: 1, range: 'low' },
        { name: 'pH 7.35', inputs: { ...base, arterialPh: 7.35 }, score: 0, range: 'low' },
        { name: 'pH 7.34 = 2', inputs: { ...base, arterialPh: 7.34 }, score: 2, range: 'low' },
        // Oxygenation (2 points) — any one of SpO2, PaO2 or PaO2/FiO2, with age-specific cuts.
        {
          name: 'age 50 SpO2 94',
          inputs: { ...base, ageYears: 50, spo2: 94 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 50 SpO2 93 = 2',
          inputs: { ...base, ageYears: 50, spo2: 93 },
          score: 2,
          range: 'low',
        },
        {
          name: 'age 51 SpO2 91',
          inputs: { ...base, ageYears: 51, spo2: 91 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 SpO2 90 = 2',
          inputs: { ...base, ageYears: 51, spo2: 90 },
          score: 2,
          range: 'low',
        },
        {
          name: 'age 50 PaO2 70',
          inputs: { ...base, ageYears: 50, spo2: 98, pao2: 70 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 50 PaO2 69 = 2',
          inputs: { ...base, ageYears: 50, spo2: 98, pao2: 69 },
          score: 2,
          range: 'low',
        },
        {
          name: 'age 51 PaO2 60',
          inputs: { ...base, ageYears: 51, spo2: 98, pao2: 60 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 PaO2 59 = 2',
          inputs: { ...base, ageYears: 51, spo2: 98, pao2: 59 },
          score: 2,
          range: 'low',
        },
        {
          name: 'age 50 P/F 333',
          inputs: { ...base, ageYears: 50, pf: 333 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 50 P/F 332 = 2',
          inputs: { ...base, ageYears: 50, pf: 332 },
          score: 2,
          range: 'low',
        },
        {
          name: 'age 51 P/F 250',
          inputs: { ...base, ageYears: 51, pf: 250 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 P/F 249 = 2',
          inputs: { ...base, ageYears: 51, pf: 249 },
          score: 2,
          range: 'low',
        },
        {
          name: 'oxygenation scores once',
          inputs: { ...base, spo2: 85, pao2: 50, pf: 200 },
          score: 2,
          range: 'low',
        },
        // Bands
        {
          name: 'three points',
          inputs: { ...base, confusion: 1, multilobar: 1, heartRate: 130 },
          score: 3,
          range: 'moderate',
          includes: '92 %',
        },
        {
          name: 'four points',
          inputs: { ...base, systolicBp: 80, multilobar: 1, confusion: 1 },
          score: 4,
          range: 'moderate',
        },
        {
          name: 'five points',
          inputs: { ...base, systolicBp: 80, spo2: 85, multilobar: 1 },
          score: 5,
          range: 'high',
        },
        {
          name: 'six points',
          inputs: { ...base, systolicBp: 80, spo2: 85, multilobar: 1, confusion: 1 },
          score: 6,
          range: 'high',
        },
        {
          name: 'seven points',
          inputs: { ...base, systolicBp: 80, spo2: 85, arterialPh: 7.3, confusion: 1 },
          score: 7,
          range: 'very-high',
          includes: '2 из 3',
        },
        {
          name: 'every item gives the 11-point maximum',
          inputs: {
            ageYears: 70,
            systolicBp: 80,
            multilobar: 1,
            albumin: 25,
            respiratoryRate: 34,
            heartRate: 140,
            confusion: 1,
            spo2: 85,
            arterialPh: 7.2,
          },
          score: 11,
          range: 'very-high',
        },
      ];
      expectCases(id, cases);
    });
    it('needs at least one oxygenation value', () => {
      const { spo2: _spo2, ...noOxygen } = base;
      expect(failure(id, noOxygen)).toContain('Укажите SpO₂, PaO₂ или PaO₂/FiO₂');
    });
  });

  describe('SMRT-CO (Charles 2008 variant without albumin, PaO2 and pH: 0–1 / 2 / ≥3)', () => {
    const id = 'minimed.calculator.smrt-co';
    const base: Inputs = {
      ageYears: 40,
      systolicBp: 120,
      multilobar: 0,
      respiratoryRate: 16,
      heartRate: 80,
      confusion: 0,
      spo2: 98,
    };
    it('scores the six items and cuts at 1 and 2', () => {
      expectCases(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'low' },
        { name: 'SBP 89 = 2', inputs: { ...base, systolicBp: 89 }, score: 2, range: 'moderate' },
        { name: 'SBP 90', inputs: { ...base, systolicBp: 90 }, score: 0, range: 'low' },
        { name: 'multilobar = 1', inputs: { ...base, multilobar: 1 }, score: 1, range: 'low' },
        {
          name: 'age 50 RR 25 = 1',
          inputs: { ...base, ageYears: 50, respiratoryRate: 25 },
          score: 1,
          range: 'low',
        },
        {
          name: 'age 51 RR 25',
          inputs: { ...base, ageYears: 51, respiratoryRate: 25 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 RR 30 = 1',
          inputs: { ...base, ageYears: 51, respiratoryRate: 30 },
          score: 1,
          range: 'low',
        },
        { name: 'HR 124', inputs: { ...base, heartRate: 124 }, score: 0, range: 'low' },
        { name: 'HR 125 = 1', inputs: { ...base, heartRate: 125 }, score: 1, range: 'low' },
        {
          name: 'confusion + multilobar',
          inputs: { ...base, confusion: 1, multilobar: 1 },
          score: 2,
          range: 'moderate',
        },
        {
          name: 'age 50 SpO2 94',
          inputs: { ...base, ageYears: 50, spo2: 94 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 50 SpO2 93 = 2',
          inputs: { ...base, ageYears: 50, spo2: 93 },
          score: 2,
          range: 'moderate',
        },
        {
          name: 'age 51 SpO2 91',
          inputs: { ...base, ageYears: 51, spo2: 91 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 SpO2 90 = 2',
          inputs: { ...base, ageYears: 51, spo2: 90 },
          score: 2,
          range: 'moderate',
        },
        {
          name: 'age 50 P/F 332 = 2',
          inputs: { ...base, ageYears: 50, pf: 332 },
          score: 2,
          range: 'moderate',
        },
        {
          name: 'age 51 P/F 250',
          inputs: { ...base, ageYears: 51, pf: 250 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 51 P/F 249 = 2',
          inputs: { ...base, ageYears: 51, pf: 249 },
          score: 2,
          range: 'moderate',
        },
        {
          name: 'three points: high',
          inputs: { ...base, systolicBp: 80, confusion: 1 },
          score: 3,
          range: 'high',
          includes: 'ОРИТ',
        },
        {
          name: 'every item gives the 8-point maximum',
          inputs: {
            ageYears: 70,
            systolicBp: 80,
            multilobar: 1,
            respiratoryRate: 34,
            heartRate: 140,
            confusion: 1,
            spo2: 85,
          },
          score: 8,
          range: 'high',
        },
      ]);
    });
    it('needs SpO2 or PaO2/FiO2', () => {
      const { spo2: _spo2, ...noOxygen } = base;
      expect(failure(id, noOxygen)).toContain('Укажите SpO₂ или PaO₂/FiO₂');
    });
  });

  describe('McIsaac (Fine 2012: age +1 under 15, −1 from 45, clipped to 0–4)', () => {
    const id = 'minimed.calculator.mcisaac-pharyngitis';
    const base: Inputs = {
      ageYears: 30,
      temperature: 37,
      tonsilExudate: 0,
      tenderNodes: 0,
      noCough: 0,
    };
    it('adds the four findings and the age adjustment, then maps to the published probabilities', () => {
      expectCases(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'score-0', includes: '8 %' },
        {
          name: 'temperature exactly 38',
          inputs: { ...base, temperature: 38 },
          score: 0,
          range: 'score-0',
        },
        {
          name: 'temperature 38.1',
          inputs: { ...base, temperature: 38.1 },
          score: 1,
          range: 'score-1',
          includes: '14 %',
        },
        { name: 'exudate', inputs: { ...base, tonsilExudate: 1 }, score: 1, range: 'score-1' },
        { name: 'nodes', inputs: { ...base, tenderNodes: 1 }, score: 1, range: 'score-1' },
        { name: 'no cough', inputs: { ...base, noCough: 1 }, score: 1, range: 'score-1' },
        { name: 'age 3 adds 1', inputs: { ...base, ageYears: 3 }, score: 1, range: 'score-1' },
        { name: 'age 14 adds 1', inputs: { ...base, ageYears: 14 }, score: 1, range: 'score-1' },
        { name: 'age 15 adds 0', inputs: { ...base, ageYears: 15 }, score: 0, range: 'score-0' },
        { name: 'age 44 adds 0', inputs: { ...base, ageYears: 44 }, score: 0, range: 'score-0' },
        {
          name: 'age 45 takes 1 off from a positive finding',
          inputs: { ...base, ageYears: 45, tonsilExudate: 1 },
          score: 0,
          range: 'score-0',
        },
        {
          name: 'two findings',
          inputs: { ...base, tonsilExudate: 1, tenderNodes: 1 },
          score: 2,
          range: 'score-2',
          includes: '23 %',
        },
        {
          name: 'three findings',
          inputs: { ...base, tonsilExudate: 1, tenderNodes: 1, noCough: 1 },
          score: 3,
          range: 'score-3',
          includes: '37 %',
        },
        {
          name: 'four findings',
          inputs: { ...base, tonsilExudate: 1, tenderNodes: 1, noCough: 1, temperature: 39 },
          score: 4,
          range: 'score-4',
          includes: '55 %',
        },
        {
          name: 'a child with every finding reaches 5 and is clipped to 4',
          inputs: { ageYears: 8, temperature: 39, tonsilExudate: 1, tenderNodes: 1, noCough: 1 },
          score: 4,
          range: 'score-4',
        },
      ]);
    });
    it('keeps the unclipped sum in the trace and clips a score of −1 to 0', () => {
      const adult = run(id, { ...base, ageYears: 60 });
      expect(adult.trace('rawScore')).toBe(-1);
      expect(adult.score).toBe(0);
      const child = run(id, {
        ageYears: 8,
        temperature: 39,
        tonsilExudate: 1,
        tenderNodes: 1,
        noCough: 1,
      });
      expect(child.trace('rawScore')).toBe(5);
    });
    it('rejects children under 3 years', () => {
      expect(failure(id, { ...base, ageYears: 2 })).toContain('Возраст');
    });
  });
});
