import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13).
 *  - HOMA-IR / HOMA-B: Matthews 1985 definition (a normal person has HOMA-IR 1 and HOMA-B 100 %, i.e.
 *    fasting insulin 5 mU/L with glucose 4.5 mmol/L); thresholds read in the Russian diabetes
 *    algorithms 12th ed. (2025), table "Insulin resistance": HOMA-IR < 3.2 (children) / < 2.77 (adults),
 *    Matsuda > 2.6 (children) / > 3.4 (adults), Matsuda formula 10000 / sqrt(...) with mg/dl and mU/ml.
 *  - Basal metabolic rate: Harris & Benedict, Carnegie Institution Publication 279 (1919), regression
 *    equations on pp. 227-228 (archive.org full text), and the Mifflin 1990 abstract.
 *  - Burch-Wartofsky: point table cross-checked in four independent open-access reproductions
 *    (the primary 1993 chapter itself is paywalled).
 */
const SCHEMAS = loadToolModuleCalculatorSchemas(['content/tool-modules/metabolic-lab.json']);
type Inputs = Record<string, number | string>;

function run(name: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${name}`);
  if (!schema) throw new Error(`Missing calculator ${name}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  const values = new Map<string, number | string>();
  for (const output of result.outputs) {
    if (output.kind === 'number') values.set(output.id, output.value);
    if (output.kind === 'text') values.set(output.id, output.text);
  }
  return { values, range: result.evaluation.verdict?.rangeId };
}

describe('HOMA-IR and HOMA-B (Matthews 1985; Russian algorithms thresholds)', () => {
  it('gives 1.0 and 100 % for the reference normal person of the HOMA model', () => {
    const result = run('homa-ir', {
      glucose: 4.5,
      glucoseUnit: 'mmol/l',
      insulin: 5,
      population: 'adult',
    });
    expect(result.values.get('homaIr')).toBe(1);
    expect(result.values.get('homaBeta')).toBeCloseTo(100, 6);
  });

  it('uses 2.77 for adults and 3.2 for children as the upper limit of normal', () => {
    // 5.5 mmol/l x 12.0 mU/ml / 22.5 = 2.933: above the adult limit, below the child limit.
    const inputs = { glucose: 5.5, glucoseUnit: 'mmol/l', insulin: 12 } as const;
    expect(run('homa-ir', { ...inputs, population: 'adult' }).range).toBe('insulin-resistance');
    expect(run('homa-ir', { ...inputs, population: 'child' }).range).toBe('below-threshold');
  });
});

describe('Matsuda index (Matsuda & DeFronzo 1999; Russian algorithms thresholds)', () => {
  const glucose = [90, 150, 170, 150, 120] as const; // mg/dl at 0, 30, 60, 90, 120 min
  const insulin = [10, 60, 70, 50, 40] as const; // mU/ml
  const inputs: Inputs = {
    glucoseUnit: 'mg/dl',
    glucose0: glucose[0],
    glucose30: glucose[1],
    glucose60: glucose[2],
    glucose90: glucose[3],
    glucose120: glucose[4],
    insulin0: insulin[0],
    insulin30: insulin[1],
    insulin60: insulin[2],
    insulin90: insulin[3],
    insulin120: insulin[4],
  };

  it('computes 10000 / sqrt(G0 x I0 x meanG x meanI)', () => {
    // meanG 136, meanI 46: 10000 / sqrt(90 x 10 x 136 x 46) = 4.2144
    const result = run('matsuda-isi', { ...inputs, population: 'adult' });
    expect(result.values.get('isi')).toBeCloseTo(4.21, 2);
    expect(result.range).toBe('above-threshold');
  });

  it('converts mmol/l glucose to mg/dl before the formula', () => {
    const mmol: Inputs = { ...inputs, glucoseUnit: 'mmol/l' };
    for (const key of ['glucose0', 'glucose30', 'glucose60', 'glucose90', 'glucose120']) {
      mmol[key] = Number(inputs[key]) / 18.016;
    }
    const result = run('matsuda-isi', { ...mmol, population: 'adult' });
    expect(result.values.get('isi')).toBeCloseTo(4.21, 2);
  });

  it('applies > 3.4 for adults and > 2.6 for children', () => {
    const high: Inputs = { ...inputs };
    for (const key of ['insulin0', 'insulin30', 'insulin60', 'insulin90', 'insulin120']) {
      high[key] = Number(inputs[key]) * 1.3;
    }
    // x1.3 on every insulin value divides the index by 1.3: 4.2144 / 1.3 = 3.2419
    expect(run('matsuda-isi', { ...high, population: 'adult' }).range).toBe('insulin-resistance');
    expect(run('matsuda-isi', { ...high, population: 'child' }).range).toBe('above-threshold');
  });
});

