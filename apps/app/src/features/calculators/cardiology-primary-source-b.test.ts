import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) for SCORE2 / SCORE2-OP, the Mehran contrast-nephropathy
 * score and the CEAP / chronic limb ischemia classifications of the cardiology module.
 *
 * Sources actually read:
 *  - SCORE2 (Eur Heart J 2021;42:2439, PMC8248998 full text): worked example in the Results text,
 *    coefficients and region scales from the table of Eur Heart J 2022;43:241 (PMID 35080243).
 *  - SCORE2-OP (Eur Heart J 2021;42:2455, PMC8248997 full text): Table 2 coefficients and centring
 *    (age 73, SBP 150, TC 6, HDL 1.4). The supplement (baseline survival, mean offsets, region
 *    scales) was not reachable; those constants agree with the independent CRAN implementation
 *    RiskScorescvd 0.3.1.
 *  - ESC 2021 prevention guideline Table 5 (risk categories).
 *  - Mehran 2004: figure reprinted with permission in PMC3711663; abstract (PMID 15464318).
 *  - CEAP 2020 update as reproduced in PMC10927428 and in the Russian clinical recommendation
 *    «Варикозное расширение вен нижних конечностей» (2024); Fontaine/Pokrovsky/Rutherford from
 *    Table 4 of the recommendation «Хроническая ишемия … перемежающейся хромоты» (2025) and
 *    Hardman 2014 (PMC4232437).
 */

const MODULE_FILE = 'content/tool-modules/cardiology.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;

interface Run {
  readonly numbers: Record<string, number>;
  readonly texts: Record<string, string>;
  readonly range: string | undefined;
  readonly title: string | undefined;
  readonly interpretation: string | undefined;
}

