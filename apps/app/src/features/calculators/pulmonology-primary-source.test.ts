import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) of the two pneumonia scores in pulmonology.json.
 *
 * PSI/PORT: Fine MJ et al., N Engl J Med 1997;336:243-250 (abstract PMID 8995086: class I 0.1-0.4 %,
 * II 0.6-0.7 %, III 0.9-2.8 %). The item table and the class II-V points were checked against the
 * open reproduction in the IDSA guideline (Bartlett et al., Clin Infect Dis 2000;31:347, PMC7109923;
 * class IV 8.2-9.3 %, class V 27.0-31.1 %) and the PSI table reproduced in PMC11153623 (Table 1).
 *
 * SMART-COP: Charles PG et al., Clin Infect Dis 2008;47:375-384 (abstract PMID 18558884). The full
 * item table is behind the publisher; it was checked against two open reproductions (PMC7126707,
 * PMC13219718) that agree with each other and with the schema.
 */

const MODULE_FILE = 'content/tool-modules/pulmonology.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;

function run(id: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${id}: expected a numeric output`);
  return {
    score: output.value,
    rangeId: result.evaluation.verdict?.rangeId,
    text: result.warnings.find((warning) => warning.code === 'interpretation')?.message ?? '',
    step: (stepId: string) => result.trace.find((entry) => entry.id === stepId)?.value,
  };
}

describe('PSI/PORT against Fine 1997', () => {
  const id = 'minimed.calculator.psi-port';
  // A man of 70 with every other item normal scores exactly his age: 70 points (class II).
  const base: Inputs = {
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
  const points = (overrides: Inputs) => run(id, { ...base, ...overrides }).step('points');

  it('scores the base case as age only', () => {
    expect(points({})).toBe(70);
  });

  it('adds the published points for demographics and comorbidity', () => {
    // Fine Table 3: nursing home +10, neoplastic +30, liver +20, CHF +10, cerebrovascular +10, renal +10.
    expect(points({ nursingHome: 1 })).toBe(80);
    expect(points({ neoplasm: 1 })).toBe(100);
    expect(points({ liverDisease: 1 })).toBe(90);
    expect(points({ heartFailure: 1 })).toBe(80);
    expect(points({ cerebrovascular: 1 })).toBe(80);
    expect(points({ renalDisease: 1 })).toBe(80);
    // Women: age minus 10.
    expect(points({ sex: 'female' })).toBe(60);
  });

  it('adds the published points for examination findings at their exact cut-points', () => {
    // altered mental status +20; RR >=30 +20; SBP <90 +20; temperature <35 or >=40 +15; pulse >=125 +10.
    expect(points({ alteredMentalStatus: 1 })).toBe(90);
    expect(points({ respiratoryRate: 29 })).toBe(70);
    expect(points({ respiratoryRate: 30 })).toBe(90);
    expect(points({ systolicBp: 90 })).toBe(70);
    expect(points({ systolicBp: 89 })).toBe(90);
    expect(points({ temperature: 35 })).toBe(70);
    expect(points({ temperature: 34.9 })).toBe(85);
    expect(points({ temperature: 39.9 })).toBe(70);
    expect(points({ temperature: 40 })).toBe(85);
    expect(points({ heartRate: 124 })).toBe(70);
    expect(points({ heartRate: 125 })).toBe(80);
  });

  it('adds the published points for laboratory findings at their exact cut-points', () => {
    // pH <7.35 +30; BUN >=30 mg/dL (urea 10.7 mmol/L) +20; Na <130 +20; glucose >=250 mg/dL (13.9 mmol/L) +10;
    // haematocrit <30 % +10; PaO2 <60 mmHg or SaO2 <90 % +10 (once); pleural effusion +10.
    expect(points({ arterialPh: 7.35 })).toBe(70);
    expect(points({ arterialPh: 7.34 })).toBe(100);
    expect(points({ urea: 10.6 })).toBe(70);
    expect(points({ urea: 10.7 })).toBe(90);
    expect(points({ sodium: 130 })).toBe(70);
    expect(points({ sodium: 129 })).toBe(90);
    expect(points({ glucose: 13.8 })).toBe(70);
    expect(points({ glucose: 13.9 })).toBe(80);
    expect(points({ hematocrit: 30 })).toBe(70);
    expect(points({ hematocrit: 29.9 })).toBe(80);
    expect(points({ pao2: 60 })).toBe(70);
    expect(points({ pao2: 59 })).toBe(80);
    expect(points({ spo2: 90 })).toBe(70);
    expect(points({ spo2: 89 })).toBe(80);
    // hypoxaemia counts once even when both PaO2 and SaO2 qualify
    expect(points({ pao2: 50, spo2: 85 })).toBe(80);
    expect(points({ pleuralEffusion: 1 })).toBe(80);
  });

  it('reproduces a hand-computed class IV case', () => {
    // Woman 70 (70 - 10 = 60) + heart failure 10 + RR 30 (20) + pulse 125 (10) = 100 points -> class IV.
    const result = run(id, {
      ...base,
      sex: 'female',
      heartFailure: 1,
      respiratoryRate: 30,
      heartRate: 125,
    });
    expect(result.step('points')).toBe(100);
    expect(result.score).toBe(4);
    expect(result.rangeId).toBe('class-4');
  });

  it('reproduces a hand-computed class V case with every item present', () => {
    // Woman 72: 62; nursing home 72; CHF 82; RR 32: 102; SBP 85: 122; pH 7.30: 152; urea 12: 172;
    // Na 128: 192; haematocrit 28: 202; hypoxaemia (PaO2 55 and SaO2 85 count once): 212;
    // effusion: 222 -> class V.
    const result = run(id, {
      ...base,
      ageYears: 72,
      sex: 'female',
      nursingHome: 1,
      heartFailure: 1,
      respiratoryRate: 32,
      systolicBp: 85,
      arterialPh: 7.3,
      urea: 12,
      sodium: 128,
      hematocrit: 28,
      pao2: 55,
      spo2: 85,
      pleuralEffusion: 1,
    });
    expect(result.step('points')).toBe(222);
    expect(result.score).toBe(5);
    expect(result.rangeId).toBe('class-5');
  });

  it('cuts the risk classes at 70/71, 90/91 and 130/131 and carries the published mortality ranges', () => {
    const cases: readonly (readonly [number, number, string])[] = [
      [70, 2, '0,6–0,7 %'],
      [71, 3, '0,9–2,8 %'],
      [90, 3, '0,9–2,8 %'],
      [91, 4, '8,2–9,3 %'],
      [100, 4, '8,2–9,3 %'],
    ];
    for (const [age, klass, mortality] of cases) {
      const result = run(id, { ...base, ageYears: age });
      expect(result.score, `age ${age}`).toBe(klass);
      expect(result.text, `age ${age}`).toContain(mortality);
    }
    // 130 and 131 points: man 100 + neoplasm 30 = 130, man 101 + neoplasm 30 = 131.
    expect(run(id, { ...base, ageYears: 100, neoplasm: 1 }).score).toBe(4);
    const five = run(id, { ...base, ageYears: 101, neoplasm: 1 });
    expect(five.score).toBe(5);
    expect(five.text).toContain('27,0–31,1 %');
  });

  it('assigns class I from step 1 and carries 0.1-0.4 %', () => {
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
    const result = run(id, youngWell);
    expect(result.score).toBe(1);
    expect(result.rangeId).toBe('class-1');
    expect(result.text).toContain('0,1–0,4 %');
    // age 51 leaves class I, so the laboratory block becomes mandatory
    const schema = SCHEMAS.find((candidate) => candidate.id === id);
    if (!schema) throw new Error(`Missing calculator ${id}`);
    expect(evaluateCalculatorSchema(schema, { ...youngWell, ageYears: 51 }).ok).toBe(false);
  });
});

describe('SMART-COP against Charles 2008', () => {
  const id = 'minimed.calculator.smart-cop';
  // Age 40, every item normal: 0 points.
  const base: Inputs = {
    ageYears: 40,
    systolicBp: 120,
    multilobar: 0,
    albumin: 40,
    respiratoryRate: 18,
    heartRate: 80,
    confusion: 0,
    spo2: 98,
    arterialPh: 7.4,
  };
  const score = (overrides: Inputs) => run(id, { ...base, ...overrides }).score;

  it('scores the normal case as zero and the maximum as 11', () => {
    expect(score({})).toBe(0);
    // SBP 2 + multilobar 1 + albumin 1 + RR 1 + HR 1 + confusion 1 + oxygen 2 + pH 2 = 11
    expect(
      score({
        systolicBp: 85,
        multilobar: 1,
        albumin: 30,
        respiratoryRate: 32,
        heartRate: 130,
        confusion: 1,
        spo2: 88,
        arterialPh: 7.3,
        ageYears: 66,
      }),
    ).toBe(11);
  });

  it('scores each non-age item at its published cut-point', () => {
    // SBP <90: 2 points
    expect(score({ systolicBp: 90 })).toBe(0);
    expect(score({ systolicBp: 89 })).toBe(2);
    // multilobar involvement: 1; confusion: 1
    expect(score({ multilobar: 1 })).toBe(1);
    expect(score({ confusion: 1 })).toBe(1);
    // albumin <3.5 g/dL = 35 g/L: 1
    expect(score({ albumin: 35 })).toBe(0);
    expect(score({ albumin: 34.9 })).toBe(1);
    // tachycardia >=125: 1
    expect(score({ heartRate: 124 })).toBe(0);
    expect(score({ heartRate: 125 })).toBe(1);
    // arterial pH <7.35: 2
    expect(score({ arterialPh: 7.35 })).toBe(0);
    expect(score({ arterialPh: 7.34 })).toBe(2);
  });

  it('applies the age-adjusted respiratory-rate threshold (>=25 at 50 or younger, >=30 above 50)', () => {
    expect(score({ ageYears: 50, respiratoryRate: 24 })).toBe(0);
    expect(score({ ageYears: 50, respiratoryRate: 25 })).toBe(1);
    expect(score({ ageYears: 51, respiratoryRate: 25 })).toBe(0);
    expect(score({ ageYears: 51, respiratoryRate: 29 })).toBe(0);
    expect(score({ ageYears: 51, respiratoryRate: 30 })).toBe(1);
  });

  it('applies the age-adjusted oxygenation criteria and counts them once', () => {
    // age <=50: PaO2 <70 mmHg, or SaO2 <=93 %, or PaO2/FiO2 <333
    const young: Inputs = { ageYears: 50, spo2: 98 };
    expect(score({ ...young, spo2: 94 })).toBe(0);
    expect(score({ ...young, spo2: 93 })).toBe(2);
    expect(score({ ...young, pao2: 70 })).toBe(0);
    expect(score({ ...young, pao2: 69 })).toBe(2);
    expect(score({ ...young, pf: 333 })).toBe(0);
    expect(score({ ...young, pf: 332 })).toBe(2);
    // age >50: PaO2 <60 mmHg, or SaO2 <=90 %, or PaO2/FiO2 <250
    const old: Inputs = { ageYears: 51, spo2: 98 };
    expect(score({ ...old, spo2: 91 })).toBe(0);
    expect(score({ ...old, spo2: 90 })).toBe(2);
    expect(score({ ...old, pao2: 60 })).toBe(0);
    expect(score({ ...old, pao2: 59 })).toBe(2);
    expect(score({ ...old, pf: 250 })).toBe(0);
    expect(score({ ...old, pf: 249 })).toBe(2);
    // a saturation of 93 % is hypoxaemic at 50 but not at 51
    expect(score({ ageYears: 51, spo2: 93 })).toBe(0);
    // all three criteria together still give 2 points, not 6
    expect(score({ ...old, spo2: 85, pao2: 50, pf: 150 })).toBe(2);
  });

  it('cuts the risk bands at 2/3, 4/5 and 6/7 with the published proportions', () => {
    // SBP 85 (2) + multilobar (1) = 3 -> moderate, about 1 in 8; >=3 caught 92 % of IRVS patients
    const moderate = run(id, { ...base, systolicBp: 85, multilobar: 1 });
    expect(moderate.score).toBe(3);
    expect(moderate.rangeId).toBe('moderate');
    expect(moderate.text).toContain('1 из 8');
    expect(moderate.text).toContain('92 %');
    // 2 points stay low
    const low = run(id, { ...base, systolicBp: 85 });
    expect(low.score).toBe(2);
    expect(low.rangeId).toBe('low');
    // 4 points stay moderate: pH 7.30 (2) + SBP 85 (2)
    expect(run(id, { ...base, systolicBp: 85, arterialPh: 7.3 }).rangeId).toBe('moderate');
    // 5 points -> high, about 1 in 3: 2 + 2 + 1 (confusion)
    const high = run(id, { ...base, systolicBp: 85, arterialPh: 7.3, confusion: 1 });
    expect(high.score).toBe(5);
    expect(high.rangeId).toBe('high');
    expect(high.text).toContain('1 из 3');
    // 6 points stay high
    expect(
      run(id, { ...base, systolicBp: 85, arterialPh: 7.3, confusion: 1, multilobar: 1 }).rangeId,
    ).toBe('high');
    // 7 points -> very high, about 2 in 3: 2 + 2 + 2 (oxygen) + 1
    const veryHigh = run(id, {
      ...base,
      systolicBp: 85,
      arterialPh: 7.3,
      spo2: 90,
      confusion: 1,
    });
    expect(veryHigh.score).toBe(7);
    expect(veryHigh.rangeId).toBe('very-high');
    expect(veryHigh.text).toContain('2 из 3');
  });
});
