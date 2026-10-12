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

const MODULE_FILES = [
  'content/tool-modules/obstetrics-gynecology.json',
  'content/tool-modules/pediatrics.json',
] as const;
const SCHEMAS = loadToolModuleCalculatorSchemas(MODULE_FILES);

const VTE_ID = 'obstetric-vte-risk-rcog';
const CDS_ID = 'minimed.calculator.clinical-dehydration-scale';
const MALNUTRITION_ID = 'minimed.calculator.acute-malnutrition-who';
const ADDED_IDS = [VTE_ID, CDS_ID, MALNUTRITION_ID] as const;

type Inputs = Record<string, number>;

function schemaById(id: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return schema;
}

function run(id: string, inputs: Inputs) {
  const result = evaluateCalculatorSchema(schemaById(id), inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${id}: expected a numeric output`);
  return {
    score: output.value,
    verdict: result.evaluation.verdict,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

interface ScoreCase {
  readonly name: string;
  readonly inputs: Inputs;
  readonly score: number;
  readonly range: string;
  readonly includes?: string;
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

describe('perinatal and pediatric tool module additions', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every added calculator to a real publication', () => {
    const allowedHosts = new Set([
      'pubmed.ncbi.nlm.nih.gov',
      'www.rcog.org.uk',
      'cr.minzdrav.gov.ru',
      'www.who.int',
    ]);
    for (const file of MODULE_FILES) {
      const source = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as {
        tools: readonly unknown[];
      };
      for (const rawTool of source.tools) {
        const record = ToolDefinitionRecordSchema.parse(rawTool);
        if (record.kind !== 'calculator') continue;
        registerDownloadedCalculator(record);
        if (!(ADDED_IDS as readonly string[]).includes(record.id)) continue;
        expect(record.sources.length, record.id).toBeGreaterThan(0);
        for (const link of record.sources) {
          expect(link.title).not.toMatch(/MiniMed/iu);
          expect(link.url, `${record.id}/${link.id}`).not.toBeNull();
          expect(allowedHosts.has(new URL(link.url ?? '').host), `${record.id}/${link.id}`).toBe(
            true,
          );
        }
      }
    }
    const registered = getCalculatorRegistry().map((calculator) => calculator.id);
    for (const id of ADDED_IDS) {
      expect(registered).toContain(id);
      expect(getCalculatorSchema(id)).toBeDefined();
    }
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const id of ADDED_IDS) {
      const schema = schemaById(id);
      expect(schema.evaluation.status, id).toBe('verdict');
      expect(schema.evaluation.rules.map((rule) => rule.when)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.when),
      );
      expect(schema.evaluation.rules.map((rule) => rule.verdict.explanation)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.message),
      );
    }
  });

  it('declares the age ranges the sources state', () => {
    expect(schemaById(VTE_ID).ageScope.groups).toEqual(['adults']);
    expect(schemaById(CDS_ID).ageScope).toMatchObject({
      groups: ['children'],
      minAge: { value: 1, unit: 'months' },
      maxAge: { value: 59, unit: 'months' },
    });
    expect(schemaById(MALNUTRITION_ID).ageScope).toMatchObject({
      groups: ['children'],
      minAge: { value: 6, unit: 'months' },
      maxAge: { value: 59, unit: 'months' },
    });
  });

  describe('VTE risk in pregnancy and after birth (RCOG Green-top 37a, Appendix III)', () => {
    const antenatal: Inputs = { stage: 0, prevVte: 0, obesity: 0, deliveryMode: 0 };
    const postnatal: Inputs = { stage: 1, prevVte: 0, obesity: 0, deliveryMode: 0 };

    it('scores a woman with no risk factor as zero in both settings', () => {
      expectCases(VTE_ID, [
        { name: 'antenatal, none', inputs: antenatal, score: 0, range: 'antenatal-lower' },
        { name: 'postnatal, none', inputs: postnatal, score: 0, range: 'postnatal-lower' },
      ]);
    });

    it('applies the antenatal cut-points: 2 below, 3 from 28 weeks, 4 from the first trimester', () => {
      expectCases(VTE_ID, [
        {
          name: 'age + smoker = 2',
          inputs: { ...antenatal, age35: 1, smoker: 1 },
          score: 2,
          range: 'antenatal-lower',
        },
        {
          name: 'age + BMI >=30 + smoker = 3',
          inputs: { ...antenatal, age35: 1, obesity: 1, smoker: 1 },
          score: 3,
          range: 'antenatal-from-28-weeks',
          includes: '28-й недели',
        },
        {
          name: 'adding parity >=3 reaches 4',
          inputs: { ...antenatal, age35: 1, obesity: 1, smoker: 1, parity3: 1 },
          score: 4,
          range: 'antenatal-first-trimester',
          includes: 'I триместра',
        },
        {
          name: 'hyperemesis alone is 3 points',
          inputs: { ...antenatal, hyperemesis: 1 },
          score: 3,
          range: 'antenatal-from-28-weeks',
        },
        {
          name: 'OHSS alone is 4 points',
          inputs: { ...antenatal, ohss: 1 },
          score: 4,
          range: 'antenatal-first-trimester',
        },
        {
          name: 'previous VTE (not surgical) is 4 points',
          inputs: { ...antenatal, prevVte: 4 },
          score: 4,
          range: 'antenatal-first-trimester',
        },
        {
          name: 'previous VTE after major surgery is 3 points',
          inputs: { ...antenatal, prevVte: 3 },
          score: 3,
          range: 'antenatal-from-28-weeks',
        },
      ]);
    });

    it('weighs each published factor', () => {
      const single: readonly (readonly [string, number])[] = [
        ['highThrombophilia', 3],
        ['comorbidity', 3],
        ['surgery', 3],
        ['familyHistory', 1],
        ['lowThrombophilia', 1],
        ['age35', 1],
        ['parity3', 1],
        ['smoker', 1],
        ['varicose', 1],
        ['preeclampsia', 1],
        ['art', 1],
        ['multiple', 1],
        ['infection', 1],
        ['immobility', 1],
      ];
      for (const [key, weight] of single) {
        expect(run(VTE_ID, { ...antenatal, [key]: 1 }).score, key).toBe(weight);
      }
      expect(run(VTE_ID, { ...antenatal, obesity: 2 }).score, 'BMI >=40').toBe(2);
      expect(run(VTE_ID, { ...antenatal, obesity: 1 }).score, 'BMI >=30').toBe(1);
    });

    it('counts delivery factors only after birth and assisted conception or OHSS only before', () => {
      const delivery: Inputs = {
        deliveryMode: 2,
        prolongedLabour: 1,
        pph: 1,
        preterm: 1,
        stillbirth: 1,
        ohss: 1,
        art: 1,
      };
      expect(run(VTE_ID, { ...antenatal, ...delivery }).score).toBe(5);
      expect(run(VTE_ID, { ...postnatal, ...delivery }).score).toBe(6);
      expect(run(VTE_ID, { ...postnatal, deliveryMode: 1 }).score, 'elective CS').toBe(1);
      expect(run(VTE_ID, { ...postnatal, deliveryMode: 2 }).score, 'CS in labour').toBe(2);
      expect(run(VTE_ID, { ...postnatal, deliveryMode: 3 }).score, 'operative vaginal').toBe(1);
    });

    it('applies the postnatal cut-points: below 2, 10 days at 2, the Russian guideline from 3', () => {
      expectCases(VTE_ID, [
        {
          name: 'elective caesarean alone = 1',
          inputs: { ...postnatal, deliveryMode: 1 },
          score: 1,
          range: 'postnatal-lower',
        },
        {
          name: 'elective caesarean + age >35 = 2',
          inputs: { ...postnatal, deliveryMode: 1, age35: 1 },
          score: 2,
          range: 'postnatal-ten-days',
          includes: '10 дней',
        },
        {
          name: 'caesarean in labour alone = 2',
          inputs: { ...postnatal, deliveryMode: 2 },
          score: 2,
          range: 'postnatal-ten-days',
        },
        {
          name: 'caesarean in labour + BMI >=30 = 3',
          inputs: { ...postnatal, deliveryMode: 2, obesity: 1 },
          score: 3,
          range: 'postnatal-three-or-more',
          includes: '6 недель',
        },
        {
          name: 'systemic infection after a vaginal birth = 1',
          inputs: { ...postnatal, infection: 1 },
          score: 1,
          range: 'postnatal-lower',
        },
      ]);
    });

    it('sends the high-risk categories to six weeks whatever the sum', () => {
      expectCases(VTE_ID, [
        {
          name: 'previous VTE after major surgery (3 points)',
          inputs: { ...postnatal, prevVte: 3 },
          score: 3,
          range: 'postnatal-six-weeks-high-risk',
          includes: 'не менее 6 недель',
        },
        {
          name: 'high-risk thrombophilia',
          inputs: { ...postnatal, highThrombophilia: 1 },
          score: 3,
          range: 'postnatal-six-weeks-high-risk',
        },
        {
          name: 'low-risk thrombophilia with a family history (2 points)',
          inputs: { ...postnatal, lowThrombophilia: 1, familyHistory: 1 },
          score: 2,
          range: 'postnatal-six-weeks-high-risk',
        },
        {
          name: 'low-risk thrombophilia alone stays at 1 point',
          inputs: { ...postnatal, lowThrombophilia: 1 },
          score: 1,
          range: 'postnatal-lower',
        },
        {
          name: 'LMWH was given in this pregnancy',
          inputs: { ...postnatal, antenatalLmwh: 1 },
          score: 0,
          range: 'postnatal-six-weeks-high-risk',
        },
        {
          name: 'the high-risk category is not applied before birth',
          inputs: { ...antenatal, antenatalLmwh: 1, lowThrombophilia: 1, familyHistory: 1 },
          score: 2,
          range: 'antenatal-lower',
        },
      ]);
    });
  });

  describe('Clinical Dehydration Scale (Friedman 2004, Goldman 2008: 0 / 1–4 / 5–8)', () => {
    const items = (appearance: number, eyes: number, mucous: number, tears: number): Inputs => ({
      appearance,
      eyes,
      mucous,
      tears,
    });

    it('classifies every cut-point of the three published categories', () => {
      expectCases(CDS_ID, [
        { name: 'all normal', inputs: items(0, 0, 0, 0), score: 0, range: 'none' },
        { name: 'one sign', inputs: items(0, 0, 0, 1), score: 1, range: 'mild' },
        {
          name: 'upper edge of some dehydration',
          inputs: items(1, 1, 1, 1),
          score: 4,
          range: 'mild',
        },
        {
          name: 'lower edge of moderate/severe',
          inputs: items(1, 1, 1, 2),
          score: 5,
          range: 'moderate-severe',
        },
        {
          name: 'maximum',
          inputs: items(2, 2, 2, 2),
          score: 8,
          range: 'moderate-severe',
          includes: '5–8 баллов',
        },
        { name: 'two on one item', inputs: items(2, 0, 0, 0), score: 2, range: 'mild' },
        { name: 'three items at 1', inputs: items(1, 1, 1, 0), score: 3, range: 'mild' },
      ]);
    });

    it('states the published band wording', () => {
      expect(run(CDS_ID, items(0, 0, 0, 0)).interpretation).toContain('дегидратации нет');
      expect(run(CDS_ID, items(1, 1, 0, 0)).interpretation).toContain('1–4 балла');
    });
  });

  describe('Acute malnutrition, WHO 2023 (SAM: z < −3, MUAC < 115 mm, oedema; MAM: z < −2, MUAC 115–<125 mm)', () => {
    it('classifies the weight-for-height z-score at both cut-points', () => {
      expectCases(MALNUTRITION_ID, [
        { name: 'z = 0', inputs: { wfhz: 0 }, score: 0, range: 'none' },
        { name: 'z = −2 is not yet wasting', inputs: { wfhz: -2 }, score: 0, range: 'none' },
        { name: 'z = −2.01', inputs: { wfhz: -2.01 }, score: 1, range: 'moderate' },
        { name: 'z = −3 is still moderate', inputs: { wfhz: -3 }, score: 1, range: 'moderate' },
        {
          name: 'z = −3.01',
          inputs: { wfhz: -3.01 },
          score: 2,
          range: 'severe',
          includes: 'z-score массы к росту <−3',
        },
      ]);
    });

    it('classifies the mid-upper arm circumference at both cut-points', () => {
      expectCases(MALNUTRITION_ID, [
        { name: 'MUAC 125 mm', inputs: { muac: 125 }, score: 0, range: 'none' },
        { name: 'MUAC 124 mm', inputs: { muac: 124 }, score: 1, range: 'moderate' },
        { name: 'MUAC 115 mm is moderate', inputs: { muac: 115 }, score: 1, range: 'moderate' },
        { name: 'MUAC 114 mm', inputs: { muac: 114 }, score: 2, range: 'severe' },
      ]);
    });

    it('takes nutritional oedema as severe and the worse of the criteria', () => {
      expectCases(MALNUTRITION_ID, [
        {
          name: 'oedema with normal measures',
          inputs: { wfhz: 0, muac: 140, edema: 1 },
          score: 2,
          range: 'severe',
        },
        {
          name: 'oedema alone with a z-score',
          inputs: { wfhz: -1, edema: 1 },
          score: 2,
          range: 'severe',
        },
        {
          name: 'moderate z, severe MUAC',
          inputs: { wfhz: -2.5, muac: 110 },
          score: 2,
          range: 'severe',
        },
        {
          name: 'severe z, normal MUAC',
          inputs: { wfhz: -3.5, muac: 140 },
          score: 2,
          range: 'severe',
        },
        {
          name: 'normal z, moderate MUAC',
          inputs: { wfhz: -1, muac: 120 },
          score: 1,
          range: 'moderate',
        },
        {
          name: 'WHO exit criteria: MUAC >=125 mm and z >= −2',
          inputs: { wfhz: -2, muac: 125 },
          score: 0,
          range: 'none',
        },
      ]);
    });

    it('asks for at least one measurement', () => {
      const result = evaluateCalculatorSchema(schemaById(MALNUTRITION_ID), { edema: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('z-score массы к росту');
    });
  });
});
