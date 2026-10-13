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

const MODULE_FILE = 'content/tool-modules/cardiology.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number>;

interface ScoreCase {
  readonly name: string;
  readonly inputs: Inputs;
  readonly score: number;
  readonly range: string;
  /** Text of the published rate or band that the interpretation must carry. */
  readonly includes?: string;
}

function run(id: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${id}: expected a numeric output`);
  return {
    score: output.value,
    verdict: result.evaluation.verdict,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
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

describe('cardiology tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly unknown[];
    };
    expect(source.tools).toHaveLength(34);
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length).toBeGreaterThan(0);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        if (link.url) expect(link.url).toMatch(/^https:\/\//u);
      }
      registerDownloadedCalculator(record);
    }
    const registered = getCalculatorRegistry().filter(
      (calculator) =>
        calculator.category === 'cardiology' && getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining([
        'minimed.calculator.wells-pe',
        'minimed.calculator.wells-dvt',
        'minimed.calculator.revised-geneva',
        'minimed.calculator.perc',
        'minimed.calculator.timi-nstemi',
        'minimed.calculator.timi-stemi',
        'minimed.calculator.rcri',
        'minimed.calculator.crusade',
        'minimed.calculator.killip-class',
        'minimed.calculator.nyha-class',
        'minimed.calculator.ccs-angina-class',
        'minimed.calculator.heart-score',
        'minimed.calculator.duke-treadmill-score',
        'minimed.calculator.pesi',
        'minimed.calculator.spesi',
        'minimed.calculator.padua',
        'minimed.calculator.hemorr2hages',
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

  describe('Wells criteria for pulmonary embolism (Wells 2000: 7 items, <2 / 2–6 / >6, ≤4 / >4)', () => {
    const base: Inputs = {
      dvtSigns: 0,
      peMostLikely: 0,
      heartRate: 80,
      immobilisationSurgery: 0,
      previousVte: 0,
      hemoptysis: 0,
      malignancy: 0,
    };
    it('adds the published points and cuts at <2, ≤4 and ≤6', () => {
      expectCases('minimed.calculator.wells-pe', [
        { name: 'nothing', inputs: base, score: 0, range: 'low' },
        {
          name: 'DVT signs + PE most likely + HR 110',
          inputs: { ...base, dvtSigns: 1, peMostLikely: 1, heartRate: 110 },
          score: 7.5,
          range: 'high',
        },
        {
          name: 'HR exactly 100 does not score',
          inputs: { ...base, heartRate: 100, previousVte: 1 },
          score: 1.5,
          range: 'low',
        },
        {
          name: 'two points: moderate, PE unlikely',
          inputs: { ...base, hemoptysis: 1, malignancy: 1 },
          score: 2,
          range: 'moderate-unlikely',
        },
        {
          name: 'four points: still PE unlikely',
          inputs: { ...base, peMostLikely: 1, hemoptysis: 1 },
          score: 4,
          range: 'moderate-unlikely',
          includes: 'маловероятна',
        },
        {
          name: '4.5 points: PE likely',
          inputs: { ...base, previousVte: 1, immobilisationSurgery: 1, heartRate: 101 },
          score: 4.5,
          range: 'moderate-likely',
          includes: 'вероятна (>4)',
        },
        {
          name: 'six points: top of moderate',
          inputs: { ...base, dvtSigns: 1, peMostLikely: 1 },
          score: 6,
          range: 'moderate-likely',
        },
        {
          name: 'every item',
          inputs: {
            dvtSigns: 1,
            peMostLikely: 1,
            heartRate: 130,
            immobilisationSurgery: 1,
            previousVte: 1,
            hemoptysis: 1,
            malignancy: 1,
          },
          score: 12.5,
          range: 'high',
        },
      ]);
    });
  });

  describe('Wells criteria for deep-vein thrombosis (Wells 2003: 10 items, ≥2 likely)', () => {
    const base: Inputs = {
      activeCancer: 0,
      paralysisCast: 0,
      bedriddenSurgery: 0,
      localTenderness: 0,
      entireLegSwollen: 0,
      calfSwelling: 0,
      pittingEdema: 0,
      collateralVeins: 0,
      previousDvt: 0,
      alternativeDiagnosis: 0,
    };
    it('scores −2 for an equally likely alternative and cuts at 2 and 3', () => {
      expectCases('minimed.calculator.wells-dvt', [
        {
          name: 'alternative diagnosis alone',
          inputs: { ...base, alternativeDiagnosis: 1 },
          score: -2,
          range: 'unlikely-low',
        },
        {
          name: 'calf swelling against an alternative',
          inputs: { ...base, calfSwelling: 1, alternativeDiagnosis: 1 },
          score: -1,
          range: 'unlikely-low',
        },
        {
          name: 'one point',
          inputs: { ...base, calfSwelling: 1 },
          score: 1,
          range: 'unlikely-moderate',
        },
        {
          name: 'two points: DVT likely',
          inputs: { ...base, calfSwelling: 1, pittingEdema: 1 },
          score: 2,
          range: 'likely',
        },
        {
          name: 'three points: high',
          inputs: { ...base, activeCancer: 1, localTenderness: 1, entireLegSwollen: 1 },
          score: 3,
          range: 'high',
        },
        {
          name: 'all nine positive items',
          inputs: {
            activeCancer: 1,
            paralysisCast: 1,
            bedriddenSurgery: 1,
            localTenderness: 1,
            entireLegSwollen: 1,
            calfSwelling: 1,
            pittingEdema: 1,
            collateralVeins: 1,
            previousDvt: 1,
            alternativeDiagnosis: 0,
          },
          score: 9,
          range: 'high',
        },
      ]);
    });
  });

  describe('Revised Geneva score (Le Gal 2006: 0–3 / 4–10 / ≥11; 8 % / 28 % / 74 %)', () => {
    const base: Inputs = {
      ageYears: 40,
      previousVte: 0,
      surgeryFracture: 0,
      malignancy: 0,
      unilateralLegPain: 0,
      hemoptysis: 0,
      heartRate: 60,
      palpationEdema: 0,
    };
    it('scores age over 65, the two heart-rate steps and the published bands', () => {
      expectCases('minimed.calculator.revised-geneva', [
        { name: 'nothing', inputs: base, score: 0, range: 'low', includes: '8 %' },
        {
          name: 'age 65 does not score',
          inputs: { ...base, ageYears: 65 },
          score: 0,
          range: 'low',
        },
        {
          name: 'age 66 + hemoptysis',
          inputs: { ...base, ageYears: 66, hemoptysis: 1 },
          score: 3,
          range: 'low',
        },
        {
          name: 'age 66 + prior VTE',
          inputs: { ...base, ageYears: 66, previousVte: 1 },
          score: 4,
          range: 'intermediate',
          includes: '28 %',
        },
        {
          name: 'HR 75 and HR 94 both 3 points',
          inputs: { ...base, heartRate: 94, previousVte: 1 },
          score: 6,
          range: 'intermediate',
        },
        {
          name: 'age 70, prior VTE, HR 100',
          inputs: { ...base, ageYears: 70, previousVte: 1, heartRate: 100 },
          score: 9,
          range: 'intermediate',
        },
        {
          name: 'eleven points',
          inputs: { ...base, ageYears: 70, previousVte: 1, heartRate: 100, hemoptysis: 1 },
          score: 11,
          range: 'high',
          includes: '74 %',
        },
        {
          name: 'every item',
          inputs: {
            ageYears: 80,
            previousVte: 1,
            surgeryFracture: 1,
            malignancy: 1,
            unilateralLegPain: 1,
            hemoptysis: 1,
            heartRate: 120,
            palpationEdema: 1,
          },
          score: 22,
          range: 'high',
        },
      ]);
    });
  });

  describe('PERC (Kline 2004/2008: 8 criteria, applied only to low suspicion)', () => {
    const base: Inputs = {
      lowSuspicion: 1,
      ageYears: 40,
      heartRate: 80,
      spo2: 98,
      legSwelling: 0,
      hemoptysis: 0,
      surgeryTrauma: 0,
      previousVte: 0,
      hormones: 0,
    };
    it('rules out only with no positive criterion and low suspicion', () => {
      expectCases('minimed.calculator.perc', [
        {
          name: 'all negative, low suspicion',
          inputs: base,
          score: 0,
          range: 'rule-out',
          includes: '1,0 %',
        },
        {
          name: 'all negative, suspicion not low',
          inputs: { ...base, lowSuspicion: 0 },
          score: 0,
          range: 'not-applicable',
        },
        {
          name: 'age 49 is negative',
          inputs: { ...base, ageYears: 49 },
          score: 0,
          range: 'rule-out',
        },
        {
          name: 'age 50 is positive',
          inputs: { ...base, ageYears: 50 },
          score: 1,
          range: 'positive',
        },
        {
          name: 'pulse 99 is negative',
          inputs: { ...base, heartRate: 99 },
          score: 0,
          range: 'rule-out',
        },
        {
          name: 'pulse 100 is positive',
          inputs: { ...base, heartRate: 100 },
          score: 1,
          range: 'positive',
        },
        { name: 'SaO2 95 is negative', inputs: { ...base, spo2: 95 }, score: 0, range: 'rule-out' },
        { name: 'SaO2 94 is positive', inputs: { ...base, spo2: 94 }, score: 1, range: 'positive' },
        {
          name: 'all eight positive',
          inputs: {
            lowSuspicion: 1,
            ageYears: 60,
            heartRate: 110,
            spo2: 90,
            legSwelling: 1,
            hemoptysis: 1,
            surgeryTrauma: 1,
            previousVte: 1,
            hormones: 1,
          },
          score: 8,
          range: 'positive',
        },
      ]);
    });
  });

  describe('TIMI risk score for UA/NSTEMI (Antman 2000: 7 items, 14-day rates)', () => {
    const base: Inputs = {
      ageYears: 50,
      riskFactors: 0,
      knownStenosis: 0,
      aspirin: 0,
      severeAngina: 0,
      stDeviation: 0,
      cardiacMarkers: 0,
    };
    it('adds one point per item and reports the published event rates', () => {
      expectCases('minimed.calculator.timi-nstemi', [
        { name: '0', inputs: base, score: 0, range: 's0-1', includes: '4,7 %' },
        { name: 'age 65 scores', inputs: { ...base, ageYears: 65 }, score: 1, range: 's0-1' },
        {
          name: 'age 64 does not',
          inputs: { ...base, ageYears: 64, aspirin: 1 },
          score: 1,
          range: 's0-1',
        },
        {
          name: '2',
          inputs: { ...base, aspirin: 1, stDeviation: 1 },
          score: 2,
          range: 's2',
          includes: '8,3 %',
        },
        {
          name: '3',
          inputs: { ...base, aspirin: 1, stDeviation: 1, cardiacMarkers: 1 },
          score: 3,
          range: 's3',
          includes: '13,2 %',
        },
        {
          name: '4',
          inputs: { ...base, ageYears: 70, riskFactors: 1, knownStenosis: 1, stDeviation: 1 },
          score: 4,
          range: 's4',
          includes: '19,9 %',
        },
        {
          name: '5',
          inputs: {
            ...base,
            ageYears: 70,
            riskFactors: 1,
            knownStenosis: 1,
            stDeviation: 1,
            cardiacMarkers: 1,
          },
          score: 5,
          range: 's5',
          includes: '26,2 %',
        },
        {
          name: '7',
          inputs: {
            ageYears: 70,
            riskFactors: 1,
            knownStenosis: 1,
            aspirin: 1,
            severeAngina: 1,
            stDeviation: 1,
            cardiacMarkers: 1,
          },
          score: 7,
          range: 's6-7',
          includes: '40,9 %',
        },
      ]);
    });
  });

  describe('TIMI risk score for STEMI (Morrow 2000: 0–14, 30-day mortality)', () => {
    const base: Inputs = {
      ageYears: 50,
      dmHtnAngina: 0,
      systolicBp: 120,
      heartRate: 80,
      killip2to4: 0,
      weightKg: 80,
      anteriorOrLbbb: 0,
      delayOver4h: 0,
    };
    it('weights age 65–74 as 2 and ≥75 as 3 and reports the published mortality', () => {
      expectCases('minimed.calculator.timi-stemi', [
        { name: '0', inputs: base, score: 0, range: 's0', includes: '0,8 %' },
        { name: 'age 64', inputs: { ...base, ageYears: 64 }, score: 0, range: 's0' },
        {
          name: 'age 65',
          inputs: { ...base, ageYears: 65 },
          score: 2,
          range: 's2',
          includes: '2,2 %',
        },
        { name: 'age 74', inputs: { ...base, ageYears: 74 }, score: 2, range: 's2' },
        {
          name: 'age 75',
          inputs: { ...base, ageYears: 75 },
          score: 3,
          range: 's3',
          includes: '4,4 %',
        },
        {
          name: 'SBP 100 does not score',
          inputs: { ...base, systolicBp: 100 },
          score: 0,
          range: 's0',
        },
        { name: 'SBP 99 scores 3', inputs: { ...base, systolicBp: 99 }, score: 3, range: 's3' },
        {
          name: 'HR 100 does not score',
          inputs: { ...base, heartRate: 100 },
          score: 0,
          range: 's0',
        },
        { name: 'HR 101 scores 2', inputs: { ...base, heartRate: 101 }, score: 2, range: 's2' },
        {
          name: 'weight 67 does not score',
          inputs: { ...base, weightKg: 67 },
          score: 0,
          range: 's0',
        },
        {
          name: 'weight 66.9 scores 1',
          inputs: { ...base, weightKg: 66.9 },
          score: 1,
          range: 's1',
          includes: '1,6 %',
        },
        {
          name: 'eight points',
          inputs: { ...base, ageYears: 70, dmHtnAngina: 1, systolicBp: 95, heartRate: 101 },
          score: 8,
          range: 's8',
          includes: '26,8 %',
        },
        {
          name: 'every item (maximum 14)',
          inputs: {
            ageYears: 80,
            dmHtnAngina: 1,
            systolicBp: 90,
            heartRate: 110,
            killip2to4: 1,
            weightKg: 60,
            anteriorOrLbbb: 1,
            delayOver4h: 1,
          },
          score: 14,
          range: 's9plus',
          includes: '35,9 %',
        },
      ]);
    });
  });

  describe('Revised Cardiac Risk Index (Lee 1999: 6 items; 0.4 / 0.9 / 6.6 / 11 %)', () => {
    const base: Inputs = {
      highRiskSurgery: 0,
      ischemicHeartDisease: 0,
      heartFailure: 0,
      cerebrovascular: 0,
      insulin: 0,
      creatinine: 0,
    };
    it('maps 0, 1, 2 and ≥3 factors to classes I–IV with the validation-cohort rates', () => {
      expectCases('minimed.calculator.rcri', [
        { name: '0', inputs: base, score: 0, range: 'class-1', includes: '0,4 %' },
        {
          name: '1',
          inputs: { ...base, insulin: 1 },
          score: 1,
          range: 'class-2',
          includes: '0,9 %',
        },
        {
          name: '2',
          inputs: { ...base, highRiskSurgery: 1, ischemicHeartDisease: 1 },
          score: 2,
          range: 'class-3',
          includes: '6,6 %',
        },
        {
          name: '3',
          inputs: { ...base, highRiskSurgery: 1, heartFailure: 1, creatinine: 1 },
          score: 3,
          range: 'class-4',
          includes: '11 %',
        },
        {
          name: 'all six',
          inputs: {
            highRiskSurgery: 1,
            ischemicHeartDisease: 1,
            heartFailure: 1,
            cerebrovascular: 1,
            insulin: 1,
            creatinine: 1,
          },
          score: 6,
          range: 'class-4',
        },
      ]);
    });
  });

  describe('CRUSADE bleeding score (Subherwal 2009: ≤20 / 21–30 / 31–40 / 41–50 / >50)', () => {
    const base: Inputs = {
      hematocrit: 45,
      creatinineClearance: 130,
      heartRate: 60,
      sexFemale: 0,
      heartFailureSigns: 0,
      vascularDisease: 0,
      diabetes: 0,
      systolicBp: 150,
    };
    it('sums the published point table and cuts at 20, 30, 40 and 50', () => {
      expectCases('minimed.calculator.crusade', [
        {
          name: 'lowest possible score is 1',
          inputs: base,
          score: 1,
          range: 'very-low',
          includes: '3,1 %',
        },
        {
          name: '20 points',
          inputs: { ...base, heartFailureSigns: 1, vascularDisease: 1, diabetes: 1 },
          score: 20,
          range: 'very-low',
        },
        {
          name: '21 points',
          inputs: { ...base, heartFailureSigns: 1, vascularDisease: 1, diabetes: 1, heartRate: 75 },
          score: 21,
          range: 'low',
          includes: '5,5 %',
        },
        {
          name: 'hematocrit 35, CrCl 50, HR 85, diabetes, SBP 130 = 3 + 28 + 3 + 6 + 1',
          inputs: {
            ...base,
            hematocrit: 35,
            creatinineClearance: 50,
            heartRate: 85,
            diabetes: 1,
            systolicBp: 130,
          },
          score: 41,
          range: 'high',
          includes: '11,9 %',
        },
        {
          name: '50 points',
          inputs: {
            hematocrit: 33,
            creatinineClearance: 100,
            heartRate: 95,
            sexFemale: 1,
            heartFailureSigns: 1,
            vascularDisease: 1,
            diabetes: 1,
            systolicBp: 190,
          },
          score: 50,
          range: 'high',
        },
        {
          name: '52 points',
          inputs: {
            hematocrit: 33,
            creatinineClearance: 100,
            heartRate: 105,
            sexFemale: 1,
            heartFailureSigns: 1,
            vascularDisease: 1,
            diabetes: 1,
            systolicBp: 190,
          },
          score: 52,
          range: 'very-high',
          includes: '19,5 %',
        },
        {
          name: 'worst bands of every item',
          inputs: {
            hematocrit: 30,
            creatinineClearance: 10,
            heartRate: 130,
            sexFemale: 1,
            heartFailureSigns: 1,
            vascularDisease: 1,
            diabetes: 1,
            systolicBp: 85,
          },
          score: 96,
          range: 'very-high',
        },
      ]);
    });

    it('applies the lower-inclusive edges of the hematocrit, clearance and pressure bands', () => {
      const score = (overrides: Inputs) =>
        run('minimed.calculator.crusade', { ...base, ...overrides }).score;
      // Hematocrit: <31 → 9, 31–33.9 → 7, 34–36.9 → 3, 37–39.9 → 2, ≥40 → 0 (baseline SBP 150 adds 1).
      expect(score({ hematocrit: 30.9 })).toBe(10);
      expect(score({ hematocrit: 31 })).toBe(8);
      expect(score({ hematocrit: 34 })).toBe(4);
      expect(score({ hematocrit: 37 })).toBe(3);
      expect(score({ hematocrit: 40 })).toBe(1);
      // Clearance: ≤15 → 39, >15–30 → 35, >30–60 → 28, >60–90 → 17, >90–120 → 7, >120 → 0.
      expect(score({ creatinineClearance: 15 })).toBe(40);
      expect(score({ creatinineClearance: 15.1 })).toBe(36);
      expect(score({ creatinineClearance: 60 })).toBe(29);
      expect(score({ creatinineClearance: 90 })).toBe(18);
      expect(score({ creatinineClearance: 120 })).toBe(8);
      expect(score({ creatinineClearance: 121 })).toBe(1);
      // Systolic pressure: ≤90 → 10, 91–100 → 8, 101–120 → 5, 121–180 → 1, 181–200 → 3, ≥201 → 5.
      expect(score({ systolicBp: 90 })).toBe(10);
      expect(score({ systolicBp: 91 })).toBe(8);
      expect(score({ systolicBp: 101 })).toBe(5);
      expect(score({ systolicBp: 121 })).toBe(1);
      expect(score({ systolicBp: 181 })).toBe(3);
      expect(score({ systolicBp: 201 })).toBe(5);
      // Heart rate: ≤70 → 0, 71–80 → 1, 81–90 → 3, 91–100 → 6, 101–110 → 8, 111–120 → 10, ≥121 → 11.
      expect(score({ heartRate: 70 })).toBe(1);
      expect(score({ heartRate: 71 })).toBe(2);
      expect(score({ heartRate: 81 })).toBe(4);
      expect(score({ heartRate: 91 })).toBe(7);
      expect(score({ heartRate: 101 })).toBe(9);
      expect(score({ heartRate: 111 })).toBe(11);
      expect(score({ heartRate: 121 })).toBe(12);
    });
  });

  describe('Classifications (Killip 1967, NYHA 1994, CCS 1976)', () => {
    it.each([
      ['minimed.calculator.killip-class', 'killipClass'],
      ['minimed.calculator.nyha-class', 'nyhaClass'],
      ['minimed.calculator.ccs-angina-class', 'ccsClass'],
    ])('%s returns the chosen class with its own description', (id, inputId) => {
      for (const classValue of [1, 2, 3, 4]) {
        const { score, verdict, interpretation } = run(id, { [inputId]: classValue });
        expect(score).toBe(classValue);
        expect(verdict?.rangeId).toBe(`class-${classValue}`);
        expect(interpretation).toContain(`Класс ${'I'.repeat(classValue).replace('IIII', 'IV')}`);
      }
    });

    it('describes every class option and rejects a class outside I–IV', () => {
      for (const id of [
        'minimed.calculator.killip-class',
        'minimed.calculator.nyha-class',
        'minimed.calculator.ccs-angina-class',
      ]) {
        const schema = SCHEMAS.find((candidate) => candidate.id === id);
        expect(schema?.inputs[0]?.options?.map((option) => option.value)).toEqual([1, 2, 3, 4]);
        if (!schema) throw new Error(id);
        const inputId = schema.inputs[0]?.id ?? '';
        expect(evaluateCalculatorSchema(schema, { [inputId]: 5 }).ok).toBe(false);
      }
    });
  });

  describe('HEART score (Six 2008, Backus 2013: 0–3 / 4–6 / 7–10)', () => {
    const base: Inputs = { history: 0, ecg: 0, ageYears: 40, riskFactors: 0, troponin: 0 };
    it('scores the five components and the age bands ≤45 / 46–64 / ≥65', () => {
      expectCases('minimed.calculator.heart-score', [
        { name: '0', inputs: base, score: 0, range: 'low', includes: '1,7 %' },
        { name: 'age 45', inputs: { ...base, ageYears: 45 }, score: 0, range: 'low' },
        { name: 'age 46', inputs: { ...base, ageYears: 46 }, score: 1, range: 'low' },
        { name: 'age 64', inputs: { ...base, ageYears: 64 }, score: 1, range: 'low' },
        { name: 'age 65', inputs: { ...base, ageYears: 65 }, score: 2, range: 'low' },
        {
          name: '3 points stay low',
          inputs: { ...base, history: 1, ecg: 1, ageYears: 50 },
          score: 3,
          range: 'low',
        },
        {
          name: '4 points are moderate',
          inputs: { ...base, history: 1, ecg: 1, ageYears: 50, troponin: 1 },
          score: 4,
          range: 'moderate',
          includes: '16,6 %',
        },
        {
          name: '6 points',
          inputs: { history: 2, ecg: 1, ageYears: 70, riskFactors: 1, troponin: 0 },
          score: 6,
          range: 'moderate',
        },
        {
          name: '7 points are high',
          inputs: { history: 2, ecg: 1, ageYears: 70, riskFactors: 1, troponin: 1 },
          score: 7,
          range: 'high',
          includes: '50,1 %',
        },
        {
          name: 'maximum 10',
          inputs: { history: 2, ecg: 2, ageYears: 80, riskFactors: 2, troponin: 2 },
          score: 10,
          range: 'high',
        },
      ]);
    });
  });

  describe('Duke treadmill score (Mark 1987/1991: time − 5·ST − 4·angina; range −25…+15)', () => {
    const score = (exerciseMinutes: number, stDeviationMm: number, anginaIndex: number) => ({
      exerciseMinutes,
      stDeviationMm,
      anginaIndex,
    });
    it('reproduces the published formula, its range and the 1991 cut-points', () => {
      expectCases('minimed.calculator.duke-treadmill-score', [
        {
          name: 'best possible +15',
          inputs: score(15, 0, 0),
          score: 15,
          range: 'low',
          includes: '99 %',
        },
        {
          name: 'worst possible −25',
          inputs: score(3, 4, 2),
          score: -25,
          range: 'high',
          includes: '79 %',
        },
        {
          name: '10 min, 2 mm, non-limiting angina',
          inputs: score(10, 2, 1),
          score: -4,
          range: 'moderate',
        },
        { name: '+5 is low', inputs: score(5, 0, 0), score: 5, range: 'low' },
        { name: '+4 is intermediate', inputs: score(4, 0, 0), score: 4, range: 'moderate' },
        { name: '−10 is intermediate', inputs: score(5, 3, 0), score: -10, range: 'moderate' },
        { name: '−11 is high', inputs: score(4, 3, 0), score: -11, range: 'high' },
      ]);
    });
  });

  describe('PESI (Aujesky 2005: classes I ≤65, II 66–85, III 86–105, IV 106–125, V >125)', () => {
    const base: Inputs = {
      ageYears: 40,
      maleSex: 0,
      cancer: 0,
      heartFailure: 0,
      chronicLungDisease: 0,
      heartRate: 80,
      systolicBp: 120,
      respiratoryRate: 16,
      temperature: 37,
      alteredMentalStatus: 0,
      spo2: 96,
    };
    it('adds age in years to the published weights and cuts at 65, 85, 105 and 125', () => {
      expectCases('minimed.calculator.pesi', [
        { name: 'woman 40', inputs: base, score: 40, range: 'class-1', includes: '0–1,6 %' },
        {
          name: 'man 55 = 65',
          inputs: { ...base, ageYears: 55, maleSex: 1 },
          score: 65,
          range: 'class-1',
        },
        {
          name: 'man 70 = 80',
          inputs: { ...base, ageYears: 70, maleSex: 1 },
          score: 80,
          range: 'class-2',
          includes: '1,7–3,5 %',
        },
        {
          name: 'man 56 = 66',
          inputs: { ...base, ageYears: 56, maleSex: 1 },
          score: 66,
          range: 'class-2',
        },
        {
          name: 'man 76 = 86',
          inputs: { ...base, ageYears: 76, maleSex: 1 },
          score: 86,
          range: 'class-3',
          includes: '3,2–7,1 %',
        },
        {
          name: 'man 95 = 105',
          inputs: { ...base, ageYears: 95, maleSex: 1 },
          score: 105,
          range: 'class-3',
        },
        {
          name: 'man 66 + cancer = 106',
          inputs: { ...base, ageYears: 66, maleSex: 1, cancer: 1 },
          score: 106,
          range: 'class-4',
          includes: '4,0–11,4 %',
        },
        {
          name: 'man 75 + cancer + heart failure = 125',
          inputs: { ...base, ageYears: 75, maleSex: 1, cancer: 1, heartFailure: 1 },
          score: 125,
          range: 'class-4',
        },
        {
          name: 'man 76 + cancer + heart failure = 126',
          inputs: { ...base, ageYears: 76, maleSex: 1, cancer: 1, heartFailure: 1 },
          score: 126,
          range: 'class-5',
          includes: '10,0–24,5 %',
        },
      ]);
    });

    it('scores each vital-sign threshold exactly as published', () => {
      const score = (overrides: Inputs) =>
        run('minimed.calculator.pesi', { ...base, ...overrides }).score;
      expect(score({ heartRate: 109 })).toBe(40);
      expect(score({ heartRate: 110 })).toBe(60);
      expect(score({ systolicBp: 100 })).toBe(40);
      expect(score({ systolicBp: 99 })).toBe(70);
      expect(score({ respiratoryRate: 29 })).toBe(40);
      expect(score({ respiratoryRate: 30 })).toBe(60);
      expect(score({ temperature: 36 })).toBe(40);
      expect(score({ temperature: 35.9 })).toBe(60);
      expect(score({ alteredMentalStatus: 1 })).toBe(100);
      expect(score({ spo2: 90 })).toBe(40);
      expect(score({ spo2: 89 })).toBe(60);
      expect(score({ chronicLungDisease: 1 })).toBe(50);
    });
  });

  describe('Simplified PESI (Jiménez 2010: 0 low, ≥1 high)', () => {
    const base: Inputs = {
      ageYears: 80,
      cancer: 0,
      cardiopulmonaryDisease: 0,
      heartRate: 100,
      systolicBp: 110,
      spo2: 95,
    };
    it('treats age over 80 and each criterion as one point', () => {
      expectCases('minimed.calculator.spesi', [
        { name: 'age 80 does not score', inputs: base, score: 0, range: 'low', includes: '1,0 %' },
        {
          name: 'age 81',
          inputs: { ...base, ageYears: 81 },
          score: 1,
          range: 'high',
          includes: '10,9 %',
        },
        { name: 'HR 110', inputs: { ...base, heartRate: 110 }, score: 1, range: 'high' },
        { name: 'SBP 99', inputs: { ...base, systolicBp: 99 }, score: 1, range: 'high' },
        { name: 'SaO2 89', inputs: { ...base, spo2: 89 }, score: 1, range: 'high' },
        {
          name: 'all six',
          inputs: {
            ageYears: 85,
            cancer: 1,
            cardiopulmonaryDisease: 1,
            heartRate: 120,
            systolicBp: 90,
            spo2: 85,
          },
          score: 6,
          range: 'high',
        },
      ]);
    });
  });

  describe('Padua Prediction Score (Barbar 2010: ≥4 high risk)', () => {
    const base: Inputs = {
      activeCancer: 0,
      previousVte: 0,
      reducedMobility: 0,
      thrombophilia: 0,
      traumaSurgery: 0,
      ageYears: 50,
      heartRespiratoryFailure: 0,
      miStroke: 0,
      infectionRheumatic: 0,
      obesity: 0,
      hormones: 0,
    };
    it('weights the first four items 3, trauma/surgery 2 and the rest 1', () => {
      expectCases('minimed.calculator.padua', [
        { name: '0', inputs: base, score: 0, range: 'low', includes: '0,3 %' },
        {
          name: 'prior VTE alone = 3',
          inputs: { ...base, previousVte: 1 },
          score: 3,
          range: 'low',
        },
        {
          name: 'trauma + age 70 + obesity = 4',
          inputs: { ...base, traumaSurgery: 1, ageYears: 70, obesity: 1 },
          score: 4,
          range: 'high',
          includes: '11,0 %',
        },
        {
          name: 'age 69 does not score',
          inputs: { ...base, traumaSurgery: 1, ageYears: 69, obesity: 1 },
          score: 3,
          range: 'low',
        },
        {
          name: 'every item',
          inputs: {
            activeCancer: 1,
            previousVte: 1,
            reducedMobility: 1,
            thrombophilia: 1,
            traumaSurgery: 1,
            ageYears: 80,
            heartRespiratoryFailure: 1,
            miStroke: 1,
            infectionRheumatic: 1,
            obesity: 1,
            hormones: 1,
          },
          score: 20,
          range: 'high',
        },
      ]);
    });
  });

  describe('HEMORR₂HAGES (Gage 2006: bleeds per 100 patient-years of warfarin)', () => {
    const base: Inputs = {
      hepaticRenal: 0,
      ethanol: 0,
      malignancy: 0,
      ageYears: 70,
      platelets: 0,
      rebleeding: 0,
      hypertension: 0,
      anemia: 0,
      genetic: 0,
      fallRisk: 0,
      stroke: 0,
    };
    it('gives a prior bleed 2 points and reports the published rate per score', () => {
      expectCases('minimed.calculator.hemorr2hages', [
        { name: '0', inputs: base, score: 0, range: 's0', includes: '1,9' },
        {
          name: 'age 75 does not score',
          inputs: { ...base, ageYears: 75, anemia: 1 },
          score: 1,
          range: 's1',
          includes: '2,5',
        },
        {
          name: 'prior bleed = 2',
          inputs: { ...base, rebleeding: 1 },
          score: 2,
          range: 's2',
          includes: '5,3',
        },
        {
          name: 'age 76 + prior bleed = 3',
          inputs: { ...base, ageYears: 76, rebleeding: 1 },
          score: 3,
          range: 's3',
          includes: '8,4',
        },
        {
          name: 'age 80 + hypertension + prior bleed = 4',
          inputs: { ...base, ageYears: 80, hypertension: 1, rebleeding: 1 },
          score: 4,
          range: 's4',
          includes: '10,4',
        },
        {
          name: 'five points',
          inputs: { ...base, ageYears: 80, hypertension: 1, rebleeding: 1, stroke: 1 },
          score: 5,
          range: 's5plus',
          includes: '12,3',
        },
        {
          name: 'every item',
          inputs: {
            hepaticRenal: 1,
            ethanol: 1,
            malignancy: 1,
            ageYears: 80,
            platelets: 1,
            rebleeding: 1,
            hypertension: 1,
            anemia: 1,
            genetic: 1,
            fallRisk: 1,
            stroke: 1,
          },
          score: 12,
          range: 's5plus',
        },
      ]);
    });
  });
});
