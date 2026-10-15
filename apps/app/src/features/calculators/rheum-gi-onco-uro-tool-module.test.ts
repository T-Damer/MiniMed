import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { assessmentDefinitionFromRecord } from '@/features/assessments/assessment-definition';
import { scoreAssessment } from '@/features/assessments/assessment-engine';

import {
  clearDownloadedCalculators,
  getCalculatorRegistry,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import {
  loadToolModuleCalculatorSchemas,
  loadToolModuleRecords,
} from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/rheum-gi-onco-uro.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number>;

interface Case {
  readonly name: string;
  readonly inputs: Inputs;
  /** Expected numeric outputs by step id. */
  readonly outputs: Readonly<Record<string, number>>;
  readonly range: string;
  /** Text of the published rate or band that the interpretation must carry. */
  readonly includes?: string;
  /** Digits to which numeric outputs are compared (default 6). */
  readonly digits?: number;
}

function run(id: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const outputs = new Map<string, number | string>();
  for (const output of result.outputs) {
    if (output.kind === 'number') outputs.set(output.id, output.value);
    else if (output.kind === 'text') outputs.set(output.id, output.text);
  }
  return {
    outputs,
    trace: new Map(result.trace.map((entry) => [entry.id, entry.value] as const)),
    verdict: result.evaluation.verdict,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

function expectCases(id: string, cases: readonly Case[]): void {
  for (const testCase of cases) {
    const { outputs, trace, verdict, interpretation } = run(id, testCase.inputs);
    for (const [stepId, expected] of Object.entries(testCase.outputs)) {
      const actual = outputs.get(stepId) ?? trace.get(stepId);
      expect(typeof actual, `${id} / ${testCase.name}: ${stepId} is numeric`).toBe('number');
      expect(actual as number, `${id} / ${testCase.name}: ${stepId}`).toBeCloseTo(
        expected,
        testCase.digits ?? 6,
      );
    }
    expect(verdict?.rangeId, `${id} / ${testCase.name}: band`).toBe(testCase.range);
    expect(interpretation, `${id} / ${testCase.name}: interpretation`).toBe(verdict?.explanation);
    if (testCase.includes) {
      expect(interpretation, `${id} / ${testCase.name}: published figure`).toContain(
        testCase.includes,
      );
    }
  }
}

function rejects(id: string, inputs: Inputs): string {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (result.ok) throw new Error(`${id}: expected the input to be rejected`);
  return result.error;
}

/**
 * Finds the value of one input at which a monotonic reference score reaches a threshold, then
 * checks that the schema's band flips from `below` to `above` on either side of it. This covers
 * continuous cut-points without relying on floating-point equality.
 */
function expectFlipAt(
  id: string,
  inputs: Inputs,
  inputId: string,
  range: readonly [number, number],
  reference: (inputs: Inputs) => number,
  threshold: number,
  bands: { readonly below: string; readonly above: string },
): void {
  let [low, high] = range;
  const increasing =
    reference({ ...inputs, [inputId]: high }) > reference({ ...inputs, [inputId]: low });
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    const value = reference({ ...inputs, [inputId]: middle });
    if (value < threshold === increasing) low = middle;
    else high = middle;
  }
  const crossing = (low + high) / 2;
  const nudge = 1e-4;
  const lowerSide = increasing ? crossing - nudge : crossing + nudge;
  const upperSide = increasing ? crossing + nudge : crossing - nudge;
  expect(
    run(id, { ...inputs, [inputId]: lowerSide }).verdict?.rangeId,
    `${id} below ${threshold}`,
  ).toBe(bands.below);
  expect(
    run(id, { ...inputs, [inputId]: upperSide }).verdict?.rangeId,
    `${id} above ${threshold}`,
  ).toBe(bands.above);
}

function ruleWhens(id: string): readonly string[] {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return schema.evaluation.rules.map((rule) => rule.when);
}

/** Reference natural logarithm, independent of the schema's series expansion. */
const ln = Math.log;

describe('rheumatology, gastroenterology, oncology and urology tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every tool to a real publication', async () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      id: string;
      schemaVersion: number;
      tools: readonly unknown[];
    };
    expect(source.id).toBe('minimed.tools.rheum-gi-onco-uro.ru');
    expect(source.schemaVersion).toBe(2);
    expect(source.tools).toHaveLength(26);
    const categories = new Set<string>();
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      categories.add(record.category);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.sources.some((link) => link.kind !== 'clinical-recommendation')).toBe(true);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        if (link.url) expect(link.url).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/u);
        if (link.kind === 'clinical-recommendation') {
          expect(link.moduleId).toMatch(/^minimed\.clinical\.recommendation\.\d+_\d+$/u);
        }
      }
      if (record.kind === 'calculator') registerDownloadedCalculator(record);
      else registerDownloadedAssessment(record);
    }
    expect([...categories].toSorted()).toEqual([
      'gastroenterology',
      'oncology',
      'rheumatology',
      'urology',
    ]);
    const registered = getCalculatorRegistry().filter(
      (calculator) =>
        getCalculatorSchema(calculator.id) !== undefined &&
        calculator.id.startsWith('minimed.calculator.'),
    );
    for (const schema of SCHEMAS) {
      expect(registered.map((calculator) => calculator.id)).toContain(schema.id);
    }
    expect(SCHEMAS).toHaveLength(24);
    expect(
      (await loadAssessmentDefinition('mayo-score-ulcerative-colitis')).questions,
    ).toHaveLength(4);
    clearDownloadedAssessments();
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const schema of SCHEMAS) {
      if (
        schema.evaluation.status === 'unavailable' ||
        schema.evaluation.status === 'not-applicable'
      ) {
        expect(schema.interpretations, schema.id).toEqual([]);
        expect(schema.evaluation.reason, schema.id).toBeTruthy();
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

  it('keeps every adult-only scope above 18 years and gives each tool a source-backed basis', () => {
    for (const schema of SCHEMAS) {
      expect(schema.ageScope.groups, schema.id).toEqual(['adults']);
      expect(schema.ageScope.basis.length, schema.id).toBeGreaterThan(10);
    }
  });

  it('evaluates every calculator at the lowest and highest value of every input', () => {
    for (const schema of SCHEMAS) {
      for (const pick of ['low', 'high'] as const) {
        const inputs: Inputs = {};
        for (const input of schema.inputs) {
          if (input.kind === 'select') {
            const values = (input.options ?? []).map((option) => Number(option.value));
            inputs[input.id] = pick === 'low' ? Math.min(...values) : Math.max(...values);
          } else {
            inputs[input.id] = (pick === 'low' ? input.minimum : input.maximum) ?? 1;
          }
        }
        const result = evaluateCalculatorSchema(schema, inputs);
        expect(result.ok, `${schema.id} (${pick}): ${result.ok ? '' : result.error}`).toBe(true);
        if (result.ok) {
          for (const output of result.outputs) {
            if (output.kind === 'number') expect(Number.isFinite(output.value)).toBe(true);
          }
        }
      }
    }
  });

  describe('DAS28 with ESR (Prevoo 1995; Wells 2009): remission < 2.6, low ≤ 3.2, high > 5.1', () => {
    const id = 'minimed.calculator.das28-esr';
    const das = (i: Inputs) =>
      0.56 * Math.sqrt(i['tenderJoints'] as number) +
      0.28 * Math.sqrt(i['swollenJoints'] as number) +
      0.7 * ln(i['esr'] as number) +
      0.014 * (i['patientGlobal'] as number);
    const base: Inputs = { tenderJoints: 4, swollenJoints: 2, esr: 30, patientGlobal: 50 };
    it('reproduces a hand-calculated example', () => {
      // 1.12 + 0.396 + 2.381 + 0.7 = 4.597
      expectCases(id, [
        {
          name: '4 tender, 2 swollen, ESR 30, VAS 50',
          inputs: base,
          outputs: { das28: 4.5968 },
          range: 'moderate',
          digits: 3,
        },
        {
          name: 'no joints, ESR 1, VAS 0',
          inputs: { tenderJoints: 0, swollenJoints: 0, esr: 1, patientGlobal: 0 },
          outputs: { das28: 0 },
          range: 'remission',
        },
        {
          name: 'maximum joints',
          inputs: { tenderJoints: 28, swollenJoints: 28, esr: 120, patientGlobal: 100 },
          outputs: {
            das28: das({ tenderJoints: 28, swollenJoints: 28, esr: 120, patientGlobal: 100 }),
          },
          range: 'high',
        },
      ]);
    });
    it('uses the published inequalities and flips on each side of 2.6, 3.2 and 5.1', () => {
      expect(ruleWhens(id)).toEqual(['das28 < 2.6', 'das28 <= 3.2', 'das28 <= 5.1', '1']);
      const low: Inputs = { tenderJoints: 1, swollenJoints: 0, esr: 10, patientGlobal: 0 };
      const high: Inputs = { tenderJoints: 10, swollenJoints: 6, esr: 40, patientGlobal: 0 };
      expectFlipAt(id, low, 'patientGlobal', [0, 100], das, 2.6, {
        below: 'remission',
        above: 'low',
      });
      expectFlipAt(id, low, 'patientGlobal', [0, 100], das, 3.2, {
        below: 'low',
        above: 'moderate',
      });
      expectFlipAt(id, high, 'patientGlobal', [0, 100], das, 5.1, {
        below: 'moderate',
        above: 'high',
      });
    });
    it('agrees with a direct natural-log implementation over a grid', () => {
      for (const esr of [1, 2, 7, 18, 45, 90, 200, 300]) {
        for (const tenderJoints of [0, 1, 6, 15, 28]) {
          const inputs = { tenderJoints, swollenJoints: 3, esr, patientGlobal: 35 };
          expect(run(id, inputs).outputs.get('das28') as number).toBeCloseTo(das(inputs), 8);
        }
      }
    });
  });

  describe('DAS28 with CRP (Wells 2009; Fleischmann 2015/2017): remission < 2.4, low ≤ 2.9, high > 4.6', () => {
    const id = 'minimed.calculator.das28-crp';
    const das = (i: Inputs) =>
      0.56 * Math.sqrt(i['tenderJoints'] as number) +
      0.28 * Math.sqrt(i['swollenJoints'] as number) +
      0.36 * ln((i['crp'] as number) + 1) +
      0.014 * (i['patientGlobal'] as number) +
      0.96;
    const base: Inputs = { tenderJoints: 4, swollenJoints: 2, crp: 10, patientGlobal: 50 };
    it('reproduces a hand-calculated example', () => {
      // 1.12 + 0.396 + 0.36·ln 11 (0.863) + 0.7 + 0.96 = 4.039
      expectCases(id, [
        {
          name: '4 tender, 2 swollen, CRP 10, VAS 50',
          inputs: base,
          outputs: { das28: 4.0392 },
          range: 'moderate',
          digits: 3,
        },
        {
          name: 'no joints, CRP 0, VAS 0: the +0.96 constant',
          inputs: { tenderJoints: 0, swollenJoints: 0, crp: 0, patientGlobal: 0 },
          outputs: { das28: 0.96 },
          range: 'remission',
        },
        {
          name: 'maximum joints',
          inputs: { tenderJoints: 28, swollenJoints: 28, crp: 80, patientGlobal: 100 },
          outputs: {
            das28: das({ tenderJoints: 28, swollenJoints: 28, crp: 80, patientGlobal: 100 }),
          },
          range: 'high',
        },
      ]);
    });
    it('uses the CRP thresholds, not the ESR ones, and flips on each side of 2.4, 2.9 and 4.6', () => {
      expect(ruleWhens(id)).toEqual(['das28 < 2.4', 'das28 <= 2.9', 'das28 <= 4.6', '1']);
      const low: Inputs = { tenderJoints: 1, swollenJoints: 0, crp: 3, patientGlobal: 0 };
      const high: Inputs = { tenderJoints: 10, swollenJoints: 6, crp: 20, patientGlobal: 0 };
      expectFlipAt(id, low, 'patientGlobal', [0, 100], das, 2.4, {
        below: 'remission',
        above: 'low',
      });
      expectFlipAt(id, low, 'patientGlobal', [0, 100], das, 2.9, {
        below: 'low',
        above: 'moderate',
      });
      expectFlipAt(id, high, 'patientGlobal', [0, 100], das, 4.6, {
        below: 'moderate',
        above: 'high',
      });
    });
    it('agrees with a direct natural-log implementation over a grid', () => {
      for (const crp of [0, 0.5, 3, 9, 24, 70, 200, 500]) {
        for (const swollenJoints of [0, 2, 9, 28]) {
          const inputs = { tenderJoints: 5, swollenJoints, crp, patientGlobal: 60 };
          expect(run(id, inputs).outputs.get('das28') as number).toBeCloseTo(das(inputs), 8);
        }
      }
    });
  });

  describe('ASDAS (Lukas 2009; states Machado 2011: < 1.3 / < 2.1 / ≤ 3.5 / > 3.5)', () => {
    const crpId = 'minimed.calculator.asdas-crp';
    const esrId = 'minimed.calculator.asdas-esr';
    const common = { backPain: 6, morningStiffness: 5, patientGlobal: 7, peripheralPain: 4 };
    const asdasCrp = (i: Inputs) =>
      0.121 * (i['backPain'] as number) +
      0.058 * (i['morningStiffness'] as number) +
      0.11 * (i['patientGlobal'] as number) +
      0.073 * (i['peripheralPain'] as number) +
      0.579 * ln(Math.max(i['crp'] as number, 2) + 1);
    const asdasEsr = (i: Inputs) =>
      0.113 * (i['patientGlobal'] as number) +
      0.293 * Math.sqrt(i['esr'] as number) +
      0.086 * (i['peripheralPain'] as number) +
      0.069 * (i['backPain'] as number) +
      0.079 * (i['morningStiffness'] as number);
    it('reproduces hand-calculated examples for both versions', () => {
      // CRP: 0.726 + 0.290 + 0.770 + 0.292 + 0.579·ln 13 (1.485) = 3.563
      expectCases(crpId, [
        {
          name: 'CRP 12',
          inputs: { ...common, crp: 12 },
          outputs: { asdas: 3.5631 },
          range: 'very-high',
          digits: 3,
        },
      ]);
      // ESR: 0.791 + 0.293·√36 (1.758) + 0.344 + 0.414 + 0.395 = 3.702
      expectCases(esrId, [
        {
          name: 'ESR 36',
          inputs: { ...common, esr: 36 },
          outputs: { asdas: 3.702 },
          range: 'very-high',
          digits: 3,
        },
      ]);
    });
    it('treats a CRP below 2 mg/L as 2 mg/L', () => {
      const at = (crp: number) => run(crpId, { ...common, crp }).outputs.get('asdas') as number;
      expect(at(0)).toBeCloseTo(at(2), 9);
      expect(at(1.9)).toBeCloseTo(at(2), 9);
      expect(at(2.5)).toBeGreaterThan(at(2));
    });
    it('uses the published inequalities and flips on each side of 1.3, 2.1 and 3.5', () => {
      for (const id of [crpId, esrId]) {
        expect(ruleWhens(id)).toEqual(['asdas < 1.3', 'asdas < 2.1', 'asdas <= 3.5', '1']);
      }
      const cases: readonly [number, Inputs, Inputs, string, string][] = [
        [
          1.3,
          { backPain: 2, morningStiffness: 1, peripheralPain: 1, patientGlobal: 0, crp: 2 },
          { backPain: 2, morningStiffness: 1, peripheralPain: 1, patientGlobal: 0, esr: 4 },
          'inactive',
          'moderate',
        ],
        [
          2.1,
          { backPain: 3, morningStiffness: 2, peripheralPain: 2, patientGlobal: 0, crp: 2 },
          { backPain: 3, morningStiffness: 2, peripheralPain: 2, patientGlobal: 0, esr: 4 },
          'moderate',
          'high',
        ],
        [
          3.5,
          { backPain: 6, morningStiffness: 5, peripheralPain: 4, patientGlobal: 0, crp: 12 },
          { backPain: 6, morningStiffness: 5, peripheralPain: 4, patientGlobal: 0, esr: 36 },
          'high',
          'very-high',
        ],
      ];
      for (const [threshold, crpInputs, esrInputs, below, above] of cases) {
        expectFlipAt(crpId, crpInputs, 'patientGlobal', [0, 10], asdasCrp, threshold, {
          below,
          above,
        });
        expectFlipAt(esrId, esrInputs, 'patientGlobal', [0, 10], asdasEsr, threshold, {
          below,
          above,
        });
      }
    });
  });

  describe('BASDAI (Garrett 1994: Q5 and Q6 averaged; ≥ 4)', () => {
    const id = 'minimed.calculator.basdai';
    const items = (q: readonly number[]): Inputs => ({
      fatigue: q[0] as number,
      spinalPain: q[1] as number,
      jointPain: q[2] as number,
      tenderness: q[3] as number,
      stiffnessSeverity: q[4] as number,
      stiffnessDuration: q[5] as number,
    });
    it('averages the two stiffness questions before adding the other four', () => {
      // (6 + 7 + 5 + 4 + (3 + 5) / 2) / 5 = 5.2
      expectCases(id, [
        {
          name: 'worked example',
          inputs: items([6, 7, 5, 4, 3, 5]),
          outputs: { basdai: 5.2 },
          range: 'at-least-4',
        },
        {
          name: 'all zero',
          inputs: items([0, 0, 0, 0, 0, 0]),
          outputs: { basdai: 0 },
          range: 'below-4',
        },
        {
          name: 'all ten',
          inputs: items([10, 10, 10, 10, 10, 10]),
          outputs: { basdai: 10 },
          range: 'at-least-4',
        },
        {
          name: 'stiffness weighs half each',
          inputs: items([0, 0, 0, 0, 10, 10]),
          outputs: { basdai: 2 },
          range: 'below-4',
        },
      ]);
    });
    it('cuts at exactly 4', () => {
      expect(ruleWhens(id)).toEqual(['basdai < 4', '1']);
      expectCases(id, [
        {
          name: '4',
          inputs: items([4, 4, 4, 4, 4, 4]),
          outputs: { basdai: 4 },
          range: 'at-least-4',
        },
        {
          name: '3.95',
          inputs: items([4, 4, 4, 4, 3.5, 4]),
          outputs: { basdai: 3.95 },
          range: 'below-4',
        },
      ]);
    });
  });

  describe('BASFI (Calin 1994: mean of ten 0–10 items)', () => {
    const id = 'minimed.calculator.basfi';
    const ids = [
      'socks',
      'pickUpPen',
      'highShelf',
      'risingFromChair',
      'risingFromFloor',
      'standing',
      'stairs',
      'lookingBack',
      'physicalActivity',
      'fullDay',
    ];
    it('is the plain mean of the ten items and declares no verdict', () => {
      const ramp = Object.fromEntries(ids.map((key, index) => [key, index]));
      const result = run(id, ramp);
      expect(result.outputs.get('basfi')).toBeCloseTo(4.5, 9);
      expect(result.verdict).toBeUndefined();
      expect(run(id, Object.fromEntries(ids.map((key) => [key, 10]))).outputs.get('basfi')).toBe(
        10,
      );
      expect(run(id, Object.fromEntries(ids.map((key) => [key, 0]))).outputs.get('basfi')).toBe(0);
    });
  });

  describe('SLEDAI-2K (Gladman 2002: 24 descriptors; strata of Cook 2000)', () => {
    const id = 'minimed.calculator.sledai-2k';
    const weights: Record<string, number> = {
      seizure: 8,
      psychosis: 8,
      organicBrainSyndrome: 8,
      visualDisturbance: 8,
      cranialNerve: 8,
      lupusHeadache: 8,
      cerebrovascular: 8,
      vasculitis: 8,
      arthritis: 4,
      myositis: 4,
      urinaryCasts: 4,
      hematuria: 4,
      proteinuria: 4,
      pyuria: 4,
      rash: 2,
      alopecia: 2,
      mucosalUlcers: 2,
      pleurisy: 2,
      pericarditis: 2,
      lowComplement: 2,
      antiDna: 2,
      fever: 1,
      thrombocytopenia: 1,
      leukopenia: 1,
    };
    const none: Inputs = Object.fromEntries(Object.keys(weights).map((key) => [key, 0]));
    it('weights each of the 24 descriptors as published and totals 105', () => {
      expect(Object.keys(weights)).toHaveLength(24);
      for (const [key, weight] of Object.entries(weights)) {
        expect(run(id, { ...none, [key]: 1 }).outputs.get('sledai'), key).toBe(weight);
      }
      const all = Object.fromEntries(Object.keys(weights).map((key) => [key, 1]));
      expectCases(id, [
        { name: 'every descriptor', inputs: all, outputs: { sledai: 105 }, range: 'ge20' },
      ]);
    });
    it('cuts the strata at 0 / 1–5 / 6–10 / 11–19 / 20', () => {
      expect(ruleWhens(id)).toEqual([
        'sledai < 1',
        'sledai <= 5',
        'sledai <= 10',
        'sledai <= 19',
        '1',
      ]);
      expectCases(id, [
        { name: '0', inputs: none, outputs: { sledai: 0 }, range: 'none' },
        { name: '1', inputs: { ...none, fever: 1 }, outputs: { sledai: 1 }, range: '1-5' },
        {
          name: '5',
          inputs: { ...none, fever: 1, arthritis: 1 },
          outputs: { sledai: 5 },
          range: '1-5',
        },
        {
          name: '6',
          inputs: { ...none, rash: 1, arthritis: 1 },
          outputs: { sledai: 6 },
          range: '6-10',
          includes: '2,34',
        },
        {
          name: '10',
          inputs: { ...none, seizure: 1, rash: 1 },
          outputs: { sledai: 10 },
          range: '6-10',
        },
        {
          name: '11',
          inputs: { ...none, seizure: 1, rash: 1, fever: 1 },
          outputs: { sledai: 11 },
          range: '11-19',
          includes: '4,74',
        },
        {
          name: '19',
          inputs: { ...none, seizure: 1, psychosis: 1, rash: 1, fever: 1 },
          outputs: { sledai: 19 },
          range: '11-19',
        },
        {
          name: '20',
          inputs: { ...none, seizure: 1, psychosis: 1, arthritis: 1 },
          outputs: { sledai: 20 },
          range: 'ge20',
          includes: '14,11',
        },
      ]);
    });
  });

  describe('SLICC/ACR damage index (Gladman 1996: 12 systems, maximum 47)', () => {
    const id = 'minimed.calculator.slicc-acr-damage-index';
    const schema = SCHEMAS.find((candidate) => candidate.id === id);
    const allInputs = (pick: (values: number[]) => number): Inputs =>
      Object.fromEntries(
        (schema?.inputs ?? []).map((input) => [
          input.id,
          pick((input.options ?? []).map((option) => Number(option.value))),
        ]),
      );
    const none = allInputs(() => 0);
    it('has 41 items and reaches 47 when every item takes its highest value', () => {
      expect(schema?.inputs).toHaveLength(41);
      expect(run(id, none).outputs.get('damage')).toBe(0);
      expect(
        run(
          id,
          allInputs((values) => Math.max(...values)),
        ).outputs.get('damage'),
      ).toBe(47);
    });
    it('scores the items that count double and end-stage renal disease as published', () => {
      const damage = (extra: Inputs) => run(id, { ...none, ...extra }).outputs.get('damage');
      for (const item of [
        'stroke',
        'myocardialInfarction',
        'significantTissueLoss',
        'bowelInfarction',
        'avascularNecrosis',
        'malignancy',
      ]) {
        expect(damage({ [item]: 1 }), `${item} once`).toBe(1);
        expect(damage({ [item]: 2 }), `${item} more than once`).toBe(2);
      }
      expect(damage({ gfr: 1 })).toBe(1);
      expect(damage({ gfr: 1, proteinuria: 1 })).toBe(2);
      expect(damage({ esrd: 3 })).toBe(3);
      expect(damage({ gfr: 1, proteinuria: 1, esrd: 3 })).toBe(3);
      expect(damage({ cataract: 1, retinalChange: 1 })).toBe(2);
      expect(damage({ pancreaticInsufficiency: 1, tendonRupture: 1 })).toBe(2);
    });
    it('declares no verdict', () => {
      expect(run(id, none).verdict).toBeUndefined();
    });
  });

  describe('ACR/EULAR 2010 RA classification criteria (Aletaha 2010: ≥ 6 of 10)', () => {
    const id = 'minimed.calculator.acr-eular-2010-ra';
    const none: Inputs = { joints: 0, serology: 0, acutePhase: 0, duration: 0 };
    it('scores the joint, serology, acute-phase and duration domains as published', () => {
      for (const [joints, points] of [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [5, 5],
      ] as const) {
        expect(run(id, { ...none, joints }).outputs.get('score'), `joints ${joints}`).toBe(points);
      }
      expect(run(id, { ...none, serology: 2 }).outputs.get('score')).toBe(2);
      expect(run(id, { ...none, serology: 3 }).outputs.get('score')).toBe(3);
      expect(run(id, { ...none, acutePhase: 1 }).outputs.get('score')).toBe(1);
      expect(run(id, { ...none, duration: 1 }).outputs.get('score')).toBe(1);
    });
    it('classifies definite RA at 6 and not at 5', () => {
      expect(ruleWhens(id)).toEqual(['score < 6', '1']);
      expectCases(id, [
        { name: 'nothing', inputs: none, outputs: { score: 0 }, range: 'below-threshold' },
        {
          name: '3 + 2 = 5',
          inputs: { ...none, joints: 3, serology: 2 },
          outputs: { score: 5 },
          range: 'below-threshold',
        },
        {
          name: '3 + 2 + 1 = 6',
          inputs: { ...none, joints: 3, serology: 2, duration: 1 },
          outputs: { score: 6 },
          range: 'definite',
        },
        {
          name: '>10 joints + 1 = 6',
          inputs: { ...none, joints: 5, acutePhase: 1 },
          outputs: { score: 6 },
          range: 'definite',
        },
        {
          name: 'maximum',
          inputs: { joints: 5, serology: 3, acutePhase: 1, duration: 1 },
          outputs: { score: 10 },
          range: 'definite',
        },
      ]);
    });
  });

  describe('EULAR/ACR 2019 SLE classification criteria (Aringer 2019: ANA ≥ 1:80, ≥ 10 points, ≥ 1 clinical)', () => {
    const id = 'minimed.calculator.eular-acr-2019-sle';
    const none: Inputs = {
      ana: 1,
      constitutional: 0,
      hematologic: 0,
      neuropsychiatric: 0,
      mucocutaneous: 0,
      serosal: 0,
      musculoskeletal: 0,
      renal: 0,
      antiphospholipid: 0,
      complement: 0,
      specificAntibodies: 0,
    };
    it('sums the highest weight of each of the ten domains to a maximum of 51', () => {
      const max: Inputs = {
        ana: 1,
        constitutional: 2,
        hematologic: 4,
        neuropsychiatric: 5,
        mucocutaneous: 6,
        serosal: 6,
        musculoskeletal: 6,
        renal: 10,
        antiphospholipid: 2,
        complement: 4,
        specificAntibodies: 6,
      };
      expectCases(id, [{ name: 'maximum', inputs: max, outputs: { score: 51 }, range: 'meets' }]);
    });
    it('needs the ANA entry criterion, a clinical criterion and 10 points', () => {
      expectCases(id, [
        {
          name: 'ANA negative overrides a high score',
          inputs: { ...none, ana: 0, renal: 10 },
          outputs: { score: 10 },
          range: 'ana-negative',
        },
        {
          name: '9 points',
          inputs: { ...none, hematologic: 3, specificAntibodies: 6 },
          outputs: { score: 9 },
          range: 'below-threshold',
        },
        {
          name: '10 points',
          inputs: { ...none, hematologic: 4, specificAntibodies: 6 },
          outputs: { score: 10 },
          range: 'meets',
        },
        {
          name: 'immunology alone reaches 12 but has no clinical criterion',
          inputs: { ...none, antiphospholipid: 2, complement: 4, specificAntibodies: 6 },
          outputs: { score: 12, clinicalDomains: 0 },
          range: 'below-threshold',
        },
        {
          name: 'adding fever supplies the clinical criterion',
          inputs: {
            ...none,
            constitutional: 2,
            antiphospholipid: 2,
            complement: 4,
            specificAntibodies: 6,
          },
          outputs: { score: 14, clinicalDomains: 1 },
          range: 'meets',
        },
        {
          name: 'renal class III/IV alone',
          inputs: { ...none, renal: 10 },
          outputs: { score: 10 },
          range: 'meets',
        },
      ]);
    });
  });

  describe('PASI (Fredriksson 1978: 0.1 / 0.2 / 0.3 / 0.4, area 0–6, signs 0–4, maximum 72)', () => {
    const id = 'minimed.calculator.pasi';
    const none: Inputs = {
      headArea: 0,
      headErythema: 0,
      headInduration: 0,
      headDesquamation: 0,
      armsArea: 0,
      armsErythema: 0,
      armsInduration: 0,
      armsDesquamation: 0,
      trunkArea: 0,
      trunkErythema: 0,
      trunkInduration: 0,
      trunkDesquamation: 0,
      legsArea: 0,
      legsErythema: 0,
      legsInduration: 0,
      legsDesquamation: 0,
    };
    it('reproduces a hand-calculated example and the maximum of 72', () => {
      // head 0.1·3·6 + arms 0.2·2·3 + trunk 0.3·4·7 + legs 0.4·5·7 = 1.8 + 1.2 + 8.4 + 14 = 25.4
      const example: Inputs = {
        ...none,
        headArea: 3,
        headErythema: 2,
        headInduration: 2,
        headDesquamation: 2,
        armsArea: 2,
        armsErythema: 1,
        armsInduration: 1,
        armsDesquamation: 1,
        trunkArea: 4,
        trunkErythema: 3,
        trunkInduration: 2,
        trunkDesquamation: 2,
        legsArea: 5,
        legsErythema: 2,
        legsInduration: 2,
        legsDesquamation: 3,
      };
      expectCases(id, [
        {
          name: 'worked example',
          inputs: example,
          outputs: { pasi: 25.4 },
          range: 'gt10',
          digits: 6,
        },
        { name: 'clear skin', inputs: none, outputs: { pasi: 0 }, range: 'le10' },
        {
          name: 'every region at maximum',
          inputs: Object.fromEntries(
            Object.keys(none).map((key) => [key, key.endsWith('Area') ? 6 : 4]),
          ),
          outputs: { pasi: 72 },
          range: 'gt10',
        },
      ]);
    });
    it('weights the regions and cuts at exactly 10', () => {
      const oneRegion = (region: string): Inputs => ({
        ...none,
        [`${region}Area`]: 1,
        [`${region}Erythema`]: 1,
      });
      expect(run(id, oneRegion('head')).outputs.get('pasi') as number).toBeCloseTo(0.1, 9);
      expect(run(id, oneRegion('arms')).outputs.get('pasi') as number).toBeCloseTo(0.2, 9);
      expect(run(id, oneRegion('trunk')).outputs.get('pasi') as number).toBeCloseTo(0.3, 9);
      expect(run(id, oneRegion('legs')).outputs.get('pasi') as number).toBeCloseTo(0.4, 9);
      expect(ruleWhens(id)).toEqual(['pasi <= 10', '1']);
      const ten: Inputs = {
        ...none,
        legsArea: 5,
        legsErythema: 2,
        legsInduration: 2,
        legsDesquamation: 1,
      };
      expectCases(id, [
        { name: '10.0', inputs: ten, outputs: { pasi: 10 }, range: 'le10' },
        {
          name: '10.1',
          inputs: { ...ten, headArea: 1, headErythema: 1 },
          outputs: { pasi: 10.1 },
          range: 'gt10',
        },
      ]);
    });
  });

  describe('MELD (Kamath 2001; bounds as in the UNOS policy; 3-month mortality Wiesner 2003)', () => {
    const base: Inputs = { bilirubin: 17.1, inr: 1, creatinine: 88.4, dialysis: 0 };
    const reference = (
      bilirubinMg: number,
      inr: number,
      creatinineMg: number,
      dialysis = false,
    ) => {
      const creatinine = dialysis ? 4 : Math.min(Math.max(creatinineMg, 1), 4);
      const raw =
        0.957 * ln(creatinine) +
        0.378 * ln(Math.max(bilirubinMg, 1)) +
        1.12 * ln(Math.max(inr, 1)) +
        0.643;
      return Math.min(40, Math.max(6, Math.round(10 * raw)));
    };
    const bandOf = (meld: number) =>
      meld < 10 ? 'lt10' : meld < 20 ? '10-19' : meld < 30 ? '20-29' : meld < 40 ? '30-39' : 'ge40';

    it('reproduces a hand-calculated example and the minimum of 6', () => {
      // 10 × (0.957·ln 1.2 + 0.378·ln 3 + 1.12·ln 1.5 + 0.643) = 16.87 → 17
      expectCases('minimed.calculator.meld', [
        {
          name: 'bilirubin 3 mg/dL, INR 1.5, creatinine 1.2 mg/dL',
          inputs: { bilirubin: 3 * 17.1, inr: 1.5, creatinine: 1.2 * 88.4, dialysis: 0 },
          outputs: { meld: 17 },
          range: '10-19',
          includes: '6,0%',
        },
        {
          name: 'all values at the floor',
          inputs: base,
          outputs: { meld: 6 },
          range: 'lt10',
          includes: '1,9%',
        },
      ]);
    });

    it('treats values below 1.0 as 1.0 and dialysis as creatinine 4.0 mg/dL', () => {
      expectCases('minimed.calculator.meld', [
        {
          name: 'sub-floor laboratory values',
          inputs: { bilirubin: 5, inr: 0.9, creatinine: 40, dialysis: 0 },
          outputs: { meld: 6 },
          range: 'lt10',
        },
        {
          name: 'dialysis overrides a normal creatinine',
          inputs: { ...base, dialysis: 1 },
          outputs: { meld: reference(1, 1, 4) },
          range: bandOf(reference(1, 1, 4)),
        },
        {
          name: 'creatinine above 4 mg/dL is capped',
          inputs: { ...base, creatinine: 9 * 88.4 },
          outputs: { meld: reference(1, 1, 4) },
          range: bandOf(reference(1, 1, 4)),
        },
      ]);
    });

    it('agrees with a direct natural-log implementation and cuts at 10, 20, 30 and 40', () => {
      const seen = new Set<string>();
      for (const inr of [1, 1.31, 1.32, 1.8, 2.5, 3.2, 4.4, 6, 9]) {
        for (const bili of [1, 2.5, 6, 14, 30, 60]) {
          for (const cr of [0.8, 1.3, 2.2, 3.4, 5]) {
            const { outputs, verdict } = run('minimed.calculator.meld', {
              bilirubin: bili * 17.1,
              inr,
              creatinine: cr * 88.4,
              dialysis: 0,
            });
            const expected = reference(bili, inr, cr);
            expect(outputs.get('meld'), `INR ${inr} bili ${bili} cr ${cr}`).toBe(expected);
            expect(verdict?.rangeId).toBe(bandOf(expected));
            seen.add(bandOf(expected));
          }
        }
      }
      expect([...seen].toSorted()).toEqual(['10-19', '20-29', '30-39', 'ge40', 'lt10']);
    });

    it('lands exactly on each band edge', () => {
      // Scores found by scanning INR with bilirubin 1 mg/dL and creatinine 1 mg/dL.
      expectCases('minimed.calculator.meld', [
        { name: '9', inputs: { ...base, inr: 1.31 }, outputs: { meld: 9 }, range: 'lt10' },
        { name: '10', inputs: { ...base, inr: 1.32 }, outputs: { meld: 10 }, range: '10-19' },
      ]);
    });
  });

  describe('MELD-Na (UNOS 2016: sodium 125–137 mmol/L, applied only when MELD > 11)', () => {
    const id = 'minimed.calculator.meld-na';
    const base: Inputs = {
      bilirubin: 3 * 17.1,
      inr: 1.5,
      creatinine: 1.2 * 88.4,
      dialysis: 0,
      sodium: 137,
    };
    const meldNa = (meld: number, sodium: number) => {
      const na = Math.min(Math.max(sodium, 125), 137);
      return Math.min(
        40,
        meld > 11 ? Math.round(meld + 1.32 * (137 - na) - 0.033 * meld * (137 - na)) : meld,
      );
    };
    it('adds the sodium term to a MELD above 11', () => {
      // MELD 17; Na 130: 17 + 1.32·7 − 0.033·17·7 = 22.313 → 22
      const sodium = (value: number) => run(id, { ...base, sodium: value }).outputs.get('meld');
      expect(sodium(137)).toBe(17);
      expect(sodium(130)).toBe(22);
      expect(sodium(110)).toBe(meldNa(17, 110));
      expect(sodium(125)).toBe(meldNa(17, 125));
      expect(sodium(150)).toBe(17);
      for (let na = 120; na <= 145; na += 1) expect(sodium(na)).toBe(meldNa(17, na));
    });
    it('leaves a MELD of 11 or lower untouched', () => {
      // 10 × (0.643 + 1.12·ln 1.4) = 10.20 → 10 even with sodium 125
      const result = run(id, {
        bilirubin: 17.1,
        inr: 1.4,
        creatinine: 88.4,
        dialysis: 0,
        sodium: 125,
      });
      expect(result.outputs.get('meld')).toBe(10);
      const eleven = run(id, {
        bilirubin: 17.1,
        inr: 1.5,
        creatinine: 88.4,
        dialysis: 0,
        sodium: 125,
      });
      expect(eleven.trace.get('meldBase')).toBe(11);
      expect(eleven.outputs.get('meld')).toBe(11);
    });
    it('is capped at 40 and declares no verdict', () => {
      const result = run(id, {
        bilirubin: 60 * 17.1,
        inr: 9,
        creatinine: 5 * 88.4,
        dialysis: 0,
        sodium: 120,
      });
      expect(result.outputs.get('meld')).toBe(40);
      expect(result.verdict).toBeUndefined();
    });
  });

  describe('MELD 3.0 (Kim 2021: sex, sodium 125–137, albumin 1.5–3.5, creatinine ≤ 3.0)', () => {
    const meld3 = (i: {
      female: number;
      bili: number;
      inr: number;
      cr: number;
      na: number;
      alb: number;
    }) => {
      const bili = Math.max(i.bili, 1);
      const inr = Math.max(i.inr, 1);
      const cr = Math.min(Math.max(i.cr, 1), 3);
      const na = Math.min(Math.max(i.na, 125), 137);
      const alb = Math.min(Math.max(i.alb, 1.5), 3.5);
      return Math.round(
        1.33 * i.female +
          4.56 * ln(bili) +
          0.82 * (137 - na) -
          0.24 * (137 - na) * ln(bili) +
          9.09 * ln(inr) +
          11.14 * ln(cr) +
          1.85 * (3.5 - alb) -
          1.83 * (3.5 - alb) * ln(cr) +
          6,
      );
    };
    const toInputs = (i: Parameters<typeof meld3>[0]): Inputs => ({
      female: i.female,
      bilirubin: i.bili * 17.1,
      inr: i.inr,
      creatinine: i.cr * 88.4,
      sodium: i.na,
      albumin: i.alb * 10,
    });
    it('reproduces a hand-calculated example', () => {
      // 5.010 + 5.740 − 1.846 + 3.686 + 2.031 + 0.925 − 0.167 + 6 = 21.38 → 21
      const example = { female: 0, bili: 3, inr: 1.5, cr: 1.2, na: 130, alb: 3 };
      expect(run('minimed.calculator.meld-3', toInputs(example)).outputs.get('meld3')).toBe(21);
      expect(meld3(example)).toBe(21);
    });
    it('adds 1.33 for women and applies the published bounds', () => {
      const base = { female: 0, bili: 2, inr: 1.4, cr: 1.1, na: 136, alb: 3.4 };
      const cases = [
        base,
        { ...base, female: 1 },
        { ...base, bili: 0.4, inr: 0.8, cr: 0.5 },
        { ...base, cr: 5 },
        { ...base, na: 118 },
        { ...base, na: 142 },
        { ...base, alb: 1.1 },
        { ...base, alb: 4.4 },
        { female: 1, bili: 30, inr: 4, cr: 4, na: 120, alb: 1.2 },
      ];
      for (const input of cases) {
        expect(
          run('minimed.calculator.meld-3', toInputs(input)).outputs.get('meld3'),
          JSON.stringify(input),
        ).toBe(meld3(input));
      }
    });
    it('declares no verdict because the source gives no risk groups', () => {
      expect(
        run(
          'minimed.calculator.meld-3',
          toInputs({ female: 0, bili: 3, inr: 1.5, cr: 1.2, na: 130, alb: 3 }),
        ).verdict,
      ).toBeUndefined();
    });
  });

  describe('CDAI Best (Best 1976: 8 components; Russian КР bands 150 / 300 / 450)', () => {
    const zero: Inputs = {
      liquidStools: 0,
      abdominalPain: 0,
      wellBeing: 0,
      arthritis: 0,
      uveitis: 0,
      skinMucosal: 0,
      analLesion: 0,
      otherFistula: 0,
      fever: 0,
      antidiarrheal: 0,
      abdominalMass: 0,
      hematocritReference: 42,
      hematocrit: 42,
      weight: 70,
      standardWeight: 70,
    };
    it('reproduces a hand-calculated example', () => {
      // 2·21 + 5·7 + 7·7 + 20·2 + 30 + 0 + 6·(42 − 38) + 100·(1 − 60/66) = 229.09 → 229
      expectCases('minimed.calculator.crohn-cdai-best', [
        {
          name: 'woman, 3 loose stools a day, two complications, antidiarrhoeals',
          inputs: {
            ...zero,
            liquidStools: 21,
            abdominalPain: 7,
            wellBeing: 7,
            arthritis: 1,
            fever: 1,
            antidiarrheal: 1,
            hematocrit: 38,
            weight: 60,
            standardWeight: 66,
          },
          outputs: { cdai: 229 },
          range: 'mild',
        },
      ]);
    });
    it('weights every component as published', () => {
      const cdai = (inputs: Inputs) =>
        run('minimed.calculator.crohn-cdai-best', inputs).outputs.get('cdai');
      expect(cdai({ ...zero, liquidStools: 1 })).toBe(2);
      expect(cdai({ ...zero, abdominalPain: 1 })).toBe(5);
      expect(cdai({ ...zero, wellBeing: 1 })).toBe(7);
      for (const flag of [
        'arthritis',
        'uveitis',
        'skinMucosal',
        'analLesion',
        'otherFistula',
        'fever',
      ]) {
        expect(cdai({ ...zero, [flag]: 1 }), flag).toBe(20);
      }
      expect(cdai({ ...zero, antidiarrheal: 1 })).toBe(30);
      expect(cdai({ ...zero, abdominalMass: 2 })).toBe(20);
      expect(cdai({ ...zero, abdominalMass: 5 })).toBe(50);
      expect(cdai({ ...zero, hematocrit: 40 })).toBe(12);
      expect(cdai({ ...zero, hematocritReference: 47, hematocrit: 40 })).toBe(42);
      expect(cdai({ ...zero, hematocritReference: 47, hematocrit: 50 })).toBe(-18);
      expect(cdai({ ...zero, weight: 63 })).toBe(10);
      expect(cdai({ ...zero, weight: 77 })).toBe(-10);
    });
    it('cuts at 150, 300 and 450', () => {
      const withWeightShift = (stools: number, weight: number): Inputs => ({
        ...zero,
        liquidStools: stools,
        weight,
        standardWeight: 100,
      });
      expectCases('minimed.calculator.crohn-cdai-best', [
        {
          name: '148',
          inputs: { ...zero, liquidStools: 74 },
          outputs: { cdai: 148 },
          range: 'remission',
        },
        {
          name: '150',
          inputs: { ...zero, liquidStools: 75 },
          outputs: { cdai: 150 },
          range: 'mild',
        },
        { name: '300', inputs: withWeightShift(150, 100), outputs: { cdai: 300 }, range: 'mild' },
        {
          name: '301',
          inputs: withWeightShift(150, 99),
          outputs: { cdai: 301 },
          range: 'moderate',
        },
        {
          name: '450',
          inputs: withWeightShift(225, 100),
          outputs: { cdai: 450 },
          range: 'moderate',
        },
        { name: '451', inputs: withWeightShift(225, 99), outputs: { cdai: 451 }, range: 'severe' },
      ]);
    });
  });

  describe('Maddrey discriminant function (4.6 × PT difference + bilirubin; severe ≥ 32)', () => {
    it('adds bilirubin in mg/dL to 4.6 times the prothrombin time difference', () => {
      // 4.6·8 + 171/17.1 = 36.8 + 10 = 46.8
      expectCases('minimed.calculator.maddrey-discriminant-function', [
        {
          name: 'worked example',
          inputs: { prothrombinTime: 20, controlTime: 12, bilirubin: 171 },
          outputs: { df: 46.8 },
          range: 'ge32',
        },
        {
          name: 'just below 32',
          inputs: { prothrombinTime: 18, controlTime: 12, bilirubin: 4.3 * 17.1 },
          outputs: { df: 31.9 },
          range: 'below32',
        },
        {
          name: 'just above 32',
          inputs: { prothrombinTime: 18, controlTime: 12, bilirubin: 4.5 * 17.1 },
          outputs: { df: 32.1 },
          range: 'ge32',
        },
        {
          name: 'prothrombin time equal to control',
          inputs: { prothrombinTime: 12, controlTime: 12, bilirubin: 34.2 },
          outputs: { df: 2 },
          range: 'below32',
        },
      ]);
    });
  });

  describe('Lille model (Louvet 2007: responder < 0.45)', () => {
    const lille = (i: Inputs) => {
      const r =
        3.19 -
        0.101 * (i['age'] as number) +
        0.147 * (i['albumin'] as number) +
        0.0165 * ((i['bilirubinDay0'] as number) - (i['bilirubinDay7'] as number)) -
        0.206 * (i['renalInsufficiency'] as number) -
        0.0065 * (i['bilirubinDay0'] as number) -
        0.0096 * (i['prothrombinTime'] as number);
      return Math.exp(-r) / (1 + Math.exp(-r));
    };
    const base: Inputs = {
      age: 50,
      albumin: 25,
      bilirubinDay0: 300,
      bilirubinDay7: 250,
      prothrombinTime: 25,
      renalInsufficiency: 0,
    };
    it('reproduces the published equation for responders and non-responders', () => {
      // R = 3.19 − 5.05 + 3.675 + 0.825 − 1.95 − 0.24 = 0.45 → 0.389
      expectCases('minimed.calculator.lille-model', [
        {
          name: 'bilirubin fell',
          inputs: base,
          outputs: { lille: 0.3894 },
          range: 'responder',
          digits: 3,
          includes: '85%',
        },
        {
          name: 'bilirubin rose',
          inputs: { ...base, bilirubinDay7: 350 },
          outputs: { lille: 0.7685 },
          range: 'nonresponder',
          digits: 3,
          includes: '25%',
        },
        {
          name: 'renal insufficiency raises the score',
          inputs: { ...base, renalInsufficiency: 1 },
          outputs: { lille: lille({ ...base, renalInsufficiency: 1 }) },
          range: 'responder',
        },
      ]);
    });
    it('switches to non-response exactly at 0.45', () => {
      for (let albumin = 10; albumin <= 40; albumin += 0.5) {
        const inputs = { ...base, albumin };
        const expected = lille(inputs);
        const { outputs, verdict } = run('minimed.calculator.lille-model', inputs);
        expect(outputs.get('lille') as number).toBeCloseTo(expected, 9);
        expect(verdict?.rangeId, `albumin ${albumin}`).toBe(
          expected < 0.45 ? 'responder' : 'nonresponder',
        );
      }
    });
  });

  describe('NAFLD fibrosis score (Angulo 2007: < −1.455 / ≤ 0.676 / > 0.676)', () => {
    const base: Inputs = {
      age: 50,
      bmi: 30,
      hyperglycemia: 1,
      ast: 40,
      alt: 40,
      platelets: 200,
      albumin: 40,
    };
    const score = (i: Inputs) =>
      -1.675 +
      0.037 * (i['age'] as number) +
      0.094 * (i['bmi'] as number) +
      1.13 * (i['hyperglycemia'] as number) +
      (0.99 * (i['ast'] as number)) / (i['alt'] as number) -
      0.013 * (i['platelets'] as number) -
      (0.66 * (i['albumin'] as number)) / 10;
    it('reproduces the published equation with albumin converted from g/L to g/dL', () => {
      // −1.675 + 1.85 + 2.82 + 1.13 + 0.99 − 2.6 − 2.64 = −0.125
      expectCases('minimed.calculator.nafld-fibrosis-score', [
        { name: 'worked example', inputs: base, outputs: { nfs: -0.125 }, range: 'indeterminate' },
        {
          name: 'young, thin, normoglycaemic, high platelets',
          inputs: {
            age: 35,
            bmi: 22,
            hyperglycemia: 0,
            ast: 20,
            alt: 40,
            platelets: 300,
            albumin: 45,
          },
          outputs: {
            nfs: score({
              age: 35,
              bmi: 22,
              hyperglycemia: 0,
              ast: 20,
              alt: 40,
              platelets: 300,
              albumin: 45,
            }),
          },
          range: 'low',
        },
        {
          name: 'older, obese, diabetic, low platelets',
          inputs: {
            age: 68,
            bmi: 36,
            hyperglycemia: 1,
            ast: 90,
            alt: 50,
            platelets: 110,
            albumin: 36,
          },
          outputs: {
            nfs: score({
              age: 68,
              bmi: 36,
              hyperglycemia: 1,
              ast: 90,
              alt: 50,
              platelets: 110,
              albumin: 36,
            }),
          },
          range: 'high',
        },
      ]);
    });
    it('cuts at −1.455 and 0.676 with the edge values in the middle band', () => {
      for (const [threshold, below, above] of [
        [-1.455, 'low', 'indeterminate'],
        [0.676, 'indeterminate', 'high'],
      ] as const) {
        // Platelets move the score by −0.013 per unit; find the count that lands on the threshold.
        const platelets = (score({ ...base, platelets: 0 }) - threshold) / 0.013;
        expect(
          run('minimed.calculator.nafld-fibrosis-score', { ...base, platelets: platelets + 0.05 })
            .verdict?.rangeId,
        ).toBe(below);
        expect(
          run('minimed.calculator.nafld-fibrosis-score', { ...base, platelets: platelets - 0.05 })
            .verdict?.rangeId,
        ).toBe(above);
      }
    });
  });

  describe('I-PSS (Barry 1992: 7 items 0–5; 0–7 / 8–19 / 20–35; quality of life 0–6)', () => {
    const zero: Inputs = {
      incompleteEmptying: 0,
      frequency: 0,
      intermittency: 0,
      urgency: 0,
      weakStream: 0,
      straining: 0,
      nocturia: 0,
      qualityOfLife: 0,
    };
    it('sums the seven items and keeps the quality-of-life item separate', () => {
      expectCases('minimed.calculator.ipss-prostate-symptoms', [
        {
          name: 'no symptoms',
          inputs: zero,
          outputs: { ipssScore: 0, qolIndex: 0 },
          range: 'mild',
        },
        {
          name: 'seven points',
          inputs: { ...zero, incompleteEmptying: 5, nocturia: 2, qualityOfLife: 3 },
          outputs: { ipssScore: 7, qolIndex: 3 },
          range: 'mild',
        },
        {
          name: 'eight points',
          inputs: { ...zero, incompleteEmptying: 5, nocturia: 3, qualityOfLife: 6 },
          outputs: { ipssScore: 8, qolIndex: 6 },
          range: 'moderate',
        },
        {
          name: 'nineteen points',
          inputs: { ...zero, incompleteEmptying: 5, frequency: 5, intermittency: 5, urgency: 4 },
          outputs: { ipssScore: 19, qolIndex: 0 },
          range: 'moderate',
        },
        {
          name: 'twenty points',
          inputs: { ...zero, incompleteEmptying: 5, frequency: 5, intermittency: 5, urgency: 5 },
          outputs: { ipssScore: 20, qolIndex: 0 },
          range: 'severe',
        },
        {
          name: 'maximum',
          inputs: {
            incompleteEmptying: 5,
            frequency: 5,
            intermittency: 5,
            urgency: 5,
            weakStream: 5,
            straining: 5,
            nocturia: 5,
            qualityOfLife: 6,
          },
          outputs: { ipssScore: 35, qolIndex: 6 },
          range: 'severe',
        },
      ]);
    });
  });

  describe('R.E.N.A.L. nephrometry score (Kutikov 2009: 4–6 / 7–9 / 10–12)', () => {
    const base: Inputs = { tumorSize: 3, exophytic: 1, nearness: 10, location: 1 };
    it('scores size at ≤4, >4 to <7 and ≥7 cm', () => {
      expectCases('minimed.calculator.renal-nephrometry', [
        {
          name: '4 cm',
          inputs: { ...base, tumorSize: 4 },
          outputs: { radiusPoints: 1, renalScore: 4 },
          range: 'low',
        },
        {
          name: '4.1 cm',
          inputs: { ...base, tumorSize: 4.1 },
          outputs: { radiusPoints: 2, renalScore: 5 },
          range: 'low',
        },
        {
          name: '6.9 cm',
          inputs: { ...base, tumorSize: 6.9 },
          outputs: { radiusPoints: 2, renalScore: 5 },
          range: 'low',
        },
        {
          name: '7 cm',
          inputs: { ...base, tumorSize: 7 },
          outputs: { radiusPoints: 3, renalScore: 6 },
          range: 'low',
        },
      ]);
    });
    it('scores nearness at ≥7, >4 to <7 and ≤4 mm', () => {
      expectCases('minimed.calculator.renal-nephrometry', [
        {
          name: '7 mm',
          inputs: { ...base, nearness: 7 },
          outputs: { nearnessPoints: 1, renalScore: 4 },
          range: 'low',
        },
        {
          name: '6.9 mm',
          inputs: { ...base, nearness: 6.9 },
          outputs: { nearnessPoints: 2, renalScore: 5 },
          range: 'low',
        },
        {
          name: '4.1 mm',
          inputs: { ...base, nearness: 4.1 },
          outputs: { nearnessPoints: 2, renalScore: 5 },
          range: 'low',
        },
        {
          name: '4 mm',
          inputs: { ...base, nearness: 4 },
          outputs: { nearnessPoints: 3, renalScore: 6 },
          range: 'low',
        },
        {
          name: 'in the sinus',
          inputs: { ...base, nearness: 0 },
          outputs: { nearnessPoints: 3, renalScore: 6 },
          range: 'low',
        },
      ]);
    });
    it('cuts the total at 6/7 and 9/10', () => {
      expectCases('minimed.calculator.renal-nephrometry', [
        { name: 'minimum', inputs: base, outputs: { renalScore: 4 }, range: 'low' },
        {
          name: 'seven',
          inputs: { tumorSize: 5, exophytic: 2, nearness: 5, location: 1 },
          outputs: { renalScore: 7 },
          range: 'moderate',
        },
        {
          name: 'nine',
          inputs: { tumorSize: 5, exophytic: 3, nearness: 5, location: 2 },
          outputs: { renalScore: 9 },
          range: 'moderate',
        },
        {
          name: 'ten',
          inputs: { tumorSize: 8, exophytic: 1, nearness: 2, location: 3 },
          outputs: { renalScore: 10 },
          range: 'high',
        },
        {
          name: 'maximum',
          inputs: { tumorSize: 9, exophytic: 3, nearness: 1, location: 3 },
          outputs: { renalScore: 12 },
          range: 'high',
        },
      ]);
    });
  });

  describe('Prostate volume (Terris and Stamey 1991: ellipsoid π/6 × a × b × c)', () => {
    it('returns the ellipsoid volume in millilitres and declares no verdict', () => {
      for (const [a, b, c, volume] of [
        [40, 30, 35, 21.99],
        [50, 40, 45, 47.12],
        [30, 25, 28, 11.0],
      ] as const) {
        const result = run('minimed.calculator.prostate-volume-ellipsoid', {
          transverse: a,
          anteroposterior: b,
          craniocaudal: c,
        });
        expect(result.outputs.get('volume') as number).toBeCloseTo(volume, 2);
        expect(result.verdict).toBeUndefined();
      }
    });
    it('rejects an implausible dimension', () => {
      expect(
        rejects('minimed.calculator.prostate-volume-ellipsoid', {
          transverse: 400,
          anteroposterior: 30,
          craniocaudal: 30,
        }),
      ).toContain('максимум');
    });
  });

  describe('RECIST 1.1 (Eisenhauer 2009: CR / PR −30% / PD +20% and 5 mm / SD)', () => {
    const base: Inputs = {
      baselineSum: 100,
      nadirSum: 100,
      currentSum: 100,
      targetsGone: 0,
      nonTarget: 0,
      newLesions: 0,
    };
    it('classifies the target lesions by the change from baseline and from nadir', () => {
      expectCases('minimed.calculator.recist-11-response', [
        {
          name: 'unchanged: SD',
          inputs: base,
          outputs: { changeFromBaseline: 0, changeFromNadir: 0 },
          range: 'sd',
        },
        {
          name: '−30% exactly: PR',
          inputs: { ...base, nadirSum: 70, currentSum: 70 },
          outputs: { changeFromBaseline: -30 },
          range: 'pr',
        },
        {
          name: '−29%: SD',
          inputs: { ...base, nadirSum: 71, currentSum: 71 },
          outputs: { changeFromBaseline: -29 },
          range: 'sd',
        },
        {
          name: '+20% and 20 mm over nadir: PD',
          inputs: { ...base, nadirSum: 100, currentSum: 120 },
          outputs: { changeFromNadir: 20 },
          range: 'pd',
        },
        {
          name: '+19% over nadir: SD',
          inputs: { ...base, nadirSum: 100, currentSum: 119 },
          outputs: { changeFromNadir: 19 },
          range: 'sd',
        },
        {
          name: 'responding then progressing from the nadir: PD despite −40% from baseline',
          inputs: { ...base, nadirSum: 50, currentSum: 60 },
          outputs: { changeFromBaseline: -40, changeFromNadir: 20 },
          range: 'pd',
        },
      ]);
    });
    it('needs an absolute increase of 5 mm as well as 20%', () => {
      const small: Inputs = { ...base, baselineSum: 14, nadirSum: 10, currentSum: 14 };
      expectCases('minimed.calculator.recist-11-response', [
        {
          name: '+40% but +4 mm: SD',
          inputs: small,
          outputs: { changeFromNadir: 40 },
          range: 'sd',
        },
        {
          name: '+50% and +5 mm: PD',
          inputs: { ...small, currentSum: 15 },
          outputs: { changeFromNadir: 50 },
          range: 'pd',
        },
      ]);
    });
    it('follows the overall response table for non-target and new lesions', () => {
      const cr: Inputs = { ...base, targetsGone: 1, nadirSum: 8, currentSum: 8 };
      expectCases('minimed.calculator.recist-11-response', [
        { name: 'CR + CR + no new: CR', inputs: cr, outputs: {}, range: 'cr' },
        {
          name: 'CR + non-CR/non-PD: PR',
          inputs: { ...cr, nonTarget: 1 },
          outputs: {},
          range: 'pr',
        },
        {
          name: 'CR + not evaluated: PR',
          inputs: { ...cr, nonTarget: 2 },
          outputs: {},
          range: 'pr',
        },
        {
          name: 'PR + non-PD: PR',
          inputs: { ...base, nadirSum: 60, currentSum: 60, nonTarget: 1 },
          outputs: {},
          range: 'pr',
        },
        {
          name: 'SD + not evaluated: SD',
          inputs: { ...base, nonTarget: 2 },
          outputs: {},
          range: 'sd',
        },
        {
          name: 'any response + unequivocal non-target progression: PD',
          inputs: { ...cr, nonTarget: 3 },
          outputs: {},
          range: 'pd',
        },
        {
          name: 'PR + new lesion: PD',
          inputs: { ...base, nadirSum: 60, currentSum: 60, newLesions: 1 },
          outputs: {},
          range: 'pd',
        },
        { name: 'CR + new lesion: PD', inputs: { ...cr, newLesions: 1 }, outputs: {}, range: 'pd' },
      ]);
      expect(run('minimed.calculator.recist-11-response', cr).outputs.get('overallResponse')).toBe(
        'Полный ответ (CR)',
      );
      expect(
        run('minimed.calculator.recist-11-response', { ...base, newLesions: 1 }).outputs.get(
          'overallResponse',
        ),
      ).toBe('Прогрессирование (PD)');
    });
    it('rejects a nadir larger than the baseline sum', () => {
      expect(
        rejects('minimed.calculator.recist-11-response', { ...base, nadirSum: 120 }),
      ).toContain('Надир');
    });
  });

  describe('Galsky criteria for cisplatin ineligibility (Galsky 2011: any one criterion)', () => {
    const fit: Inputs = {
      ecog: 0,
      creatinineClearance: 90,
      hearingLoss: 0,
      neuropathy: 0,
      heartFailure: 0,
    };
    it('is fit with no criterion and unfit with any single one', () => {
      expectCases('minimed.calculator.galsky-cisplatin-unfit', [
        { name: 'none', inputs: fit, outputs: { criteriaMet: 0 }, range: 'fit' },
        {
          name: 'ECOG 2',
          inputs: { ...fit, ecog: 1 },
          outputs: { criteriaMet: 1 },
          range: 'unfit',
        },
        {
          name: 'hearing loss',
          inputs: { ...fit, hearingLoss: 1 },
          outputs: { criteriaMet: 1 },
          range: 'unfit',
        },
        {
          name: 'neuropathy',
          inputs: { ...fit, neuropathy: 1 },
          outputs: { criteriaMet: 1 },
          range: 'unfit',
        },
        {
          name: 'NYHA III',
          inputs: { ...fit, heartFailure: 1 },
          outputs: { criteriaMet: 1 },
          range: 'unfit',
        },
        {
          name: 'all five',
          inputs: {
            ecog: 1,
            creatinineClearance: 30,
            hearingLoss: 1,
            neuropathy: 1,
            heartFailure: 1,
          },
          outputs: { criteriaMet: 5 },
          range: 'unfit',
        },
      ]);
    });
    it('counts a creatinine clearance below 60 mL/min but not 60', () => {
      expectCases('minimed.calculator.galsky-cisplatin-unfit', [
        {
          name: '60',
          inputs: { ...fit, creatinineClearance: 60 },
          outputs: { criteriaMet: 0 },
          range: 'fit',
        },
        {
          name: '59',
          inputs: { ...fit, creatinineClearance: 59 },
          outputs: { criteriaMet: 1 },
          range: 'unfit',
        },
      ]);
    });
  });

  describe('Carboplatin dose (Calvert 1989: AUC × (GFR + 25), Cockcroft–Gault GFR)', () => {
    const base: Inputs = {
      targetAuc: 5,
      age: 60,
      weight: 70,
      sexFactor: 1,
      creatinine: 88.4,
      capGfr: 0,
    };
    it('reproduces hand-calculated doses for a man and a woman', () => {
      // (140 − 60) × 70 / (72 × 1.0) = 77.78 mL/min; 5 × 102.78 = 513.9 mg
      // (140 − 60) × 60 × 0.85 / 72 = 56.67 mL/min; 5 × 81.67 = 408.3 mg
      expect(
        run('minimed.calculator.carboplatin-calvert-dose', base).outputs.get('dose') as number,
      ).toBeCloseTo(513.89, 1);
      const woman = run('minimed.calculator.carboplatin-calvert-dose', {
        ...base,
        weight: 60,
        sexFactor: 0.85,
      });
      expect(woman.outputs.get('gfrUsed') as number).toBeCloseTo(56.667, 2);
      expect(woman.outputs.get('dose') as number).toBeCloseTo(408.33, 1);
    });
    it('caps the GFR at 125 mL/min only when asked', () => {
      const high: Inputs = { ...base, age: 30, weight: 100, creatinine: 0.8 * 88.4, targetAuc: 6 };
      // (140 − 30) × 100 / (72 × 0.8) = 190.97 mL/min
      const uncapped = run('minimed.calculator.carboplatin-calvert-dose', high);
      expect(uncapped.outputs.get('gfrUsed') as number).toBeCloseTo(190.97, 1);
      expect(uncapped.outputs.get('dose') as number).toBeCloseTo(6 * (190.97 + 25), 0);
      const capped = run('minimed.calculator.carboplatin-calvert-dose', { ...high, capGfr: 1 });
      expect(capped.outputs.get('gfrUsed')).toBe(125);
      expect(capped.outputs.get('dose')).toBe(900);
    });
    it('declares no verdict', () => {
      expect(run('minimed.calculator.carboplatin-calvert-dose', base).verdict).toBeUndefined();
    });
  });
  describe('assessments in the gastroenterology section', () => {
    const definitions = new Map(
      loadToolModuleRecords([MODULE_FILE])
        .filter((record) => record.kind === 'assessment')
        .map((record) => [record.id, assessmentDefinitionFromRecord(record)] as const),
    );
    const score = (id: string, answers: readonly number[]) => {
      const definition = definitions.get(id);
      if (!definition) throw new Error(`Missing assessment ${id}`);
      const result = scoreAssessment(
        definition,
        Object.fromEntries(
          definition.questions.map((question, index) => [question.id, answers[index] ?? 0]),
        ),
      );
      if (!result.ok) throw new Error(result.error);
      return {
        total: result.value.scores[0]?.rawScore,
        range: result.value.evaluation?.verdict?.rangeId,
        headline: result.value.headline,
      };
    };

    it('full Mayo score: four components 0–3, bands 0–2 / 3–5 / 6–9 / 10–12 (Russian КР)', () => {
      const id = 'minimed.assessment.mayo-score-ulcerative-colitis';
      expect(score(id, [0, 0, 0, 0])).toMatchObject({ total: 0, range: 'remission' });
      expect(score(id, [1, 0, 1, 0])).toMatchObject({ total: 2, range: 'remission' });
      expect(score(id, [1, 1, 1, 0])).toMatchObject({ total: 3, range: 'mild' });
      expect(score(id, [2, 1, 1, 1])).toMatchObject({ total: 5, range: 'mild' });
      expect(score(id, [2, 1, 2, 1])).toMatchObject({ total: 6, range: 'moderate' });
      expect(score(id, [3, 2, 2, 2])).toMatchObject({ total: 9, range: 'moderate' });
      expect(score(id, [3, 3, 2, 2])).toMatchObject({ total: 10, range: 'severe' });
      expect(score(id, [3, 3, 3, 3])).toMatchObject({ total: 12, range: 'severe' });
      expect(score(id, [3, 3, 3, 3]).headline).toContain('Mayo 10–12');
    });

    it('Eckardt score: four symptoms 0–3, remission up to 3 and persistent symptoms from 4', () => {
      const id = 'minimed.assessment.eckardt-achalasia-score';
      expect(score(id, [0, 0, 0, 0])).toMatchObject({ total: 0, range: 'remission' });
      expect(score(id, [1, 1, 1, 0])).toMatchObject({ total: 3, range: 'remission' });
      expect(score(id, [1, 1, 1, 1])).toMatchObject({ total: 4, range: 'persistent' });
      expect(score(id, [3, 3, 3, 3])).toMatchObject({ total: 12, range: 'persistent' });
      expect(score(id, [3, 0, 0, 3])).toMatchObject({ total: 6, range: 'persistent' });
    });

    it('rejects an incomplete or out-of-range questionnaire', () => {
      const definition = definitions.get('minimed.assessment.eckardt-achalasia-score');
      if (!definition) throw new Error('Missing Eckardt');
      expect(scoreAssessment(definition, {}).ok).toBe(false);
      const answers = Object.fromEntries(definition.questions.map((question) => [question.id, 4]));
      expect(scoreAssessment(definition, answers).ok).toBe(false);
    });
  });
});
