import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) of Goldman, Detsky, ARISCAT, Caprini, MNOAR-89,
 * Evans and the Morse Fall Scale.
 *
 * Sources actually read:
 * - ARISCAT: Canet J et al., Anesthesiology 2010;113:1338-1350, full text (Tables 6 and 7);
 * - Caprini: Gould MK et al., Chest 2012;141(2 Suppl):e227S, PMC3278061 (Tables 5 and 7 and
 *   recommendations 3.6.1-3.6.5); Caprini 2005 itself was paywalled;
 * - Goldman 1977 and Detsky 1986: abstracts (PMID 904659, 3772593, 3778043) plus the point and class
 *   tables as reproduced in PMC10578796 (Goldman Tables 3-4, Detsky Table 5), PMC4799167 (Detsky
 *   Table 3) and fpnotebook (Detsky classes); the original NEJM / J Gen Intern Med full texts were
 *   not reachable;
 * - MNOAR-89: the full table as reproduced at anest-rean.ru/international-scale/mnoar-classification
 *   (checked against medsoftpro.ru and a lecture slide set); the 1989 publication itself was not
 *   reachable;
 * - Evans: PMC3038406 (Haberal 2010) and PMC5582395 (Romanowski 2017 Table 1); the Evans 1952 scan
 *   (PMC1802193) sits behind a proof-of-work download wall;
 * - Morse: the item and score table as used in PMC13149994 (Table 3), cut-offs 0-24 / 25-44 / 45+
 *   of the AHRQ Falls Toolkit; the Morse 1989 papers were paywalled.
 */

const MODULE_FILE = 'content/tool-modules/surgery-trauma.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;

interface Run {
  readonly values: Readonly<Record<string, number>>;
  readonly rangeId: string | undefined;
  readonly explanation: string | undefined;
}

function run(id: string, inputs: Inputs): Run {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const values: Record<string, number> = {};
  for (const output of result.outputs) {
    if (output.kind === 'number') values[output.id] = output.value;
  }
  return {
    values,
    rangeId: result.evaluation.verdict?.rangeId,
    explanation: result.evaluation.verdict?.explanation,
  };
}

function out(result: Run, key: string): number {
  const found = result.values[key];
  if (found === undefined) throw new Error(`no output ${key}`);
  return found;
}

interface RawTool {
  readonly id: string;
  readonly version: string;
  readonly definition: {
    readonly formulaDisplay?: string;
    readonly limitations?: readonly string[];
    readonly inputs: readonly { readonly id: string; readonly labelTooltip?: string }[];
  };
}

