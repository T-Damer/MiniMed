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

const MODULE_FILE = 'content/tool-modules/cardiology.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;

const PART_2_IDS = [
  'grace-in-hospital',
  'grace-6-month',
  'score2-score2-op',
  'framingham-atp3',
  'procam',
  'pooled-cohort-equations',
  'euroscore-ii',
  'dapt-score',
  'same-tt2r2',
  'essen-stroke-risk-score',
  'ankle-brachial-index',
  'smith-stemi-index',
  'lv-mass-index',
  'mehran-cin-score',
  'ceap',
  'ceap-extended',
  'chronic-limb-ischemia',
].map((key) => `minimed.calculator.${key}`);

interface Run {
  readonly numbers: Record<string, number>;
  readonly texts: Record<string, string>;
  num(id: string): number | undefined;
  text(id: string): string | undefined;
  readonly range: string | undefined;
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
    num: (outputId) => numbers[outputId],
    text: (outputId) => texts[outputId],
    range: result.evaluation.verdict?.rangeId,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

function fails(key: string, inputs: Inputs): void {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${key}`);
  if (!schema) throw new Error(`Missing calculator ${key}`);
  expect(evaluateCalculatorSchema(schema, inputs).ok, key).toBe(false);
}

/** Piecewise-linear interpolation through published nomogram corner points, flat outside them. */
function interp(x: number, points: readonly (readonly [number, number])[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) throw new Error('empty table');
  if (x <= first[0]) return first[1];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a && b && x < b[0]) return a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  }
  return last[1];
}

const MG_PER_MMOL = 38.67;
const get = (inputs: Inputs, key: string): number => Number(inputs[key]);
const getText = (inputs: Inputs, key: string): string => String(inputs[key]);

describe('cardiology tool module, part 2', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every added calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      version: string;
      tools: readonly { id: string }[];
    };
    expect(source.version).toBe('0.2.0-preview.1');
    expect(source.tools).toHaveLength(34);
    const added = source.tools.filter((tool) => PART_2_IDS.includes(tool.id));
    expect(added.map((tool) => tool.id).sort()).toEqual([...PART_2_IDS].sort());
    for (const rawTool of added) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length).toBeGreaterThan(0);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        if (link.url) expect(link.url).toMatch(/^https:\/\//u);
      }
      registerDownloadedCalculator(record);
    }
    const registered = getCalculatorRegistry().filter(
      (calculator) =>
        PART_2_IDS.includes(calculator.id) && getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id).sort()).toEqual([...PART_2_IDS].sort());
  });

  it('keeps verdict rules identical to the interpretations and every id unique', () => {
    expect(new Set(SCHEMAS.map((schema) => schema.id)).size).toBe(SCHEMAS.length);
    for (const schema of SCHEMAS.filter((candidate) => PART_2_IDS.includes(candidate.id))) {
      expect(schema.evaluation.status, schema.id).toBe('verdict');
      expect(schema.evaluation.rules.map((rule) => rule.when)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.when),
      );
      expect(schema.evaluation.rules.map((rule) => rule.verdict.explanation)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.message),
      );
    }
  });

  describe('GRACE in-hospital (Granger 2003; GRACE coordinating centre formulas)', () => {
    const KILLIP_POINTS: Record<number, number> = { 1: 0, 2: 20, 3: 39, 4: 59 };
    const CREAT: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.2, 1],
      [0.4, 3],
      [0.6, 4],
      [0.8, 6],
      [1.0, 7],
      [1.2, 8],
      [1.4, 10],
      [1.6, 11],
      [1.8, 13],
      [2.0, 14],
      [3.0, 21],
      [4.0, 28],
    ];
    function nomogram(i: Inputs): number {
      const mg = get(i, 'creatinineUmol') / 88.4;
      return Math.round(
        interp(get(i, 'ageYears'), [
          [30, 0],
          [40, 17],
          [50, 33],
          [60, 50],
          [70, 67],
          [80, 83],
          [90, 100],
        ]) +
          interp(get(i, 'heartRate'), [
            [50, 0],
            [60, 3],
            [70, 6],
            [80, 9],
            [90, 12],
            [100, 15],
            [110, 18],
            [150, 30],
            [200, 46],
          ]) +
          interp(get(i, 'sbp'), [
            [80, 58],
            [100, 48],
            [110, 43],
            [120, 39],
            [130, 34],
            [140, 29],
            [150, 24],
            [160, 19],
            [180, 10],
            [200, 0],
          ]) +
          interp(mg, CREAT) +
          (KILLIP_POINTS[get(i, 'killip')] ?? 0) +
          39 * get(i, 'cardiacArrest') +
          28 * get(i, 'stDeviation') +
          14 * get(i, 'enzymes'),
      );
    }
    function probability(i: Inputs): number {
      const xb =
        -7.7035 +
        0.0531 * get(i, 'ageYears') +
        0.0087 * get(i, 'heartRate') -
        0.0168 * get(i, 'sbp') +
        0.1823 * (get(i, 'creatinineUmol') / 88.4) +
        // biome-ignore lint/suspicious/noApproximativeNumericConstant: published coefficient 0.6931
        0.6931 * get(i, 'killip') +
        1.4586 * get(i, 'cardiacArrest') +
        0.47 * get(i, 'enzymes') +
        0.8755 * get(i, 'stDeviation');
      return (100 * Math.exp(xb)) / (1 + Math.exp(xb));
    }
    const base: Inputs = {
      ageYears: 50,
      heartRate: 70,
      sbp: 100,
      creatinineUmol: 88.4,
      killip: 1,
      cardiacArrest: 0,
      stDeviation: 0,
      enzymes: 1,
    };

    it('reproduces the centre worked example: XB −1.28364, probability 21.693 %', () => {
      const example: Inputs = {
        ageYears: 57,
        heartRate: 70,
        sbp: 110,
        creatinineUmol: 1.2 * 88.4,
        killip: 3,
        cardiacArrest: 1,
        stDeviation: 1,
        enzymes: 0,
      };
      const result = run('grace-in-hospital', example);
      expect(result.num('probability')).toBeCloseTo(21.693, 2);
      // 39 + 43 + 6 + 44.9 + 8 + 28 + 39 = 207.9 points
      expect(result.num('score')).toBe(208);
      expect(result.range).toBe('high');
    });

    it('uses 28 points for ST deviation, 14 for markers and 39 for arrest, not 39 for each', () => {
      const zero = run('grace-in-hospital', { ...base, enzymes: 0 }).num('score') ?? 0;
      expect(run('grace-in-hospital', { ...base, enzymes: 0, stDeviation: 1 }).num('score')).toBe(
        zero + 28,
      );
      expect(run('grace-in-hospital', base).num('score')).toBe(zero + 14);
      expect(run('grace-in-hospital', { ...base, enzymes: 0, cardiacArrest: 1 }).num('score')).toBe(
        zero + 39,
      );
    });

    it('cuts at 108 / 109 and 140 / 141 points', () => {
      const cases: readonly [Inputs, number, string][] = [
        [base, 108, 'low'],
        [{ ...base, sbp: 140, killip: 2 }, 109, 'intermediate'],
        [{ ...base, heartRate: 80, sbp: 140, killip: 2, stDeviation: 1 }, 140, 'intermediate'],
        [{ ...base, heartRate: 80, sbp: 120, killip: 3 }, 141, 'high'],
      ];
      for (const [inputs, score, range] of cases) {
        const result = run('grace-in-hospital', inputs);
        expect(result.num('score')).toBe(score);
        expect(result.range).toBe(range);
        expect(result.interpretation).toBeDefined();
      }
    });

    it('matches the published nomogram and model across the input range', () => {
      for (const age of [30, 45, 62, 79, 95]) {
        for (const sbp of [70, 95, 125, 165, 210]) {
          for (const creatinineUmol of [30, 90, 200, 400, 900]) {
            const inputs: Inputs = {
              ...base,
              ageYears: age,
              sbp,
              creatinineUmol,
              heartRate: 40 + age,
              killip: 1 + (age % 4),
              stDeviation: age % 2,
            };
            const result = run('grace-in-hospital', inputs);
            expect(result.num('score')).toBe(nomogram(inputs));
            expect(result.num('probability')).toBeCloseTo(probability(inputs), 6);
          }
        }
      }
    });

    it('rejects values outside the physiological range', () => {
      fails('grace-in-hospital', { ...base, killip: 5 });
      fails('grace-in-hospital', { ...base, sbp: 20 });
    });
  });

  describe('GRACE admission to 6 months (Fox 2006 nomogram; ESC cut-offs 88 / 118)', () => {
    const KILLIP: Record<number, number> = { 1: 0, 2: 15, 3: 29, 4: 44 };
    const CREAT: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.2, 1],
      [0.4, 3],
      [0.6, 4],
      [0.8, 6],
      [1.0, 7],
      [1.2, 8],
      [1.4, 10],
      [1.6, 11],
      [1.8, 13],
      [2.0, 14],
      [3.0, 21],
      [4.0, 28],
    ];
    function nomogram(i: Inputs): number {
      return Math.round(
        interp(get(i, 'ageYears'), [
          [35, 0],
          [45, 18],
          [55, 36],
          [65, 54],
          [75, 73],
          [85, 91],
          [90, 100],
        ]) +
          interp(get(i, 'heartRate'), [
            [70, 0],
            [80, 3],
            [90, 5],
            [100, 8],
            [110, 10],
            [150, 22],
            [200, 34],
          ]) +
          interp(get(i, 'sbp'), [
            [80, 40],
            [100, 34],
            [110, 31],
            [120, 27],
            [130, 24],
            [140, 20],
            [150, 17],
            [160, 14],
            [180, 8],
            [200, 0],
          ]) +
          interp(get(i, 'creatinineUmol') / 88.4, CREAT) +
          (KILLIP[get(i, 'killip')] ?? 0) +
          30 * get(i, 'cardiacArrest') +
          17 * get(i, 'stDeviation') +
          13 * get(i, 'enzymes'),
      );
    }
    const base: Inputs = {
      ageYears: 45,
      heartRate: 70,
      sbp: 100,
      creatinineUmol: 88.4,
      killip: 3,
      cardiacArrest: 0,
      stDeviation: 0,
      enzymes: 0,
    };

    it('cuts at 88 / 89 and 118 / 119 points', () => {
      const cases: readonly [Inputs, number, string][] = [
        [base, 88, 'low'],
        [{ ...base, killip: 1, stDeviation: 1, enzymes: 1 }, 89, 'intermediate'],
        [{ ...base, stDeviation: 1, enzymes: 1 }, 118, 'intermediate'],
        [{ ...base, heartRate: 100, sbp: 120, stDeviation: 1, enzymes: 1 }, 119, 'high'],
      ];
      for (const [inputs, score, range] of cases) {
        const result = run('grace-6-month', inputs);
        expect(result.num('score')).toBe(score);
        expect(result.range).toBe(range);
      }
    });

    it('uses 30 points for arrest, 17 for ST deviation and 13 for markers', () => {
      const zero = run('grace-6-month', base).num('score') ?? 0;
      expect(run('grace-6-month', { ...base, cardiacArrest: 1 }).num('score')).toBe(zero + 30);
      expect(run('grace-6-month', { ...base, stDeviation: 1 }).num('score')).toBe(zero + 17);
      expect(run('grace-6-month', { ...base, enzymes: 1 }).num('score')).toBe(zero + 13);
    });

    it('matches the published corner points, and the 150–200 beat stretch rises monotonically to 34', () => {
      for (const age of [30, 50, 66, 80, 95]) {
        for (const heartRate of [40, 75, 105, 149, 175, 199, 200, 230]) {
          const inputs: Inputs = {
            ...base,
            ageYears: age,
            heartRate,
            sbp: 60 + age,
            killip: 1 + (age % 4),
          };
          expect(run('grace-6-month', inputs).num('score')).toBe(nomogram(inputs));
        }
      }
      const at = (heartRate: number) =>
        run('grace-6-month', { ...base, heartRate }).num('score') ?? 0;
      expect(at(200) - at(150)).toBe(12);
      expect(at(199)).toBeLessThanOrEqual(at(200));
    });
  });

  describe('SCORE2 / SCORE2-OP (ESC 2021; Russia = very high risk region)', () => {
    const S2 = {
      male: {
        c: [0.3742, 0.6012, 0.2777, 0.1458, -0.2698, -0.0755, -0.0255, -0.0281, 0.0426],
        s0: 0.9605,
      },
      female: {
        c: [0.4648, 0.7744, 0.3131, 0.1002, -0.2606, -0.1088, -0.0277, -0.0226, 0.0613],
        s0: 0.9776,
      },
    } as const;
    const OP = {
      male: {
        c: [0.0634, 0.3524, 0.0094, 0.085, -0.3564, -0.0247, -0.0005, 0.0073, 0.0091],
        s0: 0.7576,
        off: 0.0929,
      },
      female: {
        c: [0.0789, 0.4921, 0.0102, 0.0605, -0.304, -0.0255, -0.0004, -0.0009, 0.0154],
        s0: 0.8082,
        off: 0.229,
      },
    } as const;
    const SCALES: Record<string, Record<string, Record<string, readonly [number, number]>>> = {
      score2: {
        veryHigh: { male: [0.5836, 0.8294], female: [0.9412, 0.8329] },
        high: { male: [0.3207, 0.936], female: [0.571, 0.9369] },
        moderate: { male: [-0.1565, 0.8009], female: [-0.3143, 0.7701] },
        low: { male: [-0.5699, 0.7476], female: [-0.738, 0.7019] },
      },
      op: {
        veryHigh: { male: [0.05, 0.7], female: [0.38, 0.69] },
        high: { male: [0.08, 1.15], female: [0.38, 1.09] },
        moderate: { male: [0.01, 1.25], female: [-0.1, 1.1] },
        low: { male: [-0.34, 1.19], female: [-0.52, 1.01] },
      },
    };
    interface Case {
      sex: 'male' | 'female';
      ageYears: number;
      smoker: number;
      sbp: number;
      totalChol: number;
      hdl: number;
      region: string;
    }
    /** The published algorithm written out directly: 1 − S0^exp(lp), then recalibration on the log(−log) scale. */
    function reference(i: Case): number {
      const older = i.ageYears >= 70;
      const model = older ? OP[i.sex] : S2[i.sex];
      const a = older ? i.ageYears - 73 : (i.ageYears - 60) / 5;
      const s = older ? i.sbp - 150 : (i.sbp - 120) / 20;
      const t = i.totalChol - 6;
      const h = older ? i.hdl - 1.4 : (i.hdl - 1.3) / 0.5;
      const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = model.c;
      const lp =
        (b0 ?? 0) * a +
        (b1 ?? 0) * i.smoker +
        (b2 ?? 0) * s +
        (b3 ?? 0) * t +
        (b4 ?? 0) * h +
        (b5 ?? 0) * a * i.smoker +
        (b6 ?? 0) * a * s +
        (b7 ?? 0) * a * t +
        (b8 ?? 0) * a * h;
      const offset = older ? OP[i.sex].off : 0;
      const uncalibrated = 1 - model.s0 ** Math.exp(lp - offset);
      const scale = SCALES[older ? 'op' : 'score2']?.[i.region]?.[i.sex];
      if (!scale) throw new Error('scale');
      return (
        100 * (1 - Math.exp(-Math.exp(scale[0] + scale[1] * Math.log(-Math.log(1 - uncalibrated)))))
      );
    }
    const smokerProfile = { smoker: 1, sbp: 140, totalChol: 5.5, hdl: 1.3, ageYears: 50 };
    const rounded = (value: number) => Math.round(value * 10) / 10;

    it('reproduces the four published risks for a 50-year-old smoker (SBP 140, TC 5.5, HDL 1.3)', () => {
      // Roth/ESC abstract: 5.9 % and 14.0 % for men, 4.2 % and 13.7 % for women (low / very high risk).
      const expected: readonly [Case['sex'], string, number][] = [
        ['male', 'low', 5.9],
        ['male', 'veryHigh', 14.0],
        ['female', 'low', 4.2],
        ['female', 'veryHigh', 13.7],
      ];
      for (const [sex, region, risk] of expected) {
        expect(run('score2-score2-op', { ...smokerProfile, sex, region }).num('riskPercent')).toBe(
          risk,
        );
      }
    });

    it('agrees with the algorithm for every region and sex in both models', () => {
      for (const region of ['veryHigh', 'high', 'moderate', 'low']) {
        for (const sex of ['male', 'female'] as const) {
          for (const ageYears of [40, 55, 69, 70, 73, 88]) {
            const inputs: Case = {
              sex,
              ageYears,
              smoker: ageYears % 2,
              sbp: 128 + ageYears / 2,
              totalChol: 5.4,
              hdl: 1.2,
              region,
            };
            const result = run('score2-score2-op', { ...inputs, sbp: Math.round(inputs.sbp) });
            expect(result.num('riskPercent'), `${sex} ${ageYears} ${region}`).toBeCloseTo(
              rounded(reference({ ...inputs, sbp: Math.round(inputs.sbp) })),
              6,
            );
          }
        }
      }
    });

    it('switches to SCORE2-OP at 70 and cuts categories at 2.5 / 7.5, 5 / 10 and 7.5 / 15 per cent', () => {
      const cases: readonly [Case, number, string][] = [
        [
          {
            sex: 'male',
            ageYears: 45,
            smoker: 0,
            sbp: 100,
            totalChol: 8.2,
            hdl: 1.3,
            region: 'low',
          },
          2.5,
          'high',
        ],
        [
          {
            sex: 'male',
            ageYears: 45,
            smoker: 0,
            sbp: 170,
            totalChol: 9.5,
            hdl: 1.3,
            region: 'low',
          },
          7.5,
          'very-high',
        ],
        [
          {
            sex: 'male',
            ageYears: 55,
            smoker: 0,
            sbp: 100,
            totalChol: 9.9,
            hdl: 1.3,
            region: 'low',
          },
          5.0,
          'high',
        ],
        [
          {
            sex: 'male',
            ageYears: 55,
            smoker: 0,
            sbp: 165,
            totalChol: 9.8,
            hdl: 1.3,
            region: 'low',
          },
          10.0,
          'very-high',
        ],
        [
          {
            sex: 'male',
            ageYears: 75,
            smoker: 0,
            sbp: 100,
            totalChol: 3.7,
            hdl: 1.3,
            region: 'low',
          },
          7.5,
          'high',
        ],
        [
          {
            sex: 'male',
            ageYears: 75,
            smoker: 0,
            sbp: 105,
            totalChol: 9.5,
            hdl: 1.3,
            region: 'low',
          },
          15.0,
          'very-high',
        ],
      ];
      for (const [inputs, risk, range] of cases) {
        const result = run('score2-score2-op', inputs as unknown as Inputs);
        expect(result.num('riskPercent')).toBe(risk);
        expect(result.range).toBe(range);
      }
      expect(
        run('score2-score2-op', {
          sex: 'male',
          ageYears: 45,
          smoker: 0,
          sbp: 110,
          totalChol: 4.5,
          hdl: 1.5,
          region: 'low',
        }).range,
      ).toBe('low-moderate');
      expect(
        run('score2-score2-op', {
          sex: 'male',
          ageYears: 75,
          smoker: 0,
          sbp: 110,
          totalChol: 3.5,
          hdl: 1.5,
          region: 'low',
        }).range,
      ).toBe('low-moderate');
    });

    it('rejects ages outside 40–89', () => {
      fails('score2-score2-op', { ...smokerProfile, sex: 'male', region: 'low', ageYears: 39 });
      fails('score2-score2-op', { ...smokerProfile, sex: 'male', region: 'low', ageYears: 90 });
    });
  });

  describe('Framingham ATP III points (NCEP ATP III executive summary, tables B1 and B2)', () => {
    const base: Inputs = {
      sex: 'male',
      ageYears: 55,
      totalChol: 213 / MG_PER_MMOL,
      hdl: 50 / MG_PER_MMOL,
      sbp: 120,
      treated: 0,
      smoker: 0,
    };

    it('scores a 55-year-old man with TC 213, HDL 50, SBP 120 as 11 points and 8 %', () => {
      // age 55–59: 8; TC 200–239 at 50–59: 3; HDL 50–59: 0; SBP <120... 120 untreated: 0
      const result = run('framingham-atp3', base);
      expect(result.num('points')).toBe(11);
      expect(result.text('riskText')).toBe('8 %');
      expect(result.range).toBe('under-10');
    });

    it('cuts the bands at 11 / 12 and 15 / 16 points in men', () => {
      const cases: readonly [Inputs, number, string, string][] = [
        [{ ...base, treated: 1, sbp: 125 }, 12, '10 %', '10-20'],
        [
          {
            ...base,
            ageYears: 45,
            totalChol: 220 / MG_PER_MMOL,
            hdl: 45 / MG_PER_MMOL,
            sbp: 135,
            smoker: 1,
          },
          15,
          '20 %',
          '10-20',
        ],
        [
          {
            ...base,
            ageYears: 45,
            totalChol: 220 / MG_PER_MMOL,
            hdl: 45 / MG_PER_MMOL,
            sbp: 135,
            smoker: 1,
            treated: 1,
          },
          16,
          '25 %',
          'over-20',
        ],
      ];
      for (const [inputs, points, risk, range] of cases) {
        const result = run('framingham-atp3', inputs);
        expect(result.num('points')).toBe(points);
        expect(result.text('riskText')).toBe(risk);
        expect(result.range).toBe(range);
      }
    });

    it('cuts the bands at 19 / 20 and 22 / 23 points in women', () => {
      const woman: Inputs = {
        ...base,
        sex: 'female',
        totalChol: 220 / MG_PER_MMOL,
        hdl: 50 / MG_PER_MMOL,
        sbp: 125,
        smoker: 1,
        treated: 1,
      };
      const cases: readonly [Inputs, number, string, string][] = [
        [woman, 19, '8 %', 'under-10'],
        [{ ...woman, hdl: 45 / MG_PER_MMOL }, 20, '11 %', '10-20'],
        [{ ...woman, totalChol: 250 / MG_PER_MMOL, sbp: 145 }, 22, '17 %', '10-20'],
        [
          { ...woman, totalChol: 250 / MG_PER_MMOL, sbp: 145, hdl: 45 / MG_PER_MMOL },
          23,
          '22 %',
          'over-20',
        ],
      ];
      for (const [inputs, points, risk, range] of cases) {
        const result = run('framingham-atp3', inputs);
        expect(result.num('points'), risk).toBe(points);
        expect(result.text('riskText')).toBe(risk);
        expect(result.range).toBe(range);
      }
    });

    it('reads the extremes of the tables', () => {
      const young = run('framingham-atp3', {
        ...base,
        ageYears: 25,
        totalChol: 3,
        hdl: 70 / MG_PER_MMOL,
      });
      expect(young.num('points')).toBe(-10);
      expect(young.text('riskText')).toBe('<1 %');
      const top = run('framingham-atp3', {
        sex: 'male',
        ageYears: 79,
        totalChol: 290 / MG_PER_MMOL,
        hdl: 30 / MG_PER_MMOL,
        sbp: 170,
        treated: 1,
        smoker: 1,
      });
      expect(top.num('points')).toBe(13 + 1 + 1 + 2 + 3);
      const womanTop = run('framingham-atp3', {
        sex: 'female',
        ageYears: 40,
        totalChol: 290 / MG_PER_MMOL,
        hdl: 30 / MG_PER_MMOL,
        sbp: 170,
        treated: 1,
        smoker: 1,
      });
      expect(womanTop.num('points')).toBe(0 + 10 + 7 + 2 + 6);
      expect(womanTop.text('riskText')).toBe('≥30 %');
    });

    it('rounds cholesterol to whole mg/dL before the table', () => {
      // 199.9 mg/dL rounds to 200, the 200–239 row; 159.4 rounds to 159, the 160 row is not reached
      expect(
        run('framingham-atp3', { ...base, totalChol: 199.9 / MG_PER_MMOL }).num('points'),
      ).toBe(11);
      expect(
        run('framingham-atp3', { ...base, totalChol: 159.4 / MG_PER_MMOL }).num('points'),
      ).toBe(8);
    });
  });

  describe('PROCAM (Assmann 2002: men 35–65, table 3 points, table 4 risks, ≥54 points = ≥20 %)', () => {
    const mg = (ldl: number, hdl: number, tg: number) => ({
      ldl: ldl / MG_PER_MMOL,
      hdl: hdl / MG_PER_MMOL,
      tg: tg / 88.57,
    });
    const make = (
      age: number,
      ldl: number,
      hdl: number,
      tg: number,
      sbp: number,
      fam: number,
      dm: number,
      sm: number,
    ): Inputs => ({
      ageYears: age,
      ...mg(ldl, hdl, tg),
      sbp,
      familyMi: fam,
      diabetes: dm,
      smoker: sm,
    });

    it('adds the published points', () => {
      // 50 y 16 + LDL 155 mg/dL 10 + HDL 39 mg/dL 8 + TG 133 mg/dL 2 + SBP 135 3 = 39 points = 5.7 %
      const result = run('procam', make(50, 155, 39, 133, 135, 0, 0, 0));
      expect(result.num('points')).toBe(39);
      expect(result.text('riskText')).toBe('5,7 %');
      expect(result.range).toBe('under-10');
    });

    it('cuts the risk table and the bands at 20 / 21, 44 / 45, 53 / 54 and 59 / 60 points', () => {
      const cases: readonly [Inputs, number, string, string][] = [
        [make(36, 90, 30, 90, 135, 0, 1, 0), 20, '<1,0 %', 'under-10'],
        [make(36, 90, 30, 90, 110, 1, 1, 0), 21, '1,1 %', 'under-10'],
        [make(36, 110, 30, 120, 170, 1, 1, 1), 44, '8,8 %', 'under-10'],
        [make(36, 110, 30, 170, 170, 1, 1, 1), 45, '10,2 %', '10-20'],
        [make(36, 170, 30, 120, 170, 1, 1, 1), 53, '19,6 %', '10-20'],
        [make(36, 170, 30, 170, 170, 1, 1, 1), 54, '21,7 %', 'over-20'],
        [make(36, 200, 30, 120, 170, 1, 1, 1), 59, '29,4 %', 'over-20'],
        [make(36, 200, 30, 170, 170, 1, 1, 1), 60, '≥30,0 %', 'over-20'],
      ];
      for (const [inputs, points, risk, range] of cases) {
        const result = run('procam', inputs);
        expect(result.num('points')).toBe(points);
        expect(result.text('riskText')).toBe(risk);
        expect(result.range).toBe(range);
      }
    });

    it('steps age points at 40, 45, 50, 55 and 60 and refuses ages outside 35–65', () => {
      const pointsAt = (age: number) =>
        run('procam', make(age, 90, 60, 90, 100, 0, 0, 0)).num('points');
      expect([35, 39, 40, 44, 45, 49, 50, 54, 55, 59, 60, 65].map(pointsAt)).toEqual([
        0, 0, 6, 6, 11, 11, 16, 16, 21, 21, 26, 26,
      ]);
      fails('procam', make(34, 90, 60, 90, 100, 0, 0, 0));
      fails('procam', make(66, 90, 60, 90, 100, 0, 0, 0));
    });

    it('cuts the lipid, triglyceride and pressure rows at the published edges', () => {
      const at = (ldl: number, hdl: number, tg: number, sbp: number) =>
        run('procam', make(35, ldl, hdl, tg, sbp, 0, 0, 0)).num('points');
      expect([99, 100, 129, 130, 159, 160, 189, 190].map((v) => at(v, 60, 90, 100))).toEqual([
        0, 5, 5, 10, 10, 14, 14, 20,
      ]);
      expect([34, 35, 44, 45, 54, 55].map((v) => at(90, v, 90, 100))).toEqual([11, 8, 8, 5, 5, 0]);
      expect([99, 100, 149, 150, 199, 200].map((v) => at(90, 60, v, 100))).toEqual([
        0, 2, 2, 3, 3, 4,
      ]);
      expect([119, 120, 129, 130, 139, 140, 159, 160].map((v) => at(90, 60, 90, v))).toEqual([
        0, 2, 2, 3, 3, 5, 5, 8,
      ]);
    });
  });

  describe('ACC/AHA Pooled Cohort Equations (Goff 2014, table A)', () => {
    // 55 years, TC 213 mg/dL, HDL 50 mg/dL, untreated SBP 120, non-smoker, no diabetes
    const profile = {
      ageYears: 55,
      totalChol: 213 / MG_PER_MMOL,
      hdl: 50 / MG_PER_MMOL,
      sbp: 120,
      treated: 0,
      smoker: 0,
      diabetes: 0,
    };

    it('reproduces the four worked examples of table A: 2.1 %, 3.0 %, 5.3 % and 6.1 %', () => {
      const cases: readonly [Inputs, number][] = [
        [{ ...profile, sex: 'female', race: 'white' }, 2.1],
        [{ ...profile, sex: 'female', race: 'black' }, 3.0],
        [{ ...profile, sex: 'male', race: 'white' }, 5.3],
        [{ ...profile, sex: 'male', race: 'black' }, 6.1],
      ];
      for (const [inputs, risk] of cases) {
        // The printed examples multiply rounded logarithms (ln 55 = 4.01 ...); exact logarithms give
        // 5.4 % for the white man instead of the printed 5.3 %, everything else is identical.
        const value = run('pooled-cohort-equations', inputs).num('riskPercent') ?? 0;
        expect(Math.abs(value - risk), String(risk)).toBeLessThan(0.11);
      }
      expect(
        run('pooled-cohort-equations', { ...profile, sex: 'male', race: 'white' }).num(
          'riskPercent',
        ),
      ).toBe(5.4);
    });

    /** The published equations written out with Math.log. */
    function reference(i: {
      sex: string;
      race: string;
      age: number;
      tc: number;
      hdl: number;
      sbp: number;
      treated: number;
      smoker: number;
      diabetes: number;
    }): number {
      const la = Math.log(i.age);
      const lt = Math.log(i.tc);
      const lh = Math.log(i.hdl);
      const ls = Math.log(i.sbp);
      const t = i.treated === 1;
      let sum: number;
      let mean: number;
      let s0: number;
      if (getText(i, 'sex') === 'female' && i.race === 'white') {
        sum =
          -29.799 * la +
          4.884 * la * la +
          13.54 * lt -
          3.114 * la * lt -
          13.578 * lh +
          3.149 * la * lh +
          (t ? 2.019 : 1.957) * ls +
          7.574 * i.smoker -
          1.665 * la * i.smoker +
          0.661 * i.diabetes;
        mean = -29.18;
        s0 = 0.9665;
      } else if (getText(i, 'sex') === 'female') {
        sum =
          17.114 * la +
          0.94 * lt -
          18.92 * lh +
          4.475 * la * lh +
          (t ? 29.291 * ls - 6.432 * la * ls : 27.82 * ls - 6.087 * la * ls) +
          0.691 * i.smoker +
          0.874 * i.diabetes;
        mean = 86.61;
        s0 = 0.9533;
      } else if (i.race === 'white') {
        sum =
          12.344 * la +
          11.853 * lt -
          2.664 * la * lt -
          7.99 * lh +
          1.769 * la * lh +
          (t ? 1.797 : 1.764) * ls +
          7.837 * i.smoker -
          1.795 * la * i.smoker +
          0.658 * i.diabetes;
        mean = 61.18;
        s0 = 0.9144;
      } else {
        sum =
          2.469 * la +
          0.302 * lt -
          0.307 * lh +
          (t ? 1.916 : 1.809) * ls +
          0.549 * i.smoker +
          0.645 * i.diabetes;
        mean = 19.54;
        s0 = 0.8954;
      }
      return 100 * (1 - s0 ** Math.exp(sum - mean));
    }

    it('agrees with the equations over the full range of every group', () => {
      for (const sex of ['female', 'male']) {
        for (const race of ['white', 'black']) {
          for (const age of [40, 52, 67, 79]) {
            for (const tcMg of [135, 210, 315]) {
              for (const hdlMg of [22, 48, 98]) {
                for (const sbp of [92, 130, 198]) {
                  const treated = (age + sbp) % 2;
                  const smoker = (age + tcMg) % 2;
                  const diabetes = (hdlMg + age) % 2;
                  const result = run('pooled-cohort-equations', {
                    sex,
                    race,
                    ageYears: age,
                    totalChol: tcMg / MG_PER_MMOL,
                    hdl: hdlMg / MG_PER_MMOL,
                    sbp,
                    treated,
                    smoker,
                    diabetes,
                  });
                  const expected = reference({
                    sex,
                    race,
                    age,
                    tc: tcMg,
                    hdl: hdlMg,
                    sbp,
                    treated,
                    smoker,
                    diabetes,
                  });
                  expect(
                    result.num('riskPercent'),
                    `${sex} ${race} ${age} ${tcMg} ${hdlMg} ${sbp}`,
                  ).toBeCloseTo(Math.round(expected * 10) / 10, 6);
                }
              }
            }
          }
        }
      }
    });

    it('cuts the categories at 5, 7.5 and 20 per cent', () => {
      const bandFor = (risk: number) =>
        risk < 5 ? 'low' : risk < 7.5 ? 'borderline' : risk < 20 ? 'intermediate' : 'high';
      for (const ageYears of [46, 52, 58, 64, 70, 76]) {
        const result = run('pooled-cohort-equations', {
          ...profile,
          sex: 'male',
          race: 'white',
          ageYears,
          smoker: 1,
        });
        expect(result.range).toBe(bandFor(result.num('riskPercent') ?? 0));
      }
      const ranges = new Set<string | undefined>();
      for (const [sex, ageYears, smoker, diabetes] of [
        ['female', 42, 0, 0],
        ['male', 55, 0, 0],
        ['male', 56, 1, 0],
        ['male', 70, 1, 1],
        ['male', 62, 1, 0],
      ] as const) {
        ranges.add(
          run('pooled-cohort-equations', {
            ...profile,
            sex,
            race: 'white',
            ageYears,
            smoker,
            diabetes,
          }).range,
        );
      }
      expect([...ranges].sort()).toEqual(['borderline', 'high', 'intermediate', 'low'].sort());
    });

    it('refuses values outside the validity range of the equations', () => {
      fails('pooled-cohort-equations', { ...profile, sex: 'male', race: 'white', ageYears: 39 });
      fails('pooled-cohort-equations', { ...profile, sex: 'male', race: 'white', hdl: 3 });
    });
  });

  describe('EuroSCORE II (Nashef 2012; coefficients from the authors’ calculator)', () => {
    const none: Inputs = {
      ageYears: 55,
      sex: 'male',
      renal: 0,
      arteriopathy: 0,
      poorMobility: 0,
      redo: 0,
      lungDisease: 0,
      endocarditis: 0,
      critical: 0,
      insulinDiabetes: 0,
      nyha: 1,
      angina4: 0,
      lvef: 0,
      recentMi: 0,
      pulmHtn: 0,
      urgency: 0,
      weight: 0,
      thoracicAorta: 0,
    };
    const COEF = {
      renal: [0, 0.303553, 0.8592256, 0.6421508],
      nyha: [0, 0.1070545, 0.2958358, 0.5597929],
      lvef: [0, 0.3150652, 0.8084096, 0.9346919],
      pulm: [0, 0.1788899, 0.3491475],
      urgency: [0, 0.3174673, 0.7039121, 1.362947],
      weight: [0, 0.0062118, 0.5521478, 0.9724533],
    };
    function reference(i: Inputs): number {
      const age = get(i, 'ageYears');
      const x = Math.max(age - 59, 1);
      const z =
        -5.324537 +
        0.0285181 * x +
        (getText(i, 'sex') === 'female' ? 0.2196434 : 0) +
        (COEF.renal[get(i, 'renal')] ?? 0) +
        0.5360268 * get(i, 'arteriopathy') +
        0.2407181 * get(i, 'poorMobility') +
        1.118599 * get(i, 'redo') +
        0.1886564 * get(i, 'lungDisease') +
        0.6194522 * get(i, 'endocarditis') +
        1.086517 * get(i, 'critical') +
        0.3542749 * get(i, 'insulinDiabetes') +
        (COEF.nyha[get(i, 'nyha') - 1] ?? 0) +
        0.2226147 * get(i, 'angina4') +
        (COEF.lvef[get(i, 'lvef')] ?? 0) +
        0.1528943 * get(i, 'recentMi') +
        (COEF.pulm[get(i, 'pulmHtn')] ?? 0) +
        (COEF.urgency[get(i, 'urgency')] ?? 0) +
        (COEF.weight[get(i, 'weight')] ?? 0) +
        0.6527205 * get(i, 'thoracicAorta');
      return (100 * Math.exp(z)) / (1 + Math.exp(z));
    }

    it('gives the model minimum of 0.50 % for a man up to 60 with no risk factor', () => {
      for (const age of [30, 55, 59, 60]) {
        const result = run('euroscore-ii', { ...none, ageYears: age });
        expect(result.num('mortality')).toBeCloseTo(0.49865, 4);
        expect(result.num('mortality')?.toFixed(2)).toBe('0.50');
      }
      expect(run('euroscore-ii', none).range).toBe('predicted');
    });

    it('adds 0.0285181 per year over 60 (61 = two steps, 70 = eleven steps)', () => {
      const at = (age: number) =>
        run('euroscore-ii', { ...none, ageYears: age }).num('mortality') ?? 0;
      expect(at(61)).toBeCloseTo(reference({ ...none, ageYears: 61 }), 8);
      expect(at(70)).toBeCloseTo(
        (100 * Math.exp(-5.324537 + 11 * 0.0285181)) / (1 + Math.exp(-5.324537 + 11 * 0.0285181)),
        8,
      );
      expect(at(61)).toBeGreaterThan(at(60));
    });

    it('matches the published equation for every coefficient and the all-factors profile', () => {
      const flags = [
        'arteriopathy',
        'poorMobility',
        'redo',
        'lungDisease',
        'endocarditis',
        'critical',
        'insulinDiabetes',
        'angina4',
        'recentMi',
        'thoracicAorta',
      ];
      for (const flag of flags) {
        const inputs = { ...none, [flag]: 1 };
        expect(run('euroscore-ii', inputs).num('mortality'), flag).toBeCloseTo(
          reference(inputs),
          8,
        );
      }
      const selects: readonly [string, number][] = [
        ['renal', 3],
        ['nyha', 4],
        ['lvef', 3],
        ['pulmHtn', 2],
        ['urgency', 3],
        ['weight', 3],
      ];
      for (const [id, max] of selects) {
        for (let value = id === 'nyha' ? 1 : 0; value <= max; value += 1) {
          const inputs = { ...none, [id]: value };
          expect(run('euroscore-ii', inputs).num('mortality'), `${id}=${value}`).toBeCloseTo(
            reference(inputs),
            8,
          );
        }
      }
      const worst: Inputs = {
        ...none,
        ageYears: 82,
        sex: 'female',
        renal: 3,
        arteriopathy: 1,
        poorMobility: 1,
        redo: 1,
        lungDisease: 1,
        endocarditis: 1,
        critical: 1,
        insulinDiabetes: 1,
        nyha: 4,
        angina4: 1,
        lvef: 3,
        recentMi: 1,
        pulmHtn: 2,
        urgency: 3,
        weight: 3,
        thoracicAorta: 1,
      };
      expect(run('euroscore-ii', worst).num('mortality')).toBeCloseTo(reference(worst), 8);
    });
  });

  describe('DAPT score (Yeh 2016: −2…10, ≥2 favours continuing)', () => {
    const base: Inputs = {
      ageYears: 60,
      smoker: 0,
      diabetes: 0,
      miPresentation: 0,
      priorPciMi: 0,
      paclitaxelStent: 0,
      smallStent: 0,
      chfLvef: 0,
      veinGraft: 0,
    };

    it('scores each published item', () => {
      const items: readonly [string, number][] = [
        ['smoker', 1],
        ['diabetes', 1],
        ['miPresentation', 1],
        ['priorPciMi', 1],
        ['paclitaxelStent', 1],
        ['smallStent', 1],
        ['chfLvef', 2],
        ['veinGraft', 2],
      ];
      for (const [id, points] of items)
        expect(run('dapt-score', { ...base, [id]: 1 }).num('score'), id).toBe(points);
      const every: Inputs = {
        ...base,
        smoker: 1,
        diabetes: 1,
        miPresentation: 1,
        priorPciMi: 1,
        paclitaxelStent: 1,
        smallStent: 1,
        chfLvef: 1,
        veinGraft: 1,
      };
      expect(run('dapt-score', every).num('score')).toBe(10);
      expect(run('dapt-score', { ...every, ageYears: 80 }).num('score')).toBe(8);
    });

    it('steps age at 65 and 75 and the band at 2 points', () => {
      const at = (ageYears: number) => run('dapt-score', { ...base, ageYears }).num('score');
      expect([64, 65, 74, 75].map(at)).toEqual([0, -1, -1, -2]);
      expect(run('dapt-score', { ...base, smoker: 1 }).range).toBe('under-2');
      expect(run('dapt-score', { ...base, smoker: 1, diabetes: 1 }).range).toBe('2-plus');
      expect(
        run('dapt-score', { ...base, ageYears: 80, smoker: 1, diabetes: 1, miPresentation: 1 }).num(
          'score',
        ),
      ).toBe(1);
      expect(
        run('dapt-score', {
          ...base,
          ageYears: 80,
          smoker: 1,
          diabetes: 1,
          miPresentation: 1,
          priorPciMi: 1,
        }).range,
      ).toBe('2-plus');
      const text = run('dapt-score', { ...base, smoker: 1, diabetes: 1 }).interpretation;
      expect(text).toContain('2,7 % против 5,7 %');
    });
  });

  describe('SAMe-TT₂R₂ (Apostolakis 2013: 0–1 good, ≥2 poor INR control)', () => {
    const base: Inputs = {
      female: 0,
      ageYears: 70,
      comorbidities: 0,
      interactingDrugs: 0,
      tobacco: 0,
      nonCaucasian: 0,
    };

    it('scores sex, age under 60, more than two comorbidities, drugs, tobacco ×2 and race ×2', () => {
      expect(run('same-tt2r2', base).num('score')).toBe(0);
      expect(run('same-tt2r2', { ...base, female: 1 }).num('score')).toBe(1);
      expect(run('same-tt2r2', { ...base, ageYears: 59 }).num('score')).toBe(1);
      expect(run('same-tt2r2', { ...base, ageYears: 60 }).num('score')).toBe(0);
      expect(run('same-tt2r2', { ...base, interactingDrugs: 1 }).num('score')).toBe(1);
      expect(run('same-tt2r2', { ...base, tobacco: 1 }).num('score')).toBe(2);
      expect(run('same-tt2r2', { ...base, nonCaucasian: 1 }).num('score')).toBe(2);
      expect(
        run('same-tt2r2', {
          female: 1,
          ageYears: 50,
          comorbidities: 3,
          interactingDrugs: 1,
          tobacco: 1,
          nonCaucasian: 1,
        }).num('score'),
      ).toBe(8);
    });

    it('counts comorbidities only above two and cuts the band at 2 points', () => {
      expect(
        [0, 2, 3, 8].map((comorbidities) =>
          run('same-tt2r2', { ...base, comorbidities }).num('score'),
        ),
      ).toEqual([0, 0, 1, 1]);
      expect(run('same-tt2r2', { ...base, female: 1 }).range).toBe('0-1');
      expect(run('same-tt2r2', { ...base, female: 1, interactingDrugs: 1 }).range).toBe('2-plus');
      expect(run('same-tt2r2', { ...base, tobacco: 1 }).range).toBe('2-plus');
    });
  });

  describe('Essen Stroke Risk Score (Weimar 2009; REACH 1-year rates)', () => {
    const base: Inputs = {
      ageYears: 50,
      hypertension: 0,
      diabetes: 0,
      priorMi: 0,
      otherCvd: 0,
      pad: 0,
      smoker: 0,
      priorStroke: 0,
    };

    it('scores age 65–75 as 1 and over 75 as 2, then one point per factor up to 9', () => {
      expect(
        [64, 65, 75, 76].map((ageYears) =>
          run('essen-stroke-risk-score', { ...base, ageYears }).num('score'),
        ),
      ).toEqual([0, 1, 1, 2]);
      for (const id of [
        'hypertension',
        'diabetes',
        'priorMi',
        'otherCvd',
        'pad',
        'smoker',
        'priorStroke',
      ]) {
        expect(run('essen-stroke-risk-score', { ...base, [id]: 1 }).num('score'), id).toBe(1);
      }
      const all: Inputs = {
        ageYears: 80,
        hypertension: 1,
        diabetes: 1,
        priorMi: 1,
        otherCvd: 1,
        pad: 1,
        smoker: 1,
        priorStroke: 1,
      };
      expect(run('essen-stroke-risk-score', all).num('score')).toBe(9);
    });

    it('cuts the bands at 2 / 3, 4 / 5 and 6 / 7 points with the published REACH rates', () => {
      const withPoints = (points: number): Inputs => {
        const ids = [
          'hypertension',
          'diabetes',
          'priorMi',
          'otherCvd',
          'pad',
          'smoker',
          'priorStroke',
        ];
        const inputs: Record<string, number> = { ageYears: 50 };
        for (const [index, id] of ids.entries()) inputs[id] = index < points ? 1 : 0;
        return inputs;
      };
      const expected: readonly [number, string][] = [
        [2, '0-2'],
        [3, '3-4'],
        [4, '3-4'],
        [5, '5-6'],
        [6, '5-6'],
        [7, '7-9'],
      ];
      for (const [points, range] of expected)
        expect(run('essen-stroke-risk-score', withPoints(points)).range).toBe(range);
      expect(run('essen-stroke-risk-score', withPoints(3)).interpretation).toContain('3,9–4,4 %');
      expect(run('essen-stroke-risk-score', withPoints(7)).interpretation).toContain('6,8 %');
    });
  });

  describe('Ankle-brachial index (2016 AHA/ACC: higher ankle ÷ higher arm, 2 decimals)', () => {
    const base: Inputs = {
      armRight: 120,
      armLeft: 110,
      ankleRightDp: 120,
      ankleRightPt: 100,
      ankleLeftDp: 100,
      ankleLeftPt: 130,
    };

    it('divides the higher ankle pressure of each leg by the higher arm pressure', () => {
      const result = run('ankle-brachial-index', base);
      expect(result.num('abiRight')).toBe(1);
      expect(result.num('abiLeft')).toBe(1.08);
      expect(result.range).toBe('normal');
    });

    it('cuts at 0.90 / 0.91, 0.99 / 1.00 and 1.40 / 1.41 after rounding to two decimals', () => {
      const at = (ankle: number, arm = 100): Run =>
        run('ankle-brachial-index', {
          armRight: arm,
          armLeft: arm,
          ankleRightDp: ankle,
          ankleRightPt: 0,
          ankleLeftDp: ankle,
          ankleLeftPt: 0,
        });
      expect(at(90).num('abiRight')).toBe(0.9);
      expect(at(90).range).toBe('abnormal');
      expect(at(91).range).toBe('borderline');
      expect(at(99).range).toBe('borderline');
      expect(at(100).range).toBe('normal');
      expect(at(140).range).toBe('normal');
      expect(at(141).range).toBe('noncompressible');
      expect(at(271, 300).num('abiRight')).toBe(0.9); // 0.9033 rounds to 0.90
      expect(at(181, 200).range).toBe('borderline'); // 0.905 rounds to 0.91
      expect(at(281, 200).range).toBe('noncompressible'); // 1.405 rounds to 1.41
    });

    it('classifies by the lower index and flags a non-compressible leg only when the other is not low', () => {
      const lowAndStiff = run('ankle-brachial-index', {
        armRight: 100,
        armLeft: 100,
        ankleRightDp: 80,
        ankleRightPt: 70,
        ankleLeftDp: 160,
        ankleLeftPt: 150,
      });
      expect(lowAndStiff.num('abiRight')).toBe(0.8);
      expect(lowAndStiff.range).toBe('abnormal');
      const stiff = run('ankle-brachial-index', {
        armRight: 100,
        armLeft: 100,
        ankleRightDp: 110,
        ankleRightPt: 100,
        ankleLeftDp: 160,
        ankleLeftPt: 150,
      });
      expect(stiff.range).toBe('noncompressible');
    });
  });

  describe('Smith index for STEMI vs early repolarization (Smith 2012: >23.4 = STEMI)', () => {
    it('applies 1.196 × ST(V3) + 0.059 × QTc − 0.326 × R(V4)', () => {
      const result = run('smith-stemi-index', { stV3: 2, qtc: 420, rV4: 15 });
      expect(result.num('index')).toBeCloseTo(1.196 * 2 + 0.059 * 420 - 0.326 * 15, 8);
      expect(result.range).toBe('early-repolarization');
    });

    it('cuts at 23.4: 23.39987 is early repolarization, 23.4031 is STEMI', () => {
      // 1.196 × 3 + 0.059 × 400 = 27.188; R = 11.62 mm gives 23.39988, 11.61 mm gives 23.40314
      expect(run('smith-stemi-index', { stV3: 3, qtc: 400, rV4: 11.62 }).range).toBe(
        'early-repolarization',
      );
      expect(run('smith-stemi-index', { stV3: 3, qtc: 400, rV4: 11.61 }).range).toBe('stemi');
      expect(run('smith-stemi-index', { stV3: 3, qtc: 400, rV4: 11.61 }).interpretation).toContain(
        '86 %',
      );
    });
  });

  describe('Left ventricular mass index (ASE/EACVI 2015: cube formula, sex-specific cut-offs)', () => {
    /** Wall thickness (cm) that gives the requested LV mass for LVID 5.0 cm and a septum of 1.0 cm. */
    const pwtForMass = (mass: number): number => {
      const cube = 125 + (mass - 0.6) / (0.8 * 1.04);
      return cube ** (1 / 3) - 6;
    };
    // 180 cm × 80 kg gives a body surface area of exactly 2.0 m² (Mosteller)
    const patient = (sex: string, indexedMass: number): Inputs => ({
      sex,
      ivs: 1,
      lvid: 5,
      pwt: pwtForMass(indexedMass * 2),
      heightCm: 180,
      weightKg: 80,
    });

    it('calculates mass, BSA, index and relative wall thickness', () => {
      const result = run('lv-mass-index', {
        sex: 'male',
        ivs: 1.0,
        lvid: 5.0,
        pwt: 1.0,
        heightCm: 180,
        weightKg: 80,
      });
      const mass = 0.8 * 1.04 * (7 ** 3 - 5 ** 3) + 0.6;
      expect(result.num('lvmi')).toBeCloseTo(mass / 2, 8);
      expect(result.num('rwt')).toBeCloseTo(0.4, 8);
      expect(result.text('geometry')).toBe('Нормальная геометрия');
      expect(result.range).toBe('normal');
    });

    it('cuts the men’s bands at 115, 131 and 148 g/m²', () => {
      const cases: readonly [number, string][] = [
        [114.9, 'normal'],
        [115.1, 'mild'],
        [130.9, 'mild'],
        [131.1, 'moderate'],
        [147.9, 'moderate'],
        [148.1, 'severe'],
      ];
      for (const [value, range] of cases)
        expect(run('lv-mass-index', patient('male', value)).range, String(value)).toBe(range);
    });

    it('cuts the women’s bands at 95, 108 and 121 g/m²', () => {
      const cases: readonly [number, string][] = [
        [94.9, 'normal'],
        [95.1, 'mild'],
        [107.9, 'mild'],
        [108.1, 'moderate'],
        [120.9, 'moderate'],
        [121.1, 'severe'],
      ];
      for (const [value, range] of cases)
        expect(run('lv-mass-index', patient('female', value)).range, String(value)).toBe(range);
    });

    it('names the geometry from the mass band and the wall thickness ratio 0.42', () => {
      const geometry = (sex: string, ivs: number, lvid: number, pwt: number) =>
        run('lv-mass-index', { sex, ivs, lvid, pwt, heightCm: 180, weightKg: 80 }).text('geometry');
      expect(geometry('male', 0.9, 5, 0.9)).toBe('Нормальная геометрия');
      expect(geometry('male', 1, 4, 0.9)).toBe('Концентрическое ремоделирование'); // RWT 0.45, mass normal
      expect(geometry('male', 1.6, 5, 1.6)).toBe('Концентрическая гипертрофия');
      expect(geometry('male', 1.3, 6.8, 1.3)).toBe('Эксцентрическая гипертрофия');
      expect(
        run('lv-mass-index', {
          sex: 'male',
          ivs: 1,
          lvid: 5,
          pwt: 2.1,
          heightCm: 180,
          weightKg: 80,
        }).num('rwt'),
      ).toBeCloseTo(0.84, 8);
    });
  });

  describe('Mehran contrast nephropathy score (JACC 2004: ≤5 / 6–10 / 11–15 / ≥16)', () => {
    const base: Inputs = {
      hypotension: 0,
      iabp: 0,
      chf: 0,
      ageYears: 60,
      anemia: 0,
      diabetes: 0,
      contrastMl: 0,
      egfr: 90,
    };

    it('adds the published points', () => {
      const items: readonly [string, number][] = [
        ['hypotension', 5],
        ['iabp', 5],
        ['chf', 5],
        ['anemia', 3],
        ['diabetes', 3],
      ];
      for (const [id, points] of items)
        expect(run('mehran-cin-score', { ...base, [id]: 1 }).num('score'), id).toBe(points);
      const everything: Inputs = {
        hypotension: 1,
        iabp: 1,
        chf: 1,
        ageYears: 80,
        anemia: 1,
        diabetes: 1,
        contrastMl: 250,
        egfr: 15,
      };
      expect(run('mehran-cin-score', everything).num('score')).toBe(5 + 5 + 5 + 4 + 3 + 3 + 2 + 6);
    });

    it('scores age above 75, contrast per full 100 mL and the eGFR steps 60, 40 and 20', () => {
      expect(
        [75, 76].map((ageYears) => run('mehran-cin-score', { ...base, ageYears }).num('score')),
      ).toEqual([0, 4]);
      expect(
        [99, 100, 199, 200].map((contrastMl) =>
          run('mehran-cin-score', { ...base, contrastMl }).num('score'),
        ),
      ).toEqual([0, 1, 1, 2]);
      expect(
        [61, 60, 59, 40, 39, 20, 19].map((egfr) =>
          run('mehran-cin-score', { ...base, egfr }).num('score'),
        ),
      ).toEqual([0, 0, 2, 2, 4, 4, 6]);
    });

    it('cuts the risk groups at 5 / 6, 10 / 11 and 15 / 16 with the published rates', () => {
      const withPoints = (
        hypotension: number,
        diabetes: number,
        anemia: number,
        iabp: number,
        chf: number,
      ): Inputs => ({ ...base, hypotension, diabetes, anemia, iabp, chf });
      const cases: readonly [Inputs, number, string, string][] = [
        [withPoints(1, 0, 0, 0, 0), 5, 'low', '7,5 %'],
        [{ ...base, hypotension: 1, ageYears: 80 }, 9, 'moderate', '14,0 %'],
        [{ ...base, hypotension: 1, iabp: 1, chf: 1, contrastMl: 100 }, 16, 'very-high', '57,3 %'],
        [{ ...base, hypotension: 1, iabp: 1, chf: 1 }, 15, 'high', '26,1 %'],
        [{ ...base, hypotension: 1, iabp: 1, diabetes: 1, anemia: 1 }, 16, 'very-high', '57,3 %'],
        [{ ...base, hypotension: 1, iabp: 1 }, 10, 'moderate', '14,0 %'],
        [{ ...base, hypotension: 1, iabp: 1, contrastMl: 100 }, 11, 'high', '26,1 %'],
      ];
      for (const [inputs, score, range, rate] of cases) {
        const result = run('mehran-cin-score', inputs);
        expect(result.num('score')).toBe(score);
        expect(result.range).toBe(range);
        expect(result.interpretation).toContain(rate);
      }
      expect(run('mehran-cin-score', { ...base, hypotension: 1, contrastMl: 99 }).range).toBe(
        'low',
      );
      expect(run('mehran-cin-score', { ...base, hypotension: 1, contrastMl: 100 }).range).toBe(
        'moderate',
      );
    });
  });

  describe('CEAP (Eklöf 2004) and extended CEAP', () => {
    const base: Inputs = {
      clinical: 'C2',
      symptoms: 'S',
      etiology: 'Ep',
      superficial: 1,
      perforator: 0,
      deep: 0,
      pathophysiology: 'Pr',
    };

    it('keeps the C, S/A, E, A and P descriptors and numbers the C class', () => {
      const result = run('ceap', base);
      expect(result.num('cNumber')).toBe(2);
      expect(result.texts).toMatchObject({
        cText: 'C2',
        sText: 'S',
        eText: 'Ep',
        aText: 'As',
        pText: 'Pr',
      });
      const classes: readonly [string, number, string][] = [
        ['C0', 0, 'c0-c1'],
        ['C1', 1, 'c0-c1'],
        ['C2', 2, 'c2'],
        ['C3', 3, 'c3'],
        ['C4a', 4, 'c4-c5'],
        ['C4b', 4, 'c4-c5'],
        ['C5', 5, 'c4-c5'],
        ['C6', 6, 'c6'],
      ];
      for (const [clinical, number, range] of classes) {
        const result = run('ceap', { ...base, clinical });
        expect(result.num('cNumber'), clinical).toBe(number);
        expect(result.range, clinical).toBe(range);
      }
    });

    it('derives the anatomic descriptor from the involved systems', () => {
      const code = (superficial: number, perforator: number, deep: number) =>
        run('ceap', { ...base, superficial, perforator, deep }).text('aText');
      expect(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 1, 0],
          [1, 0, 1],
          [0, 1, 1],
          [1, 1, 1],
        ].map(([s, p, d]) => code(s ?? 0, p ?? 0, d ?? 0)),
      ).toEqual(['An', 'As', 'Ap', 'Ad', 'As,p', 'As,d', 'Ap,d', 'As,p,d']);
    });

    it('reproduces the published example C6,S, Ep, As,p,d, Pr in the extended form with segments 2,3,18,13,14', () => {
      const segments: Inputs = {};
      for (let index = 1; index <= 18; index += 1)
        segments[`seg${index}`] = [2, 3, 18, 13, 14].includes(index) ? 1 : 0;
      const result = run('ceap-extended', {
        clinical: 'C6',
        symptoms: 'S',
        etiology: 'Ep',
        pathophysiology: 'Pr',
        ...segments,
      });
      expect(result.texts).toMatchObject({
        cText: 'C6',
        sText: 'S',
        eText: 'Ep',
        aText: 'As,p,d',
        pText: 'Pr',
      });
      expect(result.num('segmentCount')).toBe(5);
      expect(result.range).toBe('c6');
    });

    it('groups segments 1–5 as superficial, 6–16 as deep and 17–18 as perforators', () => {
      const only = (segment: number) => {
        const segments: Inputs = {};
        for (let index = 1; index <= 18; index += 1)
          segments[`seg${index}`] = index === segment ? 1 : 0;
        return run('ceap-extended', {
          clinical: 'C3',
          symptoms: 'A',
          etiology: 'Es',
          pathophysiology: 'Po',
          ...segments,
        }).text('aText');
      };
      expect([1, 5, 6, 16, 17, 18].map(only)).toEqual(['As', 'As', 'Ad', 'Ad', 'Ap', 'Ap']);
      const none: Inputs = { clinical: 'C0', symptoms: 'A', etiology: 'En', pathophysiology: 'Pn' };
      expect(run('ceap-extended', none).text('aText')).toBe('An');
    });
  });

  describe('Chronic limb ischemia: Fontaine, Pokrovsky, Rutherford (Russian consensus 2010)', () => {
    it('maps each clinical picture to the three classifications', () => {
      const table: readonly [number, string, string, string][] = [
        [0, 'I', 'I', '0'],
        [1, 'IIa', 'IIa', 'I'],
        [2, 'IIb', 'IIb', 'I'],
        [3, 'IIb', 'III', 'I'],
        [4, 'III', 'III', 'II'],
        [5, 'IV', 'IV', 'III'],
        [6, 'IV', 'IV', 'III'],
      ];
      for (const [picture, fontaine, pokrovsky, grade] of table) {
        const result = run('chronic-limb-ischemia', { picture });
        expect(result.num('rutherfordCategory')).toBe(picture);
        expect(result.texts).toMatchObject({
          fontaineStage: fontaine,
          pokrovskyStage: pokrovsky,
          rutherfordGrade: grade,
        });
        expect(result.range).toBe(`cat-${picture}`);
        expect(result.interpretation).toContain(`Фонтейн ${fontaine}, Покровский ${pokrovsky}`);
      }
    });

    it('rejects a picture outside the list', () => {
      fails('chronic-limb-ischemia', { picture: 7 });
    });
  });
});
