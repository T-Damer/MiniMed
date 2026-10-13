import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) of ISTH overt DIC, SOFA and MEWS in intensive-care.json.
 *
 * ISTH overt DIC: Taylor FB Jr et al., Thromb Haemost 2001;86:1327-1330 (publisher full text is not
 * openly reachable). Checked against two open reproductions of the scoring table: PMC5011102 (Table 1)
 * and PMC4057033 (Table 1B), which agree: platelets >=100/<100/<50 = 0/1/2; fibrin marker none/moderate/
 * strong = 0/2/3; PT prolongation <3 / >=3 and <6 / >=6 s = 0/1/2; fibrinogen >=1 / <1 g/L = 0/1;
 * total >=5 overt DIC. Taylor's own wording ("<100", ">100", ">3 but <6", ">6", "<1.0") leaves the
 * exact values 100, 3, 6 and 1.0 undefined; the schema follows the reproductions (>=).
 *
 * SOFA: Vincent JL et al., Intensive Care Med 1996;22:707-710 (table reproduced in Lambden et al.,
 * Crit Care 2019, PMC6880479, Table 1; and Singer et al., JAMA 2016). Mortality statements: Ferreira
 * et al., JAMA 2001;286:1754 (abstract: initial and highest score >11 or mean >5 -> mortality >80 %).
 *
 * MEWS: Subbe CP et al., QJM 2001;94:521-526 (abstract: score >=5, OR 5.4 for death, OR 10.9 for ICU
 * admission). The table was checked against the reproduction in PMC8132807 (Table 1); the original
 * leaves SBP 70, HR 40, HR 130 and RR 30 undefined, the schema takes the higher score at each.
 */

const SCHEMAS = loadToolModuleCalculatorSchemas(['content/tool-modules/intensive-care.json']);

type Inputs = Record<string, number>;

