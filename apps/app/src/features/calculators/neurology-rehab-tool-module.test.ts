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

const MODULE_FILE = 'content/tool-modules/neurology-rehab.json';
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
    status: result.evaluation.status,
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

/** Every input set to its first option, then overridden. */
function zeros(id: string, overrides: Inputs = {}): Inputs {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const base: Inputs = {};
  for (const input of schema.inputs) {
    base[input.id] =
      input.kind === 'select' ? Number(input.options?.[0]?.value) : (input.minimum ?? 0);
  }
  return { ...base, ...overrides };
}

describe('neurology and rehabilitation tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly unknown[];
    };
    expect(source.tools).toHaveLength(20);
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
      (calculator) => getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining(SCHEMAS.map((schema) => schema.id)),
    );
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const schema of SCHEMAS) {
      if (schema.evaluation.status === 'not-applicable') {
        expect(schema.evaluation.reason, schema.id).toBeTruthy();
        expect(schema.interpretations, schema.id).toHaveLength(0);
        continue;
      }
      expect(schema.evaluation.status, schema.id).toBe('verdict');
      expect(schema.evaluation.rules.map((rule) => rule.when)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.when),
      );
      expect(schema.evaluation.rules.map((rule) => rule.verdict.explanation)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.message),
      );
    }
  });

  describe('NIHSS (Brott 1989; 15 scored lines, 0–42; bands 0 / 1–4 / 5–15 / 16–20 / 21–42)', () => {
    const id = 'minimed.calculator.nihss';
    const base = zeros(id);
    it('sums the lines and cuts at 4, 5, 15, 16, 20 and 21', () => {
      expectCases(id, [
        { name: 'no deficit', inputs: base, score: 0, range: 'no-symptoms' },
        { name: 'one point', inputs: { ...base, facial: 1 }, score: 1, range: 'minor' },
        {
          name: 'four points',
          inputs: { ...base, facial: 1, gaze: 1, sensory: 2 },
          score: 4,
          range: 'minor',
        },
        {
          name: 'five points',
          inputs: { ...base, armLeft: 3, language: 2 },
          score: 5,
          range: 'moderate',
        },
        {
          name: 'worked example: left hemiparesis, facial palsy, dysarthria and neglect',
          inputs: {
            ...base,
            facial: 2,
            armLeft: 3,
            legLeft: 2,
            dysarthria: 1,
            extinction: 1,
            sensory: 1,
          },
          score: 10,
          range: 'moderate',
        },
        {
          name: 'fifteen points',
          inputs: { ...base, armLeft: 4, legLeft: 4, facial: 3, language: 3, loc: 1 },
          score: 15,
          range: 'moderate',
        },
        {
          name: 'sixteen points',
          inputs: { ...base, armLeft: 4, legLeft: 4, facial: 3, language: 3, loc: 1, sensory: 1 },
          score: 16,
          range: 'moderate-severe',
        },
        {
          name: 'twenty points',
          inputs: { ...base, armLeft: 4, legLeft: 4, armRight: 4, legRight: 4, loc: 2, ataxia: 2 },
          score: 20,
          range: 'moderate-severe',
        },
        {
          name: 'twenty-one points',
          inputs: {
            ...base,
            armLeft: 4,
            legLeft: 4,
            armRight: 4,
            legRight: 4,
            loc: 2,
            ataxia: 2,
            sensory: 1,
          },
          score: 21,
          range: 'severe',
        },
        {
          name: 'every line at its maximum',
          inputs: {
            loc: 3,
            locQuestions: 2,
            locCommands: 2,
            gaze: 2,
            visual: 3,
            facial: 3,
            armLeft: 4,
            armRight: 4,
            legLeft: 4,
            legRight: 4,
            ataxia: 2,
            sensory: 2,
            language: 3,
            dysarthria: 2,
            extinction: 2,
          },
          score: 42,
          range: 'severe',
        },
      ]);
    });
  });

  describe('modified Rankin Scale (van Swieten 1988: grades 0–5)', () => {
    it('maps each grade to its own band', () => {
      for (let grade = 0; grade <= 5; grade += 1) {
        expectCases('minimed.calculator.mrs', [
          { name: `grade ${grade}`, inputs: { grade }, score: grade, range: `grade-${grade}` },
        ]);
      }
    });
  });

  describe('ABCD2 (Johnston 2007: 0–7; 0–3 / 4–5 / 6–7; 2-day risk 1.0 / 4.1 / 8.1 %)', () => {
    const id = 'minimed.calculator.abcd2';
    const base: Inputs = { ageYears: 50, bp: 0, clinical: 0, duration: 0, diabetes: 0 };
    it('scores age from 60 and cuts at 3, 4, 5 and 6', () => {
      expectCases(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'low', includes: '1,0 %' },
        {
          name: 'age 59 does not score',
          inputs: { ...base, ageYears: 59 },
          score: 0,
          range: 'low',
        },
        { name: 'age 60 scores one', inputs: { ...base, ageYears: 60 }, score: 1, range: 'low' },
        {
          name: 'three points: age, speech, 10–59 min',
          inputs: { ...base, ageYears: 70, clinical: 1, duration: 1 },
          score: 3,
          range: 'low',
        },
        {
          name: 'four points',
          inputs: { ...base, ageYears: 70, bp: 1, clinical: 2 },
          score: 4,
          range: 'moderate',
          includes: '4,1 %',
        },
        {
          name: 'five points',
          inputs: { ...base, ageYears: 70, bp: 1, duration: 2, diabetes: 1 },
          score: 5,
          range: 'moderate',
        },
        {
          name: 'six points',
          inputs: { ...base, ageYears: 70, bp: 1, clinical: 2, duration: 2 },
          score: 6,
          range: 'high',
          includes: '8,1 %',
        },
        {
          name: 'every item',
          inputs: { ageYears: 80, bp: 1, clinical: 2, duration: 2, diabetes: 1 },
          score: 7,
          range: 'high',
        },
      ]);
    });
  });

  describe('ABCD3-I (Merwick 2010: ABCD2 + dual TIA 2 + stenosis 2 + DWI 2; 0–13)', () => {
    const id = 'minimed.calculator.abcd3-i';
    const base: Inputs = {
      ageYears: 50,
      bp: 0,
      clinical: 0,
      duration: 0,
      diabetes: 0,
      dualTia: 0,
      carotidStenosis: 0,
      dwi: 0,
    };
    it('adds the imaging items and cuts at 3, 4, 7 and 8', () => {
      expectCases(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'low' },
        { name: 'dual TIA alone', inputs: { ...base, dualTia: 1 }, score: 2, range: 'low' },
        {
          name: 'three points',
          inputs: { ...base, dualTia: 1, diabetes: 1 },
          score: 3,
          range: 'low',
        },
        {
          name: 'four points',
          inputs: { ...base, dwi: 1, carotidStenosis: 1 },
          score: 4,
          range: 'moderate',
        },
        {
          name: 'six points: age, blood pressure, weakness and DWI',
          inputs: { ...base, ageYears: 65, bp: 1, clinical: 2, dwi: 1 },
          score: 6,
          range: 'moderate',
        },
        {
          name: 'seven points: the same plus diabetes',
          inputs: { ...base, ageYears: 65, bp: 1, clinical: 2, dwi: 1, diabetes: 1 },
          score: 7,
          range: 'moderate',
        },
        {
          name: 'eight points',
          inputs: { ...base, ageYears: 65, bp: 1, clinical: 2, dwi: 1, diabetes: 1, duration: 1 },
          score: 8,
          range: 'high',
          includes: '40,9 %',
        },
        {
          name: 'every item',
          inputs: {
            ageYears: 80,
            bp: 1,
            clinical: 2,
            duration: 2,
            diabetes: 1,
            dualTia: 1,
            carotidStenosis: 1,
            dwi: 1,
          },
          score: 13,
          range: 'high',
        },
      ]);
    });
  });

  describe('Hunt–Hess (1968: grades I–V; serious systemic disease or vasospasm moves one grade up)', () => {
    const id = 'minimed.calculator.hunt-hess';
    it('returns each grade and caps the shift at V', () => {
      for (let grade = 1; grade <= 5; grade += 1) {
        expectCases(id, [
          {
            name: `grade ${grade}`,
            inputs: { clinicalGrade: grade, systemicShift: 0 },
            score: grade,
            range: `grade-${grade}`,
          },
        ]);
      }
      expectCases(id, [
        {
          name: 'grade II with systemic disease becomes III',
          inputs: { clinicalGrade: 2, systemicShift: 1 },
          score: 3,
          range: 'grade-3',
        },
        {
          name: 'grade V stays V',
          inputs: { clinicalGrade: 5, systemicShift: 1 },
          score: 5,
          range: 'grade-5',
        },
      ]);
    });
  });

  describe('LAMS (Llanes 2004; Nazliel 2008: 0–5, large-vessel occlusion likely from 4)', () => {
    it('cuts at 3 and 4', () => {
      const id = 'minimed.calculator.lams';
      expectCases(id, [
        {
          name: 'nothing',
          inputs: { facialDroop: 0, armDrift: 0, gripStrength: 0 },
          score: 0,
          range: 'lvo-less-likely',
        },
        {
          name: 'three points',
          inputs: { facialDroop: 1, armDrift: 1, gripStrength: 1 },
          score: 3,
          range: 'lvo-less-likely',
        },
        {
          name: 'four points',
          inputs: { facialDroop: 1, armDrift: 2, gripStrength: 1 },
          score: 4,
          range: 'lvo-likely',
          includes: '0,81',
        },
        {
          name: 'five points',
          inputs: { facialDroop: 1, armDrift: 2, gripStrength: 2 },
          score: 5,
          range: 'lvo-likely',
        },
      ]);
    });
  });

  describe('Hoehn and Yahr (1967: stages 1–5; modified: 0, 1, 1.5, 2, 2.5, 3, 4, 5)', () => {
    it('returns every stage of the original scale', () => {
      for (const stage of [1, 2, 3, 4, 5]) {
        expectCases('minimed.calculator.hoehn-yahr', [
          { name: `stage ${stage}`, inputs: { stage }, score: stage, range: `stage-${stage}` },
        ]);
      }
    });
    it('returns every stage of the modified scale, including the half steps', () => {
      for (const stage of [0, 1, 1.5, 2, 2.5, 3, 4, 5]) {
        expectCases('minimed.calculator.hoehn-yahr-modified', [
          {
            name: `stage ${stage}`,
            inputs: { stage },
            score: stage,
            range: `stage-${String(stage).replace('.', '-')}`,
          },
        ]);
      }
    });
  });

  describe('ASIA Impairment Scale (ISNCSCI 2019 rules)', () => {
    const id = 'minimed.calculator.asia-ais';
    const base: Inputs = {
      normalAll: 0,
      voluntaryAnalContraction: 0,
      sacralSensory: 0,
      motorBelowLevel: 0,
      halfKeyMuscles: 0,
    };
    it('classifies complete, sensory-incomplete, motor-incomplete and normal injuries', () => {
      expectCases(id, [
        { name: 'no sacral sparing: A', inputs: base, score: 1, range: 'ais-a' },
        {
          name: 'motor function below the level without sacral sparing is still A',
          inputs: { ...base, motorBelowLevel: 1, halfKeyMuscles: 1 },
          score: 1,
          range: 'ais-a',
        },
        {
          name: 'sacral sensation only: B',
          inputs: { ...base, sacralSensory: 1 },
          score: 2,
          range: 'ais-b',
        },
        {
          name: 'voluntary anal contraction, under half of key muscles ≥3: C',
          inputs: { ...base, voluntaryAnalContraction: 1 },
          score: 3,
          range: 'ais-c',
        },
        {
          name: 'sacral sensation + motor function more than 3 levels below, under half ≥3: C',
          inputs: { ...base, sacralSensory: 1, motorBelowLevel: 1 },
          score: 3,
          range: 'ais-c',
        },
        {
          name: 'at least half of key muscles ≥3: D',
          inputs: { ...base, voluntaryAnalContraction: 1, halfKeyMuscles: 1 },
          score: 4,
          range: 'ais-d',
        },
        {
          name: 'sensory sparing + motor below + half ≥3: D',
          inputs: { ...base, sacralSensory: 1, motorBelowLevel: 1, halfKeyMuscles: 1 },
          score: 4,
          range: 'ais-d',
        },
        {
          name: 'normal after an earlier deficit: E',
          inputs: {
            ...base,
            normalAll: 1,
            voluntaryAnalContraction: 1,
            sacralSensory: 1,
            halfKeyMuscles: 1,
          },
          score: 5,
          range: 'ais-e',
        },
      ]);
    });
  });

  describe('Schwab and England (1969: 100–0 % in steps of 10)', () => {
    it('returns every level', () => {
      for (let level = 0; level <= 100; level += 10) {
        expectCases('minimed.calculator.schwab-england', [
          { name: `${level} %`, inputs: { level }, score: level, range: `level-${level}` },
        ]);
      }
    });
  });

  describe('Barthel Index (Mahoney & Barthel 1965: 0–100)', () => {
    const id = 'minimed.calculator.barthel-index';
    const base = zeros(id);
    const full: Inputs = {
      feeding: 10,
      bathing: 5,
      grooming: 5,
      dressing: 10,
      bowels: 10,
      bladder: 10,
      toilet: 10,
      transfer: 15,
      mobility: 15,
      stairs: 10,
    };
    it('sums the ten items and cuts at 20, 60, 90 and 100', () => {
      expectCases(id, [
        { name: 'all dependent', inputs: base, score: 0, range: 'total-dependence' },
        {
          name: '20 points',
          inputs: { ...base, transfer: 15, bathing: 5 },
          score: 20,
          range: 'total-dependence',
        },
        {
          name: '25 points',
          inputs: { ...base, transfer: 15, bathing: 5, grooming: 5 },
          score: 25,
          range: 'severe-dependence',
        },
        {
          name: 'worked example: transfers and walking with minor help',
          inputs: {
            ...base,
            feeding: 10,
            dressing: 5,
            bowels: 10,
            bladder: 10,
            toilet: 5,
            transfer: 10,
            mobility: 10,
            stairs: 0,
          },
          score: 60,
          range: 'severe-dependence',
        },
        {
          name: '65 points',
          inputs: {
            ...base,
            feeding: 10,
            dressing: 5,
            bowels: 10,
            bladder: 10,
            toilet: 5,
            transfer: 10,
            mobility: 10,
            grooming: 5,
          },
          score: 65,
          range: 'moderate-dependence',
        },
        {
          name: '90 points',
          inputs: { ...full, stairs: 0 },
          score: 90,
          range: 'moderate-dependence',
        },
        {
          name: '95 points',
          inputs: { ...full, stairs: 5 },
          score: 95,
          range: 'slight-dependence',
        },
        { name: '100 points', inputs: full, score: 100, range: 'independent' },
      ]);
    });
  });

  describe('Rivermead Mobility Index (Collen 1991: 15 yes/no items)', () => {
    const id = 'minimed.calculator.rivermead-mobility';
    it('counts the yes answers and declares no published bands', () => {
      const base = zeros(id);
      expect(run(id, base).score).toBe(0);
      const all = Object.fromEntries(Object.keys(base).map((key) => [key, 1]));
      expect(run(id, all).score).toBe(15);
      expect(run(id, { ...base, turnOver: 1, lyingToSitting: 1, run: 1 })).toMatchObject({
        score: 3,
        status: 'not-applicable',
      });
      expect(Object.keys(base)).toHaveLength(15);
    });
  });

  describe('PAINAD (Warden 2003: five items 0–2; 0–10)', () => {
    const id = 'minimed.calculator.painad';
    const base = zeros(id);
    it('sums the items and applies the conventional 1–3 / 4–6 / 7–10 labels', () => {
      expectCases(id, [
        { name: 'no signs', inputs: base, score: 0, range: 'none' },
        { name: 'one point', inputs: { ...base, face: 1 }, score: 1, range: 'mild' },
        { name: 'three points', inputs: { ...base, face: 1, body: 2 }, score: 3, range: 'mild' },
        { name: 'four points', inputs: { ...base, face: 2, body: 2 }, score: 4, range: 'moderate' },
        {
          name: 'six points',
          inputs: { ...base, face: 2, body: 2, vocalization: 2 },
          score: 6,
          range: 'moderate',
        },
        {
          name: 'seven points',
          inputs: { breathing: 1, vocalization: 2, face: 2, body: 2, consolability: 0 },
          score: 7,
          range: 'severe',
        },
        {
          name: 'every item at 2',
          inputs: { breathing: 2, vocalization: 2, face: 2, body: 2, consolability: 2 },
          score: 10,
          range: 'severe',
        },
      ]);
    });
  });

  describe('visual analogue scale (Huskisson 1974; Jensen 2003: 0–4 / 5–44 / 45–74 / 75–100 mm)', () => {
    it('cuts at 4, 5, 44, 45, 74 and 75 mm', () => {
      const id = 'minimed.calculator.vas-pain';
      expectCases(id, [
        { name: '0 mm', inputs: { vas: 0 }, score: 0, range: 'none' },
        { name: '4 mm', inputs: { vas: 4 }, score: 4, range: 'none' },
        { name: '5 mm', inputs: { vas: 5 }, score: 5, range: 'mild' },
        { name: '44 mm', inputs: { vas: 44 }, score: 44, range: 'mild' },
        { name: '45 mm', inputs: { vas: 45 }, score: 45, range: 'moderate' },
        { name: '74 mm', inputs: { vas: 74 }, score: 74, range: 'moderate' },
        { name: '75 mm', inputs: { vas: 75 }, score: 75, range: 'severe' },
        { name: '100 mm', inputs: { vas: 100 }, score: 100, range: 'severe' },
      ]);
    });
  });

  describe('ECOG performance status (Oken 1982: grades 0–4)', () => {
    it('maps each grade to its own band', () => {
      for (let grade = 0; grade <= 4; grade += 1) {
        expectCases('minimed.calculator.ecog', [
          { name: `grade ${grade}`, inputs: { grade }, score: grade, range: `grade-${grade}` },
        ]);
      }
    });
  });

  describe('Karnofsky Performance Status (1949: A 80–100, B 50–70, C 10–40)', () => {
    it('cuts at 80/70 and 50/40', () => {
      const id = 'minimed.calculator.karnofsky';
      expectCases(id, [
        { name: '100', inputs: { level: 100 }, score: 100, range: 'group-a' },
        { name: '80', inputs: { level: 80 }, score: 80, range: 'group-a' },
        { name: '70', inputs: { level: 70 }, score: 70, range: 'group-b' },
        { name: '50', inputs: { level: 50 }, score: 50, range: 'group-b' },
        { name: '40', inputs: { level: 40 }, score: 40, range: 'group-c' },
        { name: '10', inputs: { level: 10 }, score: 10, range: 'group-c' },
      ]);
    });
  });

  describe('Palliative Prognostic Index (Morita 1999: >4 → <6 weeks, >6 → <3 weeks)', () => {
    const id = 'minimed.calculator.ppi';
    const base: Inputs = { ppsBand: 0, oralIntake: 0, edema: 0, dyspneaRest: 0, delirium: 0 };
    it('adds the published points and cuts at 4 and 6', () => {
      expectCases(id, [
        { name: 'PPS ≥60 and no symptoms', inputs: base, score: 0, range: 'above-six-weeks' },
        {
          name: 'PPS 10–20 alone is exactly 4',
          inputs: { ...base, ppsBand: 4 },
          score: 4,
          range: 'above-six-weeks',
        },
        {
          name: '4.5 is above 4',
          inputs: { ...base, ppsBand: 2.5, oralIntake: 1, edema: 1 },
          score: 4.5,
          range: 'under-six-weeks',
          includes: '77 %',
        },
        {
          name: 'exactly 6 is not above 6',
          inputs: { ...base, ppsBand: 2.5, dyspneaRest: 3.5 },
          score: 6,
          range: 'under-six-weeks',
        },
        {
          name: '6.5 is above 6',
          inputs: { ...base, ppsBand: 4, oralIntake: 2.5 },
          score: 6.5,
          range: 'under-three-weeks',
          includes: '85 %',
        },
        {
          name: 'every item',
          inputs: { ppsBand: 4, oralIntake: 2.5, edema: 1, dyspneaRest: 3.5, delirium: 4 },
          score: 15,
          range: 'under-three-weeks',
        },
      ]);
    });
  });

  describe('Kérdő vegetative index ((1 − DBP/HR) × 100)', () => {
    const id = 'minimed.calculator.kerdo-index';
    it('reads the sign of the index', () => {
      expectCases(id, [
        {
          name: 'DBP equals HR',
          inputs: { diastolicBp: 70, heartRate: 70 },
          score: 0,
          range: 'eutonia',
        },
        {
          name: 'DBP 60, HR 80',
          inputs: { diastolicBp: 60, heartRate: 80 },
          score: 25,
          range: 'sympathicotonia',
        },
        {
          name: 'DBP 80, HR 70',
          inputs: { diastolicBp: 80, heartRate: 70 },
          score: -100 / 7,
          range: 'vagotonia',
        },
      ]);
    });
  });

  describe('Ruffier index ((4 × (P0 + P1 + P2) − 200) / 10)', () => {
    const id = 'minimed.calculator.ruffier-index';
    it('applies the formula and cuts at 0, 5, 10 and 15', () => {
      expectCases(id, [
        {
          name: 'worked example: 15 + 25 + 17',
          inputs: { p0: 15, p1: 25, p2: 17 },
          score: 2.8,
          range: 'good',
        },
        { name: 'exactly 0', inputs: { p0: 15, p1: 20, p2: 15 }, score: 0, range: 'very-good' },
        { name: 'below 0', inputs: { p0: 14, p1: 20, p2: 15 }, score: -0.4, range: 'very-good' },
        { name: '4.8', inputs: { p0: 20, p1: 22, p2: 20 }, score: 4.8, range: 'good' },
        { name: '5.2', inputs: { p0: 21, p1: 22, p2: 20 }, score: 5.2, range: 'average' },
        { name: 'exactly 10', inputs: { p0: 20, p1: 35, p2: 20 }, score: 10, range: 'average' },
        { name: '10.4', inputs: { p0: 21, p1: 35, p2: 20 }, score: 10.4, range: 'insufficient' },
        { name: '14.8', inputs: { p0: 22, p1: 45, p2: 20 }, score: 14.8, range: 'insufficient' },
        { name: '15.2', inputs: { p0: 23, p1: 45, p2: 20 }, score: 15.2, range: 'poor' },
      ]);
    });
  });

  describe('CIWA-Ar (Sullivan 1989: 10 items, 0–67; ASAM 2020: <10 / 10–18 / ≥19)', () => {
    const id = 'minimed.calculator.ciwa-ar';
    const base = zeros(id);
    it('sums the items and cuts at 9, 10, 18 and 19', () => {
      expectCases(id, [
        { name: 'no symptoms', inputs: base, score: 0, range: 'mild' },
        { name: 'nine points', inputs: { ...base, nausea: 7, tremor: 2 }, score: 9, range: 'mild' },
        {
          name: 'ten points',
          inputs: { ...base, nausea: 7, tremor: 2, orientation: 1 },
          score: 10,
          range: 'moderate',
        },
        {
          name: 'worked example: tremor, sweats, anxiety, agitation, headache',
          inputs: { ...base, tremor: 4, sweats: 4, anxiety: 4, agitation: 4, headache: 2 },
          score: 18,
          range: 'moderate',
        },
        {
          name: 'nineteen points',
          inputs: {
            ...base,
            tremor: 4,
            sweats: 4,
            anxiety: 4,
            agitation: 4,
            headache: 2,
            orientation: 1,
          },
          score: 19,
          range: 'severe',
        },
        {
          name: 'every item at its maximum',
          inputs: {
            nausea: 7,
            tremor: 7,
            sweats: 7,
            anxiety: 7,
            agitation: 7,
            tactile: 7,
            auditory: 7,
            visual: 7,
            headache: 7,
            orientation: 4,
          },
          score: 67,
          range: 'severe',
        },
      ]);
    });
  });
});
