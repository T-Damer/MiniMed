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

const MODULE_FILE = 'content/tool-modules/medication-dosing.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;

function evaluate(id: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return evaluateCalculatorSchema(schema, inputs);
}

type OutputId =
  | 'newDose'
  | 'prednisolone'
  | 'singleLow'
  | 'singleHigh'
  | 'dailyMax'
  | 'minInterval'
  | 'volumeLow'
  | 'volumeHigh'
  | 'bsa'
  | 'dose'
  | 'dropsPerMinute'
  | 'dropsPerTenSeconds'
  | 'mlPerHour'
  | 'rate'
  | 'mgPerMl'
  | 'percent'
  | 'massMg'
  | 'massG';

/** Output values keyed by step id; a step left out by the schema is absent. */
function outputs(id: string, inputs: Inputs): Partial<Record<OutputId, number>> {
  const result = evaluate(id, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const values = new Map<string, number>();
  for (const output of result.outputs) {
    if (output.kind === 'number') values.set(output.id, output.value);
  }
  return Object.fromEntries(values) as Partial<Record<OutputId, number>>;
}

function failure(id: string, inputs: Inputs): string {
  const result = evaluate(id, inputs);
  if (result.ok) throw new Error(`${id}: expected a failure`);
  return result.error;
}

describe('medication dosing tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real source', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly unknown[];
    };
    expect(source.tools).toHaveLength(7);
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(validateCalculatorSchema(record.definition).errors, record.id).toEqual([]);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        expect(link.url ?? link.moduleId, link.id).toBeTruthy();
      }
      registerDownloadedCalculator(record);
    }
    const registered = getCalculatorRegistry().filter(
      (calculator) =>
        calculator.category === 'medication' && getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id)).toEqual(
      expect.arrayContaining([
        'minimed.calculator.glucocorticoid-equivalent-dose',
        'minimed.calculator.paracetamol-dose',
        'minimed.calculator.dose-by-bsa',
        'minimed.calculator.iv-drip-rate',
        'minimed.calculator.infusion-rate-mcg-kg-min',
        'minimed.calculator.solution-percent-concentration',
        'minimed.calculator.solution-substance-content',
      ]),
    );
  });

  it('declares no clinical verdict: arithmetic results only', () => {
    for (const schema of SCHEMAS) {
      expect(schema.evaluation.status, schema.id).toBe('not-applicable');
      expect(schema.evaluation.reason, schema.id).toBeTruthy();
      expect(schema.interpretations, schema.id).toEqual([]);
    }
  });

  describe('glucocorticoid equivalents (Liu 2013 table: oral/IV, hydrocortisone 20 mg)', () => {
    const id = 'minimed.calculator.glucocorticoid-equivalent-dose';
    const equivalent: Record<number, number> = {
      1: 25, // cortisone
      2: 20, // hydrocortisone
      3: 5, // prednisone
      4: 5, // prednisolone
      5: 4, // methylprednisolone
      6: 4, // triamcinolone
      7: 0.75, // dexamethasone
      8: 0.6, // betamethasone
    };
    it('maps the published equivalent dose of every drug onto that of every other', () => {
      for (const [from, fromEq] of Object.entries(equivalent)) {
        for (const [to, toEq] of Object.entries(equivalent)) {
          const result = outputs(id, { fromDrug: Number(from), dose: fromEq, toDrug: Number(to) });
          expect(result.newDose, `${from} -> ${to}`).toBeCloseTo(toEq, 9);
          expect(result.prednisolone, `${from} -> prednisolone`).toBeCloseTo(5, 9);
        }
      }
    });
    it('converts practical doses', () => {
      // prednisolone 10 mg = methylprednisolone 8 mg
      expect(outputs(id, { fromDrug: 4, dose: 10, toDrug: 5 }).newDose).toBeCloseTo(8, 9);
      // methylprednisolone 40 mg = hydrocortisone 200 mg = prednisolone 50 mg
      const result = outputs(id, { fromDrug: 5, dose: 40, toDrug: 2 });
      expect(result.newDose).toBeCloseTo(200, 9);
      expect(result.prednisolone).toBeCloseTo(50, 9);
      // dexamethasone 4 mg = prednisolone 26.67 mg
      expect(outputs(id, { fromDrug: 7, dose: 4, toDrug: 4 }).newDose).toBeCloseTo(26.6667, 3);
      // same drug returns the same dose
      expect(outputs(id, { fromDrug: 3, dose: 12.5, toDrug: 3 }).newDose).toBeCloseTo(12.5, 9);
    });
    it('rejects a missing or zero dose', () => {
      expect(failure(id, { fromDrug: 4, dose: 0, toDrug: 5 })).toContain('минимума');
      expect(failure(id, { fromDrug: 4, toDrug: 5 })).toContain('обязательно');
    });
  });

  describe('paracetamol (КР: child 10–15 mg/kg every 6 h, ≤60 mg/kg/day; adult 500–1000 mg every 4–6 h, ≤4000 mg/day)', () => {
    const id = 'minimed.calculator.paracetamol-dose';
    it('doses a child by weight and converts to millilitres of suspension', () => {
      const result = outputs(id, { patientGroup: 1, weightKg: 20, concentration: 24 });
      expect(result.singleLow).toBe(200);
      expect(result.singleHigh).toBe(300);
      expect(result.dailyMax).toBe(1200);
      expect(result.minInterval).toBe(6);
      expect(result.volumeLow).toBeCloseTo(200 / 24, 9);
      expect(result.volumeHigh).toBeCloseTo(12.5, 9);
    });
    it('omits volumes when no concentration is given', () => {
      const result = outputs(id, { patientGroup: 1, weightKg: 12 });
      expect(result.singleLow).toBe(120);
      expect(result.singleHigh).toBe(180);
      expect(result.dailyMax).toBe(720);
      expect(result.volumeLow).toBeUndefined();
      expect(result.volumeHigh).toBeUndefined();
    });
    it('caps a heavy child at the adult single dose and daily maximum', () => {
      const atCap = outputs(id, { patientGroup: 1, weightKg: 200 / 3 });
      expect(atCap.singleHigh).toBeCloseTo(1000, 6);
      const heavy = outputs(id, { patientGroup: 1, weightKg: 70 });
      expect(heavy.singleLow).toBe(700);
      expect(heavy.singleHigh).toBe(1000);
      expect(heavy.dailyMax).toBe(4000);
      const justBelowDailyCap = outputs(id, { patientGroup: 1, weightKg: 66 });
      expect(justBelowDailyCap.dailyMax).toBe(3960);
    });
    it('gives a lightest infant 3 months old the weight-based dose', () => {
      const infant = outputs(id, { patientGroup: 1, weightKg: 4 });
      expect(infant.singleLow).toBe(40);
      expect(infant.singleHigh).toBe(60);
      expect(infant.dailyMax).toBe(240);
    });
    it('gives an adult 500–1000 mg every 4 h up to 4000 mg without a weight', () => {
      const adult = outputs(id, { patientGroup: 2 });
      expect(adult.singleLow).toBe(500);
      expect(adult.singleHigh).toBe(1000);
      expect(adult.dailyMax).toBe(4000);
      expect(adult.minInterval).toBe(4);
      const withVolume = outputs(id, { patientGroup: 2, concentration: 50 });
      expect(withVolume.volumeLow).toBeCloseTo(10, 9);
      expect(withVolume.volumeHigh).toBeCloseTo(20, 9);
    });
    it('asks for a weight for a child', () => {
      expect(failure(id, { patientGroup: 1 })).toContain('массу тела');
    });
  });

  describe('dose by body surface area (Mosteller, Du Bois, Haycock, Gehan–George)', () => {
    const id = 'minimed.calculator.dose-by-bsa';
    const base: Inputs = { heightCm: 170, weightKg: 70, formula: 1, dosePerM2: 100 };
    it('computes the area with each published formula', () => {
      expect(outputs(id, base).bsa).toBeCloseTo(Math.sqrt((170 * 70) / 3600), 9);
      expect(outputs(id, base).bsa).toBeCloseTo(1.818, 3);
      expect(outputs(id, { ...base, formula: 2 }).bsa).toBeCloseTo(1.8097, 3);
      expect(outputs(id, { ...base, formula: 3 }).bsa).toBeCloseTo(1.8257, 3);
      expect(outputs(id, { ...base, formula: 4 }).bsa).toBeCloseTo(1.8313, 3);
      // the four formulas agree within 2 % for an adult
      const areas = [1, 2, 3, 4].map((formula) => outputs(id, { ...base, formula }).bsa as number);
      expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.02);
    });
    it('keeps the child result close to the reference body surface area', () => {
      const child = { heightCm: 100, weightKg: 16, dosePerM2: 50 };
      expect(outputs(id, { ...child, formula: 1 }).bsa).toBeCloseTo(0.6667, 3);
      expect(outputs(id, { ...child, formula: 2 }).bsa).toBeCloseTo(0.6578, 3);
      expect(outputs(id, { ...child, formula: 3 }).bsa).toBeCloseTo(0.6689, 3);
      expect(outputs(id, { ...child, formula: 4 }).bsa).toBeCloseTo(0.6848, 3);
      expect(outputs(id, { ...child, formula: 1 }).dose).toBeCloseTo(33.333, 2);
    });
    it('multiplies by the dose per square metre and applies the optional ceiling', () => {
      expect(outputs(id, base).dose).toBeCloseTo(181.81, 1);
      expect(outputs(id, { ...base, maxDose: 150 }).dose).toBe(150);
      expect(outputs(id, { ...base, maxDose: 200 }).dose).toBeCloseTo(181.81, 1);
    });
  });

  describe('drip rate (drops/min = volume × drops per mL / minutes)', () => {
    const id = 'minimed.calculator.iv-drip-rate';
    it('converts the duration to drops per minute for each set', () => {
      // 500 mL over 4 h with a 20 drops/mL set
      const standard = outputs(id, {
        volumeMl: 500,
        duration: 4,
        durationUnit: 60,
        dropFactor: 20,
      });
      expect(standard.dropsPerMinute).toBeCloseTo(41.6667, 3);
      expect(standard.mlPerHour).toBeCloseTo(125, 9);
      expect(standard.dropsPerTenSeconds).toBeCloseTo(6.9444, 3);
      // 250 mL over 90 min with a 60 drops/mL set
      const micro = outputs(id, { volumeMl: 250, duration: 90, durationUnit: 1, dropFactor: 60 });
      expect(micro.dropsPerMinute).toBeCloseTo(166.6667, 3);
      expect(micro.mlPerHour).toBeCloseTo(166.6667, 3);
      // 100 mL over 30 min
      expect(
        outputs(id, { volumeMl: 100, duration: 30, durationUnit: 1, dropFactor: 20 })
          .dropsPerMinute,
      ).toBeCloseTo(66.6667, 3);
      // 15 and 10 drops/mL sets
      expect(
        outputs(id, { volumeMl: 600, duration: 2, durationUnit: 60, dropFactor: 15 })
          .dropsPerMinute,
      ).toBeCloseTo(75, 9);
      expect(
        outputs(id, { volumeMl: 600, duration: 2, durationUnit: 60, dropFactor: 10 })
          .dropsPerMinute,
      ).toBeCloseTo(50, 9);
    });
    it('rejects a missing or zero duration', () => {
      expect(failure(id, { volumeMl: 500, durationUnit: 1, dropFactor: 20 })).toContain(
        'обязательно',
      );
      expect(
        failure(id, { volumeMl: 500, duration: 0, durationUnit: 1, dropFactor: 20 }),
      ).toContain('минимума');
    });
  });

  describe('infusion rate (mL/h = mcg/kg/min × kg × 60 / mcg per mL)', () => {
    const id = 'minimed.calculator.infusion-rate-mcg-kg-min';
    it('turns a weight-based dose into a pump rate', () => {
      // 5 mcg/kg/min, 70 kg, 200 mg in 50 mL = 4000 mcg/mL → 350 mcg/min → 5.25 mL/h
      expect(
        outputs(id, { doseMcgKgMin: 5, weightKg: 70, drugMg: 200, volumeMl: 50 }).rate,
      ).toBeCloseTo(5.25, 9);
      // 0.1 mcg/kg/min, 80 kg, 4 mg in 50 mL = 80 mcg/mL → 8 mcg/min → 6 mL/h
      expect(
        outputs(id, { doseMcgKgMin: 0.1, weightKg: 80, drugMg: 4, volumeMl: 50 }).rate,
      ).toBeCloseTo(6, 9);
      // doubling the concentration halves the rate
      expect(
        outputs(id, { doseMcgKgMin: 0.1, weightKg: 80, drugMg: 8, volumeMl: 50 }).rate,
      ).toBeCloseTo(3, 9);
    });
    it('scales with weight and dose', () => {
      const one =
        outputs(id, { doseMcgKgMin: 2, weightKg: 3.5, drugMg: 15, volumeMl: 50 }).rate ?? 0;
      const two =
        outputs(id, { doseMcgKgMin: 4, weightKg: 3.5, drugMg: 15, volumeMl: 50 }).rate ?? 0;
      // 15 mg / 50 mL = 300 mcg/mL; 2 × 3.5 × 60 / 300 = 1.4 mL/h
      expect(one).toBeCloseTo(1.4, 9);
      expect(two).toBeCloseTo(2.8, 9);
    });
  });

  describe('percent concentration (1 % = 1 g per 100 mL = 10 mg/mL)', () => {
    const id = 'minimed.calculator.solution-percent-concentration';
    it('converts mass and volume to percent', () => {
      expect(outputs(id, { substance: 5, massUnit: 1000, volumeMl: 100 }).percent).toBeCloseTo(
        5,
        9,
      );
      const milligrams = outputs(id, { substance: 500, massUnit: 1, volumeMl: 10 });
      expect(milligrams.mgPerMl).toBeCloseTo(50, 9);
      expect(milligrams.percent).toBeCloseTo(5, 9);
      expect(outputs(id, { substance: 2000, massUnit: 0.001, volumeMl: 1 }).percent).toBeCloseTo(
        0.2,
        9,
      );
      // 0.9 % saline: 4.5 g in 500 mL
      expect(outputs(id, { substance: 4.5, massUnit: 1000, volumeMl: 500 }).percent).toBeCloseTo(
        0.9,
        9,
      );
    });
  });

  describe('substance in a solution (grams = % × mL / 100)', () => {
    const id = 'minimed.calculator.solution-substance-content';
    it('converts percent and volume to milligrams and grams', () => {
      const saline = outputs(id, { percent: 0.9, volumeMl: 500 });
      expect(saline.massMg).toBeCloseTo(4500, 9);
      expect(saline.massG).toBeCloseTo(4.5, 9);
      expect(outputs(id, { percent: 40, volumeMl: 20 }).massG).toBeCloseTo(8, 9);
      const ampoule = outputs(id, { percent: 10, volumeMl: 10 });
      expect(ampoule.massMg).toBeCloseTo(1000, 9);
      expect(ampoule.massG).toBeCloseTo(1, 9);
    });
    it('is the inverse of the percent calculator', () => {
      const percent = outputs('minimed.calculator.solution-percent-concentration', {
        substance: 3,
        massUnit: 1000,
        volumeMl: 250,
      }).percent;
      const grams = outputs(id, { percent: percent ?? 0, volumeMl: 250 }).massG;
      expect(grams).toBeCloseTo(3, 9);
    });
  });
});
