import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) of TRISS and the Russian military field surgery
 * scales VPH-SP, VPH-SG(II), VPH-SS, VPH-SU, VPH-UL and VPH-EH.
 *
 * VPH scales — sources actually read (both PDFs downloaded and text-extracted, tables compared
 * token by token; the numeric content of the two documents is identical):
 * - «Указания по военно-полевой хирургии», МО РФ, 2013 (https://www.vmeda.org/wp-content/uploads/
 *   2016/pdf/ukazaniya_po_vph_2013.pdf): chapter 4 tables 4.3-4.4, appendix tables 1-3 (SP, SG-II,
 *   SS), 8 (SU), 9 (UL), 10-11 (EH), worked example on printed pages 448-449;
 * - «Методические рекомендации по лечению боевой хирургической травмы», ГВМУ МО РФ, 2022
 *   (https://www.vmeda.org/wp-content/uploads/2023/04/metodugaz_travma.pdf), the same tables.
 *
 * TRISS — the primary papers (Boyd 1987, Champion 1990 and the 1995 ACS-COT revision, Schluter
 * 2010) are paywalled. The constants were cross-checked against four independent open-access
 * reproductions: PMC3876517 (Boyd 1987 set, MTOS set), PMC4800364 (Table 2: MTOS 1995 blunt set
 * with RTS weights multiplied in), PMC11469657 and PMC7199982 (both MTOS-1995 sets), plus the
 * Schluter 2010 abstract (PMID 20386271) which names the MTOS 1995 coefficients as the baseline.
 * The age index (0 under 55, 1 from 55) is stated in PMC10348036 and PMC12639945.
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

// ---------------------------------------------------------------------------------------------
// TRISS
// ---------------------------------------------------------------------------------------------

describe('TRISS against the MTOS-1995 coefficient set and the Champion 1989 RTS coding', () => {
  const id = 'minimed.calculator.triss';
  const BLUNT = { b0: -0.4499, rts: 0.8085, iss: -0.0835, age: -1.743 };
  const PENETRATING = { b0: -2.5355, rts: 0.9934, iss: -0.0651, age: -1.136 };
  const reference = (set: typeof BLUNT, rts: number, iss: number, ageIndex: number): number =>
    100 / (1 + Math.exp(-(set.b0 + set.rts * rts + set.iss * iss + set.age * ageIndex)));
  const normal: Inputs = { gcs: 15, sbp: 120, rr: 16, iss: 9, ageYears: 30, mechanism: 0 };

  // The schema exposes only Ps as an output; the coded RTS is recovered by inverting the blunt
  // logistic model for an under-55 patient with ISS 1: logit = ln(Ps / (100 - Ps)).
  const rtsOf = (overrides: Inputs): number => {
    const ps = out(
      run(id, { ...normal, iss: 1, ageYears: 30, mechanism: 0, ...overrides }),
      'survival',
    );
    const logit = Math.log(ps / (100 - ps));
    return (logit - BLUNT.b0 - BLUNT.iss * 1) / BLUNT.rts;
  };
  const W = { gcs: 0.9368, sbp: 0.7326, rr: 0.2908 };

  it('codes the three physiological variables at every published break (Champion 1989)', () => {
    // GCS 13-15 = 4, 9-12 = 3, 6-8 = 2, 4-5 = 1, 3 = 0 (SBP and RR held at code 4).
    const gcs: readonly [number, number][] = [
      [15, 4],
      [13, 4],
      [12, 3],
      [9, 3],
      [8, 2],
      [6, 2],
      [5, 1],
      [4, 1],
      [3, 0],
    ];
    for (const [value, code] of gcs) {
      const expected = W.gcs * code + W.sbp * 4 + W.rr * 4;
      expect(rtsOf({ gcs: value }), `gcs ${value}`).toBeCloseTo(expected, 6);
    }
    // SBP >89 = 4, 76-89 = 3, 50-75 = 2, 1-49 = 1, 0 = 0.
    const sbp: readonly [number, number][] = [
      [200, 4],
      [90, 4],
      [89, 3],
      [76, 3],
      [75, 2],
      [50, 2],
      [49, 1],
      [1, 1],
      [0, 0],
    ];
    for (const [value, code] of sbp) {
      const expected = W.gcs * 4 + W.sbp * code + W.rr * 4;
      expect(rtsOf({ sbp: value }), `sbp ${value}`).toBeCloseTo(expected, 6);
    }
    // RR 10-29 = 4, >29 = 3, 6-9 = 2, 1-5 = 1, 0 = 0.
    const rr: readonly [number, number][] = [
      [29, 4],
      [10, 4],
      [30, 3],
      [60, 3],
      [9, 2],
      [6, 2],
      [5, 1],
      [1, 1],
      [0, 0],
    ];
    for (const [value, code] of rr) {
      const expected = W.gcs * 4 + W.sbp * 4 + W.rr * code;
      expect(rtsOf({ rr: value }), `rr ${value}`).toBeCloseTo(expected, 6);
    }
  });

  it('weights the coded RTS with 0.9368 / 0.7326 / 0.2908 (maximum 7.8408)', () => {
    // 4 × (0.9368 + 0.7326 + 0.2908) = 4 × 1.9602 = 7.8408
    expect(rtsOf({})).toBeCloseTo(7.8408, 6);
    // GCS 8 (2), SBP 70 (2), RR 8 (2): 2 × 1.9602 = 3.9204
    expect(rtsOf({ gcs: 8, sbp: 70, rr: 8 })).toBeCloseTo(3.9204, 6);
    // GCS 3 (0), SBP 120 (4), RR 0 (0): 4 × 0.7326 = 2.9304
    expect(rtsOf({ gcs: 3, sbp: 120, rr: 0 })).toBeCloseTo(2.9304, 6);
  });

  it('hand-computed blunt case: RTS 7.8408, ISS 9, age 30', () => {
    // b = -0.4499 + 0.8085 × 7.8408 - 0.0835 × 9
    //   = -0.4499 + 6.3392868 - 0.7515 = 5.1378868; Ps = 1 / (1 + e^-5.1378868) = 99.416 %
    const ps = out(run(id, normal), 'survival');
    expect(Math.log(ps / (100 - ps))).toBeCloseTo(5.1378868, 6);
    expect(out(run(id, normal), 'survival')).toBeCloseTo(reference(BLUNT, 7.8408, 9, 0), 6);
    expect(out(run(id, normal), 'survival')).toBeCloseTo(99.4164, 3);
  });

  it('hand-computed penetrating case: RTS 3.9204, ISS 25, age 60', () => {
    // b = -2.5355 + 0.9934 × 3.9204 - 0.0651 × 25 - 1.136 × 1
    //   = -2.5355 + 3.8945 (3.894525) - 1.6275 - 1.136 = -1.404475
    // Ps = 1 / (1 + e^1.404475) = 1 / 5.07339 = 19.71 %
    const input: Inputs = { gcs: 8, sbp: 70, rr: 8, iss: 25, ageYears: 60, mechanism: 1 };
    const ps = out(run(id, input), 'survival');
    expect(Math.log(ps / (100 - ps))).toBeCloseTo(-1.404475, 5);
    expect(out(run(id, input), 'survival')).toBeCloseTo(reference(PENETRATING, 3.9204, 25, 1), 6);
    expect(out(run(id, input), 'survival')).toBeCloseTo(19.71, 2);
  });

  it('keeps the MTOS-1995 constants, not the Boyd 1987 or Schluter 2010 sets', () => {
    // Boyd 1987 blunt set would give 100/(1+e^-(-1.2470+0.9544×7.8408-0.0768×9)) = 99.6 %,
    // different from the MTOS-1995 result of 99.4 %.
    const boyd = 100 / (1 + Math.exp(-(-1.247 + 0.9544 * 7.8408 - 0.0768 * 9)));
    expect(boyd).toBeCloseTo(99.61, 2);
    expect(out(run(id, normal), 'survival')).not.toBeCloseTo(boyd, 1);
  });

  it('switches the age index between 54 and 55 and the penetrating model between 14 and 15', () => {
    expect(out(run(id, { ...normal, ageYears: 54 }), 'survival')).toBeCloseTo(
      reference(BLUNT, 7.8408, 9, 0),
      6,
    );
    // age 55, blunt: b = 5.1378868 - 1.743 = 3.3948868
    expect(out(run(id, { ...normal, ageYears: 55 }), 'survival')).toBeCloseTo(
      reference(BLUNT, 7.8408, 9, 1),
      6,
    );
    // Under 15 years the blunt coefficients apply to every mechanism (PMC3876517, PMC4800364).
    const blunt14 = out(run(id, { ...normal, ageYears: 14 }), 'survival');
    expect(out(run(id, { ...normal, ageYears: 14, mechanism: 1 }), 'survival')).toBeCloseTo(
      blunt14,
      8,
    );
    expect(out(run(id, { ...normal, ageYears: 15, mechanism: 1 }), 'survival')).toBeCloseTo(
      reference(PENETRATING, 7.8408, 9, 0),
      6,
    );
  });

  it('declares the coefficient set in the limitations and bumps the record version', () => {
    const tool = moduleTool(id);
    expect(tool.version).toBe('1.0.1');
    expect(tool.definition.limitations?.some((line) => line.includes('1995'))).toBe(true);
    expect(tool.definition.limitations?.some((line) => line.includes('Boyd 1987'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// VPH scales: generic table / band machinery
// ---------------------------------------------------------------------------------------------

interface Level {
  readonly value: number;
  readonly points: number;
}
interface Row {
  readonly id: string;
  /** The first level is the baseline (minimum points). */
  readonly levels: readonly Level[];
}

function baselineInputs(rows: readonly Row[]): Inputs {
  return Object.fromEntries(rows.map((row) => [row.id, row.levels[0]?.value ?? 0]));
}

function baselineSum(rows: readonly Row[]): number {
  return rows.reduce((sum, row) => sum + (row.levels[0]?.points ?? 0), 0);
}

/** Every level of every row moves the total by exactly (points − baseline points). */
function expectTable(id: string, rows: readonly Row[], output = 'score'): void {
  const base = baselineInputs(rows);
  const baseSum = baselineSum(rows);
  expect(out(run(id, base), output), `${id} baseline`).toBe(baseSum);
  for (const row of rows) {
    const basePoints = row.levels[0]?.points ?? 0;
    for (const level of row.levels) {
      const total = out(run(id, { ...base, [row.id]: level.value }), output);
      expect(total, `${id} ${row.id}=${level.value}`).toBe(baseSum - basePoints + level.points);
    }
  }
}

/** Finds any selection of levels whose points add to `target`. */
function inputsForScore(rows: readonly Row[], target: number): Inputs {
  let reach = new Map<number, Inputs>([[0, {}]]);
  for (const row of rows) {
    const next = new Map<number, Inputs>();
    for (const [sum, chosen] of reach) {
      for (const level of row.levels) {
        const total = sum + level.points;
        if (total <= target && !next.has(total)) {
          next.set(total, { ...chosen, [row.id]: level.value });
        }
      }
    }
    reach = next;
  }
  const found = reach.get(target);
  if (!found) throw new Error(`score ${target} not reachable`);
  return found;
}

function expectBands(
  id: string,
  rows: readonly Row[],
  bands: readonly (readonly [number, string])[],
): void {
  for (const [target, rangeId] of bands) {
    const result = run(id, inputsForScore(rows, target));
    expect(out(result, 'score'), `${id} score ${target}`).toBe(target);
    expect(result.rangeId, `${id} band at ${target}`).toBe(rangeId);
  }
}

const select = (id: string, points: readonly number[]): Row => ({
  id,
  levels: points.map((p, value) => ({ value, points: p })),
});
const numeric = (id: string, pairs: readonly (readonly [number, number])[]): Row => ({
  id,
  levels: pairs.map(([value, points]) => ({ value, points })),
});

// ---------------------------------------------------------------------------------------------
// VPH-SP  (2013 Указания, appendix table 1; grades table 4.3)
// ---------------------------------------------------------------------------------------------

const SP_ROWS: readonly Row[] = [
  select('skin', [1, 2, 4, 7]),
  select('breathing', [1, 5, 8]),
  select('auscultation', [1, 3, 7]),
  select('speech', [1, 3, 6]),
  select('pain', [1, 6]),
  select('reflex', [1, 8]),
  select('pupils', [1, 2, 4, 6]),
  select('rhythm', [1, 8]),
  select('pulse', [1, 3, 4, 7, 9]),
  // 101-140 = 1; «100-90 или >140» = 3; 70-89 = 4; 60-69 = 5; 40-59 = 7; <40 = 8
  select('sbp', [1, 3, 4, 5, 7, 8]),
  select('bloodLoss', [1, 3, 4, 6, 9]),
  select('bowel', [1, 3, 5]),
];

describe('VPH-SP against Указания по ВПХ 2013, table 1 and table 4.3', () => {
  const id = 'minimed.calculator.vph-sp';
  it('scores every row of the printed table (minimum 12, maximum 83)', () => {
    expectTable(id, SP_ROWS);
    expect(baselineSum(SP_ROWS)).toBe(12);
  });

  it('reproduces the printed worked example: 32 points, extremely severe', () => {
    // Table "ПРИМЕР ОБЪЕКТИВНОЙ ОЦЕНКИ ТЯЖЕСТИ ТРАВМЫ" (2013, printed p. 448-449):
    // skin cyanotic 2 + breathing 28/min 5 + weakened breathing 3 + speech 1 + pain 1 +
    // reflexes 1 + pupils 1 + rhythm 1 + pulse 120 → 4 + SBP 80 → 4 + blood loss to 2000 → 4 +
    // bowel absent 5 = 32
    const result = run(id, {
      skin: 1,
      breathing: 1,
      auscultation: 1,
      speech: 0,
      pain: 0,
      reflex: 0,
      pupils: 0,
      rhythm: 0,
      pulse: 2,
      sbp: 2,
      bloodLoss: 2,
      bowel: 2,
    });
    expect(out(result, 'score')).toBe(32);
    expect(result.rangeId).toBe('extremely-severe');
  });

  it('assigns table 4.3 grades at both sides of every printed boundary', () => {
    expectBands(id, SP_ROWS, [
      [12, 'satisfactory'],
      [13, 'moderate'],
      [20, 'moderate'],
      [21, 'severe'],
      [31, 'severe'],
      [32, 'extremely-severe'],
      [45, 'extremely-severe'],
      [46, 'critical'],
    ]);
  });

  it('keeps the printed mortality figures in the band wording', () => {
    expect(run(id, inputsForScore(SP_ROWS, 12)).explanation).toContain('летальность 0 %');
    expect(run(id, inputsForScore(SP_ROWS, 20)).explanation).toContain('менее 3,5 %');
    expect(run(id, inputsForScore(SP_ROWS, 31)).explanation).toContain('менее 38 %');
    expect(run(id, inputsForScore(SP_ROWS, 45)).explanation).toContain('менее 84 %');
    expect(run(id, inputsForScore(SP_ROWS, 46)).explanation).toContain('100 %');
  });

  it('documents the conflicting compensation limits of table 4.4', () => {
    const tool = moduleTool(id);
    expect(tool.version).toBe('1.0.1');
    expect(tool.definition.limitations?.some((line) => line.includes('Табл. 4.4'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// VPH-SG(II)  (2013 Указания, appendix table 2; grades table 4.3)
// ---------------------------------------------------------------------------------------------

const SG_ROWS: readonly Row[] = [
  // 14-15 = 1, 11-13 = 3, 8-10 = 6, 5-7 = 8, 3-4 = 9
  numeric('gcs', [
    [15, 1],
    [14, 1],
    [13, 3],
    [11, 3],
    [10, 6],
    [8, 6],
    [7, 8],
    [5, 8],
    [4, 9],
    [3, 9],
  ]),
  select('breathing', [1, 6, 9]),
  select('auscultation', [1, 3, 6]),
  select('rhythm', [1, 6]),
  // 60-90 = 1, 91-100 = 3, 101-140 = 5, <60 or >140 = 7, not determined = 9
  numeric('hr', [
    [75, 1],
    [60, 1],
    [90, 1],
    [91, 3],
    [100, 3],
    [101, 5],
    [140, 5],
    [141, 7],
    [59, 7],
    [0, 9],
  ]),
  // >=100 = 1, 81-99 = 4, 61-80 = 8, <=60 = 9
  numeric('sbp', [
    [120, 1],
    [100, 1],
    [99, 4],
    [81, 4],
    [80, 8],
    [61, 8],
    [60, 9],
    [0, 9],
  ]),
  select('bowel', [1, 3, 5]),
  // bilirubin < 20.5 = 1, > 20.5 = 4 (printed unit «ммоль/л», physiologically µmol/L)
  numeric('bilirubin', [
    [10, 1],
    [20.5, 1],
    [20.6, 4],
  ]),
  // >60 = 1, 50-60 = 3, <50 = 5
  numeric('protein', [
    [70, 1],
    [60.1, 1],
    [60, 3],
    [50, 3],
    [49.9, 5],
  ]),
  // 1250-2500 = 1, >2500 = 2, <1250 = 5
  numeric('diuresis', [
    [2000, 1],
    [1250, 1],
    [2500, 1],
    [2501, 2],
    [1249, 5],
  ]),
  // 0.14 mmol/L = 140 µmol/L and below = 1, above = 3
  numeric('creatinine', [
    [100, 1],
    [140, 1],
    [141, 3],
  ]),
  // 36.0-37.0 = 1, 37.1-38.0 = 2, <36.0 or >38.0 = 3
  numeric('temp', [
    [36.5, 1],
    [36, 1],
    [37, 1],
    [37.1, 2],
    [38, 2],
    [38.1, 3],
    [35.9, 3],
  ]),
  // >=3.0 = 1, 2.9-2.6 = 2, <=2.5 = 4
  numeric('rbc', [
    [4, 1],
    [3, 1],
    [2.9, 2],
    [2.6, 2],
    [2.5, 4],
  ]),
  // 4.0-8.0 = 1, 8.1-10.0 = 2, 10.1-12.0 = 3, <4.0 or >12.0 = 4
  numeric('wbc', [
    [6, 1],
    [4, 1],
    [8, 1],
    [8.1, 2],
    [10, 2],
    [10.1, 3],
    [12, 3],
    [12.1, 4],
    [3.9, 4],
  ]),
  // <10 = 1, 11-20 = 2, >20 = 4
  numeric('bands', [
    [5, 1],
    [10, 1],
    [11, 2],
    [20, 2],
    [21, 4],
  ]),
  // 5-12 = 1, 12-16 = 3, <5 = 5, >16 = 8
  numeric('clotting', [
    [8, 1],
    [5, 1],
    [12, 1],
    [12.5, 3],
    [16, 3],
    [17, 8],
    [4.5, 5],
  ]),
];

describe('VPH-SG(II) against Указания по ВПХ 2013, table 2 and table 4.3', () => {
  const id = 'minimed.calculator.vph-sg';
  it('scores all 16 rows at every published break (minimum 16)', () => {
    expectTable(id, SG_ROWS);
    expect(baselineSum(SG_ROWS)).toBe(16);
  });

  it('hand-computed worked case from the table', () => {
    // GCS 9 → 6, breathing frequent → 6, wet rales → 6, arrhythmia → 6, pulse 120 → 5,
    // SBP 85 → 4, bowel weakened → 3, bilirubin 30 → 4, protein 55 → 3, diuresis 900 → 5,
    // creatinine 180 → 3, temp 38.5 → 3, RBC 2.8 → 2, WBC 11 → 3, bands 15 → 2, clotting 14 → 3
    // = 6+6+6+6+5+4+3+4+3+5+3+3+2+3+2+3 = 64
    const result = run(id, {
      gcs: 9,
      breathing: 1,
      auscultation: 2,
      rhythm: 1,
      hr: 120,
      sbp: 85,
      bowel: 1,
      bilirubin: 30,
      protein: 55,
      diuresis: 900,
      creatinine: 180,
      temp: 38.5,
      rbc: 2.8,
      wbc: 11,
      bands: 15,
      clotting: 14,
    });
    expect(out(result, 'score')).toBe(64);
    expect(result.rangeId).toBe('critical');
  });

  it('assigns table 4.3 grades at both sides of every printed boundary', () => {
    expectBands(id, SG_ROWS, [
      [16, 'satisfactory'],
      [22, 'satisfactory'],
      [23, 'moderate'],
      [32, 'moderate'],
      [33, 'severe'],
      [40, 'severe'],
      [41, 'extremely-severe'],
      [50, 'extremely-severe'],
      [51, 'critical'],
    ]);
  });

  it('documents the table 4.4 conflict and bumps the record version', () => {
    const tool = moduleTool(id);
    expect(tool.version).toBe('1.0.1');
    expect(tool.definition.limitations?.some((line) => line.includes('Табл. 4.4'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// VPH-SS  (2013 Указания, appendix table 3; grades table 4.3)
// ---------------------------------------------------------------------------------------------

const SS_ROWS: readonly Row[] = [
  numeric('gcs', [
    [15, 1],
    [14, 1],
    [13, 3],
    [11, 3],
    [10, 6],
    [8, 6],
    [7, 8],
    [5, 8],
    [4, 9],
    [3, 9],
  ]),
  // normal 1, frequent 6, pathological 9, assisted (ВВЛ) 6, ventilated (ИВЛ) 9
  select('breathing', [1, 6, 9, 6, 9]),
  // PaO2/FiO2 >300 = 1, 150-300 = 4, <150 = 8
  numeric('pf', [
    [400, 1],
    [301, 1],
    [300, 4],
    [150, 4],
    [149, 8],
  ]),
  // HbO2a >94 = 1, 93-90 = 5, <90 = 9
  numeric('sao2', [
    [98, 1],
    [94, 1],
    [93, 5],
    [90, 5],
    [89, 9],
  ]),
  // PaCO2 32-50 = 1, 50-60 = 2, >60 or <32 = 4
  numeric('paco2', [
    [40, 1],
    [32, 1],
    [50, 1],
    [51, 2],
    [60, 2],
    [61, 4],
    [31, 4],
  ]),
  select('rhythm', [1, 6]),
  select('pulse', [1, 5, 7, 8, 9]),
  // >100 = 1, 81-100 = 4, 61-80 = 8, <=60 = 9
  numeric('sbp', [
    [120, 1],
    [101, 1],
    [100, 4],
    [81, 4],
    [80, 8],
    [61, 8],
    [60, 9],
  ]),
  select('inotropes', [1, 8]),
  // stroke index >40 = 1, 28-40 = 3, <28 = 5
  numeric('si', [
    [50, 1],
    [41, 1],
    [40, 3],
    [28, 3],
    [27, 5],
  ]),
  // RBC >3.0 = 1, 3.0-2.6 = 5, <2.6 = 9
  numeric('rbc', [
    [4, 1],
    [3.1, 1],
    [3, 5],
    [2.6, 5],
    [2.5, 9],
  ]),
  // fibrinogen 2.3-4.0 = 1, <2.3 or >4.0 = 3
  numeric('fibrinogen', [
    [3, 1],
    [2.3, 1],
    [4, 1],
    [2.2, 3],
    [4.1, 3],
  ]),
  numeric('clotting', [
    [8, 1],
    [5, 1],
    [12, 1],
    [12.5, 3],
    [16, 3],
    [17, 8],
    [4.5, 5],
  ]),
  // hourly diuresis >60 = 1, <60 = 3
  numeric('hourlyDiuresis', [
    [100, 1],
    [60, 1],
    [59, 3],
  ]),
  numeric('creatinine', [
    [100, 1],
    [140, 1],
    [141, 3],
  ]),
  // urea <=8.3 = 1, >8.3 = 3
  numeric('urea', [
    [5, 1],
    [8.3, 1],
    [8.4, 3],
  ]),
  numeric('bilirubin', [
    [10, 1],
    [20.5, 1],
    [20.6, 4],
  ]),
  select('bowel', [1, 3, 5]),
  numeric('protein', [
    [70, 1],
    [60.1, 1],
    [60, 3],
    [50, 3],
    [49.9, 5],
  ]),
  // middle molecules x1 = 1, x2 = 3, x3 = 5, x4 and more = 7
  select('middleMolecules', [1, 3, 5, 7]),
  // urine intoxication index: above blood = 1, equal or lower by <=50 % = 4, lower by >=50 % = 9
  select('urineIndex', [1, 4, 9]),
  // 35.9-37.0 = 1, 37.1-38.0 = 2, <35.9 or >38.0 = 3
  numeric('temp', [
    [36.5, 1],
    [35.9, 1],
    [37, 1],
    [37.1, 2],
    [38, 2],
    [38.1, 3],
    [35.8, 3],
  ]),
  // 4.0-8.0 = 1, 8.1-12.0 = 3, >12.0 or <4.0 = 4
  numeric('wbc', [
    [6, 1],
    [4, 1],
    [8, 1],
    [8.1, 3],
    [12, 3],
    [12.1, 4],
    [3.9, 4],
  ]),
  numeric('bands', [
    [5, 1],
    [10, 1],
    [11, 2],
    [20, 2],
    [21, 4],
  ]),
  select('bacteremia', [1, 5]),
];

describe('VPH-SS against Указания по ВПХ 2013, table 3 and table 4.3', () => {
  const id = 'minimed.calculator.vph-ss';
  it('scores all 25 rows at every published break (minimum 25)', () => {
    expect(SS_ROWS).toHaveLength(25);
    expectTable(id, SS_ROWS);
    expect(baselineSum(SS_ROWS)).toBe(25);
  });

  it('hand-computed worked case with the printed system sub-totals', () => {
    // GCS 9 → 6; gas transport: ИВЛ 9 + PaO2/FiO2 120 → 8 + SaO2 92 → 5 + PaCO2 55 → 2 = 24;
    // haemodynamics: arrhythmia 6 + pulse >140 → 7 + SBP 85 → 4 + dopamine 8 + SI 30 → 3 = 28;
    // blood: RBC 2.8 → 5 + fibrinogen 1.9 → 3 + clotting 14 → 3 = 11;
    // kidney: diuresis 40 ml/h → 3 + creatinine 180 → 3 + urea 12 → 3 = 9;
    // liver/GIT: bilirubin 30 → 4 + weak bowel 3 + protein 55 → 3 = 10;
    // endotoxicosis: middle molecules x3 → 5 + urine index equal → 4 = 9;
    // SIRS: temp 38.6 → 3 + WBC 14 → 4 + bands 15 → 2 + bacteraemia 5 = 14;
    // total = 6 + 24 + 28 + 11 + 9 + 10 + 9 + 14 = 111
    const result = run(id, {
      gcs: 9,
      breathing: 4,
      pf: 120,
      sao2: 92,
      paco2: 55,
      rhythm: 1,
      pulse: 2,
      sbp: 85,
      inotropes: 1,
      si: 30,
      rbc: 2.8,
      fibrinogen: 1.9,
      clotting: 14,
      hourlyDiuresis: 40,
      creatinine: 180,
      urea: 12,
      bilirubin: 30,
      bowel: 1,
      protein: 55,
      middleMolecules: 2,
      urineIndex: 1,
      temp: 38.6,
      wbc: 14,
      bands: 15,
      bacteremia: 1,
    });
    expect(out(result, 'score')).toBe(111);
    expect(result.rangeId).toBe('critical');
  });

  it('assigns table 4.3 grades; sums 25-26 fall below the printed 27 and stay satisfactory', () => {
    expectBands(id, SS_ROWS, [
      [25, 'satisfactory'],
      [27, 'satisfactory'],
      [32, 'satisfactory'],
      [33, 'moderate'],
      [49, 'moderate'],
      [50, 'severe'],
      [69, 'severe'],
      [70, 'extremely-severe'],
      [98, 'extremely-severe'],
      // printed «>99»: the sum 99 itself is not covered; the schema treats it as critical
      [99, 'critical'],
      [100, 'critical'],
    ]);
  });

  it('documents the table 4.4 conflict and the 99-point gap', () => {
    const tool = moduleTool(id);
    expect(tool.version).toBe('1.0.1');
    expect(tool.definition.limitations?.some((line) => line.includes('Табл. 4.4'))).toBe(true);
    expect(tool.definition.limitations?.some((line) => line.includes('99'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// VPH-SU  (2013 Указания, appendix table 8)
// ---------------------------------------------------------------------------------------------

const SU_ROWS: readonly Row[] = [
  select('chestTrauma', [0, 6, 8, 10]),
  select('pulseArrhythmia', [0, 8]),
  select('cvp', [0, 1]),
  select('ckmb', [0, 1]),
  select('ecgRhythm', [0, 7]),
  select('stElevation', [0, 10]),
  select('noR', [0, 9]),
  select('stDepression', [0, 6]),
];

describe('VPH-SU against Указания по ВПХ 2013, table 8', () => {
  const id = 'minimed.calculator.vph-su';
  it('scores every row of the printed table (maximum 52)', () => {
    expectTable(id, SU_ROWS);
    const all = Object.fromEntries(SU_ROWS.map((row) => [row.id, row.levels.at(-1)?.value ?? 0]));
    expect(out(run(id, all), 'score')).toBe(52);
  });

  it('applies the printed ≥15 threshold (95 % accuracy)', () => {
    // 14 = multiple rib fractures 6 + arrhythmia 8; 15 = the same plus CVP above 10 cm H2O (1)
    const fourteen = run(id, { ...baselineInputs(SU_ROWS), chestTrauma: 1, pulseArrhythmia: 1 });
    expect(out(fourteen, 'score')).toBe(14);
    expect(fourteen.rangeId).toBe('below-threshold');
    const fifteen = run(id, {
      ...baselineInputs(SU_ROWS),
      chestTrauma: 1,
      pulseArrhythmia: 1,
      cvp: 1,
    });
    expect(out(fifteen, 'score')).toBe(15);
    expect(fifteen.rangeId).toBe('contusion');
    expect(fifteen.explanation).toContain('95 %');
  });

  it('keeps the printed CK-MB threshold 12.5 but flags the unit as unresolved', () => {
    // Both official documents print «Менее/Более 12.5 ммоль/л» for CK-MB; that unit is
    // physiologically implausible and no primary source for the original unit was reachable.
    const ckmb = moduleTool(id).definition.inputs.find((input) => input.id === 'ckmb');
    expect(ckmb?.labelTooltip).toContain('ммоль/л');
  });
});

// ---------------------------------------------------------------------------------------------
// VPH-UL  (2013 Указания, appendix table 9)
// ---------------------------------------------------------------------------------------------

const UL_ROWS: readonly Row[] = [
  select('chestWall', [0, 1, 4, 8, 10]),
  select('bronchoscopy', [0, 10]),
  select('xray', [0, 6]),
  select('spo2', [0, 3, 6]),
  select('rrBand', [0, 3, 6]),
];

describe('VPH-UL against Указания по ВПХ 2013, table 9', () => {
  const id = 'minimed.calculator.vph-ul';
  it('scores every row of the printed table (maximum 38)', () => {
    expectTable(id, UL_ROWS);
    const all = Object.fromEntries(UL_ROWS.map((row) => [row.id, row.levels.at(-1)?.value ?? 0]));
    expect(out(run(id, all), 'score')).toBe(38);
  });

  it('applies the printed thresholds 9-20 (80 %) and 20 and more (90 %)', () => {
    expectBands(id, UL_ROWS, [
      [8, 'below-threshold'],
      [9, 'probable'],
      [19, 'probable'],
      // «от 9 до 20» and «20 и более» overlap at 20: the schema takes the higher-accuracy band
      [20, 'high'],
    ]);
    expect(run(id, inputsForScore(UL_ROWS, 9)).explanation).toContain('80 %');
    expect(run(id, inputsForScore(UL_ROWS, 20)).explanation).toContain('90 %');
  });
});

// ---------------------------------------------------------------------------------------------
// VPH-EH  (2013 Указания, appendix tables 10-11)
// ---------------------------------------------------------------------------------------------

const EH_ROWS: readonly Row[] = [
  // SBP >100 = 0, 90-100 = 2, <90 = 5
  numeric('sbp', [
    [120, 0],
    [101, 0],
    [100, 2],
    [90, 2],
    [89, 5],
  ]),
  // SpO2 >94 = 0, 93-90 = 3, <90 = 6
  numeric('spo2', [
    [98, 0],
    [94, 0],
    [93, 3],
    [90, 3],
    [89, 6],
  ]),
  // VPH-SP <20 = 0, 21-31 = 1, 32-45 = 2, >45 = 6 (20 itself is a gap; mapped to 0)
  numeric('sp', [
    [12, 0],
    [20, 0],
    [21, 1],
    [31, 1],
    [32, 2],
    [45, 2],
    [46, 6],
  ]),
  // Lee-White <16 = 0, 16-30 = 3, >30 or not determined = 6
  select('clottingBand', [0, 3, 6]),
];

describe('VPH-EH against Указания по ВПХ 2013, tables 10 and 11', () => {
  const id = 'minimed.calculator.vph-eh';
  it('scores every row of table 10 (maximum 23)', () => {
    expectTable(id, EH_ROWS);
    const worst = { sbp: 80, spo2: 80, sp: 60, clottingBand: 2 };
    expect(out(run(id, worst), 'score')).toBe(23);
  });

  it('assigns table 11 risk classes and complication rates', () => {
    expectBands(id, EH_ROWS, [
      [0, 'minimal'],
      [3, 'minimal'],
      [4, 'probable'],
      [5, 'probable'],
      [6, 'high'],
      [23, 'high'],
    ]);
    const minimal = run(id, inputsForScore(EH_ROWS, 3)).explanation ?? '';
    expect(minimal).toContain('2,5 %');
    expect(minimal).toContain('1,3 %');
    const probable = run(id, inputsForScore(EH_ROWS, 4)).explanation ?? '';
    expect(probable).toContain('3,8 %');
    expect(probable).toContain('2,5 %');
    const high = run(id, inputsForScore(EH_ROWS, 6)).explanation ?? '';
    expect(high).toContain('20,0 %');
    expect(high).toContain('13,8 %');
  });

  it('hand-computed case: SBP 95 (2) + SpO2 92 (3) + VPH-SP 35 (2) + clotting 20 min (3) = 10', () => {
    const result = run(id, { sbp: 95, spo2: 92, sp: 35, clottingBand: 1 });
    expect(out(result, 'score')).toBe(10);
    expect(result.rangeId).toBe('high');
  });
});