function moduleTool(id: string): RawTool {
  const module = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
    tools: readonly RawTool[];
  };
  const tool = module.tools.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Missing tool ${id}`);
  return tool;
}

describe('Goldman cardiac risk index against Goldman 1977 (NEJM 297:845)', () => {
  const id = 'minimed.calculator.goldman-cardiac-risk';
  const none: Inputs = { ageYears: 60 };

  it('weights the nine published correlates (53 points at most)', () => {
    // Points as reproduced in PMC10578796 Table 3: age >70 5, MI <6 mo 10, S3/JVD 11,
    // aortic stenosis 3, non-sinus rhythm/PACs 7, >5 PVC/min 7, poor general status 3,
    // intraperitoneal/intrathoracic/aortic operation 3, emergency 4.
    expect(out(run(id, none), 'score')).toBe(0);
    const weights: readonly [string, number][] = [
      ['jvd', 11],
      ['recentMi', 10],
      ['nonSinus', 7],
      ['pvc', 7],
      ['aorticStenosis', 3],
      ['poorCondition', 3],
      ['highRiskSurgery', 3],
      ['emergencySurgery', 4],
    ];
    for (const [input, points] of weights) {
      expect(out(run(id, { ...none, [input]: 1 }), 'score')).toBe(points);
    }
    const all: Inputs = { ageYears: 71 };
    for (const [input] of weights) all[input] = 1;
    // 5 + 11 + 10 + 7 + 7 + 3 + 3 + 3 + 4 = 53
    expect(out(run(id, all), 'score')).toBe(53);
  });

  it('counts age strictly above 70', () => {
    expect(out(run(id, { ageYears: 70 }), 'score')).toBe(0);
    expect(out(run(id, { ageYears: 71 }), 'score')).toBe(5);
  });

  it('assigns the four classes at 5/6, 12/13 and 25/26 with the published rates', () => {
    const class1 = run(id, { ageYears: 71 }); // 5
    expect(out(class1, 'score')).toBe(5);
    expect(class1.rangeId).toBe('class-1');
    expect(class1.explanation).toContain('0,7 %');
    expect(class1.explanation).toContain('0,2 %');

    const aorticAndPoor = run(id, { ageYears: 60, aorticStenosis: 1, poorCondition: 1 }); // 3 + 3
    expect(out(aorticAndPoor, 'score')).toBe(6);
    expect(aorticAndPoor.rangeId).toBe('class-2');
    expect(aorticAndPoor.explanation).toContain('5 %');
    expect(aorticAndPoor.explanation).toContain('2 %');

    const ageAndRhythm = run(id, { ageYears: 71, nonSinus: 1 }); // 5 + 7
    expect(out(ageAndRhythm, 'score')).toBe(12);
    expect(ageAndRhythm.rangeId).toBe('class-2');

    const miAndSurgery = run(id, { ageYears: 60, recentMi: 1, highRiskSurgery: 1 }); // 10 + 3
    expect(out(miAndSurgery, 'score')).toBe(13);
    expect(miAndSurgery.rangeId).toBe('class-3');
    expect(miAndSurgery.explanation).toContain('11 %');

    const jvdAndArrhythmias = run(id, { ageYears: 60, jvd: 1, nonSinus: 1, pvc: 1 }); // 11 + 7 + 7
    expect(out(jvdAndArrhythmias, 'score')).toBe(25);
    expect(jvdAndArrhythmias.rangeId).toBe('class-3');

    const class4 = run(id, { ageYears: 71, jvd: 1, recentMi: 1 }); // 5 + 11 + 10
    expect(out(class4, 'score')).toBe(26);
    expect(class4.rangeId).toBe('class-4');
    // 4 of 18 patients with life-threatening complications (22 %), 10 of 18 cardiac deaths (56 %).
    expect(class4.explanation).toContain('22 %');
    expect(class4.explanation).toContain('56 %');
    expect(class4.explanation).toContain('4 из 18');
    expect(class4.explanation).toContain('10 из 18');
  });

  it('states urea in BUN units and converts to mmol/L in the poor-condition tooltip', () => {
    // Original: BUN > 50 mg/dL (= urea 17.9 mmol/L, = urea 107.5 mg/dL), creatinine > 3.0 mg/dL.
    const tooltip = moduleTool(id).definition.inputs.find(
      (input) => input.id === 'poorCondition',
    )?.labelTooltip;
    expect(tooltip).toContain('азот мочевины (BUN) >50 мг/дл (мочевина >17,9 ммоль/л)');
    expect(tooltip).toContain('креатинин >3,0 мг/дл (>265 мкмоль/л)');
    expect(tooltip).toContain('pO₂ <60 или pCO₂ >50 мм рт. ст.');
    expect(tooltip).toContain('K <3,0 или HCO₃ <20 ммоль/л');
  });
});

describe('Detsky modified cardiac risk index (J Gen Intern Med 1986;1:211, Arch Intern Med 1986;146:2131)', () => {
  const id = 'minimed.calculator.detsky-modified-cardiac-risk';
  const none: Inputs = { mi: 0, angina: 0, pulmonaryEdema: 0, ageYears: 60 };
  const score = (override: Inputs): number => out(run(id, { ...none, ...override }), 'score');

  it('weights every item as in the published table (maximum 100)', () => {
    expect(score({})).toBe(0);
    expect(score({ mi: 10 })).toBe(10); // MI within 6 months
    expect(score({ mi: 5 })).toBe(5); // MI more than 6 months ago
    expect(score({ angina: 10 })).toBe(10); // CCS class III
    expect(score({ angina: 20 })).toBe(20); // CCS class IV
    expect(score({ unstableAngina: 1 })).toBe(10);
    expect(score({ pulmonaryEdema: 10 })).toBe(10); // within 1 week
    expect(score({ pulmonaryEdema: 5 })).toBe(5); // earlier
    expect(score({ aorticStenosis: 1 })).toBe(20);
    expect(score({ nonSinus: 1 })).toBe(5);
    expect(score({ pvc: 1 })).toBe(5);
    expect(score({ poorCondition: 1 })).toBe(5);
    expect(score({ emergencySurgery: 1 })).toBe(10);
    expect(score({ ageYears: 70 })).toBe(0);
    expect(score({ ageYears: 71 })).toBe(5);
    // 10 + 20 + 10 + 10 + 20 + 5 + 5 + 5 + 10 + 5 = 100
    expect(
      score({
        mi: 10,
        angina: 20,
        unstableAngina: 1,
        pulmonaryEdema: 10,
        aorticStenosis: 1,
        nonSinus: 1,
        pvc: 1,
        poorCondition: 1,
        emergencySurgery: 1,
        ageYears: 71,
      }),
    ).toBe(100);
  });

  it('classifies 0-15 as I, 20-30 as II and above 30 as III (ACP classes)', () => {
    const class1 = run(id, { ...none, mi: 10, nonSinus: 1 }); // 10 + 5
    expect(out(class1, 'score')).toBe(15);
    expect(class1.rangeId).toBe('class-1');
    expect(class1.explanation).toContain('0–15 баллов');

    const class2Low = run(id, { ...none, angina: 10, pulmonaryEdema: 10 }); // 10 + 10
    expect(out(class2Low, 'score')).toBe(20);
    expect(class2Low.rangeId).toBe('class-2');

    const class2High = run(id, { ...none, aorticStenosis: 1, emergencySurgery: 1 }); // 20 + 10
    expect(out(class2High, 'score')).toBe(30);
    expect(class2High.rangeId).toBe('class-2');
    expect(class2High.explanation).toContain('20–30 баллов');

    const class3 = run(id, { ...none, aorticStenosis: 1, emergencySurgery: 1, poorCondition: 1 });
    expect(out(class3, 'score')).toBe(35);
    expect(class3.rangeId).toBe('class-3');
    expect(class3.explanation).toContain('Более 30 баллов');
  });

  it('states the poor-condition laboratory limits in BUN units and records the 3-month window', () => {
    const tool = moduleTool(id);
    const tooltip = tool.definition.inputs.find(
      (input) => input.id === 'poorCondition',
    )?.labelTooltip;
    expect(tooltip).toContain('азот мочевины (BUN) >50 мг/дл (мочевина >17,9 ммоль/л)');
    expect(tooltip).toContain('креатинин >3,0 мг/дл (>265 мкмоль/л)');
    expect(tool.definition.limitations?.some((line) => line.includes('3 месяцев'))).toBe(true);
  });
});

describe('ARISCAT against Canet 2010 (Anesthesiology 113:1338), Tables 6 and 7', () => {
  const id = 'minimed.calculator.ariscat';
  const base: Inputs = { ageYears: 40, spo2: 98, incision: 0, duration: 0 };
  const score = (override: Inputs): number => out(run(id, { ...base, ...override }), 'score');

  it('uses the Table 6 risk scores (123 points at most)', () => {
    expect(score({})).toBe(0);
    // Age: <=50 -> 0, 51-80 -> 3, >80 -> 16
    expect(score({ ageYears: 50 })).toBe(0);
    expect(score({ ageYears: 51 })).toBe(3);
    expect(score({ ageYears: 80 })).toBe(3);
    expect(score({ ageYears: 81 })).toBe(16);
    // SpO2: >=96 -> 0, 91-95 -> 8, <=90 -> 24
    expect(score({ spo2: 96 })).toBe(0);
    expect(score({ spo2: 95 })).toBe(8);
    expect(score({ spo2: 91 })).toBe(8);
    expect(score({ spo2: 90 })).toBe(24);
    expect(score({ infection: 1 })).toBe(17);
    expect(score({ anemia: 1 })).toBe(11);
    expect(score({ incision: 15 })).toBe(15); // upper abdominal
    expect(score({ incision: 24 })).toBe(24); // intrathoracic
    expect(score({ duration: 16 })).toBe(16); // 2-3 h
    expect(score({ duration: 23 })).toBe(23); // >3 h
    expect(score({ emergency: 1 })).toBe(8);
    // 16 + 24 + 17 + 11 + 24 + 23 + 8 = 123
    expect(
      score({
        ageYears: 85,
        spo2: 85,
        infection: 1,
        anemia: 1,
        incision: 24,
        duration: 23,
        emergency: 1,
      }),
    ).toBe(123);
  });

  it('separates low (<26), intermediate (26-44) and high (>=45) with the Table 7 rates', () => {
    const low = run(id, { ...base, spo2: 95, infection: 1 }); // 8 + 17
    expect(out(low, 'score')).toBe(25);
    expect(low.rangeId).toBe('low');
    expect(low.explanation).toContain('0,7 %');
    expect(low.explanation).toContain('1,6 %');

    const intermediateLow = run(id, { ...base, ageYears: 60, duration: 23 }); // 3 + 23
    expect(out(intermediateLow, 'score')).toBe(26);
    expect(intermediateLow.rangeId).toBe('intermediate');
    expect(intermediateLow.explanation).toContain('6,3 %');
    expect(intermediateLow.explanation).toContain('13,3 %');

    const intermediateHigh = run(id, { ...base, ageYears: 60, spo2: 90, infection: 1 }); // 3 + 24 + 17
    expect(out(intermediateHigh, 'score')).toBe(44);
    expect(intermediateHigh.rangeId).toBe('intermediate');

    const high = run(id, { ...base, ageYears: 60, spo2: 93, anemia: 1, duration: 23 }); // 3 + 8 + 11 + 23
    expect(out(high, 'score')).toBe(45);
    expect(high.rangeId).toBe('high');
    expect(high.explanation).toContain('44,9 %');
    expect(high.explanation).toContain('42,1 %');
  });

  it('describes the derivation cohort exclusions accurately', () => {
    const limitations = moduleTool(id).definition.limitations ?? [];
    expect(limitations[0]).toContain('59 больниц Каталонии');
    expect(limitations[0]).toContain('без акушерских вмешательств');
  });
});

describe('Caprini score against the Caprini risk assessment model (Gould 2012, Table 7)', () => {
  const id = 'minimed.calculator.caprini-vte-2005';
  const base: Inputs = { ageYears: 30 };
  const score = (override: Inputs): number => out(run(id, { ...base, ...override }), 'score');

  const onePoint = [
    'minorSurgery',
    'priorMajorSurgery',
    'varicose',
    'ibd',
    'swollenLegs',
    'obesity',
    'acuteMi',
    'chf',
    'sepsis',
    'lungDisease',
    'copd',
    'bedRestMedical',
    'otherRisk',
    'hormones',
    'pregnancy',
    'obstetricHistory',
  ];
  const twoPoints = [
    'arthroscopy',
    'malignancy',
    'majorSurgery',
    'laparoscopy',
    'bedConfined',
    'cast',
    'centralVenous',
  ];
  const threePoints = [
    'previousVte',
    'familyVte',
    'factorV',
    'prothrombin',
    'homocysteine',
    'lupus',
    'anticardiolipin',
    'hit',
    'thrombophilia',
  ];
  const fivePoints = ['arthroplasty', 'fracture', 'stroke', 'multiTrauma', 'spinalCord'];

  it('weights every risk factor by its 1/2/3/5-point group', () => {
    for (const input of onePoint) expect(score({ [input]: 1 }), input).toBe(1);
    for (const input of twoPoints) expect(score({ [input]: 1 }), input).toBe(2);
    for (const input of threePoints) expect(score({ [input]: 1 }), input).toBe(3);
    for (const input of fivePoints) expect(score({ [input]: 1 }), input).toBe(5);
    const everything: Inputs = { ageYears: 80 };
    for (const input of [...onePoint, ...twoPoints, ...threePoints, ...fivePoints]) {
      everything[input] = 1;
    }
    // age 3 + 16 * 1 + 7 * 2 + 9 * 3 + 5 * 5 = 85
    expect(out(run(id, everything), 'score')).toBe(85);
  });

  it('scores the age bands 41-60 (1), 61-74 (2) and 75+ (3)', () => {
    expect(score({ ageYears: 40 })).toBe(0);
    expect(score({ ageYears: 41 })).toBe(1);
    expect(score({ ageYears: 60 })).toBe(1);
    expect(score({ ageYears: 61 })).toBe(2);
    expect(score({ ageYears: 74 })).toBe(2);
    expect(score({ ageYears: 75 })).toBe(3);
  });

  it('applies the ACCP 2012 categories 0 / 1-2 / 3-4 / >=5 with 0.5 / 1.5 / 3.0 / 6.0 % risk', () => {
    const veryLow = run(id, base);
    expect(out(veryLow, 'score')).toBe(0);
    expect(veryLow.rangeId).toBe('very-low');
    expect(veryLow.explanation).toContain('менее 0,5 %');

    const lowOne = run(id, { ...base, minorSurgery: 1 });
    expect(out(lowOne, 'score')).toBe(1);
    expect(lowOne.rangeId).toBe('low');
    expect(lowOne.explanation).toContain('1,5 %');
    expect(run(id, { ...base, malignancy: 1 }).rangeId).toBe('low'); // 2

    const moderateThree = run(id, { ...base, malignancy: 1, obesity: 1 }); // 2 + 1
    expect(out(moderateThree, 'score')).toBe(3);
    expect(moderateThree.rangeId).toBe('moderate');
    expect(moderateThree.explanation).toContain('3 %');
    expect(run(id, { ...base, malignancy: 1, majorSurgery: 1 }).rangeId).toBe('moderate'); // 4

    // Worked example: 65-year-old (2) with obesity (1), cancer (2), major open surgery (2) = 7
    const high = run(id, { ageYears: 65, obesity: 1, malignancy: 1, majorSurgery: 1 });
    expect(out(high, 'score')).toBe(7);
    expect(high.rangeId).toBe('high');
    expect(high.explanation).toContain('6 %');
    expect(run(id, { ...base, stroke: 1 }).rangeId).toBe('high'); // exactly 5
  });

  it('notes the original four-level Caprini categories as a limitation', () => {
    const limitations = moduleTool(id).definition.limitations ?? [];
    expect(limitations.some((line) => line.includes('0–1 балл — низкий'))).toBe(true);
    expect(limitations.some((line) => line.includes('наивысший'))).toBe(true);
  });
});

describe('MNOAR-89 operative-anaesthetic risk (MNOAR classification, 1989)', () => {
  const id = 'minimed.calculator.mnoar-89';
  const score = (state: number, surgery: number, anesthesia: number, emergency = 0): number =>
    out(run(id, { state, surgery, anesthesia, emergency }), 'score');

  it('scores the five rungs of each section (0.5-6, 0.5-2.5, 0.5-2.5)', () => {
    const stateRungs = [0.5, 1, 2, 4, 6];
    const rungs = [0.5, 1, 1.5, 2, 2.5];
    for (const [index, points] of stateRungs.entries()) {
      expect(score(index, 0, 0)).toBe(points + 1);
    }
    for (const [index, points] of rungs.entries()) {
      expect(score(0, index, 0)).toBe(points + 1);
      expect(score(0, 0, index)).toBe(points + 1);
    }
    expect(score(0, 0, 0)).toBe(1.5); // minimum of the scale
    expect(score(4, 4, 4)).toBe(11); // maximum of the scale: 6 + 2.5 + 2.5
    expect(score(4, 4, 4, 1)).toBe(12); // an emergency adds one point
  });

  it('assigns classes I 1.5, II 2-3, III 3.5-5, IV 5.5-8, V 8.5 and above', () => {
    const cases: readonly [number, number, number, number, string][] = [
      [0, 0, 0, 1.5, 'class-1'],
      [1, 0, 0, 2, 'class-2'],
      [2, 0, 0, 3, 'class-2'],
      [2, 1, 0, 3.5, 'class-3'], // 2 + 1 + 0.5
      [2, 2, 2, 5, 'class-3'], // 2 + 1.5 + 1.5
      [2, 2, 3, 5.5, 'class-4'], // 2 + 1.5 + 2
      [3, 3, 3, 8, 'class-4'], // 4 + 2 + 2
      [3, 3, 4, 8.5, 'class-5'], // 4 + 2 + 2.5
    ];
    for (const [state, surgery, anesthesia, expected, rangeId] of cases) {
      const result = run(id, { state, surgery, anesthesia, emergency: 0 });
      expect(out(result, 'score'), `${state}/${surgery}/${anesthesia}`).toBe(expected);
      expect(result.rangeId, `${state}/${surgery}/${anesthesia}`).toBe(rangeId);
    }
    // An emergency anaesthetic raises the minimum 1.5 to 2.5: class II.
    const emergency = run(id, { state: 0, surgery: 0, anesthesia: 0, emergency: 1 });
    expect(out(emergency, 'score')).toBe(2.5);
    expect(emergency.rangeId).toBe('class-2');
  });
});

describe('Evans burn resuscitation against Evans 1952 (Ann Surg 135:804) as reproduced in open reviews', () => {
  const id = 'minimed.calculator.evans-burn-fluids';

  it('gives 1 mL colloid + 1 mL crystalloid per kg per % burn plus 2000 mL glucose, halved on day two', () => {
    // Worked example: 70 kg, 20 % TBSA: 70 * 20 = 1400 mL of each, 4800 mL in the first 24 h.
    const result = run(id, { weightKg: 70, tbsa: 20 });
    expect(out(result, 'colloid1')).toBe(1400);
    expect(out(result, 'crystalloid1')).toBe(1400);
    expect(out(result, 'glucose1')).toBe(2000);
    expect(out(result, 'colloid1') + out(result, 'crystalloid1') + out(result, 'glucose1')).toBe(
      4800,
    );
    // Second 24 h: 0.5 mL/kg/% of each, the same 2000 mL glucose.
    expect(out(result, 'colloid2')).toBe(700);
    expect(out(result, 'crystalloid2')).toBe(700);
    expect(out(result, 'glucose2')).toBe(2000);
  });

  it('scales linearly with weight and burn area', () => {
    const result = run(id, { weightKg: 80, tbsa: 30 });
    expect(out(result, 'colloid1')).toBe(2400);
    expect(out(result, 'crystalloid2')).toBe(1200);
  });

  it('documents the 8 h / 16 h split of the first-day volume', () => {
    expect(moduleTool(id).definition.formulaDisplay).toContain('первые 8 ч');
  });
});

describe('Morse Fall Scale (Morse 1989) with the AHRQ risk levels', () => {
  const id = 'minimed.calculator.morse-fall-scale';
  const base: Inputs = {
    fell: 0,
    secondaryDiagnosis: 0,
    ambulatoryAid: 0,
    iv: 0,
    gait: 0,
    mental: 0,
  };
  const score = (override: Inputs): number => out(run(id, { ...base, ...override }), 'score');

  it('scores the six items: falls 25, second diagnosis 15, aid 0/15/30, IV 20, gait 0/10/20, mental 15', () => {
    expect(score({})).toBe(0);
    expect(score({ fell: 1 })).toBe(25);
    expect(score({ secondaryDiagnosis: 1 })).toBe(15);
    expect(score({ ambulatoryAid: 1 })).toBe(15); // crutches, cane, walker
    expect(score({ ambulatoryAid: 2 })).toBe(30); // furniture
    expect(score({ iv: 1 })).toBe(20);
    expect(score({ gait: 1 })).toBe(10); // weak
    expect(score({ gait: 2 })).toBe(20); // impaired
    expect(score({ mental: 1 })).toBe(15);
    // 25 + 15 + 30 + 20 + 20 + 15 = 125
    expect(
      score({ fell: 1, secondaryDiagnosis: 1, ambulatoryAid: 2, iv: 1, gait: 2, mental: 1 }),
    ).toBe(125);
  });

  it('uses no risk 0-24, low risk 25-44, high risk 45 and above', () => {
    const none = run(id, { ...base, iv: 1 }); // 20: scores move in steps of 5, so 24 is not reachable
    expect(out(none, 'score')).toBe(20);
    expect(none.rangeId).toBe('none');

    const lowAtCut = run(id, { ...base, fell: 1 }); // 25
    expect(out(lowAtCut, 'score')).toBe(25);
    expect(lowAtCut.rangeId).toBe('low');

    const lowTop = run(id, { ...base, fell: 1, mental: 1 }); // 25 + 15 = 40
    expect(out(lowTop, 'score')).toBe(40);
    expect(lowTop.rangeId).toBe('low');

    const lowFromAids = run(id, { ...base, ambulatoryAid: 1, iv: 1 }); // 15 + 20 = 35
    expect(out(lowFromAids, 'score')).toBe(35);
    expect(lowFromAids.rangeId).toBe('low');

    const highAtCut = run(id, { ...base, fell: 1, iv: 1 }); // 25 + 20 = 45
    expect(out(highAtCut, 'score')).toBe(45);
    expect(highAtCut.rangeId).toBe('high');
    expect(highAtCut.explanation).toContain('45 баллов и более');
  });
});