function run(key: string, inputs: Inputs): Run {
  const id = `minimed.calculator.${key}`;
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const numbers: Record<string, number> = {};
  const texts: Record<string, string> = {};
  for (const output of result.outputs) {
    if (output.kind === 'number') numbers[output.id] = output.value;
    if (output.kind === 'text') texts[output.id] = output.text;
  }
  return {
    numbers,
    texts,
    range: result.evaluation.verdict?.rangeId,
    title: result.evaluation.verdict?.title,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

function fails(key: string, inputs: Inputs): void {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${key}`);
  if (!schema) throw new Error(`Missing calculator ${key}`);
  expect(evaluateCalculatorSchema(schema, inputs).ok, key).toBe(false);
}

describe('SCORE2 / SCORE2-OP (ESC 2021)', () => {
  const REGIONS = ['low', 'moderate', 'high', 'veryHigh'] as const;
  const risk = (inputs: Inputs, region: string) =>
    run('score2-score2-op', { ...inputs, region }).numbers.riskPercent;

  // Worked example printed in the SCORE2 paper (Results): 50-year-old smoker, SBP 140 mmHg,
  // total cholesterol 5.5 mmol/L, HDL 1.3 mmol/L: men 5.9 % (low risk) ... 14.0 % (very high risk),
  // women 4.2 % ... 13.7 %.
  const man50 = { sex: 'male', ageYears: 50, smoker: 1, sbp: 140, totalChol: 5.5, hdl: 1.3 };
  const woman50 = { ...man50, sex: 'female' };

  it('reproduces the published 50-year-old smoker example in the low and very high regions', () => {
    expect(risk(man50, 'low')).toBe(5.9);
    expect(risk(man50, 'veryHigh')).toBe(14.0);
    expect(risk(woman50, 'low')).toBe(4.2);
    expect(risk(woman50, 'veryHigh')).toBe(13.7);
  });

  it('applies the published moderate and high region scales (hand-computed from the 2022 table)', () => {
    // Man, 50 y: centred age -2, SBP 1, TC -0.5, HDL 0, smoker 1:
    // x = 0.3742(-2) + 0.6012 + 0.2777 + 0.1458(-0.5) + (-0.0755)(-2)(1) + (-0.0255)(-2)(1)
    //   + (-0.0281)(-2)(-0.5) = 0.2315; risk0 = 1 - 0.9605^exp(x) = 0.0495; ln(-ln(1-risk0)) = -2.9795.
    // Region scale: 1 - exp(-exp(scale1 + scale2 * -2.9795)).
    expect(risk(man50, 'moderate')).toBe(7.6); // -0.1565 + 0.8009 * -2.9795
    expect(risk(man50, 'high')).toBe(8.1); //   0.3207 + 0.9360 * -2.9795
    expect(risk(woman50, 'moderate')).toBe(5.1);
    expect(risk(woman50, 'high')).toBe(6.9);
    expect(REGIONS.map((region) => risk(man50, region))).toEqual([5.9, 7.6, 8.1, 14.0]);
  });

  it('cuts the ESC 2021 categories at 2.5 / 7.5 (<50 y), 5 / 10 (50–69 y) and 7.5 / 15 % (>=70 y)', () => {
    // 49 vs 50 years, man smoker: the same profile moves from "very high" (>=7.5 %) to "high" (<10 %).
    const man49 = { ...man50, ageYears: 49 };
    expect([
      risk(man49, 'high'),
      run('score2-score2-op', { ...man49, region: 'high' }).range,
    ]).toEqual([7.7, 'very-high']);
    expect([
      risk(man50, 'high'),
      run('score2-score2-op', { ...man50, region: 'high' }).range,
    ]).toEqual([8.1, 'high']);
    expect(run('score2-score2-op', { ...man50, region: 'low' }).range).toBe('high'); // 5.9 % in 5–<10
    expect(run('score2-score2-op', { ...woman50, region: 'low' }).range).toBe('low-moderate'); // 4.2 % < 5
    expect(run('score2-score2-op', { ...man50, region: 'veryHigh' }).range).toBe('very-high');

    // 69 vs 70 years, non-smoking woman, low region: SCORE2 5.3 % (>=5, high) vs SCORE2-OP 4.7 % (<7.5).
    const woman69 = { sex: 'female', ageYears: 69, smoker: 0, sbp: 120, totalChol: 5, hdl: 1.6 };
    const woman70 = { ...woman69, ageYears: 70 };
    expect(risk(woman69, 'low')).toBe(5.3);
    expect(run('score2-score2-op', { ...woman69, region: 'low' }).range).toBe('high');
    expect(risk(woman70, 'low')).toBe(4.7);
    expect(run('score2-score2-op', { ...woman70, region: 'low' }).range).toBe('low-moderate');
    // The very high region at 70 y: 23.1 % >= 15 %.
    expect(risk(woman70, 'veryHigh')).toBe(23.1);
    expect(run('score2-score2-op', { ...woman70, region: 'veryHigh' }).range).toBe('very-high');
  });

  it('uses the band wording of the ESC 2021 table', () => {
    expect(run('score2-score2-op', { ...woman50, region: 'low' }).title).toBe(
      'Низкий или умеренный риск',
    );
    expect(run('score2-score2-op', { ...man50, region: 'low' }).title).toBe('Высокий риск');
    expect(run('score2-score2-op', { ...man50, region: 'veryHigh' }).title).toBe(
      'Очень высокий риск',
    );
    expect(run('score2-score2-op', { ...man50, region: 'low' }).interpretation).toContain(
      '5–<10 % в 50–69 лет',
    );
  });

  it('reproduces SCORE2-OP for the centred reference person (coefficients of Table 2 cancel)', () => {
    // Reference older person: 73 y, SBP 150, TC 6, HDL 1.4, non-smoker -> every centred term is 0, so the
    // linear predictor is only the mean offset: x = -0.0929 (men), -0.229 (women).
    // Man, low region: risk0 = 1 - 0.7576^exp(-0.0929) = 0.2230 -> ln(-ln(1-risk0)) = ln(0.25297) = -1.3745;
    // -0.34 + 1.19 * -1.3745 = -1.9757 -> 1 - exp(-exp(-1.9757)) = 0.1295 -> 12.9 %.
    const man73 = { sex: 'male', ageYears: 73, smoker: 0, sbp: 150, totalChol: 6, hdl: 1.4 };
    const woman73 = { ...man73, sex: 'female' };
    expect(REGIONS.map((region) => risk(man73, region))).toEqual([12.9, 16.6, 20.0, 33.1]);
    expect(REGIONS.map((region) => risk(woman73, region))).toEqual([9.4, 12.0, 19.0, 34.9]);
  });

  it('applies the SCORE2-OP smoking, HDL and total cholesterol terms in the published direction', () => {
    // 75-year-old smoker, SBP 150, TC 5.9, HDL 1.4 (age 75 = centred +2).
    const man75 = { sex: 'male', ageYears: 75, smoker: 1, sbp: 150, totalChol: 5.9, hdl: 1.4 };
    const woman75 = { ...man75, sex: 'female' };
    expect(REGIONS.map((region) => risk(man75, region))).toEqual([20.4, 26.4, 30.3, 41.7]);
    expect(REGIONS.map((region) => risk(woman75, region))).toEqual([16.5, 21.8, 33.2, 47.6]);
    // Per Table 2 smoking raises the risk, higher HDL lowers it, higher total cholesterol raises it.
    expect(risk({ ...man75, smoker: 0 }, 'low')).toBeLessThan(20.4);
    expect(risk({ ...man75, hdl: 1.8 }, 'low')).toBeLessThan(20.4);
    expect(risk({ ...man75, totalChol: 6.9 }, 'low')).toBeGreaterThan(20.4);
  });

  it('keeps the model age window 40–89', () => {
    expect(risk({ ...man50, ageYears: 40 }, 'veryHigh')).toBeGreaterThan(0);
    expect(risk({ ...man50, ageYears: 89 }, 'veryHigh')).toBeGreaterThan(0);
    fails('score2-score2-op', { ...man50, ageYears: 39, region: 'low' });
    fails('score2-score2-op', { ...man50, ageYears: 90, region: 'low' });
  });
});

describe('Mehran contrast-induced nephropathy score (JACC 2004;44:1393)', () => {
  const none: Inputs = {
    hypotension: 0,
    iabp: 0,
    chf: 0,
    ageYears: 60,
    anemia: 0,
    diabetes: 0,
    contrastMl: 0,
    egfr: 90,
  };
  const score = (patch: Inputs) => run('mehran-cin-score', { ...none, ...patch }).numbers.score;

  it('adds the published integer scores of the eight variables', () => {
    // Figure: hypotension 5, IABP 5, CHF 5, age >75 4, anemia 3, diabetes 3, 1 per 100 cc, eGFR 40-60 2 /
    // 20-40 4 / <20 6.
    // All factors: 5 + 5 + 5 + 4 + 3 + 3 + 3 (350 mL) + 4 (eGFR 25) = 32.
    const everything = run('mehran-cin-score', {
      hypotension: 1,
      iabp: 1,
      chf: 1,
      ageYears: 76,
      anemia: 1,
      diabetes: 1,
      contrastMl: 350,
      egfr: 25,
    });
    expect(everything.numbers.score).toBe(32);
    expect(everything.range).toBe('very-high');
    expect(score({})).toBe(0);
  });

  it('handles the contrast, age and eGFR boundaries', () => {
    expect([99, 100, 199, 200].map((contrastMl) => score({ contrastMl }))).toEqual([0, 1, 1, 2]);
    expect([75, 76].map((ageYears) => score({ ageYears }))).toEqual([0, 4]);
    // "eGFR < 60: 2 for 40-60, 4 for 20-40, 6 for <20": 60 -> 0; 59 and 40 -> 2; 39 and 20 -> 4; 19 -> 6.
    expect([61, 60, 59, 40, 39, 20, 19].map((egfr) => score({ egfr }))).toEqual([
      0, 0, 2, 2, 4, 4, 6,
    ]);
  });

  it('cuts the published risk bands at <=5, 6–10, 11–15 and >=16 with the figure CIN and dialysis rates', () => {
    const rows: readonly [Inputs, number, string, string][] = [
      [{ hypotension: 1 }, 5, 'low', 'нефропатия 7,5 %, диализ 0,04 %'],
      [{ hypotension: 1, contrastMl: 100 }, 6, 'moderate', 'нефропатия 14,0 %, диализ 0,12 %'],
      [{ hypotension: 1, iabp: 1 }, 10, 'moderate', 'нефропатия 14,0 %, диализ 0,12 %'],
      [
        { hypotension: 1, iabp: 1, contrastMl: 100 },
        11,
        'high',
        'нефропатия 26,1 %, диализ 1,09 %',
      ],
      [{ hypotension: 1, iabp: 1, chf: 1 }, 15, 'high', 'нефропатия 26,1 %, диализ 1,09 %'],
      [
        { hypotension: 1, iabp: 1, chf: 1, contrastMl: 100 },
        16,
        'very-high',
        'нефропатия 57,3 %, диализ 12,6 %',
      ],
    ];
    for (const [patch, expected, range, rates] of rows) {
      const result = run('mehran-cin-score', { ...none, ...patch });
      expect(result.numbers.score, JSON.stringify(patch)).toBe(expected);
      expect(result.range, JSON.stringify(patch)).toBe(range);
      expect(result.interpretation, JSON.stringify(patch)).toContain(rates);
    }
  });
});

describe('CEAP (2004 consensus + 2020 update, Russian КР 2024)', () => {
  const base: Inputs = {
    clinical: 'C3',
    symptoms: 'S',
    etiology: 'Ep',
    superficial: 1,
    perforator: 1,
    deep: 0,
    pathophysiology: 'Pr',
  };

  it('reproduces the basic example of the КР: C3s, Ep, As,p, Pr', () => {
    const result = run('ceap', base);
    expect(result.texts).toMatchObject({
      cText: 'C3',
      sText: 'S',
      eText: 'Ep',
      aText: 'As,p',
      pText: 'Pr',
    });
    expect(result.numbers.cNumber).toBe(3);
    expect(result.range).toBe('c3');
  });

  it('knows the 2020 classes C2r, C4c and C6r and the Esi / Ese subdivision', () => {
    const classes: readonly [string, number, string][] = [
      ['C0', 0, 'c0-c1'],
      ['C1', 1, 'c0-c1'],
      ['C2', 2, 'c2'],
      ['C2r', 2, 'c2'],
      ['C3', 3, 'c3'],
      ['C4a', 4, 'c4-c5'],
      ['C4b', 4, 'c4-c5'],
      ['C4c', 4, 'c4-c5'],
      ['C5', 5, 'c4-c5'],
      ['C6', 6, 'c6'],
      ['C6r', 6, 'c6'],
    ];
    for (const [clinical, number, range] of classes) {
      for (const key of ['ceap', 'ceap-extended']) {
        const inputs = key === 'ceap' ? { ...base, clinical } : extendedBase({ clinical });
        const result = run(key, inputs);
        expect(result.numbers.cNumber, `${key} ${clinical}`).toBe(number);
        expect(result.range, `${key} ${clinical}`).toBe(range);
        expect(result.texts.cText).toBe(clinical);
      }
    }
    for (const etiology of ['Ec', 'Ep', 'Es', 'Esi', 'Ese', 'En']) {
      expect(run('ceap', { ...base, etiology }).texts.eText).toBe(etiology);
    }
    fails('ceap', { ...base, clinical: 'C7' });
  });

  function extendedBase(patch: Inputs): Inputs {
    return { clinical: 'C3', symptoms: 'S', etiology: 'Ep', pathophysiology: 'Pr', ...patch };
  }

  it('reproduces the extended КР example Pr (GSVa, TPV) with the 2020 segment abbreviations', () => {
    // КР 2024: "С2,3s, Ep, As,p, Pr (GSVa, TPV)": great saphenous vein above the knee (old no. 2) and
    // thigh perforator (old no. 17).
    const result = run('ceap-extended', extendedBase({ seg2: 1, seg17: 1 }));
    expect(result.texts.aText).toBe('As,p');
    expect(result.numbers.segmentCount).toBe(2);
  });

  it('groups the 2020 segments into As (Tel, Ret, GSVa, GSVb, SSV, AASV, NSV), Ad and Ap', () => {
    const only = (segment: string) => {
      const segments: Inputs = {};
      for (const id of [
        'seg1',
        'segRet',
        'seg2',
        'seg3',
        'seg4',
        'segAASV',
        'seg5',
        'seg6',
        'seg7',
        'seg8',
        'seg9',
        'seg10',
        'seg11',
        'seg12',
        'seg13',
        'seg14',
        'seg15',
        'seg16',
        'seg17',
        'seg18',
      ])
        segments[id] = id === segment ? 1 : 0;
      return run('ceap-extended', extendedBase(segments)).texts.aText;
    };
    expect(['seg1', 'segRet', 'seg2', 'seg3', 'seg4', 'segAASV', 'seg5'].map(only)).toEqual([
      'As',
      'As',
      'As',
      'As',
      'As',
      'As',
      'As',
    ]);
    expect(
      [
        'seg6',
        'seg7',
        'seg8',
        'seg9',
        'seg10',
        'seg11',
        'seg12',
        'seg13',
        'seg14',
        'seg15',
        'seg16',
      ].map(only),
    ).toEqual(Array.from({ length: 11 }, () => 'Ad'));
    expect(['seg17', 'seg18'].map(only)).toEqual(['Ap', 'Ap']);
    expect(run('ceap-extended', extendedBase({})).texts.aText).toBe('An');
  });
});

describe('Chronic limb ischemia: Fontaine, Pokrovsky, Rutherford (КР 2025 table 4)', () => {
  it('maps the clinical pictures like table 4 of the КР, with Rutherford categories 0–6', () => {
    // [picture, Fontaine, Pokrovsky, Rutherford grade, Rutherford category]
    const table: readonly [number, string, string, string, number][] = [
      [0, 'I', 'I', '0', 0],
      [1, 'IIa', 'IIa', 'I', 1],
      [2, 'IIb', 'IIb', 'I', 2],
      [3, 'IIb', 'III', 'I', 3],
      [4, 'III', 'III', 'II', 4],
      [5, 'IV', 'IV', 'III', 5],
      [6, 'IV', 'IV', 'III', 6],
    ];
    for (const [picture, fontaine, pokrovsky, grade, category] of table) {
      const result = run('chronic-limb-ischemia', { picture });
      expect(result.numbers.rutherfordCategory).toBe(category);
      expect(result.texts).toMatchObject({
        fontaineStage: fontaine,
        pokrovskyStage: pokrovsky,
        rutherfordGrade: grade,
      });
      expect(result.interpretation).toContain(`Фонтейн ${fontaine}, Покровский ${pokrovsky}`);
      expect(result.range).toBe(`cat-${category}`);
    }
  });

  it('words categories 5 and 6 by the extent of tissue loss as in Rutherford 1997', () => {
    expect(run('chronic-limb-ischemia', { picture: 5 }).title).toBe('Небольшой дефект тканей');
    expect(run('chronic-limb-ischemia', { picture: 6 }).title).toBe('Обширный дефект тканей');
    expect(run('chronic-limb-ischemia', { picture: 6 }).interpretation).toContain(
      'major tissue loss',
    );
    fails('chronic-limb-ischemia', { picture: 7 });
  });

  it('carries the diabetes caveat and the grade ambiguity of category 6 in the limitations', () => {
    const schema = SCHEMAS.find(
      (candidate) => candidate.id === 'minimed.calculator.chronic-limb-ischemia',
    );
    const limitations = (schema?.limitations ?? []).join(' ');
    expect(limitations).toContain('сахарным диабетом');
    expect(limitations).toContain('категории 6');
  });
});
