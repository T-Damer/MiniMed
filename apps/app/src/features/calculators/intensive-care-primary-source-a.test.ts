import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Verification pass 2026-10-13 for six intensive-care calculators.
 *
 * Sources actually read (see the final review report for the exact status of each item):
 * - APACHE II: Knaus 1985 scoring form as reproduced in "ALLEGATO 3. APACHE 2 SCORE"
 *   (spinuti.unict.it/assets/files/allegato_3.pdf), cross-checked with EBMcalc/MSD and the SFAR
 *   page. The original Crit Care Med full text is paywalled and was not read.
 * - MPM II: Lemeshow 1993 / 1994 tables 7 and 8 as reproduced by Serrano Hernandez et al.,
 *   Med Intensiva 2000;24:49-60 (incl. two worked examples), and Arabi et al., Saudi Med J 2002
 *   appendix (admission coefficients). The JAMA text is paywalled; the 72 h constant is NOT
 *   confirmed by any reproduction read.
 * - Nitrogen balance: the standard formula attributed to Blackburn 1977 by citing literature
 *   (PMC7602201, PMC5442349); the 1977 paper itself is paywalled.
 * - RASS: Table reproduced from Sessler 2002 in open-access papers (PMC9358336, PMC8759207).
 * - Ramsay: scale reproduced by M. Ramsay himself, Proc Bayl Univ Med Cent 2000 (PMC1317048),
 *   and Mayo Clin Proc 2006 (PMC1413967).
 */
const MODULE_FILE = 'content/tool-modules/intensive-care.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number>;
type Edge = readonly [value: number, expected: number];