describe('Basal metabolic rate (Harris-Benedict 1919, Mifflin 1990)', () => {
  const man: Inputs = { sex: 'male', ageYears: 30, weight: 70, height: 175 };
  const woman: Inputs = { sex: 'female', ageYears: 30, weight: 60, height: 165 };

  it('evaluates the Harris-Benedict regression equations of the 1919 monograph', () => {
    // men: 66.4730 + 13.7516 W + 5.0033 S - 6.7550 A = 66.473 + 962.612 + 875.5775 - 202.65
    expect(
      run('basal-metabolic-rate', { ...man, equation: 'harris' }).values.get('bmr'),
    ).toBeCloseTo(1702.0125, 4);
    // women: 655.0955 + 9.5634 W + 1.8496 S - 4.6756 A = 655.0955 + 573.804 + 305.184 - 140.268
    expect(
      run('basal-metabolic-rate', { ...woman, equation: 'harris' }).values.get('bmr'),
    ).toBeCloseTo(1393.8155, 4);
  });

  it('evaluates the simplified Mifflin-St Jeor equations printed in the 1990 abstract', () => {
    // males: 10 W + 6.25 H - 5 A + 5 = 700 + 1093.75 - 150 + 5
    expect(
      run('basal-metabolic-rate', { ...man, equation: 'mifflin' }).values.get('bmr'),
    ).toBeCloseTo(1648.75, 6);
    // females: 10 W + 6.25 H - 5 A - 161 = 600 + 1031.25 - 150 - 161
    expect(
      run('basal-metabolic-rate', { ...woman, equation: 'mifflin' }).values.get('bmr'),
    ).toBeCloseTo(1320.25, 6);
  });

  it('multiplies by the activity factor only when one is given', () => {
    const plain = run('basal-metabolic-rate', { ...man, equation: 'mifflin' });
    expect(plain.values.get('energy')).toBeUndefined();
    const active = run('basal-metabolic-rate', {
      ...man,
      equation: 'mifflin',
      activityFactor: 1.5,
    });
    expect(active.values.get('energy')).toBeCloseTo(1648.75 * 1.5, 6);
  });
});

describe('Burch-Wartofsky point scale', () => {
  const none: Inputs = {
    temperature: 36.6,
    cns: 0,
    gastro: 0,
    heartRate: 70,
    heartFailure: 0,
    atrialFibrillation: 0,
    precipitant: 0,
  };

  it('adds the printed points for a full worked case', () => {
    // 38.9 C = 102 F: 20; HR 125: 15; delirium: 20; vomiting: 10; pedal oedema: 5; AF: 10;
    // precipitant: 10 -> 90
    const result = run('burch-wartofsky', {
      temperature: 38.9,
      cns: 20,
      gastro: 10,
      heartRate: 125,
      heartFailure: 5,
      atrialFibrillation: 1,
      precipitant: 1,
    });
    expect(result.values.get('score')).toBe(90);
    expect(result.range).toBe('storm');
  });

  it('scores temperature in the printed steps (99, 100, ... 104 F = 37.2 ... 40.0 C)', () => {
    const points: ReadonlyArray<readonly [number, number]> = [
      [37.1, 0],
      [37.2, 5],
      [37.8, 10],
      [38.3, 15],
      [38.9, 20],
      [39.4, 25],
      [40, 30],
    ];
    for (const [temperature, expected] of points) {
      expect(run('burch-wartofsky', { ...none, temperature }).values.get('score')).toBe(expected);
    }
  });

  it('scores heart rate 90-109 as 5 and then 10 / 15 / 20 / 25 per 10 beats up to 140', () => {
    const points: ReadonlyArray<readonly [number, number]> = [
      [89, 0],
      [90, 5],
      [109, 5],
      [110, 10],
      [120, 15],
      [130, 20],
      [140, 25],
    ];
    for (const [heartRate, expected] of points) {
      expect(run('burch-wartofsky', { ...none, heartRate }).values.get('score')).toBe(expected);
    }
  });

  it('cuts at 25 (impending) and 45 (storm); below 25 is unlikely', () => {
    const at = (score: number) => {
      const table: Record<number, Inputs> = {
        20: { ...none, temperature: 38.9 },
        25: { ...none, temperature: 38.9, heartRate: 95 },
        40: { ...none, temperature: 38.9, cns: 20 },
        45: { ...none, temperature: 38.9, cns: 20, heartRate: 95 },
      };
      return run('burch-wartofsky', table[score] as Inputs);
    };
    expect(at(20).range).toBe('unlikely');
    expect(at(25).range).toBe('impending');
    expect(at(40).range).toBe('impending');
    expect(at(45).range).toBe('storm');
  });
});
