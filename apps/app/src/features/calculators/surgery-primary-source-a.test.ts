import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) of POSSUM, Mannheim peritonitis index, Pusajo ARPI,
 * Ranson and the complete Rockall score.
 *
 * Sources actually read in full:
 * - Rockall TA et al., Gut 1996;38:316-321, PMC1383057 (page scans: Tables II-IV);
 * - Ranson JH, Ann Surg 1979;189:654-663, PMC1397201 (Table 1 and Fig. 1);
 * - the POSSUM tables and the POSSUM / P-POSSUM equations as reproduced in the open article
 *   PMC4541674 (Copeland 1991 tables), with the Prytherch 1998 abstract (PMID 9752863);
 * - Billing 1994 abstract (PMID 8156338) for the Mannheim classes and the MPI score table as
 *   reproduced in PMC10578822 and JCDR 2020;14(6):PC09.
 * The Pusajo 1993 full text was not reachable; its checks only pin the current schema.
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

const logistic = (x: number): number => 100 / (1 + Math.exp(-x));

interface RawTool {
  readonly id: string;
  readonly version: string;
  readonly definition: {
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

describe('POSSUM / P-POSSUM against Copeland 1991 tables and Prytherch 1998 equations', () => {
  const id = 'minimed.calculator.possum';
  const best: Inputs = {
    age: 40,
    cardiac: 0,
    respiratory: 0,
    sbp: 120,
    pulse: 70,
    gcs: 15,
    hb: 14,
    wbc: 7,
    urea: 5,
    sodium: 140,
    potassium: 4.2,
    ecg: 0,
    severity: 0,
    procedures: 0,
    bloodLoss: 50,
    soiling: 0,
    malignancy: 0,
    mode: 0,
  };
  const ps = (override: Inputs): number => out(run(id, { ...best, ...override }), 'ps');
  const os = (override: Inputs): number => out(run(id, { ...best, ...override }), 'os');

  it('scores the physiological table at every published break (baseline 12 points)', () => {
    // [input, value, expected points] — the baseline contributes 1 point for the tested row.
    const rows: readonly [string, number, number][] = [
      ['age', 60, 1],
      ['age', 61, 2],
      ['age', 70, 2],
      ['age', 71, 4],
      ['cardiac', 1, 2],
      ['cardiac', 2, 4],
      ['cardiac', 3, 8],
      ['respiratory', 1, 2],
      ['respiratory', 2, 4],
      ['respiratory', 3, 8],
      ['sbp', 110, 1],
      ['sbp', 130, 1],
      ['sbp', 109, 2],
      ['sbp', 100, 2],
      ['sbp', 131, 2],
      ['sbp', 170, 2],
      ['sbp', 171, 4],
      ['sbp', 99, 4],
      ['sbp', 90, 4],
      ['sbp', 89, 8],
      ['pulse', 50, 1],
      ['pulse', 80, 1],
      ['pulse', 81, 2],
      ['pulse', 100, 2],
      ['pulse', 49, 2],
      ['pulse', 40, 2],
      ['pulse', 101, 4],
      ['pulse', 120, 4],
      ['pulse', 121, 8],
      ['pulse', 39, 8],
      ['gcs', 15, 1],
      ['gcs', 14, 2],
      ['gcs', 12, 2],
      ['gcs', 11, 4],
      ['gcs', 9, 4],
      ['gcs', 8, 8],
      ['hb', 13, 1],
      ['hb', 16, 1],
      ['hb', 12.9, 2],
      ['hb', 11.5, 2],
      ['hb', 17, 2],
      ['hb', 11.4, 4],
      ['hb', 10, 4],
      ['hb', 18, 4],
      ['hb', 9.9, 8],
      ['hb', 18.1, 8],
      ['wbc', 10, 1],
      ['wbc', 10.1, 2],
      ['wbc', 20, 2],
      ['wbc', 3.9, 2],
      ['wbc', 20.1, 4],
      ['wbc', 3, 4],
      ['urea', 7.5, 1],
      ['urea', 7.6, 2],
      ['urea', 10, 2],
      ['urea', 10.1, 4],
      ['urea', 15, 4],
      ['urea', 15.1, 8],
      ['sodium', 136, 1],
      ['sodium', 135, 2],
      ['sodium', 131, 2],
      ['sodium', 130, 4],
      ['sodium', 126, 4],
      ['sodium', 125, 8],
      ['potassium', 3.5, 1],
      ['potassium', 5, 1],
      ['potassium', 3.4, 2],
      ['potassium', 3.2, 2],
      ['potassium', 5.1, 2],
      ['potassium', 5.3, 2],
      ['potassium', 3.1, 4],
      ['potassium', 2.9, 4],
      ['potassium', 5.4, 4],
      ['potassium', 5.9, 4],
      ['potassium', 2.8, 8],
      ['potassium', 6, 8],
      ['ecg', 1, 4],
      ['ecg', 2, 8],
    ];
    for (const [key, input, points] of rows) {
      expect(ps({ [key]: input }) - 11, `${key}=${input}`).toBe(points);
    }
  });

  it('scores the operative table at every published break (baseline 6 points)', () => {
    const rows: readonly [string, number, number][] = [
      ['severity', 1, 2],
      ['severity', 2, 4],
      ['severity', 3, 8],
      ['procedures', 1, 4],
      ['procedures', 2, 8],
      ['bloodLoss', 100, 1],
      ['bloodLoss', 101, 2],
      ['bloodLoss', 500, 2],
      ['bloodLoss', 501, 4],
      ['bloodLoss', 999, 4],
      ['bloodLoss', 1000, 8],
      ['soiling', 1, 2],
      ['soiling', 2, 4],
      ['soiling', 3, 8],
      ['malignancy', 1, 2],
      ['malignancy', 2, 4],
      ['malignancy', 3, 8],
      ['mode', 1, 4],
      ['mode', 2, 8],
    ];
    for (const [key, input, points] of rows) {
      expect(os({ [key]: input }) - 5, `${key}=${input}`).toBe(points);
    }
  });

  it('applies the POSSUM, P-POSSUM and morbidity equations to a hand-computed patient', () => {
    // Age 72 (4), oedema/warfarin cardiac tier (4), limiting dyspnoea (4), SBP 95 (4), pulse 105 (4),
    // GCS 14 (2), Hb 12 (2), WBC 12 (2), urea 12 (4), Na 133 (2), K 3.3 (2), AF (4):
    // PS = 4+4+4+4+4+2+2+2+4+2+2+4 = 38.
    // Major operation (4), two procedures (4), blood loss 600 (4), local pus (4), nodal metastases (4),
    // emergency within 24 h (4): OS = 24.
    const result = run(id, {
      age: 72,
      cardiac: 2,
      respiratory: 2,
      sbp: 95,
      pulse: 105,
      gcs: 14,
      hb: 12,
      wbc: 12,
      urea: 12,
      sodium: 133,
      potassium: 3.3,
      ecg: 1,
      severity: 2,
      procedures: 1,
      bloodLoss: 600,
      soiling: 2,
      malignancy: 2,
      mode: 1,
    });
    expect(out(result, 'ps')).toBe(38);
    expect(out(result, 'os')).toBe(24);
    // POSSUM: ln(R/(1-R)) = -7.04 + 0.13*38 + 0.16*24 = 1.74
    expect(out(result, 'possumMortality')).toBeCloseTo(logistic(-7.04 + 0.13 * 38 + 0.16 * 24), 6);
    expect(out(result, 'possumMortality')).toBeCloseTo(85.1, 1);
    // P-POSSUM: -9.065 + 0.1692*38 + 0.1550*24 = 1.0846 (Prytherch 1998 constants)
    expect(out(result, 'pPossumMortality')).toBeCloseTo(
      logistic(-9.065 + 0.1692 * 38 + 0.155 * 24),
      6,
    );
    expect(out(result, 'pPossumMortality')).toBeCloseTo(74.7, 1);
    // Morbidity: -5.91 + 0.16*38 + 0.19*24 = 4.73
    expect(out(result, 'possumMorbidity')).toBeCloseTo(logistic(-5.91 + 0.16 * 38 + 0.19 * 24), 6);
    expect(out(result, 'possumMorbidity')).toBeCloseTo(99.1, 1);
  });

  it('shows POSSUM overpredicting relative to P-POSSUM at low risk (Prytherch 1998)', () => {
    const low = run(id, best);
    // 12/6: POSSUM -7.04+1.56+0.96 = -4.52 -> 1.07 %; P-POSSUM -9.065+2.0304+0.93 = -6.1046 -> 0.22 %
    expect(out(low, 'possumMortality')).toBeCloseTo(logistic(-4.52), 6);
    expect(out(low, 'pPossumMortality')).toBeCloseTo(logistic(-6.1046), 6);
    expect(out(low, 'possumMortality')).toBeGreaterThan(4 * out(low, 'pPossumMortality'));
  });
});

describe('Mannheim peritonitis index against Linder/Wacha weights and Billing 1994 classes', () => {
  const id = 'minimed.calculator.mannheim-peritonitis-index';
  const base: Inputs = { ageYears: 40, sex: 0, exudate: 0 };
  const score = (override: Inputs): number => out(run(id, { ...base, ...override }), 'score');

  it('reaches the published maximum of 47 and the single-item weights', () => {
    expect(
      score({
        ageYears: 60,
        sex: 1,
        organFailure: 1,
        malignancy: 1,
        duration: 1,
        nonColonic: 1,
        diffuse: 1,
        exudate: 12,
      }),
    ).toBe(47);
    expect(score({ ageYears: 50 })).toBe(0);
    expect(score({ ageYears: 51 })).toBe(5);
    expect(score({ sex: 1 })).toBe(5);
    expect(score({ organFailure: 1 })).toBe(7);
    expect(score({ malignancy: 1 })).toBe(4);
    expect(score({ duration: 1 })).toBe(4);
    expect(score({ nonColonic: 1 })).toBe(4);
    expect(score({ diffuse: 1 })).toBe(6);
    expect(score({ exudate: 6 })).toBe(6);
    expect(score({ exudate: 12 })).toBe(12);
  });

  it('uses the Billing 1994 classes: <21, 21-29, >29 with 2.3 / 22.5 / 59.1 % mortality', () => {
    // 20 = female 5 + organ failure 7 + malignancy 4 + duration 4
    const twenty = run(id, { ...base, sex: 1, organFailure: 1, malignancy: 1, duration: 1 });
    expect(out(twenty, 'score')).toBe(20);
    expect(twenty.rangeId).toBe('class-1');
    expect(twenty.explanation).toContain('2,3 %');
    // 21 = age>50 5 + female 5 + organ failure 7 + malignancy 4
    const twentyOne = run(id, {
      ...base,
      ageYears: 60,
      sex: 1,
      organFailure: 1,
      malignancy: 1,
    });
    expect(out(twentyOne, 'score')).toBe(21);
    expect(twentyOne.rangeId).toBe('class-2');
    expect(twentyOne.explanation).toContain('22,5 %');
    // 29 = age 5 + female 5 + organ failure 7 + diffuse 6 + purulent exudate 6
    const twentyNine = run(id, {
      ...base,
      ageYears: 60,
      sex: 1,
      organFailure: 1,
      diffuse: 1,
      exudate: 6,
    });
    expect(out(twentyNine, 'score')).toBe(29);
    expect(twentyNine.rangeId).toBe('class-2');
    // 30 = female 5 + organ failure 7 + diffuse 6 + faecal exudate 12
    const thirty = run(id, { ...base, sex: 1, organFailure: 1, diffuse: 1, exudate: 12 });
    expect(out(thirty, 'score')).toBe(30);
    expect(thirty.rangeId).toBe('class-3');
    expect(thirty.explanation).toContain('59,1 %');
  });

  it('describes organ failure with the creatinine, urea, oliguria, gas and obstruction criteria', () => {
    const tooltip = moduleTool(id).definition.inputs.find(
      (input) => input.id === 'organFailure',
    )?.labelTooltip;
    expect(tooltip).toContain('177');
    expect(tooltip).toContain('16,7');
    expect(tooltip).toContain('20 мл/ч');
    expect(tooltip).toContain('pO₂ менее 50');
    expect(tooltip).toContain('pCO₂ более 50');
    expect(tooltip).toContain('механическая непроходимость');
    expect(moduleTool(id).version).toBe('1.0.1');
  });
});

describe('Pusajo abdominal reoperation index (schema pinned; primary text not reachable)', () => {
  const id = 'minimed.calculator.pusajo-relaparotomy-index';
  const score = (inputs: Inputs): number => out(run(id, inputs), 'score');

  it('sums the eight items to the schema maximum of 32', () => {
    expect(
      score({
        emergencyFirst: 1,
        respiratoryFailure: 1,
        renalFailure: 1,
        ileus: 1,
        pain: 1,
        woundInfection: 1,
        consciousness: 1,
        lateSymptoms: 1,
      }),
    ).toBe(32);
    expect(score({ emergencyFirst: 1 })).toBe(3);
    expect(score({ respiratoryFailure: 1 })).toBe(2);
    expect(score({ renalFailure: 1 })).toBe(2);
    expect(score({ ileus: 1 })).toBe(4);
    expect(score({ pain: 1 })).toBe(5);
    expect(score({ woundInfection: 1 })).toBe(8);
    expect(score({ consciousness: 1 })).toBe(2);
    expect(score({ lateSymptoms: 1 })).toBe(6);
  });

  it('keeps the Moscow 2017 bands and flags the unverified thresholds in the limitations', () => {
    // 10 = emergency 3 + pain 5 + respiratory 2
    expect(run(id, { emergencyFirst: 1, pain: 1, respiratoryFailure: 1 }).rangeId).toBe('low');
    // 11 = pain 5 + ileus 4 + respiratory 2
    expect(run(id, { pain: 1, ileus: 1, respiratoryFailure: 1 }).rangeId).toBe('intermediate');
    // 12 = pain 5 + ileus 4 + emergency 3
    expect(run(id, { pain: 1, ileus: 1, emergencyFirst: 1 }).rangeId).toBe('intermediate');
    // 13 = pain 5 + ileus 4 + respiratory 2 + renal 2
    expect(run(id, { pain: 1, ileus: 1, respiratoryFailure: 1, renalFailure: 1 }).rangeId).toBe(
      'high',
    );
    // 14 = wound infection 8 + ileus 4 + respiratory 2
    expect(run(id, { woundInfection: 1, ileus: 1, respiratoryFailure: 1 }).rangeId).toBe('high');
    // 15 = wound infection 8 + pain 5 + respiratory 2
    expect(run(id, { woundInfection: 1, pain: 1, respiratoryFailure: 1 }).rangeId).toBe(
      'very-high',
    );
    const limitations = moduleTool(id).definition.limitations?.join(' ') ?? '';
    expect(limitations).toContain('проверить не удалось');
    expect(limitations).toContain('88 %');
  });
});

describe('Ranson criteria against Ranson 1979 Table 1 (non-gallstone thresholds)', () => {
  const id = 'minimed.calculator.ranson-pancreatitis';
  // Every value sits exactly ON the published threshold, so nothing counts (strict ">" / "<").
  const onThreshold: Inputs = {
    etiology: 0,
    ageYears: 55,
    wbc: 16,
    glucose: 11.1,
    ldh: 350,
    ast: 250,
    hctFall: 10,
    ureaRise: 1.8,
    calcium: 2,
    pao2: 60,
    baseDeficit: 4,
    fluid: 6,
  };
  const criteria = (inputs: Inputs): number => out(run(id, inputs), 'criteria');

  it('counts nothing on the threshold and one criterion just beyond it', () => {
    expect(criteria(onThreshold)).toBe(0);
    const beyond: Inputs = {
      ageYears: 56, // >55 y
      wbc: 16.1, // >16 000/mm3
      glucose: 11.2, // >200 mg/dl = 11.1 mmol/l
      ldh: 351, // >350 IU/l
      ast: 251, // >250 (Sigma-Frankel units in the paper)
      hctFall: 10.5, // fall >10 percentage points
      ureaRise: 1.9, // BUN rise >5 mg/dl = 1.8 mmol/l urea
      calcium: 1.9, // <8 mg/dl = 2.0 mmol/l
      pao2: 59, // <60 mmHg
      baseDeficit: 4.1, // >4 mEq/l
      fluid: 6.1, // >6000 ml
    };
    for (const [key, input] of Object.entries(beyond))
      expect(criteria({ ...onThreshold, [key]: input }), key).toBe(1);
    expect(criteria({ ...onThreshold, ...beyond })).toBe(11);
  });

  it('uses the gallstone set: age >70, WBC >18, glucose >12.2, LDH >400, base deficit >5, fluid >4 L, PaO2 ignored', () => {
    const gallOn: Inputs = {
      ...onThreshold,
      etiology: 1,
      ageYears: 70,
      wbc: 18,
      glucose: 12.2,
      ldh: 400,
      ureaRise: 0.7,
      baseDeficit: 5,
      fluid: 4,
      pao2: 30,
    };
    expect(criteria(gallOn)).toBe(0);
    const beyond: Inputs = {
      ageYears: 71,
      wbc: 18.1,
      glucose: 12.3,
      ldh: 401,
      ast: 251,
      hctFall: 10.5,
      ureaRise: 0.8,
      calcium: 1.9,
      baseDeficit: 5.1,
      fluid: 4.1,
    };
    for (const [key, input] of Object.entries(beyond))
      expect(criteria({ ...gallOn, [key]: input }), key).toBe(1);
    expect(criteria({ ...gallOn, ...beyond })).toBe(10);
  });

  it('names the mortality band by number of criteria', () => {
    const withCount = (count: number): Inputs => {
      const flags: Inputs[] = [
        { ageYears: 56 },
        { wbc: 17 },
        { glucose: 12 },
        { ldh: 400 },
        { ast: 300 },
        { hctFall: 12 },
        { ureaRise: 2 },
      ];
      return Object.assign({ ...onThreshold }, ...flags.slice(0, count)) as Inputs;
    };
    const rangeAt = (count: number): string | undefined => run(id, withCount(count)).rangeId;
    expect(rangeAt(0)).toBe('low');
    expect(rangeAt(2)).toBe('low');
    expect(rangeAt(3)).toBe('moderate'); // three or more signs = "severe" in Ranson 1979
    expect(rangeAt(4)).toBe('moderate');
    expect(rangeAt(5)).toBe('severe');
    expect(rangeAt(6)).toBe('severe');
    expect(rangeAt(7)).toBe('critical');
  });

  it('records the unverified parts in the limitations', () => {
    const limitations = moduleTool(id).definition.limitations?.join(' ') ?? '';
    expect(limitations).toContain('Сигма–Франкеля');
    expect(limitations).toContain('не проверены');
  });
});

describe('Rockall complete score against Rockall 1996 Tables III and IV(B)', () => {
  const id = 'minimed.calculator.rockall-complete';
  const base: Inputs = { ageYears: 40, shock: 0, comorbidity: 0, diagnosis: 0, stigmata: 0 };
  const fmt = (n: number): string => String(n).replace('.', ',');

  // Table IV(B): rebleeding % and total mortality % per complete risk score 0..8+.
  const rebleed = [4.9, 3.4, 5.3, 11.2, 14.1, 24.1, 32.9, 43.8, 41.8] as const;
  const mortality = [0, 0, 0.2, 2.9, 5.3, 10.8, 17.3, 27, 41.1] as const;
  const inputsForScore: readonly Inputs[] = [
    { ...base },
    { ...base, ageYears: 60 }, // 1
    { ...base, shock: 2 }, // 2
    { ...base, comorbidity: 3 }, // 3
    { ...base, ageYears: 80, shock: 2 }, // 4
    { ...base, ageYears: 80, shock: 2, diagnosis: 1 }, // 5
    { ...base, comorbidity: 3, shock: 2, diagnosis: 1 }, // 6
    { ...base, comorbidity: 3, shock: 2, stigmata: 2 }, // 7
    { ...base, comorbidity: 3, shock: 2, stigmata: 2, diagnosis: 1 }, // 8
  ];

  it('gives the published rebleeding and mortality for every score band', () => {
    inputsForScore.forEach((inputs, score) => {
      const result = run(id, inputs);
      expect(out(result, 'score')).toBe(score);
      const rebleedText = `повторное кровотечение у ${fmt(rebleed[score] ?? NaN)} %`;
      const mortalityText = `летальность ${fmt(mortality[score] ?? NaN)} %`;
      expect(result.explanation, `score ${score}`).toContain(rebleedText);
      expect(result.explanation, `score ${score}`).toContain(mortalityText);
    });
  });

  it('scores each Table III variable at its break', () => {
    const score = (override: Inputs): number => out(run(id, { ...base, ...override }), 'score');
    expect(score({ ageYears: 59 })).toBe(0);
    expect(score({ ageYears: 60 })).toBe(1);
    expect(score({ ageYears: 79 })).toBe(1);
    expect(score({ ageYears: 80 })).toBe(2);
    expect(score({ shock: 1 })).toBe(1);
    expect(score({ shock: 2 })).toBe(2);
    expect(score({ comorbidity: 2 })).toBe(2);
    expect(score({ comorbidity: 3 })).toBe(3);
    expect(score({ diagnosis: 1 })).toBe(1);
    expect(score({ diagnosis: 2 })).toBe(2);
    expect(score({ stigmata: 2 })).toBe(2);
  });

  it('reaches the maximum of 11 and keeps 8+ as one band', () => {
    // Table III: age >=80 (2) + hypotension (2) + renal/liver failure/disseminated cancer (3)
    // + malignancy of the upper GI tract (2) + major SRH (2) = 11; 7 before the diagnosis items.
    const top = run(id, {
      ageYears: 82,
      shock: 2,
      comorbidity: 3,
      diagnosis: 2,
      stigmata: 2,
    });
    expect(out(top, 'score')).toBe(11);
    expect(top.rangeId).toBe('s8plus');
    expect(top.explanation).toContain('41,8 %');
    expect(top.explanation).toContain('41,1 %');
    expect(
      out(run(id, { ageYears: 82, shock: 2, comorbidity: 3, diagnosis: 0, stigmata: 0 }), 'score'),
    ).toBe(7);
  });

  it('lists the pre-endoscopy mortality of Table IV(A) in the limitations', () => {
    const limitations = moduleTool(id).definition.limitations?.join(' ') ?? '';
    for (const figure of ['0,2', '2,4', '5,6', '11,0', '24,6', '39,6', '48,9', '50,0'])
      expect(limitations).toContain(figure);
  });
});
