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

const MODULE_FILE = 'content/tool-modules/intensive-care.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number>;
type Edge = readonly [value: number, expected: number];

const ids = (key: string) => `minimed.calculator.${key}`;

function evaluate(key: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === ids(key));
  if (!schema) throw new Error(`Missing calculator ${key}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${key}: ${result.error}`);
  return result;
}

/** Value of one calculation step (any step, not only the output). */
function stepValue(key: string, inputs: Inputs, stepId: string): number {
  const entry = evaluate(key, inputs).trace.find((item) => item.id === stepId);
  if (!entry) throw new Error(`${key}: no step ${stepId}`);
  return entry.value;
}

function output(key: string, inputs: Inputs, outputId = 'score'): number {
  const found = evaluate(key, inputs).outputs.find((item) => item.id === outputId);
  if (found?.kind !== 'number') throw new Error(`${key}: no numeric output ${outputId}`);
  return found.value;
}

function band(key: string, inputs: Inputs) {
  const result = evaluate(key, inputs);
  const interpretation = result.warnings.find((warning) => warning.code === 'interpretation');
  return { rangeId: result.evaluation.verdict?.rangeId, text: interpretation?.message };
}

function failure(key: string, inputs: Inputs): string {
  const schema = SCHEMAS.find((candidate) => candidate.id === ids(key));
  if (!schema) throw new Error(`Missing calculator ${key}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (result.ok) throw new Error(`${key}: expected a failure`);
  return result.error;
}

/** Sweeps one input across cut-points (each pair: input value, expected points of one step). */
function expectEdges(
  key: string,
  base: Inputs,
  inputId: string,
  stepId: string,
  edges: readonly Edge[],
  extra: Inputs = {},
): void {
  for (const [value, expected] of edges) {
    const inputs = { ...base, ...extra, [inputId]: value };
    expect(stepValue(key, inputs, stepId), `${key}: ${inputId}=${value} → ${stepId}`).toBe(
      expected,
    );
  }
}

describe('intensive care tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      id: string;
      tools: readonly unknown[];
    };
    expect(source.id).toBe('minimed.tools.intensive-care.ru');
    expect(source.tools).toHaveLength(19);
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.category).toBe('intensive-care');
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        expect(link.url).toMatch(/^https:\/\//u);
        if (link.url?.includes('pubmed')) expect(link.url).toMatch(/\/\d+\/$/u);
      }
      registerDownloadedCalculator(record);
    }
    const registered = getCalculatorRegistry().filter(
      (calculator) =>
        calculator.category === 'intensive-care' &&
        getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered).toHaveLength(19);
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const schema of SCHEMAS) {
      if (schema.evaluation.status === 'verdict') {
        expect(
          schema.evaluation.rules.map((rule) => rule.when),
          schema.id,
        ).toEqual(schema.interpretations.map((interpretation) => interpretation.when));
        expect(
          schema.evaluation.rules.map((rule) => rule.verdict.explanation),
          schema.id,
        ).toEqual(schema.interpretations.map((interpretation) => interpretation.message));
      } else {
        expect(schema.evaluation.status, schema.id).toBe('not-applicable');
        expect(schema.evaluation.reason, schema.id).toBeTruthy();
      }
    }
    const unbanded = SCHEMAS.filter((schema) => schema.evaluation.status !== 'verdict').map(
      (schema) => schema.id,
    );
    expect(unbanded.sort()).toEqual(
      [ids('saps-ii'), ids('mpm-ii-admission'), ids('mpm-ii-24-48-72')].sort(),
    );
  });

  // ---------------------------------------------------------------- SOFA
  describe('SOFA (Vincent 1996 / Sepsis-3 Table 1: six systems, 0–4)', () => {
    const base: Inputs = {
      pao2fio2: 450,
      respiratorySupport: 0,
      platelets: 200,
      bilirubin: 10,
      cardiovascular: 0,
      gcs: 15,
      creatinine: 80,
    };
    it('scores a normal patient as 0', () => {
      expect(output('sofa', base)).toBe(0);
    });
    it('cuts respiration at 400, 300, and 200/100 only with respiratory support', () => {
      expectEdges('sofa', base, 'pao2fio2', 'respiration', [
        [400, 0],
        [399, 1],
        [300, 1],
        [299, 2],
        [100, 2],
        [99, 2],
      ]);
      expectEdges(
        'sofa',
        base,
        'pao2fio2',
        'respiration',
        [
          [299, 2],
          [200, 2],
          [199, 3],
          [100, 3],
          [99, 4],
        ],
        { respiratorySupport: 1 },
      );
    });
    it('cuts platelets, bilirubin, GCS and creatinine at the published limits', () => {
      expectEdges('sofa', base, 'platelets', 'coagulation', [
        [150, 0],
        [149, 1],
        [100, 1],
        [99, 2],
        [50, 2],
        [49, 3],
        [20, 3],
        [19, 4],
      ]);
      expectEdges('sofa', base, 'bilirubin', 'liver', [
        [19, 0],
        [20, 1],
        [32, 1],
        [33, 2],
        [101, 2],
        [102, 3],
        [204, 3],
        [205, 4],
      ]);
      expectEdges('sofa', base, 'gcs', 'nervousSystem', [
        [15, 0],
        [14, 1],
        [13, 1],
        [12, 2],
        [10, 2],
        [9, 3],
        [6, 3],
        [5, 4],
      ]);
      expectEdges('sofa', base, 'creatinine', 'renal', [
        [109, 0],
        [110, 1],
        [170, 1],
        [171, 2],
        [299, 2],
        [300, 3],
        [440, 3],
        [441, 4],
      ]);
    });
    it('takes the worse of creatinine and urine output', () => {
      expectEdges('sofa', base, 'urineOutput', 'renal', [
        [500, 0],
        [499, 3],
        [200, 3],
        [199, 4],
      ]);
      expect(stepValue('sofa', { ...base, creatinine: 441, urineOutput: 400 }, 'renal')).toBe(4);
    });
    it('takes the circulation score from the vasopressor tier', () => {
      for (const tier of [0, 1, 2, 3, 4]) {
        expect(stepValue('sofa', { ...base, cardiovascular: tier }, 'circulation')).toBe(tier);
      }
    });
    it('sums a worked example and applies the Sepsis-3 and Ferreira bands', () => {
      const severe: Inputs = {
        pao2fio2: 150,
        respiratorySupport: 1,
        platelets: 45,
        bilirubin: 110,
        cardiovascular: 4,
        gcs: 8,
        creatinine: 320,
      };
      // 3 + 3 + 3 + 4 + 3 + 3
      expect(output('sofa', severe)).toBe(19);
      expect(band('sofa', severe).rangeId).toBe('very-high');
      expect(band('sofa', { ...base, platelets: 140 })).toMatchObject({
        rangeId: 'below-threshold',
      });
      expect(output('sofa', { ...base, platelets: 140 })).toBe(1);
      expect(band('sofa', { ...base, platelets: 90 }).rangeId).toBe('organ-dysfunction');
      // 4 + 4 + 3 = 11: still the organ-dysfunction band; one more point crosses ">11"
      const eleven = { ...base, pao2fio2: 90, respiratorySupport: 1, platelets: 15, gcs: 8 };
      expect(output('sofa', eleven)).toBe(11);
      expect(band('sofa', eleven).rangeId).toBe('organ-dysfunction');
      const twelve = { ...eleven, bilirubin: 25 };
      expect(output('sofa', twelve)).toBe(12);
      expect(band('sofa', twelve).rangeId).toBe('very-high');
    });
  });

  // ---------------------------------------------------------------- qSOFA
  describe('qSOFA (Seymour 2016: RR ≥22, SBP ≤100, altered mentation; ≥2 high risk)', () => {
    const base: Inputs = { respiratoryRate: 16, systolicBp: 120, alteredMentation: 0 };
    it('cuts at RR 22 and SBP 100', () => {
      expectEdges('qsofa', base, 'respiratoryRate', 'breathingPoint', [
        [21, 0],
        [22, 1],
      ]);
      expectEdges('qsofa', base, 'systolicBp', 'pressurePoint', [
        [101, 0],
        [100, 1],
      ]);
    });
    it('flags two or more criteria', () => {
      expect(band('qsofa', base).rangeId).toBe('lower-risk');
      expect(band('qsofa', { ...base, alteredMentation: 1 })).toMatchObject({
        rangeId: 'lower-risk',
      });
      expect(output('qsofa', { ...base, alteredMentation: 1 })).toBe(1);
      const two = { respiratoryRate: 22, systolicBp: 100, alteredMentation: 0 };
      expect(output('qsofa', two)).toBe(2);
      expect(band('qsofa', two).rangeId).toBe('higher-risk');
      expect(output('qsofa', { respiratoryRate: 30, systolicBp: 80, alteredMentation: 1 })).toBe(3);
    });
  });

  // ---------------------------------------------------------------- SIRS
  describe('SIRS (Bone 1992: T >38 / <36, HR >90, RR >20 or PaCO2 <32, WBC >12 / <4 or >10 % bands)', () => {
    const base: Inputs = {
      temperature: 37,
      heartRate: 80,
      respiratoryRate: 16,
      wbc: 8,
      immatureForms: 0,
    };
    it('cuts every criterion strictly', () => {
      expectEdges('sirs', base, 'temperature', 'temperaturePoint', [
        [38, 0],
        [38.1, 1],
        [36, 0],
        [35.9, 1],
      ]);
      expectEdges('sirs', base, 'heartRate', 'heartRatePoint', [
        [90, 0],
        [91, 1],
      ]);
      expectEdges('sirs', base, 'respiratoryRate', 'breathingPoint', [
        [20, 0],
        [21, 1],
      ]);
      expectEdges('sirs', base, 'paco2', 'breathingPoint', [
        [32, 0],
        [31, 1],
      ]);
      expectEdges('sirs', base, 'wbc', 'bloodPoint', [
        [12, 0],
        [12.1, 1],
        [4, 0],
        [3.9, 1],
      ]);
      expectEdges('sirs', base, 'immatureForms', 'bloodPoint', [
        [0, 0],
        [1, 1],
      ]);
    });
    it('needs two criteria and never double-counts the respiratory criterion', () => {
      expect(output('sirs', base)).toBe(0);
      expect(band('sirs', base).rangeId).toBe('not-met');
      expect(output('sirs', { ...base, temperature: 39 })).toBe(1);
      expect(band('sirs', { ...base, temperature: 39 }).rangeId).toBe('not-met');
      const two = { ...base, temperature: 39, heartRate: 100 };
      expect(output('sirs', two)).toBe(2);
      expect(band('sirs', two).rangeId).toBe('met');
      const all = {
        temperature: 39,
        heartRate: 120,
        respiratoryRate: 30,
        paco2: 25,
        wbc: 15,
        immatureForms: 1,
      };
      expect(output('sirs', all)).toBe(4);
    });
  });

  // ---------------------------------------------------------------- NEWS2
  describe('NEWS2 (RCP 2017: 0–4 low, 5–6 medium, ≥7 high, single 3 urgent)', () => {
    const base: Inputs = {
      respiratoryRate: 16,
      spo2Scale: 1,
      spo2: 98,
      onOxygen: 0,
      systolicBp: 130,
      pulse: 70,
      consciousness: 0,
      temperature: 37,
    };
    it('scores a normal patient as 0', () => {
      expect(output('news2', base)).toBe(0);
      expect(band('news2', base).rangeId).toBe('low');
    });
    it('cuts respiration, systolic pressure, pulse and temperature at the chart limits', () => {
      expectEdges('news2', base, 'respiratoryRate', 'breathing', [
        [8, 3],
        [9, 1],
        [11, 1],
        [12, 0],
        [20, 0],
        [21, 2],
        [24, 2],
        [25, 3],
      ]);
      expectEdges('news2', base, 'systolicBp', 'pressure', [
        [90, 3],
        [91, 2],
        [100, 2],
        [101, 1],
        [110, 1],
        [111, 0],
        [219, 0],
        [220, 3],
      ]);
      expectEdges('news2', base, 'pulse', 'heart', [
        [40, 3],
        [41, 1],
        [50, 1],
        [51, 0],
        [90, 0],
        [91, 1],
        [110, 1],
        [111, 2],
        [130, 2],
        [131, 3],
      ]);
      expectEdges('news2', base, 'temperature', 'heat', [
        [35, 3],
        [35.1, 1],
        [36, 1],
        [36.1, 0],
        [38, 0],
        [38.1, 1],
        [39, 1],
        [39.1, 2],
      ]);
    });
    it('cuts SpO2 scale 1 and scale 2 (air and oxygen)', () => {
      expectEdges('news2', base, 'spo2', 'saturation', [
        [91, 3],
        [92, 2],
        [93, 2],
        [94, 1],
        [95, 1],
        [96, 0],
      ]);
      expectEdges(
        'news2',
        base,
        'spo2',
        'saturation',
        [
          [83, 3],
          [84, 2],
          [85, 2],
          [86, 1],
          [87, 1],
          [88, 0],
          [92, 0],
          [93, 0],
          [100, 0],
        ],
        { spo2Scale: 2 },
      );
      expectEdges(
        'news2',
        base,
        'spo2',
        'saturation',
        [
          [87, 1],
          [88, 0],
          [92, 0],
          [93, 1],
          [94, 1],
          [95, 2],
          [96, 2],
          [97, 3],
          [100, 3],
        ],
        { spo2Scale: 2, onOxygen: 1 },
      );
    });
    it('adds 2 for oxygen and 3 for new confusion', () => {
      expect(stepValue('news2', { ...base, onOxygen: 1 }, 'oxygen')).toBe(2);
      expect(stepValue('news2', { ...base, consciousness: 3 }, 'mind')).toBe(3);
    });
    it('applies the aggregate and single-parameter triggers', () => {
      // RR 24 (2) + SpO2 93 (2) + oxygen (2) + SBP 105 (1) + pulse 112 (2) + temp 38.5 (1) = 10
      const high = {
        ...base,
        respiratoryRate: 24,
        spo2: 93,
        onOxygen: 1,
        systolicBp: 105,
        pulse: 112,
        temperature: 38.5,
      };
      expect(output('news2', high)).toBe(10);
      expect(band('news2', high).rangeId).toBe('high');
      // 7 exactly: still high; 5 and 6: medium; 4 without a red score: low
      const seven = {
        ...base,
        respiratoryRate: 22,
        spo2: 94,
        onOxygen: 1,
        systolicBp: 105,
        pulse: 95,
        temperature: 38.5,
      };
      // 2 + 1 + 2 + 1 + 1 + 0 + 1 = 8, so lower the pulse score to land on 7
      expect(output('news2', seven)).toBe(8);
      expect(output('news2', { ...seven, pulse: 80 })).toBe(7);
      expect(band('news2', { ...seven, pulse: 80 }).rangeId).toBe('high');
      expect(output('news2', { ...seven, pulse: 80, temperature: 37 })).toBe(6);
      expect(band('news2', { ...seven, pulse: 80, temperature: 37 }).rangeId).toBe('medium');
      expect(output('news2', { ...seven, pulse: 80, temperature: 37, systolicBp: 130 })).toBe(5);
      expect(band('news2', { ...seven, pulse: 80, temperature: 37, systolicBp: 130 }).rangeId).toBe(
        'medium',
      );
      const four = { ...seven, pulse: 80, temperature: 37, systolicBp: 130, spo2: 98 };
      expect(output('news2', four)).toBe(4);
      expect(band('news2', four).rangeId).toBe('low');
      // one red parameter with a low total
      const red = { ...base, consciousness: 3 };
      expect(output('news2', red)).toBe(3);
      expect(band('news2', red).rangeId).toBe('low-medium');
      expect(band('news2', { ...base, respiratoryRate: 25 }).rangeId).toBe('low-medium');
      // a red parameter inside a total of 5 or more reports the higher band
      expect(band('news2', { ...base, consciousness: 3, onOxygen: 1 }).rangeId).toBe('medium');
    });
  });

  // ---------------------------------------------------------------- MEWS
  describe('MEWS (Subbe 2001: SBP, HR, RR, temperature, AVPU; ≥5 high risk)', () => {
    const base: Inputs = {
      systolicBp: 130,
      heartRate: 75,
      respiratoryRate: 12,
      temperature: 37,
      avpu: 0,
    };
    it('cuts systolic pressure, heart rate, respiratory rate and temperature', () => {
      expectEdges('mews', base, 'systolicBp', 'pressure', [
        [70, 3],
        [71, 2],
        [80, 2],
        [81, 1],
        [100, 1],
        [101, 0],
        [199, 0],
        [200, 2],
      ]);
      expectEdges('mews', base, 'heartRate', 'heart', [
        [40, 2],
        [41, 1],
        [50, 1],
        [51, 0],
        [100, 0],
        [101, 1],
        [110, 1],
        [111, 2],
        [129, 2],
        [130, 3],
      ]);
      expectEdges('mews', base, 'respiratoryRate', 'breathing', [
        [8, 2],
        [9, 0],
        [14, 0],
        [15, 1],
        [20, 1],
        [21, 2],
        [29, 2],
        [30, 3],
      ]);
      expectEdges('mews', base, 'temperature', 'heat', [
        [34.9, 2],
        [35, 0],
        [38.4, 0],
        [38.5, 2],
      ]);
    });
    it('reaches the published maximum of 14 and cuts the bands at 5', () => {
      expect(output('mews', base)).toBe(0);
      const worst = {
        systolicBp: 70,
        heartRate: 130,
        respiratoryRate: 30,
        temperature: 38.5,
        avpu: 3,
      };
      expect(output('mews', worst)).toBe(14);
      expect(band('mews', worst).rangeId).toBe('higher');
      // 3 + 2 = 5
      const five = { ...base, systolicBp: 70, avpu: 2 };
      expect(output('mews', five)).toBe(5);
      expect(band('mews', five).rangeId).toBe('higher');
      const four = { ...base, systolicBp: 70, avpu: 1 };
      expect(output('mews', four)).toBe(4);
      expect(band('mews', four).rangeId).toBe('lower');
    });
  });

  // ---------------------------------------------------------------- APACHE II
  describe('APACHE II (Knaus 1985: 12 physiology variables + age + chronic health)', () => {
    const base: Inputs = {
      temperature: 37,
      meanArterialPressure: 90,
      heartRate: 80,
      respiratoryRate: 16,
      fio2: 21,
      pao2: 90,
      paco2: 40,
      ph: 7.4,
      sodium: 140,
      potassium: 4,
      creatinineUnit: 2,
      creatinine: 1,
      acuteRenalFailure: 0,
      hematocrit: 40,
      wbc: 8,
      gcs: 15,
      ageYears: 30,
      admissionType: 0,
      chronicFailure: 0,
    };
    it('scores a normal patient as 0', () => {
      expect(output('apache-ii', base)).toBe(0);
    });
    it('cuts temperature, pressure, heart and respiratory rate', () => {
      expectEdges('apache-ii', base, 'temperature', 'temperaturePoints', [
        [41, 4],
        [40.9, 3],
        [39, 3],
        [38.9, 1],
        [38.5, 1],
        [38.4, 0],
        [36, 0],
        [35.9, 1],
        [34, 1],
        [33.9, 2],
        [32, 2],
        [31.9, 3],
        [30, 3],
        [29.9, 4],
      ]);
      expectEdges('apache-ii', base, 'meanArterialPressure', 'pressurePoints', [
        [160, 4],
        [159, 3],
        [130, 3],
        [129, 2],
        [110, 2],
        [109, 0],
        [70, 0],
        [69, 2],
        [50, 2],
        [49, 4],
      ]);
      expectEdges('apache-ii', base, 'heartRate', 'heartPoints', [
        [180, 4],
        [179, 3],
        [140, 3],
        [139, 2],
        [110, 2],
        [109, 0],
        [70, 0],
        [69, 2],
        [55, 2],
        [54, 3],
        [40, 3],
        [39, 4],
      ]);
      expectEdges('apache-ii', base, 'respiratoryRate', 'breathingPoints', [
        [50, 4],
        [49, 3],
        [35, 3],
        [34, 1],
        [25, 1],
        [24, 0],
        [12, 0],
        [11, 1],
        [10, 1],
        [9, 2],
        [6, 2],
        [5, 4],
      ]);
    });
    it('scores oxygenation by PaO2 below FiO2 0.5 and by A-aDO2 from FiO2 0.5', () => {
      expectEdges('apache-ii', base, 'pao2', 'oxygenationPoints', [
        [71, 0],
        [70, 1],
        [61, 1],
        [60, 3],
        [55, 3],
        [54, 4],
      ]);
      // FiO2 49 % still uses PaO2
      expect(stepValue('apache-ii', { ...base, fio2: 49, pao2: 54 }, 'oxygenationPoints')).toBe(4);
      // FiO2 100 %, PaCO2 40: A-aDO2 = 713 − 50 − PaO2
      expectEdges(
        'apache-ii',
        base,
        'pao2',
        'oxygenationPoints',
        [
          [163, 4],
          [164, 3],
          [313, 3],
          [314, 2],
          [463, 2],
          [464, 0],
        ],
        { fio2: 100 },
      );
      expect(stepValue('apache-ii', { ...base, fio2: 100, pao2: 163 }, 'gradient')).toBe(500);
    });
    it('uses pH, or serum bicarbonate when no gas analysis is available', () => {
      expectEdges('apache-ii', base, 'ph', 'acidBasePoints', [
        [7.7, 4],
        [7.69, 3],
        [7.6, 3],
        [7.59, 1],
        [7.5, 1],
        [7.49, 0],
        [7.33, 0],
        [7.32, 2],
        [7.25, 2],
        [7.24, 3],
        [7.15, 3],
        [7.14, 4],
      ]);
      const { ph: _ph, ...withoutPh } = base;
      expectEdges('apache-ii', withoutPh, 'hco3', 'acidBasePoints', [
        [52, 4],
        [51.9, 3],
        [41, 3],
        [40.9, 1],
        [32, 1],
        [31.9, 0],
        [22, 0],
        [21.9, 2],
        [18, 2],
        [17.9, 3],
        [15, 3],
        [14.9, 4],
      ]);
      expect(failure('apache-ii', withoutPh)).toContain('pH');
    });
    it('cuts sodium, potassium, hematocrit and leukocytes', () => {
      expectEdges('apache-ii', base, 'sodium', 'sodiumPoints', [
        [180, 4],
        [179, 3],
        [160, 3],
        [159, 2],
        [155, 2],
        [154, 1],
        [150, 1],
        [149, 0],
        [130, 0],
        [129, 2],
        [120, 2],
        [119, 3],
        [111, 3],
        [110, 4],
      ]);
      expectEdges('apache-ii', base, 'potassium', 'potassiumPoints', [
        [7, 4],
        [6.9, 3],
        [6, 3],
        [5.9, 1],
        [5.5, 1],
        [5.4, 0],
        [3.5, 0],
        [3.4, 1],
        [3, 1],
        [2.9, 2],
        [2.5, 2],
        [2.4, 4],
      ]);
      expectEdges('apache-ii', base, 'hematocrit', 'hematocritPoints', [
        [60, 4],
        [59.9, 2],
        [50, 2],
        [49.9, 1],
        [46, 1],
        [45.9, 0],
        [30, 0],
        [29.9, 2],
        [20, 2],
        [19.9, 4],
      ]);
      expectEdges('apache-ii', base, 'wbc', 'wbcPoints', [
        [40, 4],
        [39.9, 2],
        [20, 2],
        [19.9, 1],
        [15, 1],
        [14.9, 0],
        [3, 0],
        [2.9, 2],
        [1, 2],
        [0.9, 4],
      ]);
    });
    it('scores creatinine in mg/dL or µmol/L and doubles it in acute renal failure', () => {
      expectEdges('apache-ii', base, 'creatinine', 'creatininePoints', [
        [3.5, 4],
        [3.4, 3],
        [2, 3],
        [1.9, 2],
        [1.5, 2],
        [1.4, 0],
        [0.6, 0],
        [0.5, 2],
      ]);
      expectEdges(
        'apache-ii',
        base,
        'creatinine',
        'creatininePoints',
        [
          [3.5, 8],
          [2, 6],
          [1.5, 4],
          [1, 0],
          [0.5, 4],
        ],
        { acuteRenalFailure: 1 },
      );
      expectEdges(
        'apache-ii',
        base,
        'creatinine',
        'creatininePoints',
        [
          [310, 4],
          [300, 3],
          [180, 3],
          [170, 2],
          [133, 2],
          [120, 0],
          [50, 2],
        ],
        { creatinineUnit: 1 },
      );
    });
    it('scores the Glasgow deficit, age and chronic health points', () => {
      expectEdges('apache-ii', base, 'gcs', 'glasgowPoints', [
        [15, 0],
        [14, 1],
        [8, 7],
        [3, 12],
      ]);
      expectEdges('apache-ii', base, 'ageYears', 'agePoints', [
        [44, 0],
        [45, 2],
        [54, 2],
        [55, 3],
        [64, 3],
        [65, 5],
        [74, 5],
        [75, 6],
      ]);
      for (const [admissionType, chronicFailure, expected] of [
        [0, 1, 5],
        [1, 1, 5],
        [2, 1, 2],
        [0, 0, 0],
        [2, 0, 0],
      ] as const) {
        expect(
          stepValue('apache-ii', { ...base, admissionType, chronicFailure }, 'chronicPoints'),
        ).toBe(expected);
      }
    });
    it('sums a worked example and cuts the mortality bands', () => {
      const example: Inputs = {
        ...base,
        temperature: 39.5, // 3
        meanArterialPressure: 120, // 2
        heartRate: 130, // 2
        respiratoryRate: 30, // 1
        fio2: 60,
        pao2: 200, // A-aDO2 177.8 → 0
        ph: 7.28, // 2
        sodium: 132, // 0
        potassium: 5.8, // 1
        creatinine: 2.2, // 3 × 2 with acute renal failure
        acuteRenalFailure: 1,
        hematocrit: 32, // 0
        wbc: 18, // 1
        gcs: 10, // 5
        ageYears: 70, // 5
        admissionType: 1,
        chronicFailure: 1, // 5
      };
      expect(stepValue('apache-ii', example, 'physiologyScore')).toBe(23);
      expect(output('apache-ii', example)).toBe(33);
      expect(band('apache-ii', example).rangeId).toBe('score-30-34');

      const extras: readonly (readonly [Inputs, number])[] = [
        [{ temperature: 41 }, 4],
        [{ meanArterialPressure: 160 }, 4],
        [{ heartRate: 180 }, 4],
        [{ ageYears: 75 }, 6],
        [{ admissionType: 1, chronicFailure: 1 }, 5],
      ];
      const forTotal = (total: number): Inputs => {
        let rest = total;
        let inputs: Inputs = { ...base };
        for (const [override, points] of extras) {
          if (rest > 12) {
            inputs = { ...inputs, ...override };
            rest -= points;
          }
        }
        return { ...inputs, gcs: 15 - rest };
      };
      const expectedBands: readonly (readonly [number, string])[] = [
        [0, 'score-0-4'],
        [4, 'score-0-4'],
        [5, 'score-5-9'],
        [9, 'score-5-9'],
        [10, 'score-10-14'],
        [14, 'score-10-14'],
        [15, 'score-15-19'],
        [19, 'score-15-19'],
        [20, 'score-20-24'],
        [24, 'score-20-24'],
        [25, 'score-25-29'],
        [29, 'score-25-29'],
        [30, 'score-30-34'],
        [34, 'score-30-34'],
        [35, 'score-35-plus'],
      ];
      for (const [total, rangeId] of expectedBands) {
        expect(output('apache-ii', forTotal(total)), `total ${total}`).toBe(total);
        expect(band('apache-ii', forTotal(total)).rangeId, `total ${total}`).toBe(rangeId);
      }
    });
  });

  // ---------------------------------------------------------------- SAPS II
  describe('SAPS II (Le Gall 1993: 17 variables; logit −7.7631 + 0.0737·S + 0.9971·ln(S + 1))', () => {
    const base: Inputs = {
      ageYears: 30,
      heartRate: 80,
      systolicBp: 120,
      temperature: 37,
      ventilated: 0,
      urineOutput: 2,
      urea: 5,
      wbc: 8,
      potassium: 4,
      sodium: 140,
      bicarbonate: 24,
      bilirubin: 10,
      gcs: 15,
      chronicDisease: 0,
      admissionType: 0,
    };
    it('scores a normal scheduled-surgery patient as 0', () => {
      expect(output('saps-ii', base)).toBe(0);
    });
    it('cuts age, heart rate, pressure and temperature', () => {
      expectEdges('saps-ii', base, 'ageYears', 'agePoints', [
        [39, 0],
        [40, 7],
        [59, 7],
        [60, 12],
        [69, 12],
        [70, 15],
        [74, 15],
        [75, 16],
        [79, 16],
        [80, 18],
      ]);
      expectEdges('saps-ii', base, 'heartRate', 'heartPoints', [
        [39, 11],
        [40, 2],
        [69, 2],
        [70, 0],
        [119, 0],
        [120, 4],
        [159, 4],
        [160, 7],
      ]);
      expectEdges('saps-ii', base, 'systolicBp', 'pressurePoints', [
        [69, 13],
        [70, 5],
        [99, 5],
        [100, 0],
        [199, 0],
        [200, 2],
      ]);
      expectEdges('saps-ii', base, 'temperature', 'temperaturePoints', [
        [38.9, 0],
        [39, 3],
      ]);
    });
    it('counts PaO2/FiO2 only on a ventilator or CPAP', () => {
      expectEdges(
        'saps-ii',
        base,
        'pao2fio2',
        'oxygenationPoints',
        [
          [99, 11],
          [100, 9],
          [199, 9],
          [200, 6],
        ],
        { ventilated: 1 },
      );
      expect(stepValue('saps-ii', { ...base, pao2fio2: 50 }, 'oxygenationPoints')).toBe(0);
      expect(stepValue('saps-ii', { ...base, ventilated: 1 }, 'oxygenationPoints')).toBe(0);
    });
    it('cuts urine output, urea, leukocytes, electrolytes, bicarbonate and bilirubin', () => {
      expectEdges('saps-ii', base, 'urineOutput', 'urinePoints', [
        [0.499, 11],
        [0.5, 4],
        [0.999, 4],
        [1, 0],
      ]);
      expectEdges('saps-ii', base, 'urea', 'ureaPoints', [
        [9.9, 0],
        [10, 6],
        [29.9, 6],
        [30, 10],
      ]);
      expectEdges('saps-ii', base, 'wbc', 'wbcPoints', [
        [0.9, 12],
        [1, 0],
        [19.9, 0],
        [20, 3],
      ]);
      expectEdges('saps-ii', base, 'potassium', 'potassiumPoints', [
        [2.9, 3],
        [3, 0],
        [4.9, 0],
        [5, 3],
      ]);
      expectEdges('saps-ii', base, 'sodium', 'sodiumPoints', [
        [124, 5],
        [125, 0],
        [144, 0],
        [145, 1],
      ]);
      expectEdges('saps-ii', base, 'bicarbonate', 'bicarbonatePoints', [
        [14.9, 6],
        [15, 3],
        [19.9, 3],
        [20, 0],
      ]);
      expectEdges('saps-ii', base, 'bilirubin', 'bilirubinPoints', [
        [68.3, 0],
        [68.4, 4],
        [102.5, 4],
        [102.6, 9],
      ]);
    });
    it('cuts the Glasgow bands and takes chronic disease and admission points as chosen', () => {
      expectEdges('saps-ii', base, 'gcs', 'glasgowPoints', [
        [15, 0],
        [14, 0],
        [13, 5],
        [11, 5],
        [10, 7],
        [9, 7],
        [8, 13],
        [6, 13],
        [5, 26],
        [3, 26],
      ]);
      for (const points of [0, 9, 10, 17]) {
        expect(stepValue('saps-ii', { ...base, chronicDisease: points }, 'chronicPoints')).toBe(
          points,
        );
      }
      for (const points of [0, 6, 8]) {
        expect(stepValue('saps-ii', { ...base, admissionType: points }, 'admissionPoints')).toBe(
          points,
        );
      }
    });
    it('converts the score to the published probability of hospital death', () => {
      const example: Inputs = {
        ...base,
        ageYears: 65, // 12
        heartRate: 125, // 4
        systolicBp: 85, // 5
        ventilated: 1,
        pao2fio2: 150, // 9
        urineOutput: 0.8, // 4
        urea: 12, // 6
        bicarbonate: 18, // 3
        bilirubin: 80, // 4
        gcs: 12, // 5
        admissionType: 6, // 6
      };
      expect(output('saps-ii', example)).toBe(58);
      const logit = -7.7631 + 0.0737 * 58 + 0.9971 * Math.log(59);
      const expected = (100 * Math.exp(logit)) / (1 + Math.exp(logit));
      expect(output('saps-ii', example, 'mortality')).toBeCloseTo(expected, 4);
      // ln(S + 1) comes from the engine's ln()
      expect(stepValue('saps-ii', example, 'naturalLog')).toBeCloseTo(Math.log(59), 6);
    });
    it('keeps the logarithm accurate at the extremes of the score', () => {
      // score 0 → ln 1 = 0 → p from the constant alone
      const zero = (100 * Math.exp(-7.7631)) / (1 + Math.exp(-7.7631));
      expect(output('saps-ii', base, 'mortality')).toBeCloseTo(zero, 6);
      expect(stepValue('saps-ii', base, 'naturalLog')).toBeCloseTo(0, 9);
      // the highest published combination: 163 points
      const maximum: Inputs = {
        ageYears: 85, // 18
        heartRate: 30, // 11
        systolicBp: 60, // 13
        temperature: 40, // 3
        ventilated: 1,
        pao2fio2: 60, // 11
        urineOutput: 0.1, // 11
        urea: 40, // 10
        wbc: 0.5, // 12
        potassium: 2, // 3
        sodium: 120, // 5
        bicarbonate: 10, // 6
        bilirubin: 150, // 9
        gcs: 3, // 26
        chronicDisease: 17, // 17
        admissionType: 8, // 8
      };
      expect(output('saps-ii', maximum)).toBe(163);
      expect(stepValue('saps-ii', maximum, 'naturalLog')).toBeCloseTo(Math.log(164), 6);
      const logit = -7.7631 + 0.0737 * 163 + 0.9971 * Math.log(164);
      expect(output('saps-ii', maximum, 'mortality')).toBeCloseTo(
        (100 * Math.exp(logit)) / (1 + Math.exp(logit)),
        4,
      );
    });
  });

  // ---------------------------------------------------------------- MODS
  describe('MODS (Marshall 1995: six systems, 0–4, maximum 24)', () => {
    const base: Inputs = {
      pao2fio2: 400,
      creatinine: 80,
      bilirubin: 10,
      heartRate: 100,
      centralVenousPressure: 5,
      meanArterialPressure: 100,
      platelets: 200,
      gcs: 15,
    };
    it('scores a normal patient as 0', () => {
      expect(output('mods', base)).toBe(0);
      expect(band('mods', base).rangeId).toBe('score-0');
    });
    it('cuts every system at the published limits', () => {
      expectEdges('mods', base, 'pao2fio2', 'respiration', [
        [301, 0],
        [300, 1],
        [226, 1],
        [225, 2],
        [151, 2],
        [150, 3],
        [76, 3],
        [75, 4],
      ]);
      expectEdges('mods', base, 'creatinine', 'renal', [
        [100, 0],
        [101, 1],
        [200, 1],
        [201, 2],
        [350, 2],
        [351, 3],
        [500, 3],
        [501, 4],
      ]);
      expectEdges('mods', base, 'bilirubin', 'liver', [
        [20, 0],
        [21, 1],
        [60, 1],
        [61, 2],
        [120, 2],
        [121, 3],
        [240, 3],
        [241, 4],
      ]);
      expectEdges('mods', base, 'platelets', 'coagulation', [
        [121, 0],
        [120, 1],
        [81, 1],
        [80, 2],
        [51, 2],
        [50, 3],
        [21, 3],
        [20, 4],
      ]);
      expectEdges('mods', base, 'gcs', 'nervousSystem', [
        [15, 0],
        [14, 1],
        [13, 1],
        [12, 2],
        [10, 2],
        [9, 3],
        [7, 3],
        [6, 4],
      ]);
    });
    it('uses the pressure-adjusted heart rate (HR × CVP / MAP)', () => {
      expectEdges('mods', base, 'centralVenousPressure', 'circulation', [
        [10, 0],
        [10.1, 1],
        [15, 1],
        [15.1, 2],
        [20, 2],
        [20.1, 3],
        [30, 3],
        [30.1, 4],
      ]);
      expect(
        stepValue(
          'mods',
          { ...base, heartRate: 120, centralVenousPressure: 10, meanArterialPressure: 60 },
          'pressureAdjustedHeartRate',
        ),
      ).toBeCloseTo(20, 9);
    });
    it('reaches 24 and maps the mortality bands', () => {
      const worst: Inputs = {
        pao2fio2: 60,
        creatinine: 600,
        bilirubin: 300,
        heartRate: 150,
        centralVenousPressure: 30,
        meanArterialPressure: 50,
        platelets: 10,
        gcs: 3,
      };
      expect(output('mods', worst)).toBe(24);
      expect(band('mods', worst).rangeId).toBe('score-21-plus');
      const withScore = (
        platelets: number,
        gcs: number,
        creatinine: number,
        bilirubin: number,
        pao2fio2: number,
      ) => ({
        ...base,
        platelets,
        gcs,
        creatinine,
        bilirubin,
        pao2fio2,
      });
      // 1 → 1–4, 4 → 1–4, 5 → 5–8
      expect(band('mods', withScore(200, 15, 150, 10, 400)).rangeId).toBe('score-1-4');
      expect(output('mods', withScore(40, 11, 150, 10, 400))).toBe(6);
      expect(band('mods', withScore(40, 11, 150, 10, 400)).rangeId).toBe('score-5-8');
      expect(output('mods', withScore(40, 11, 300, 100, 140))).toBe(12);
      expect(band('mods', withScore(40, 11, 300, 100, 140)).rangeId).toBe('score-9-12');
      expect(output('mods', withScore(40, 11, 300, 300, 140))).toBe(14);
      expect(band('mods', withScore(40, 11, 300, 300, 140)).rangeId).toBe('score-13-16');
    });
  });

  // ---------------------------------------------------------------- MPM II
  const logistic = (logit: number) => (100 * Math.exp(logit)) / (1 + Math.exp(logit));

  describe('MPM II at admission (Lemeshow 1993: constant −5.46836, age 0.03057, 14 binary terms)', () => {
    const coefficients: Record<string, number> = {
      coma: 1.48592,
      heartRate150: 0.45603,
      systolicBp90: 1.06127,
      chronicRenalFailure: 0.91906,
      cirrhosis: 1.13681,
      metastaticNeoplasm: 1.19979,
      acuteRenalFailure: 1.4821,
      dysrhythmia: 0.28095,
      cerebrovascularIncident: 0.21338,
      giBleeding: 0.39653,
      intracranialMassEffect: 0.86533,
      cpr: 0.56995,
      mechanicalVentilation: 0.79105,
      medicalOrUnscheduled: 1.19098,
    };
    const base: Inputs = {
      ageYears: 50,
      ...Object.fromEntries(Object.keys(coefficients).map((key) => [key, 0])),
    };
    it('uses the published intercept and age coefficient', () => {
      expect(output('mpm-ii-admission', base, 'mortality')).toBeCloseTo(
        logistic(-5.46836 + 0.03057 * 50),
        6,
      );
      expect(output('mpm-ii-admission', { ...base, ageYears: 18 }, 'mortality')).toBeCloseTo(
        logistic(-5.46836 + 0.03057 * 18),
        6,
      );
    });
    it('adds the published coefficient of each term', () => {
      for (const [term, beta] of Object.entries(coefficients)) {
        if (term === 'chronicRenalFailure') continue;
        const inputs = { ...base, [term]: 1 };
        expect(output('mpm-ii-admission', inputs, 'mortality'), term).toBeCloseTo(
          logistic(-5.46836 + 0.03057 * 50 + beta),
          6,
        );
      }
      expect(
        output('mpm-ii-admission', { ...base, chronicRenalFailure: 1 }, 'mortality'),
      ).toBeCloseTo(logistic(-5.46836 + 0.03057 * 50 + 0.91906), 6);
    });
    it('sums every term and refuses chronic plus acute renal failure together', () => {
      const all = Object.fromEntries(Object.keys(coefficients).map((key) => [key, 1]));
      const { chronicRenalFailure: _chronic, ...allButChronic } = all;
      const total = Object.entries(coefficients)
        .filter(([term]) => term !== 'chronicRenalFailure')
        .reduce((sum, [, beta]) => sum + beta, 0);
      expect(
        output(
          'mpm-ii-admission',
          { ageYears: 80, chronicRenalFailure: 0, ...allButChronic },
          'mortality',
        ),
      ).toBeCloseTo(logistic(-5.46836 + 0.03057 * 80 + total), 6);
      expect(
        failure('mpm-ii-admission', { ...base, chronicRenalFailure: 1, acuteRenalFailure: 1 }),
      ).toContain('острую');
    });
    it('rejects an age below 18', () => {
      expect(failure('mpm-ii-admission', { ...base, ageYears: 17 })).toContain('минимума');
    });
  });

  describe('MPM II at 24, 48 and 72 hours (Lemeshow 1993, 1994: 13 terms, constants −5.64592 / −5.39153 / −5.23840)', () => {
    const coefficients: Record<string, number> = {
      medicalOrUnscheduled: 0.83404,
      metastaticNeoplasm: 1.16109,
      cirrhosis: 1.08745,
      creatinineAbove2: 0.72283,
      lowUrineOutput: 0.82286,
      coma: 1.6879,
      confirmedInfection: 0.49742,
      intracranialMassEffect: 0.91314,
      mechanicalVentilation: 0.80845,
      vasoactiveDrugs: 0.71628,
      lowPao2: 0.46677,
      prolongedProthrombin: 0.55352,
    };
    const constants: Record<number, number> = { 24: -5.64592, 48: -5.39153, 72: -5.2384 };
    const base: Inputs = {
      moment: 24,
      ageYears: 60,
      ...Object.fromEntries(Object.keys(coefficients).map((key) => [key, 0])),
    };
    it('uses the constant of the chosen moment', () => {
      for (const moment of [24, 48, 72]) {
        expect(
          output('mpm-ii-24-48-72', { ...base, moment }, 'mortality'),
          `${moment} h`,
        ).toBeCloseTo(logistic((constants[moment] ?? 0) + 0.03268 * 60), 6);
      }
    });
    it('adds the published coefficient of each term', () => {
      for (const [term, beta] of Object.entries(coefficients)) {
        expect(
          output('mpm-ii-24-48-72', { ...base, moment: 48, [term]: 1 }, 'mortality'),
          term,
        ).toBeCloseTo(logistic(-5.39153 + 0.03268 * 60 + beta), 6);
      }
      const all = Object.fromEntries(Object.keys(coefficients).map((key) => [key, 1]));
      const total = Object.values(coefficients).reduce((sum, beta) => sum + beta, 0);
      expect(output('mpm-ii-24-48-72', { ...base, moment: 72, ...all }, 'mortality')).toBeCloseTo(
        logistic(-5.2384 + 0.03268 * 60 + total),
        6,
      );
    });
  });

  // ---------------------------------------------------------------- Murray LIS
  describe('Lung Injury Score (Murray 1988: four components, mean of those used; 0 / 0.1–2.5 / >2.5)', () => {
    const base: Inputs = { quadrants: 0, pao2fio2: 350, peep: 5, compliance: 90 };
    it('cuts oxygenation, PEEP and compliance', () => {
      expectEdges('murray-lung-injury-score', base, 'pao2fio2', 'oxygenationPoints', [
        [300, 0],
        [299, 1],
        [225, 1],
        [224, 2],
        [175, 2],
        [174, 3],
        [100, 3],
        [99, 4],
      ]);
      expectEdges('murray-lung-injury-score', base, 'peep', 'peepPoints', [
        [5, 0],
        [6, 1],
        [8, 1],
        [9, 2],
        [11, 2],
        [12, 3],
        [14, 3],
        [15, 4],
      ]);
      expectEdges('murray-lung-injury-score', base, 'compliance', 'compliancePoints', [
        [80, 0],
        [79, 1],
        [60, 1],
        [59, 2],
        [40, 2],
        [39, 3],
        [20, 3],
        [19, 4],
      ]);
      for (const quadrants of [0, 1, 2, 3, 4]) {
        expect(
          stepValue('murray-lung-injury-score', { ...base, quadrants }, 'radiographPoints'),
        ).toBe(quadrants);
      }
    });
    it('averages over the components used', () => {
      expect(output('murray-lung-injury-score', base)).toBe(0);
      expect(band('murray-lung-injury-score', base).rangeId).toBe('none');
      // (3 + 3 + 3 + 3) / 4 = 3
      const four = { quadrants: 3, pao2fio2: 150, peep: 12, compliance: 30 };
      expect(output('murray-lung-injury-score', four)).toBe(3);
      expect(band('murray-lung-injury-score', four).rangeId).toBe('severe');
      // without compliance the divisor is 3
      const { compliance: _omitted, ...three } = four;
      expect(output('murray-lung-injury-score', three)).toBe(3);
      expect(stepValue('murray-lung-injury-score', three, 'componentCount')).toBe(3);
      expect(
        output('murray-lung-injury-score', { quadrants: 1, pao2fio2: 350, peep: 5 }),
      ).toBeCloseTo(1 / 3, 9);
    });
    it('cuts the bands at 2.5', () => {
      // 4 + 3 + 3 + 0 = 10 → 2.5: still mild-to-moderate
      const edge = { quadrants: 4, pao2fio2: 150, peep: 12, compliance: 90 };
      expect(output('murray-lung-injury-score', edge)).toBe(2.5);
      expect(band('murray-lung-injury-score', edge).rangeId).toBe('mild-moderate');
      expect(output('murray-lung-injury-score', { ...edge, compliance: 60 })).toBe(2.75);
      expect(band('murray-lung-injury-score', { ...edge, compliance: 60 }).rangeId).toBe('severe');
      expect(band('murray-lung-injury-score', { ...base, quadrants: 1 }).rangeId).toBe(
        'mild-moderate',
      );
    });
  });

  // ---------------------------------------------------------------- RASS and Ramsay
  describe('RASS (Sessler 2002: +4 … −5)', () => {
    it('reports every level with its own wording', () => {
      const names: Record<number, string> = {
        4: 'агрессивный',
        3: 'очень сильно возбуждён',
        2: 'возбуждён',
        1: 'беспокоен',
        0: 'бодр и спокоен',
        [-1]: 'сонлив',
        [-2]: 'лёгкая седация',
        [-3]: 'умеренная седация',
        [-4]: 'глубокая седация',
        [-5]: 'не пробуждается',
      };
      for (const [level, name] of Object.entries(names)) {
        const value = Number(level);
        expect(output('rass', { level: value })).toBe(value);
        expect(band('rass', { level: value }).text, `RASS ${level}`).toContain(name);
      }
      expect(failure('rass', { level: 5 })).toContain('недопустимое');
      expect(failure('rass', { level: -6 })).toContain('недопустимое');
    });
  });

  describe('Ramsay sedation scale (Ramsay 1974: six levels)', () => {
    it('reports every level', () => {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(output('ramsay-sedation-scale', { level })).toBe(level);
        expect(band('ramsay-sedation-scale', { level }).rangeId).toBe(`level-${level}`);
      }
      expect(failure('ramsay-sedation-scale', { level: 7 })).toContain('недопустимое');
    });
  });

  // ---------------------------------------------------------------- PaO2/FiO2 and Berlin
  describe('PaO2/FiO2 and Berlin definition (ARDS Task Force 2012: >300, 200–300, 100–200, ≤100, PEEP ≥5)', () => {
    const base: Inputs = { pao2: 90, pao2Unit: 1, fio2: 100, peep: 8 };
    it('divides PaO2 by the FiO2 fraction, in mmHg or kPa', () => {
      expect(output('pao2-fio2-berlin', { ...base, pao2: 90, fio2: 30 }, 'ratio')).toBe(300);
      expect(output('pao2-fio2-berlin', { ...base, pao2: 60, fio2: 40 }, 'ratio')).toBe(150);
      expect(
        output('pao2-fio2-berlin', { ...base, pao2: 10, pao2Unit: 2, fio2: 50 }, 'ratio'),
      ).toBeCloseTo(150.0124, 3);
    });
    it('cuts the severity at 300, 200 and 100', () => {
      for (const [pao2, rangeId] of [
        [301, 'above-300'],
        [300, 'mild'],
        [201, 'mild'],
        [200, 'moderate'],
        [101, 'moderate'],
        [100, 'severe'],
        [50, 'severe'],
      ] as const) {
        expect(band('pao2-fio2-berlin', { ...base, pao2 }).rangeId, `PaO2 ${pao2}`).toBe(rangeId);
      }
      // 13.3 kPa = 99.8 mmHg is severe; 13.4 kPa = 100.5 mmHg is moderate
      expect(band('pao2-fio2-berlin', { ...base, pao2: 13.3, pao2Unit: 2 }).rangeId).toBe('severe');
      expect(band('pao2-fio2-berlin', { ...base, pao2: 13.4, pao2Unit: 2 }).rangeId).toBe(
        'moderate',
      );
    });
    it('requires PEEP of at least 5 for a Berlin category', () => {
      expect(band('pao2-fio2-berlin', { ...base, pao2: 150, peep: 4 }).rangeId).toBe(
        'peep-below-5',
      );
      expect(band('pao2-fio2-berlin', { ...base, pao2: 150, peep: 5 }).rangeId).toBe('moderate');
      expect(band('pao2-fio2-berlin', { ...base, pao2: 350, peep: 0 }).rangeId).toBe('above-300');
    });
  });

  // ---------------------------------------------------------------- RSBI
  describe('RSBI (Yang and Tobin 1991: f/Vt, threshold 105)', () => {
    it('divides rate by tidal volume in litres', () => {
      expect(output('rsbi', { respiratoryRate: 20, tidalVolume: 500 }, 'rsbi')).toBe(40);
      expect(output('rsbi', { respiratoryRate: 30, tidalVolume: 250 }, 'rsbi')).toBe(120);
    });
    it('cuts at 105', () => {
      expect(band('rsbi', { respiratoryRate: 62, tidalVolume: 600 }).rangeId).toBe('success');
      expect(output('rsbi', { respiratoryRate: 63, tidalVolume: 600 }, 'rsbi')).toBe(105);
      expect(band('rsbi', { respiratoryRate: 63, tidalVolume: 600 }).rangeId).toBe('failure');
      expect(band('rsbi', { respiratoryRate: 21, tidalVolume: 200 }).rangeId).toBe('failure');
    });
  });

  // ---------------------------------------------------------------- nitrogen balance
  describe('Nitrogen balance (Blackburn 1977: protein / 6.25 − (UUN + 4))', () => {
    it('balances 75 g protein against 8 g urinary urea nitrogen', () => {
      expect(
        output(
          'nitrogen-balance',
          { proteinIntake: 75, excretion: 8, excretionUnit: 1 },
          'balance',
        ),
      ).toBeCloseTo(0, 9);
    });
    it('converts urea in grams or millimoles to urea nitrogen', () => {
      // 100 g protein = 16 g N; 30 g urea = 13.992 g N; output = 17.992 g → −1.992
      expect(
        output(
          'nitrogen-balance',
          { proteinIntake: 100, excretion: 30, excretionUnit: 2 },
          'balance',
        ),
      ).toBeCloseTo(16 - (30 * 0.4664 + 4), 9);
      // 500 mmol urea × 28.014 mg N
      expect(
        output(
          'nitrogen-balance',
          { proteinIntake: 100, excretion: 500, excretionUnit: 3 },
          'balance',
        ),
      ).toBeCloseTo(16 - (500 * 0.028014 + 4), 9);
    });
    it('splits positive from negative balance at 0', () => {
      expect(
        band('nitrogen-balance', { proteinIntake: 75, excretion: 8, excretionUnit: 1 }).rangeId,
      ).toBe('non-negative');
      expect(
        band('nitrogen-balance', { proteinIntake: 62.5, excretion: 8, excretionUnit: 1 }).rangeId,
      ).toBe('negative');
      expect(
        band('nitrogen-balance', { proteinIntake: 100, excretion: 4, excretionUnit: 1 }).rangeId,
      ).toBe('non-negative');
    });
  });

  // ---------------------------------------------------------------- ISTH overt DIC
  describe('ISTH overt DIC (Taylor 2001: platelets, fibrin markers, PT, fibrinogen; ≥5 overt)', () => {
    const base: Inputs = {
      underlyingDisorder: 1,
      platelets: 200,
      fibrinMarkers: 0,
      prothrombinProlongation: 1,
      fibrinogen: 3,
    };
    it('cuts every component', () => {
      expectEdges('isth-overt-dic', base, 'platelets', 'plateletPoints', [
        [100, 0],
        [99, 1],
        [50, 1],
        [49, 2],
      ]);
      expectEdges('isth-overt-dic', base, 'prothrombinProlongation', 'prothrombinPoints', [
        [2.9, 0],
        [3, 1],
        [5.9, 1],
        [6, 2],
      ]);
      expectEdges('isth-overt-dic', base, 'fibrinogen', 'fibrinogenPoints', [
        [1, 0],
        [0.99, 1],
      ]);
      for (const marker of [0, 2, 3]) {
        expect(
          stepValue('isth-overt-dic', { ...base, fibrinMarkers: marker }, 'markerPoints'),
        ).toBe(marker);
      }
    });
    it('calls overt DIC from 5 points and needs an underlying disorder', () => {
      expect(output('isth-overt-dic', base)).toBe(0);
      expect(band('isth-overt-dic', base).rangeId).toBe('not-overt');
      // 1 + 3 + 0 + 0 = 4
      const four = { ...base, platelets: 80, fibrinMarkers: 3 };
      expect(output('isth-overt-dic', four)).toBe(4);
      expect(band('isth-overt-dic', four).rangeId).toBe('not-overt');
      // 2 + 3 + 0 + 0 = 5
      const five = { ...base, platelets: 30, fibrinMarkers: 3 };
      expect(output('isth-overt-dic', five)).toBe(5);
      expect(band('isth-overt-dic', five).rangeId).toBe('overt');
      // the maximum: 2 + 3 + 2 + 1
      expect(
        output('isth-overt-dic', {
          ...base,
          platelets: 10,
          fibrinMarkers: 3,
          prothrombinProlongation: 8,
          fibrinogen: 0.5,
        }),
      ).toBe(8);
      expect(failure('isth-overt-dic', { ...base, underlyingDisorder: 0 })).toContain(
        'ассоциированном',
      );
    });
  });

  // ---------------------------------------------------------------- Candida score
  describe('Candida score (León 2006: sepsis 2, parenteral nutrition 1, surgery 1, multifocal colonization 1; >2.5)', () => {
    const base: Inputs = {
      severeSepsis: 0,
      parenteralNutrition: 0,
      surgery: 0,
      multifocalColonization: 0,
    };
    it('adds the published points', () => {
      expect(output('candida-score', base)).toBe(0);
      expect(output('candida-score', { ...base, severeSepsis: 1 })).toBe(2);
      expect(output('candida-score', { ...base, parenteralNutrition: 1 })).toBe(1);
      expect(output('candida-score', { ...base, surgery: 1 })).toBe(1);
      expect(output('candida-score', { ...base, multifocalColonization: 1 })).toBe(1);
      expect(
        output('candida-score', {
          severeSepsis: 1,
          parenteralNutrition: 1,
          surgery: 1,
          multifocalColonization: 1,
        }),
      ).toBe(5);
    });
    it('cuts the band between 2 and 3', () => {
      expect(band('candida-score', { ...base, severeSepsis: 1 }).rangeId).toBe('below-cutoff');
      expect(band('candida-score', { ...base, severeSepsis: 1, surgery: 1 }).rangeId).toBe(
        'above-cutoff',
      );
      expect(
        band('candida-score', {
          ...base,
          parenteralNutrition: 1,
          surgery: 1,
          multifocalColonization: 1,
        }).rangeId,
      ).toBe('above-cutoff');
    });
  });

  // ---------------------------------------------------------------- COVID-19 severity
  describe('COVID-19 severity (Wu and McGoogan 2020: mild / severe / critical)', () => {
    const base: Inputs = {
      respiratoryFailure: 0,
      septicShock: 0,
      multiOrganFailure: 0,
      dyspnea: 0,
      respiratoryRate: 18,
      spo2: 97,
      lungProgression: 0,
    };
    it('cuts each severe criterion', () => {
      expect(output('covid19-severity-china', base)).toBe(1);
      expect(band('covid19-severity-china', base).rangeId).toBe('mild');
      expectEdges('covid19-severity-china', base, 'respiratoryRate', 'score', [
        [29, 1],
        [30, 2],
      ]);
      expectEdges('covid19-severity-china', base, 'spo2', 'score', [
        [94, 1],
        [93, 2],
      ]);
      expectEdges('covid19-severity-china', base, 'pao2fio2', 'score', [
        [300, 1],
        [299, 2],
      ]);
      expect(output('covid19-severity-china', { ...base, dyspnea: 1 })).toBe(2);
      expect(output('covid19-severity-china', { ...base, lungProgression: 1 })).toBe(2);
    });
    it('calls a critical form from respiratory failure, shock or multiple organ failure', () => {
      for (const key of ['respiratoryFailure', 'septicShock', 'multiOrganFailure']) {
        expect(output('covid19-severity-china', { ...base, [key]: 1 }), key).toBe(3);
        expect(band('covid19-severity-china', { ...base, [key]: 1 }).rangeId).toBe('critical');
      }
      expect(band('covid19-severity-china', { ...base, dyspnea: 1 }).rangeId).toBe('severe');
    });
  });
});