function evaluate(key: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${key}`);
  if (!schema) throw new Error(`Missing calculator ${key}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${key}: ${result.error}`);
  return result;
}

function step(key: string, inputs: Inputs, stepId: string): number {
  const entry = evaluate(key, inputs).trace.find((item) => item.id === stepId);
  if (!entry) throw new Error(`${key}: no step ${stepId}`);
  return entry.value;
}

function total(key: string, inputs: Inputs): number {
  const found = evaluate(key, inputs).outputs.find((item) => item.id === 'score');
  if (found?.kind !== 'number') throw new Error(`${key}: no numeric score output`);
  return found.value;
}

function band(key: string, inputs: Inputs) {
  const result = evaluate(key, inputs);
  return {
    rangeId: result.evaluation.verdict?.rangeId,
    text: result.warnings.find((warning) => warning.code === 'interpretation')?.message ?? '',
  };
}

/** Sweeps one input and checks the points of one step (each pair: input value, expected points). */
function edges(
  key: string,
  base: Inputs,
  inputId: string,
  stepId: string,
  pairs: readonly (readonly [number, number])[],
): void {
  for (const [value, expected] of pairs) {
    expect(step(key, { ...base, [inputId]: value }, stepId), `${key} ${inputId}=${value}`).toBe(
      expected,
    );
  }
}

describe('ISTH overt DIC against Taylor 2001', () => {
  const base: Inputs = {
    underlyingDisorder: 1,
    platelets: 250,
    fibrinMarkers: 0,
    prothrombinProlongation: 1,
    fibrinogen: 3,
  };

  it('scores platelets: >=100 = 0, 50-99 = 1, <50 = 2', () => {
    edges('isth-overt-dic', base, 'platelets', 'plateletPoints', [
      [250, 0],
      [100, 0],
      [99.9, 1],
      [50, 1],
      [49.9, 2],
      [0, 2],
    ]);
  });

  it('scores PT prolongation: <3 s = 0, 3 to <6 s = 1, >=6 s = 2', () => {
    edges('isth-overt-dic', base, 'prothrombinProlongation', 'prothrombinPoints', [
      [0, 0],
      [2.9, 0],
      [3, 1],
      [5.9, 1],
      [6, 2],
      [20, 2],
    ]);
  });

  it('scores fibrinogen: >=1 g/L = 0, <1 g/L = 1', () => {
    edges('isth-overt-dic', base, 'fibrinogen', 'fibrinogenPoints', [
      [3, 0],
      [1, 0],
      [0.99, 1],
      [0.2, 1],
    ]);
  });

  it('scores the fibrin marker as 0 / 2 / 3', () => {
    for (const [value, points] of [
      [0, 0],
      [2, 2],
      [3, 3],
    ] as const) {
      expect(step('isth-overt-dic', { ...base, fibrinMarkers: value }, 'markerPoints')).toBe(
        points,
      );
    }
  });

  it('reproduces a hand-computed overt case and the 4/5 cut', () => {
    // Platelets 45 (2) + moderate D-dimer rise (2) + PT +4 s (1) + fibrinogen 0.8 g/L (1) = 6 -> overt.
    const overt = {
      underlyingDisorder: 1,
      platelets: 45,
      fibrinMarkers: 2,
      prothrombinProlongation: 4,
      fibrinogen: 0.8,
    };
    expect(total('isth-overt-dic', overt)).toBe(6);
    expect(band('isth-overt-dic', overt).rangeId).toBe('overt');
    // Platelets 60 (1) + moderate (2) + PT +3 s (1) + fibrinogen 1.2 (0) = 4 -> not overt.
    const four = {
      underlyingDisorder: 1,
      platelets: 60,
      fibrinMarkers: 2,
      prothrombinProlongation: 3,
      fibrinogen: 1.2,
    };
    expect(total('isth-overt-dic', four)).toBe(4);
    const notOvert = band('isth-overt-dic', four);
    expect(notOvert.rangeId).toBe('not-overt');
    expect(notOvert.text).toContain('non-overt');
    // Lowering fibrinogen to 0.9 g/L adds 1 point: 5 -> overt.
    expect(total('isth-overt-dic', { ...four, fibrinogen: 0.9 })).toBe(5);
    expect(band('isth-overt-dic', { ...four, fibrinogen: 0.9 }).rangeId).toBe('overt');
  });

  it('reaches the published maximum of 8 and refuses a patient without an underlying disorder', () => {
    expect(
      total('isth-overt-dic', {
        underlyingDisorder: 1,
        platelets: 10,
        fibrinMarkers: 3,
        prothrombinProlongation: 10,
        fibrinogen: 0.5,
      }),
    ).toBe(8);
    const schema = SCHEMAS.find(
      (candidate) => candidate.id === 'minimed.calculator.isth-overt-dic',
    );
    if (!schema) throw new Error('missing schema');
    expect(evaluateCalculatorSchema(schema, { ...base, underlyingDisorder: 0 }).ok).toBe(false);
  });
});

describe('SOFA against Vincent 1996 / Sepsis-3', () => {
  // All organ systems normal: 0 points.
  const base: Inputs = {
    pao2fio2: 450,
    respiratorySupport: 0,
    platelets: 250,
    bilirubin: 10,
    cardiovascular: 0,
    gcs: 15,
    creatinine: 80,
  };

  it('scores respiration: <400 = 1, <300 = 2, <200 and <100 only with ventilatory support', () => {
    edges('sofa', base, 'pao2fio2', 'respiration', [
      [400, 0],
      [399, 1],
      [300, 1],
      [299, 2],
      [200, 2],
      [199, 2],
      [100, 2],
      [99, 2],
    ]);
    const ventilated = { ...base, respiratorySupport: 1 };
    edges('sofa', ventilated, 'pao2fio2', 'respiration', [
      [200, 2],
      [199, 3],
      [100, 3],
      [99, 4],
    ]);
  });

  it('scores platelets: <150 = 1, <100 = 2, <50 = 3, <20 = 4', () => {
    edges('sofa', base, 'platelets', 'coagulation', [
      [150, 0],
      [149, 1],
      [100, 1],
      [99, 2],
      [50, 2],
      [49, 3],
      [20, 3],
      [19, 4],
    ]);
  });

  it('scores bilirubin in umol/L: <20, 20-32, 33-101, 102-204, >204', () => {
    edges('sofa', base, 'bilirubin', 'liver', [
      [19.9, 0],
      [20, 1],
      [32, 1],
      [33, 2],
      [101, 2],
      [102, 3],
      [204, 3],
      [204.1, 4],
      [300, 4],
    ]);
  });

  it('scores the cardiovascular rows 0-4 as the selected category', () => {
    for (const tier of [0, 1, 2, 3, 4]) {
      expect(step('sofa', { ...base, cardiovascular: tier }, 'circulation')).toBe(tier);
    }
  });

  it('scores the Glasgow Coma Scale: 15 = 0, 13-14 = 1, 10-12 = 2, 6-9 = 3, <6 = 4', () => {
    edges('sofa', base, 'gcs', 'nervousSystem', [
      [15, 0],
      [14, 1],
      [13, 1],
      [12, 2],
      [10, 2],
      [9, 3],
      [6, 3],
      [5, 4],
      [3, 4],
    ]);
  });

  it('scores creatinine in umol/L: <110, 110-170, 171-299, 300-440, >440', () => {
    edges('sofa', base, 'creatinine', 'renal', [
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

  it('uses daily urine output as the alternative renal criterion (<500 mL = 3, <200 mL = 4)', () => {
    edges('sofa', base, 'urineOutput', 'renal', [
      [500, 0],
      [499, 3],
      [200, 3],
      [199, 4],
    ]);
    // the worse of creatinine and urine output counts
    expect(step('sofa', { ...base, creatinine: 441, urineOutput: 400 }, 'renal')).toBe(4);
  });

  it('adds the six systems and cuts the Sepsis-3 / Ferreira bands', () => {
    expect(total('sofa', base)).toBe(0);
    expect(band('sofa', base).rangeId).toBe('below-threshold');
    // Hand-computed: P/F 150 ventilated (3) + platelets 80 (2) + bilirubin 40 (2) + noradrenaline
    // 0.2 ug/kg/min (4) + GCS 11 (2) + creatinine 250 (2) = 15 -> above 11.
    const severe = {
      pao2fio2: 150,
      respiratorySupport: 1,
      platelets: 80,
      bilirubin: 40,
      cardiovascular: 4,
      gcs: 11,
      creatinine: 250,
    };
    expect(total('sofa', severe)).toBe(15);
    const high = band('sofa', severe);
    expect(high.rangeId).toBe('very-high');
    expect(high.text).toContain('80 %');
    // 1 point is below the Sepsis-3 threshold of 2; 2 points are organ dysfunction.
    expect(band('sofa', { ...base, platelets: 140 }).rangeId).toBe('below-threshold');
    const two = band('sofa', { ...base, platelets: 90 });
    expect(two.rangeId).toBe('organ-dysfunction');
    expect(two.text).toContain('10 %');
    // 11 points stay organ dysfunction, 12 reach the >11 band.
    const nine = { ...severe, creatinine: 80, bilirubin: 10, cardiovascular: 2 };
    // 3 + 2 + 0 + 2 + 2 + 0 = 9; add bilirubin 120 (3) -> 12
    expect(total('sofa', nine)).toBe(9);
    expect(total('sofa', { ...nine, bilirubin: 120 })).toBe(12);
    expect(band('sofa', { ...nine, bilirubin: 120 }).rangeId).toBe('very-high');
    expect(band('sofa', { ...nine, bilirubin: 60 }).rangeId).toBe('organ-dysfunction');
    expect(total('sofa', { ...nine, bilirubin: 60 })).toBe(11);
  });
});

describe('MEWS against Subbe 2001', () => {
  const base: Inputs = {
    systolicBp: 130,
    heartRate: 75,
    respiratoryRate: 12,
    temperature: 37,
    avpu: 0,
  };

  it('scores systolic pressure: <=70 = 3, 71-80 = 2, 81-100 = 1, 101-199 = 0, >=200 = 2', () => {
    edges('mews', base, 'systolicBp', 'pressure', [
      [69, 3],
      [70, 3],
      [71, 2],
      [80, 2],
      [81, 1],
      [100, 1],
      [101, 0],
      [199, 0],
      [200, 2],
    ]);
  });

  it('scores heart rate: <=40 = 2, 41-50 = 1, 51-100 = 0, 101-110 = 1, 111-129 = 2, >=130 = 3', () => {
    edges('mews', base, 'heartRate', 'heart', [
      [39, 2],
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
      [131, 3],
    ]);
  });

  it('scores respiratory rate: <9 = 2, 9-14 = 0, 15-20 = 1, 21-29 = 2, >=30 = 3', () => {
    edges('mews', base, 'respiratoryRate', 'breathing', [
      [8, 2],
      [9, 0],
      [14, 0],
      [15, 1],
      [20, 1],
      [21, 2],
      [29, 2],
      [30, 3],
      [31, 3],
    ]);
  });

  it('scores temperature: <35 = 2, 35-38.4 = 0, >=38.5 = 2', () => {
    edges('mews', base, 'temperature', 'heat', [
      [34.9, 2],
      [35, 0],
      [38.4, 0],
      [38.5, 2],
    ]);
  });

  it('scores AVPU as 0 / 1 / 2 / 3', () => {
    for (const level of [0, 1, 2, 3]) {
      expect(step('mews', { ...base, avpu: level }, 'mind')).toBe(level);
    }
  });

  it('reproduces a hand-computed case and the cut at 5 with the abstract odds ratios', () => {
    // SBP 75 (2) + HR 115 (2) + RR 22 (2) + temperature 38.6 (2) + responds to voice (1) = 9.
    const nine = {
      systolicBp: 75,
      heartRate: 115,
      respiratoryRate: 22,
      temperature: 38.6,
      avpu: 1,
    };
    expect(total('mews', nine)).toBe(9);
    const high = band('mews', nine);
    expect(high.rangeId).toBe('higher');
    expect(high.text).toContain('5,4');
    expect(high.text).toContain('10,9');
    // Four points: SBP 90 (1) + HR 105 (1) + RR 16 (1) + voice (1) = 4 -> below the threshold.
    const four = { systolicBp: 90, heartRate: 105, respiratoryRate: 16, temperature: 37, avpu: 1 };
    expect(total('mews', four)).toBe(4);
    expect(band('mews', four).rangeId).toBe('lower');
    // Adding one more point (temperature 38.5 = 2 instead of 0 gives 6; use RR 21 = 2 instead of 1 -> 5).
    expect(total('mews', { ...four, respiratoryRate: 21 })).toBe(5);
    expect(band('mews', { ...four, respiratoryRate: 21 }).rangeId).toBe('higher');
  });

  it('reaches the maximum of 14', () => {
    expect(
      total('mews', {
        systolicBp: 70,
        heartRate: 130,
        respiratoryRate: 30,
        temperature: 38.5,
        avpu: 3,
      }),
    ).toBe(14);
  });
});
