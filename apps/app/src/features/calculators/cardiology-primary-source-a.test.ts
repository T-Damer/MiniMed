/**
 * Primary-source verification (2026-10-13) of: Wells DVT, Padua, CRUSADE, TIMI STEMI, NYHA, CCS.
 *
 * Every expectation is either a worked example taken from the publication's own table (point tables
 * and risk bands, which are facts) or a hand-computed sum shown in the comment above it. Sources
 * actually read:
 *  - Wells DVT: NICE CG144 Appendix C Table 1 (two-level score "adapted with permission from Wells
 *    2003"), Wells 2003 NEJM abstract, Wells 1997 Lancet abstract, Wells 2006 JAMA abstract.
 *  - Padua: Barbar 2010 JTH abstract (rates), McMaster Textbook table adapted from the paper and the
 *    Dutch national guideline table (items, points, cut-off). Full text of the paper not reachable.
 *  - CRUSADE: Subherwal 2009 Circulation, Table 4 and Figure 2 (PMC3767035, full text).
 *  - TIMI STEMI: TIMI Study Group calculator (timi.org), MSD Manual table, Wikidoc; Morrow 2000
 *    full text not reachable (publisher bot-wall, not in PMC).
 *  - NYHA 1994 wording: reproductions of the 9th edition classes (AGRACE appendix, clinical-trial
 *    protocol appendices). CCS: Campeau 1976 table as reproduced in Can J Cardiol 2009 (PMC2723031)
 *    and Campeau 2002 abstract.
 */
import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const SCHEMAS = loadToolModuleCalculatorSchemas(['content/tool-modules/cardiology.json']);

type Inputs = Record<string, number>;

function run(id: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${id}`);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${id}: expected a numeric output`);
  return { score: output.value, verdict: result.evaluation.verdict };
}