function schemaOf(key: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${key}`);
  if (!schema) throw new Error(`Missing calculator ${key}`);
  return schema;
}

function evaluate(key: string, inputs: Inputs) {
  const result = evaluateCalculatorSchema(schemaOf(key), inputs);
  if (!result.ok) throw new Error(`${key}: ${result.error}`);
  return result;
}

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
  return { rangeId: result.evaluation.verdict?.rangeId, text: interpretation?.message ?? '' };
}

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
    expect(stepValue(key, inputs, stepId), `${key}: ${inputId}=${value} -> ${stepId}`).toBe(
      expected,
    );
  }
}

const logistic = (logit: number) => (100 * Math.exp(logit)) / (1 + Math.exp(logit));

describe('APACHE II against the Knaus 1985 scoring form', () => {
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

  it('scores every row of the form at both edges of each printed range', () => {
    // Ranges and points as printed on the form (high +4..+1, normal 0, low +1..+4).
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
    expectEdges('apache-ii', base, 'pao2', 'oxygenationPoints', [
      [71, 0],
      [70, 1],
      [61, 1],
      [60, 3],
      [55, 3],
      [54, 4],
    ]);
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
    expectEdges('apache-ii', base, 'creatinine', 'creatininePoints', [
      [3.5, 4],
      [3.4, 3],
      [2, 3],
      [1.9, 2],
      [1.5, 2],
      [1.4, 0],
      [0.6, 0],
      [0.59, 2],
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
  });

  it('uses the serum bicarbonate rows only when no pH is given', () => {
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
  });

  it('doubles creatinine points in acute renal failure and converts micromoles', () => {
    expectEdges(
      'apache-ii',
      base,
      'creatinine',
      'creatininePoints',
      [
        [3.5, 8],
        [3.4, 6],
        [2, 6],
        [1.9, 4],
        [1.5, 4],
        [1.4, 0],
      ],
      { acuteRenalFailure: 1 },
    );
    // 88.4 umol/L = 1.0 mg/dL (0 points); 310 umol/L = 3.51 mg/dL (4 points)
    expect(
      stepValue('apache-ii', { ...base, creatinineUnit: 1, creatinine: 88.4 }, 'creatininePoints'),
    ).toBe(0);
    expect(
      stepValue('apache-ii', { ...base, creatinineUnit: 1, creatinine: 310 }, 'creatininePoints'),
    ).toBe(4);
  });

  it('uses A-aDO2 only for FiO2 >= 0.5 (713*FiO2 - PaCO2/0.8 - PaO2) and PaO2 below it', () => {
    // FiO2 100 %, PaCO2 40: gradient = 713 - 50 - PaO2 = 663 - PaO2
    expectEdges('apache-ii', { ...base, fio2: 100 }, 'pao2', 'oxygenationPoints', [
      [163, 4],
      [164, 3],
      [313, 3],
      [314, 2],
      [463, 2],
      [464, 0],
    ]);
    expect(stepValue('apache-ii', { ...base, fio2: 100, pao2: 163 }, 'gradient')).toBe(500);
    // FiO2 49 % is below the 0.5 threshold: PaO2 row is used (54 -> 4 points)
    expect(stepValue('apache-ii', { ...base, fio2: 49, pao2: 54 }, 'oxygenationPoints')).toBe(4);
    // FiO2 50 % with PaO2 54 uses the gradient: 356.5 - 50 - 54 = 252.5 -> 2 points
    expect(stepValue('apache-ii', { ...base, fio2: 50, pao2: 54 }, 'oxygenationPoints')).toBe(2);
  });

  it('scores GCS as 15 minus the actual score and chronic health 5 or 2 points', () => {
    expectEdges('apache-ii', base, 'gcs', 'glasgowPoints', [
      [15, 0],
      [14, 1],
      [8, 7],
      [3, 12],
    ]);
    const chronic = (admissionType: number, chronicFailure: number) =>
      stepValue('apache-ii', { ...base, admissionType, chronicFailure }, 'chronicPoints');
    expect(chronic(0, 1)).toBe(5); // non-operative
    expect(chronic(1, 1)).toBe(5); // emergency postoperative
    expect(chronic(2, 1)).toBe(2); // elective postoperative
    expect(chronic(0, 0)).toBe(0);
  });

  it('hand-computed case: sum of 12 physiology rows + age + chronic health', () => {
    // Rows: temp 39.2 (3), MAP 120 (2), HR 115 (2), RR 28 (1),
    // FiO2 60 %, PaCO2 40, PaO2 90 -> A-aDO2 = 427.8 - 50 - 90 = 287.8 (2),
    // pH 7.30 (2), Na 132 (0), K 5.7 (1), creatinine 2.4 mg/dL (3) x2 ARF = 6,
    // Hct 28 (2), WBC 18 (1), GCS 12 (3)  => APS = 3+2+2+1+2+2+0+1+6+2+1+3 = 25
    // Age 68 (5), chronic health in a non-operative patient (5)  => 35
    const example: Inputs = {
      ...base,
      temperature: 39.2,
      meanArterialPressure: 120,
      heartRate: 115,
      respiratoryRate: 28,
      fio2: 60,
      pao2: 90,
      paco2: 40,
      ph: 7.3,
      sodium: 132,
      potassium: 5.7,
      creatinine: 2.4,
      acuteRenalFailure: 1,
      hematocrit: 28,
      wbc: 18,
      gcs: 12,
      ageYears: 68,
      admissionType: 0,
      chronicFailure: 1,
    };
    expect(stepValue('apache-ii', example, 'physiologyScore')).toBe(25);
    expect(output('apache-ii', example)).toBe(35);
    expect(band('apache-ii', example).rangeId).toBe('score-35-plus');
  });

  it('maps the total to the mortality bands of the Knaus table at every boundary', () => {
    const contributions: ReadonlyArray<readonly [Inputs, number]> = [
      [{ ageYears: 75 }, 6],
      [{ chronicFailure: 1 }, 5],
      [{ temperature: 41 }, 4],
      [{ meanArterialPressure: 160 }, 4],
      [{ heartRate: 180 }, 4],
      [{ respiratoryRate: 50 }, 4],
    ];
    const forTotal = (total: number): Inputs => {
      let remaining = total;
      let patch: Inputs = {};
      for (const [change, points] of contributions) {
        if (remaining >= points) {
          patch = { ...patch, ...change };
          remaining -= points;
        }
      }
      return { ...base, ...patch, gcs: 15 - remaining };
    };
    const bands: ReadonlyArray<readonly [number, string, string]> = [
      [0, 'score-0-4', '4 % без операции и 1 % после операции'],
      [4, 'score-0-4', '4 % без операции и 1 % после операции'],
      [5, 'score-5-9', '8 % без операции и 3 % после операции'],
      [9, 'score-5-9', '8 % без операции и 3 % после операции'],
      [10, 'score-10-14', '15 % без операции и 7 % после операции'],
      [14, 'score-10-14', '15 % без операции и 7 % после операции'],
      [15, 'score-15-19', '24 % без операции и 12 % после операции'],
      [19, 'score-15-19', '24 % без операции и 12 % после операции'],
      [20, 'score-20-24', '40 % без операции и 30 % после операции'],
      [24, 'score-20-24', '40 % без операции и 30 % после операции'],
      [25, 'score-25-29', '55 % без операции и 35 % после операции'],
      [29, 'score-25-29', '55 % без операции и 35 % после операции'],
      [30, 'score-30-34', 'около 73 % в обеих группах'],
      [34, 'score-30-34', 'около 73 % в обеих группах'],
      [35, 'score-35-plus', '85 % без операции и 88 % после операции'],
      [39, 'score-35-plus', '85 % без операции и 88 % после операции'],
    ];
    for (const [total, rangeId, wording] of bands) {
      const inputs = forTotal(total);
      expect(output('apache-ii', inputs), `total ${total}`).toBe(total);
      const result = band('apache-ii', inputs);
      expect(result.rangeId, `total ${total}`).toBe(rangeId);
      expect(result.text, `total ${total}`).toContain(wording);
    }
    // The first band states that the table is a reproduction, not the original paper's figure.
    expect(band('apache-ii', forTotal(0)).text).toContain('воспроизведению таблицы Knaus');
  });

  it('declares the secondary status of the bands and the A-aDO2 convention as limitations', () => {
    const text = schemaOf('apache-ii').limitations?.join('\n') ?? '';
    expect(text).toContain('EBMcalc/MSD');
    expect(text).toContain('PaCO₂/0,8');
  });
});

describe('MPM II at admission against Lemeshow 1993 Table (as reproduced)', () => {
  // Table 7 of Serrano Hernandez 2000 / appendix of Arabi 2002.
  const table: Record<string, number> = {
    coma: 1.48592,
    heartRate150: 0.45603,
    systolicBp90: 1.06127,
    chronicRenalFailure: 0.91906,
    cirrhosis: 1.13681,
    metastaticNeoplasm: 1.19979,
    acuteRenalFailure: 1.4821,
    dysrhythmia: 0.28095,
    cerebrovascularIncident: 0.21338,
    giBleeding: 0.39653, // positive in both reproductions
    intracranialMassEffect: 0.86533,
    cpr: 0.56995,
    mechanicalVentilation: 0.79105,
    medicalOrUnscheduled: 1.19098,
  };
  const zero: Inputs = Object.fromEntries(Object.keys(table).map((key) => [key, 0]));

  it('reproduces the worked example of the paper (60 y, cirrhosis, GI bleeding, SBP <= 90)', () => {
    // logit = -5.46836 + 1.06127 + 1.13681 + 0.39653 + 60*0.03057 + 1.19098 = 0.15143 -> 0.54
    const example: Inputs = {
      ...zero,
      ageYears: 60,
      systolicBp90: 1,
      cirrhosis: 1,
      giBleeding: 1,
      medicalOrUnscheduled: 1,
    };
    expect(stepValue('mpm-ii-admission', example, 'logit')).toBeCloseTo(0.15143, 5);
    expect(output('mpm-ii-admission', example, 'mortality')).toBeCloseTo(logistic(0.15143), 4);
    expect(Math.round(output('mpm-ii-admission', example, 'mortality'))).toBe(54);
  });

  it('applies the constant, the age term and each of the 14 binary terms', () => {
    expect(stepValue('mpm-ii-admission', { ...zero, ageYears: 18 }, 'logit')).toBeCloseTo(
      -5.46836 + 0.03057 * 18,
      9,
    );
    expect(stepValue('mpm-ii-admission', { ...zero, ageYears: 100 }, 'logit')).toBeCloseTo(
      -5.46836 + 3.057,
      9,
    );
    for (const [term, beta] of Object.entries(table)) {
      expect(
        stepValue('mpm-ii-admission', { ...zero, ageYears: 0 + 18, [term]: 1 }, 'logit'),
        term,
      ).toBeCloseTo(-5.46836 + 0.03057 * 18 + beta, 9);
    }
  });

  it('keeps the model without threshold bands (the authors define none)', () => {
    expect(schemaOf('mpm-ii-admission').evaluation.status).toBe('unavailable');
  });
});

describe('MPM II 24/48/72 h against Lemeshow 1993/1994 Table 8 (as reproduced)', () => {
  const table: Record<string, number> = {
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
  const zero: Inputs = {
    moment: 24,
    ageYears: 60,
    ...Object.fromEntries(Object.keys(table).map((key) => [key, 0])),
  };

  it('reproduces the worked example of the paper at 24 h and 48 h', () => {
    // 60 y, confirmed infection, creatinine > 2.0, urine < 150 mL/8 h, mechanical ventilation,
    // medical admission. Logit 24 h = 0.00048 (p = 0.50), 48 h = 0.25487 (p = 0.56).
    const example: Inputs = {
      ...zero,
      medicalOrUnscheduled: 1,
      creatinineAbove2: 1,
      lowUrineOutput: 1,
      confirmedInfection: 1,
      mechanicalVentilation: 1,
    };
    expect(stepValue('mpm-ii-24-48-72', { ...example, moment: 24 }, 'logit')).toBeCloseTo(
      0.00048,
      5,
    );
    expect(stepValue('mpm-ii-24-48-72', { ...example, moment: 48 }, 'logit')).toBeCloseTo(
      0.25487,
      5,
    );
    expect(output('mpm-ii-24-48-72', { ...example, moment: 24 }, 'mortality')).toBeCloseTo(50, 0);
    expect(output('mpm-ii-24-48-72', { ...example, moment: 48 }, 'mortality')).toBeCloseTo(
      logistic(0.25487),
      4,
    );
  });

  it('applies the constants, the common age term and each of the 12 binary terms', () => {
    expect(stepValue('mpm-ii-24-48-72', { ...zero, moment: 24 }, 'logit')).toBeCloseTo(
      -5.64592 + 0.03268 * 60,
      9,
    );
    expect(stepValue('mpm-ii-24-48-72', { ...zero, moment: 48 }, 'logit')).toBeCloseTo(
      -5.39153 + 0.03268 * 60,
      9,
    );
    // 72 h constant: not confirmed by any reproduction that was readable (see limitations).
    expect(stepValue('mpm-ii-24-48-72', { ...zero, moment: 72 }, 'logit')).toBeCloseTo(
      -5.2384 + 0.03268 * 60,
      9,
    );
    for (const [term, beta] of Object.entries(table)) {
      expect(
        stepValue('mpm-ii-24-48-72', { ...zero, moment: 24, [term]: 1 }, 'logit'),
        term,
      ).toBeCloseTo(-5.64592 + 0.03268 * 60 + beta, 9);
    }
  });

  it('discloses that the 72 h constant is unconfirmed', () => {
    expect(schemaOf('mpm-ii-24-48-72').limitations?.join('\n')).toContain('72 часов');
  });
});

describe('Nitrogen balance (protein / 6.25 - (UUN + 4 g))', () => {
  it('equals zero for 75 g protein (12 g N) and 8 g UUN + 4 g', () => {
    expect(
      output('nitrogen-balance', { proteinIntake: 75, excretion: 8, excretionUnit: 1 }, 'balance'),
    ).toBeCloseTo(0, 9);
    expect(
      band('nitrogen-balance', { proteinIntake: 75, excretion: 8, excretionUnit: 1 }).rangeId,
    ).toBe('non-negative');
    // 0.1 g protein less -> negative
    expect(
      band('nitrogen-balance', { proteinIntake: 74, excretion: 8, excretionUnit: 1 }).rangeId,
    ).toBe('negative');
  });

  it('subtracts the constant 4 g even with no intake and no urinary nitrogen', () => {
    expect(
      output('nitrogen-balance', { proteinIntake: 0, excretion: 0, excretionUnit: 1 }, 'balance'),
    ).toBeCloseTo(-4, 9);
  });

  it('converts urea to nitrogen with 28.014 / 60.056 per gram and 28.014 mg per mmol', () => {
    // 60.056 g urea carries 28.014 g N
    expect(
      stepValue(
        'nitrogen-balance',
        { proteinIntake: 0, excretion: 60.056, excretionUnit: 2 },
        'urineNitrogen',
      ),
    ).toBeCloseTo(28.014, 2);
    expect(
      stepValue(
        'nitrogen-balance',
        { proteinIntake: 0, excretion: 1000, excretionUnit: 3 },
        'urineNitrogen',
      ),
    ).toBeCloseTo(28.014, 9);
    // 100 g protein = 16 g N; 30 g urea = 13.99 g N; balance = 16 - (13.99 + 4) = -1.99
    expect(
      output(
        'nitrogen-balance',
        { proteinIntake: 100, excretion: 30, excretionUnit: 2 },
        'balance',
      ),
    ).toBeCloseTo(-1.992, 2);
  });
});

describe('RASS (Sessler 2002 table)', () => {
  const optionLabel = (level: number) => {
    const input = schemaOf('rass').inputs.find((item) => item.id === 'level');
    return input?.options?.find((option) => option.value === level)?.label ?? '';
  };

  it('keeps the ten levels with the published descriptors', () => {
    const expected: ReadonlyArray<readonly [number, readonly string[]]> = [
      [4, ['Агрессивный', 'насилие', 'опасность для персонала']],
      [3, ['Очень сильно возбуждён', 'трубки и катетеры', 'по отношению к персоналу']],
      [2, ['Возбуждён', 'бесцельные движения', 'несинхронность']],
      [1, ['Беспокоен', 'не агрессивные и не энергичные']],
      [0, ['Бодр и спокоен']],
      [-1, ['Сонлив', 'более 10 секунд', 'зрительный контакт']],
      [-2, ['Лёгкая седация', 'менее 10 секунд', 'зрительный контакт']],
      [-3, ['Умеренная седация', 'без зрительного контакта']],
      [-4, ['Глубокая седация', 'нет реакции на голос', 'физическое раздражение']],
      [-5, ['Не пробуждается', 'нет реакции на голос и физическое раздражение']],
    ];
    for (const [level, fragments] of expected) {
      expect(output('rass', { level })).toBe(level);
      for (const fragment of fragments) {
        expect(optionLabel(level), `RASS ${level} label`).toContain(fragment);
      }
      expect(band('rass', { level }).rangeId).toBe(
        level >= 0 ? `level-${level}` : `level-minus-${-level}`,
      );
    }
  });

  it('the +2 to +4 interpretation text follows the published descriptors', () => {
    expect(band('rass', { level: 4 }).text).toContain('открыто агрессивен или применяет насилие');
    expect(band('rass', { level: 3 }).text).toContain('либо агрессивен по отношению к персоналу');
    expect(band('rass', { level: 2 }).text).toContain('несинхронность пациента с аппаратом ИВЛ');
  });
});

describe('Ramsay sedation scale (Ramsay 1974, six levels)', () => {
  it('keeps the six published levels and their descriptors', () => {
    const input = schemaOf('ramsay-sedation-scale').inputs.find((item) => item.id === 'level');
    const expected: ReadonlyArray<readonly [number, readonly string[]]> = [
      [1, ['тревожен', 'возбуждён', 'беспокоен']],
      [2, ['контактен', 'ориентирован', 'спокоен']],
      [3, ['только на команды']],
      [4, ['быстрая реакция', 'межбровью', 'громкий звук']],
      [5, ['вялая реакция', 'межбровью', 'громкий звук']],
      [6, ['нет ответа']],
    ];
    for (const [level, fragments] of expected) {
      const label = input?.options?.find((option) => option.value === level)?.label ?? '';
      for (const fragment of fragments) {
        expect(label).toContain(fragment);
      }
      expect(output('ramsay-sedation-scale', { level })).toBe(level);
      expect(band('ramsay-sedation-scale', { level }).rangeId).toBe(`level-${level}`);
    }
    expect(input?.options).toHaveLength(6);
  });
});