function schemaOf(id: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${id}`);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return schema;
}

describe('Wells DVT (modified Wells 2003: NICE CG144 Table 1; ≥2 likely, ≤1 unlikely)', () => {
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

  it('lists exactly the ten published items, with previously documented DVT included', () => {
    expect(schemaOf('wells-dvt').inputs.map((input) => input.id)).toEqual([
      'activeCancer',
      'paralysisCast',
      'bedriddenSurgery',
      'localTenderness',
      'entireLegSwollen',
      'calfSwelling',
      'pittingEdema',
      'collateralVeins',
      'previousDvt',
      'alternativeDiagnosis',
    ]);
    const calf = schemaOf('wells-dvt').inputs.find((input) => input.id === 'calfSwelling');
    expect(calf?.label).toContain('не менее чем на 3 см');
  });

  it('adds +1 for each of nine items and −2 for an equally likely alternative', () => {
    // nine positive items = 9; with the alternative diagnosis 9 − 2 = 7.
    const all: Inputs = { ...base };
    for (const key of Object.keys(base)) all[key] = 1;
    expect(run('wells-dvt', { ...all, alternativeDiagnosis: 0 }).score).toBe(9);
    expect(run('wells-dvt', all).score).toBe(7);
    // previously documented DVT alone is a point (this is the item added in the 2003 model).
    expect(run('wells-dvt', { ...base, previousDvt: 1 }).score).toBe(1);
  });

  it('cuts the two-level score at 2 (likely) and keeps 1 unlikely', () => {
    // 1 point: calf swelling -> unlikely; 2 points: calf + pitting oedema -> likely.
    const one = run('wells-dvt', { ...base, calfSwelling: 1 });
    expect(one.score).toBe(1);
    expect(one.verdict?.rangeId).toBe('unlikely-moderate');
    expect(one.verdict?.title).toBe('ТГВ маловероятен');
    const two = run('wells-dvt', { ...base, calfSwelling: 1, pittingEdema: 1 });
    expect(two.score).toBe(2);
    expect(two.verdict?.rangeId).toBe('likely');
    expect(two.verdict?.title).toBe('ТГВ вероятен');
  });

  it('cuts the three-level score at ≤0 / 1–2 / ≥3 and carries the pooled prevalences', () => {
    // 0: nothing; −1: calf (+1) with alternative (−2); 3: cancer + tenderness + entire leg.
    const zero = run('wells-dvt', base);
    expect(zero.verdict?.rangeId).toBe('unlikely-low');
    expect(zero.verdict?.explanation).toContain('5,0 %');
    expect(run('wells-dvt', { ...base, calfSwelling: 1, alternativeDiagnosis: 1 }).score).toBe(-1);
    const moderate = run('wells-dvt', { ...base, calfSwelling: 1 });
    expect(moderate.verdict?.explanation).toContain('17 %');
    const three = run('wells-dvt', {
      ...base,
      activeCancer: 1,
      localTenderness: 1,
      entireLegSwollen: 1,
    });
    expect(three.score).toBe(3);
    expect(three.verdict?.rangeId).toBe('high');
    expect(three.verdict?.explanation).toContain('53 %');
  });
});

describe('Padua Prediction Score (Barbar 2010: 11 items, high risk ≥4)', () => {
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

  it('weights the items 3/3/3/3/2 and 1 for the rest, maximum 20', () => {
    // 3+3+3+3 + 2 + 1×6 (age ≥70, HF/RF, MI/stroke, infection, obesity, hormones) = 20.
    const everything: Inputs = {
      activeCancer: 1,
      previousVte: 1,
      reducedMobility: 1,
      thrombophilia: 1,
      traumaSurgery: 1,
      ageYears: 70,
      heartRespiratoryFailure: 1,
      miStroke: 1,
      infectionRheumatic: 1,
      obesity: 1,
      hormones: 1,
    };
    expect(run('padua', everything).score).toBe(20);
    for (const [id, points] of [
      ['activeCancer', 3],
      ['previousVte', 3],
      ['reducedMobility', 3],
      ['thrombophilia', 3],
      ['traumaSurgery', 2],
      ['heartRespiratoryFailure', 1],
      ['miStroke', 1],
      ['infectionRheumatic', 1],
      ['obesity', 1],
      ['hormones', 1],
    ] as const) {
      expect(run('padua', { ...base, [id]: 1 }).score, id).toBe(points);
    }
  });

  it('gives the age point from 70 (≥70), not from 69', () => {
    expect(run('padua', { ...base, ageYears: 69 }).score).toBe(0);
    expect(run('padua', { ...base, ageYears: 70 }).score).toBe(1);
  });

  it('is low risk at 3 points and high risk from 4, with the published 90-day rates', () => {
    // trauma/surgery 2 + age 70 (1) = 3 -> low; + obesity 1 = 4 -> high.
    const low = run('padua', { ...base, traumaSurgery: 1, ageYears: 70 });
    expect(low.score).toBe(3);
    expect(low.verdict?.rangeId).toBe('low');
    expect(low.verdict?.explanation).toContain('0,3 %');
    const high = run('padua', { ...base, traumaSurgery: 1, ageYears: 70, obesity: 1 });
    expect(high.score).toBe(4);
    expect(high.verdict?.rangeId).toBe('high');
    expect(high.verdict?.explanation).toContain('11,0 %');
    expect(high.verdict?.explanation).toContain('2,2 %');
    // one 3-point item with one 1-point item reaches 4: cancer 3 + infection 1.
    expect(run('padua', { ...base, activeCancer: 1, infectionRheumatic: 1 }).score).toBe(4);
  });
});

describe('CRUSADE bleeding score (Subherwal 2009, Table 4)', () => {
  // Zero-point baseline: Hct 45 (0), CrCl 130 (0), HR 60 (0), male, no CHF/vascular/diabetes,
  // SBP 150 (121–180 -> 1 point). Baseline total = 1.
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
  const score = (overrides: Inputs): number => run('crusade', { ...base, ...overrides }).score;

  it('scores hematocrit <31 / 31–33.9 / 34–36.9 / 37–39.9 / ≥40 as 9 / 7 / 3 / 2 / 0', () => {
    for (const [hct, points] of [
      [30.9, 9],
      [31, 7],
      [33.9, 7],
      [34, 3],
      [36.9, 3],
      [37, 2],
      [39.9, 2],
      [40, 0],
    ] as const) {
      expect(score({ hematocrit: hct }), `Hct ${hct}`).toBe(1 + points);
    }
  });

  it('scores Cockcroft–Gault clearance ≤15 / >15–30 / >30–60 / >60–90 / >90–120 / >120 as 39 / 35 / 28 / 17 / 7 / 0', () => {
    for (const [crcl, points] of [
      [15, 39],
      [15.1, 35],
      [30, 35],
      [30.1, 28],
      [60, 28],
      [60.1, 17],
      [90, 17],
      [90.1, 7],
      [120, 7],
      [120.1, 0],
    ] as const) {
      expect(score({ creatinineClearance: crcl }), `CrCl ${crcl}`).toBe(1 + points);
    }
  });

  it('scores heart rate ≤70 / 71–80 / 81–90 / 91–100 / 101–110 / 111–120 / ≥121 as 0 / 1 / 3 / 6 / 8 / 10 / 11', () => {
    for (const [hr, points] of [
      [70, 0],
      [71, 1],
      [80, 1],
      [81, 3],
      [90, 3],
      [91, 6],
      [100, 6],
      [101, 8],
      [110, 8],
      [111, 10],
      [120, 10],
      [121, 11],
    ] as const) {
      expect(score({ heartRate: hr }), `HR ${hr}`).toBe(1 + points);
    }
  });

  it('scores systolic pressure ≤90 / 91–100 / 101–120 / 121–180 / 181–200 / ≥201 as 10 / 8 / 5 / 1 / 3 / 5', () => {
    for (const [sbp, points] of [
      [90, 10],
      [91, 8],
      [100, 8],
      [101, 5],
      [120, 5],
      [121, 1],
      [180, 1],
      [181, 3],
      [200, 3],
      [201, 5],
    ] as const) {
      expect(score({ systolicBp: sbp }), `SBP ${sbp}`).toBe(points);
    }
  });

  it('scores the binary items female 8, CHF signs 7, prior vascular disease 6, diabetes 6', () => {
    expect(score({ sexFemale: 1 })).toBe(1 + 8);
    expect(score({ heartFailureSigns: 1 })).toBe(1 + 7);
    expect(score({ vascularDisease: 1 })).toBe(1 + 6);
    expect(score({ diabetes: 1 })).toBe(1 + 6);
  });

  it('sums a full worked example', () => {
    // Hct 35 (3) + CrCl 55 (28) + HR 95 (6) + female (8) + CHF (7) + vascular (6) + diabetes (6)
    // + SBP 110 (5) = 69 -> very high risk (>50).
    const result = run('crusade', {
      hematocrit: 35,
      creatinineClearance: 55,
      heartRate: 95,
      sexFemale: 1,
      heartFailureSigns: 1,
      vascularDisease: 1,
      diabetes: 1,
      systolicBp: 110,
    });
    expect(result.score).toBe(69);
    expect(result.verdict?.rangeId).toBe('very-high');
  });

  it('cuts the five risk groups at ≤20 / 21–30 / 31–40 / 41–50 / >50 with the published rates', () => {
    // Baseline 1 plus: 20 = CrCl 17 + Hct 2; 21 = 17 + 3; 30 = 17 + female 8 + Hct 3 + HR 1;
    // 31 = CrCl 28 + Hct 2; 40 = 28 + female 8 + Hct 3; 41 = 40 + HR 1;
    // 50 = CrCl 35 + female 8 + diabetes 6; 51 = 35 + female 8 + CHF 7.
    const cases: readonly [Inputs, number, string, string][] = [
      [{ creatinineClearance: 75, hematocrit: 38 }, 20, 'very-low', '3,1 %'],
      [{ creatinineClearance: 75, hematocrit: 35 }, 21, 'low', '5,5 %'],
      [
        { creatinineClearance: 75, sexFemale: 1, hematocrit: 35, heartRate: 75 },
        30,
        'low',
        '5,5 %',
      ],
      [{ creatinineClearance: 45, hematocrit: 38 }, 31, 'moderate', '8,6 %'],
      [{ creatinineClearance: 45, sexFemale: 1, hematocrit: 35 }, 40, 'moderate', '8,6 %'],
      [
        { creatinineClearance: 45, sexFemale: 1, hematocrit: 35, heartRate: 75 },
        41,
        'high',
        '11,9 %',
      ],
      [{ creatinineClearance: 20, sexFemale: 1, diabetes: 1 }, 50, 'high', '11,9 %'],
      [{ creatinineClearance: 20, sexFemale: 1, heartFailureSigns: 1 }, 51, 'very-high', '19,5 %'],
    ];
    for (const [overrides, expectedScore, range, rate] of cases) {
      const result = run('crusade', { ...base, ...overrides });
      expect(result.score, `score ${expectedScore}`).toBe(expectedScore);
      expect(result.verdict?.rangeId, `band ${expectedScore}`).toBe(range);
      expect(result.verdict?.explanation, `rate ${expectedScore}`).toContain(rate);
    }
  });
});

describe('TIMI risk score for STEMI (Morrow 2000: 0–14, 30-day mortality)', () => {
  // Zero-point baseline: age 50, no DM/HTN/angina, SBP 130, HR 80, Killip I, 80 kg,
  // no anterior ST elevation / LBBB, treatment within 4 h.
  const base: Inputs = {
    ageYears: 50,
    dmHtnAngina: 0,
    systolicBp: 130,
    heartRate: 80,
    killip2to4: 0,
    weightKg: 80,
    anteriorOrLbbb: 0,
    delayOver4h: 0,
  };
  const score = (overrides: Inputs): number => run('timi-stemi', { ...base, ...overrides }).score;

  it('scores age 65–74 as 2 and ≥75 as 3', () => {
    expect(score({ ageYears: 64 })).toBe(0);
    expect(score({ ageYears: 65 })).toBe(2);
    expect(score({ ageYears: 74 })).toBe(2);
    // ≥75 per the TIMI Study Group calculator and MSD Manual table; the ACC summary says ">75".
    expect(score({ ageYears: 75 })).toBe(3);
    expect(score({ ageYears: 90 })).toBe(3);
  });

  it('scores SBP <100 as 3, HR >100 as 2 and weight <67 kg as 1 with strict boundaries', () => {
    expect(score({ systolicBp: 99 })).toBe(3);
    expect(score({ systolicBp: 100 })).toBe(0);
    expect(score({ heartRate: 100 })).toBe(0);
    expect(score({ heartRate: 101 })).toBe(2);
    expect(score({ weightKg: 66.9 })).toBe(1);
    expect(score({ weightKg: 67 })).toBe(0);
  });

  it('scores the binary items DM/HTN/angina 1, Killip II–IV 2, anterior/LBBB 1, delay >4 h 1', () => {
    expect(score({ dmHtnAngina: 1 })).toBe(1);
    expect(score({ killip2to4: 1 })).toBe(2);
    expect(score({ anteriorOrLbbb: 1 })).toBe(1);
    expect(score({ delayOver4h: 1 })).toBe(1);
  });

  it('reproduces the published 30-day mortality for every score 0–8 and >8', () => {
    // Inputs sum to the stated score: 0 nothing; 1 DM; 2 age 70; 3 age 80; 4 age 80 + DM;
    // 5 age 80 + HR 110 (2); 6 age 80 + SBP 90 (3); 7 = 3+3+1; 8 = 3+3+2; 9 = 3+3+2+1 (weight 60).
    const cases: readonly [Inputs, number, string, string][] = [
      [{}, 0, 's0', '0,8 %'],
      [{ dmHtnAngina: 1 }, 1, 's1', '1,6 %'],
      [{ ageYears: 70 }, 2, 's2', '2,2 %'],
      [{ ageYears: 80 }, 3, 's3', '4,4 %'],
      [{ ageYears: 80, dmHtnAngina: 1 }, 4, 's4', '7,3 %'],
      [{ ageYears: 80, heartRate: 110 }, 5, 's5', '12,4 %'],
      [{ ageYears: 80, systolicBp: 90 }, 6, 's6', '16,1 %'],
      [{ ageYears: 80, systolicBp: 90, dmHtnAngina: 1 }, 7, 's7', '23,4 %'],
      [{ ageYears: 80, systolicBp: 90, heartRate: 110 }, 8, 's8', '26,8 %'],
      [{ ageYears: 80, systolicBp: 90, heartRate: 110, weightKg: 60 }, 9, 's9plus', '35,9 %'],
    ];
    for (const [overrides, expectedScore, range, rate] of cases) {
      const result = run('timi-stemi', { ...base, ...overrides });
      expect(result.score, `score ${expectedScore}`).toBe(expectedScore);
      expect(result.verdict?.rangeId, `band ${expectedScore}`).toBe(range);
      expect(result.verdict?.explanation, `rate ${expectedScore}`).toContain(`летальность ${rate}`);
    }
  });

  it('sums the maximum of 14 into the open-ended top group', () => {
    // age 78 (3) + DM (1) + SBP 95 (3) + HR 110 (2) + Killip III (2) + 60 kg (1)
    // + anterior ST elevation (1) + 5 h to treatment (1) = 14.
    const result = run('timi-stemi', {
      ageYears: 78,
      dmHtnAngina: 1,
      systolicBp: 95,
      heartRate: 110,
      killip2to4: 1,
      weightKg: 60,
      anteriorOrLbbb: 1,
      delayOver4h: 1,
    });
    expect(result.score).toBe(14);
    expect(result.verdict?.rangeId).toBe('s9plus');
  });
});

describe('NYHA functional class (Criteria Committee 1994, 9th edition)', () => {
  const schema = schemaOf('nyha-class');
  const labels = schema.inputs[0]?.options?.map((option) => option.label) ?? [];

  it('keeps the four published classes, including the anginal-pain wording of classes I–III', () => {
    expect(labels).toHaveLength(4);
    expect(labels[0]).toContain('не ограничивает активность');
    for (const index of [0, 1, 2])
      expect(labels[index], `class ${index + 1}`).toContain('стенокардитическ');
    // Class IV: any activity causes discomfort; heart-failure or anginal syndrome may be present at rest.
    expect(labels[3]).toContain('любая нагрузка вызывает дискомфорт');
    expect(labels[3]).toContain('стенокардии могут быть в покое');
    expect(labels[1]).toContain('в покое комфортно');
    expect(labels[2]).toContain('меньше обычной');
  });

  it('returns the chosen class with its own band wording', () => {
    const wording = new Map([
      [1, 'Класс I: заболевание сердца не ограничивает физическую активность.'],
      [2, 'Класс II: небольшое ограничение физической активности.'],
      [3, 'Класс III: выраженное ограничение физической активности.'],
    ]);
    for (const [value, text] of wording) {
      const result = run('nyha-class', { nyhaClass: value });
      expect(result.score).toBe(value);
      expect(result.verdict?.rangeId).toBe(`class-${value}`);
      expect(result.verdict?.explanation).toBe(text);
    }
    const four = run('nyha-class', { nyhaClass: 4 });
    expect(four.verdict?.rangeId).toBe('class-4');
    expect(four.verdict?.explanation).toContain('сердечной недостаточности или стенокардии');
  });
});

describe('CCS angina class (Campeau 1976 table as reproduced in Can J Cardiol 2009)', () => {
  const labels =
    schemaOf('ccs-angina-class').inputs[0]?.options?.map((option) => option.label) ?? [];

  it('keeps the published threshold activities of each class', () => {
    expect(labels).toHaveLength(4);
    // I: angina only with strenuous, rapid or prolonged exertion.
    expect(labels[0]).toContain('интенсивной, быстрой или длительной');
    // II: rapid walking/stairs, uphill, after meals, cold, wind, emotion, first hours after waking;
    // walking more than two blocks and more than one flight of stairs.
    for (const part of [
      'быстрой ходьбе',
      'в гору',
      'после еды',
      'на холоде',
      'на ветру',
      'волнении',
      'после пробуждения',
      'более чем на 2 квартала',
      'более чем на один пролёт',
    ]) {
      expect(labels[1], part).toContain(part);
    }
    // III: one to two blocks on the level, one flight of stairs.
    expect(labels[2]).toContain('1–2 квартала');
    expect(labels[2]).toContain('один пролёт');
    // IV: inability to carry on any activity without discomfort; angina may be present at rest.
    expect(labels[3]).toContain('любая нагрузка вызывает дискомфорт');
    expect(labels[3]).toContain('в покое');
  });

  it('returns the chosen class with its own band wording', () => {
    for (const [value, text] of [
      [1, 'Класс I: стенокардия только при интенсивной нагрузке.'],
      [2, 'Класс II: небольшое ограничение повседневной активности.'],
      [3, 'Класс III: выраженное ограничение повседневной активности.'],
      [4, 'Класс IV: любая нагрузка вызывает дискомфорт, приступ возможен в покое.'],
    ] as const) {
      const result = run('ccs-angina-class', { ccsClass: value });
      expect(result.score).toBe(value);
      expect(result.verdict?.rangeId).toBe(`class-${value}`);
      expect(result.verdict?.explanation).toBe(text);
    }
  });

  it('records the author’s later criticism of the class IV rest criterion', () => {
    expect(schemaOf('ccs-angina-class').limitations.join(' ')).toContain('в покое');
  });
});
