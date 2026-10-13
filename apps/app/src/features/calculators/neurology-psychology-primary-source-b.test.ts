import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentAnswers } from '@/features/assessments/assessment-types';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import {
  loadToolModuleCalculatorSchemas,
  loadToolModuleRecords,
} from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification of Karnofsky, Rivermead Mobility Index, Kerdo index, Ruffier index
 * (neurology-rehab module) and the Zung SDS / SAS (psychology module), 2026-10-13.
 *
 * What was actually read (the 1949 / 1965 / 1966 / 1971 / 1991 originals are paywalled or not online):
 *  - Karnofsky: the full 0-100 table with the A/B/C groups, reproduced in the open-access history
 *    article in Chronic Illn 2013 (PMC3837542), "Performance status as defined by
 *    Karnofsky, Burchenal and colleagues in 1948".
 *  - Rivermead: all 15 questions in the current Russian clinical recommendations "Ischaemic stroke
 *    and TIA" (ID 814, 2024), Appendix G6; "14 questions + 1 observation of standing for 10 s, yes = 1,
 *    no = 0, 0-15" in open-access BMC Neurol 2007 (PMC2169252).
 *  - Kerdo: formula KI = (1 - d/p) x 100 and the sign reading (zero eutonia, positive
 *    sympathicotonia, negative vagotonia) in the Russian clinical recommendations "Myopia" (ID 109,
 *    2024) section 2.2; the same reading at medi.ru/info/3979. The 1966 paper itself was not seen.
 *  - Ruffier: (P0 + P1 + P2 - 200) / 10 with P in beats/min and the 0 / 5 / 10 / 15 bands in Leunkeu,
 *    Shephard, Ahmaidi, HFJC 2014 (Table 1), the formulas in Sartor et al., PLoS One 2016 (PMC5154562) and
 *    PMC7473550; the (4 x (P1 + P2 + P3) - 200) / 10 form with 15-second counts and the same bands in a
 *    Russian teaching paper (elib.psu.by/bitstream/123456789/48880/1/175-177.pdf, 2025).
 *  - Zung: the 20 SDS and 20 SAS items and the reverse-scored sets in open tables (SDS: Medicina 2023,
 *    PMC10818784; SAS: Behav Sci 2023, PMC10451887); raw = index x 0.8 conversion and the cut-offs in
 *    Dunstan & Scott, Depress Res Treat 2018, Table 1 (PMC5828114), Dunstan et al., BMC Psychiatry 2017
 *    (PMC5591521) and Dunstan & Scott, BMC Psychiatry 2020 (PMC7048044).
 */
const NEURO = 'content/tool-modules/neurology-rehab.json';
const PSYCH = 'content/tool-modules/psychology.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([NEURO]);
type Inputs = Record<string, number | string>;

function run(name: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${name}`);
  if (!schema) throw new Error(`Missing calculator ${name}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error(`${name}: expected a numeric output`);
  return {
    score: output.value,
    range: result.evaluation.verdict?.rangeId,
    title: result.evaluation.verdict?.title,
    explanation: result.evaluation.verdict?.explanation,
  };
}

function schemaOf(name: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${name}`);
  if (!schema) throw new Error(`Missing calculator ${name}`);
  return schema;
}

describe('Karnofsky performance status against the 1948 table (PMC3837542)', () => {
  it('keeps the ten levels with the published wording and groups', () => {
    const level = schemaOf('karnofsky').inputs.find((input) => input.id === 'level');
    const options = level && 'options' in level ? (level.options ?? []) : [];
    expect(options.map((option) => option.value)).toEqual([
      100, 90, 80, 70, 60, 50, 40, 30, 20, 10,
    ]);
    const labels = options.map((option) => String(option.label));
    // 100 Normal; no complaints; no evidence of disease
    expect(labels[0]).toContain('жалоб нет, признаков болезни нет');
    // 60 Requires occasional assistance, but is able to care for most of his needs
    expect(labels[4]).toContain('периодической помощи');
    // 30 Severely disabled; hospitalisation is indicated although death not imminent
    expect(labels[7]).toContain('смерть не неизбежна');
    // 10 Moribund; fatal processes progressing rapidly
    expect(labels[9]).toContain('фатальные процессы быстро прогрессируют');
  });

  it('assigns groups A (80-100), B (50-70) and C (up to 40) at the boundaries', () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [100, 'group-a'],
      [90, 'group-a'],
      [80, 'group-a'],
      [70, 'group-b'],
      [60, 'group-b'],
      [50, 'group-b'],
      [40, 'group-c'],
      [30, 'group-c'],
      [20, 'group-c'],
      [10, 'group-c'],
    ];
    for (const [level, range] of cases) {
      const result = run('karnofsky', { level });
      expect(result.score, `level ${level}`).toBe(level);
      expect(result.range, `level ${level}`).toBe(range);
    }
    // Group A: "Able to carry on normal activity and to work. No special care is needed."
    expect(run('karnofsky', { level: 80 }).explanation).toContain('особый уход не нужен');
    // Group B: "Unable to work. Able to live at home, care for most personal needs."
    expect(run('karnofsky', { level: 70 }).explanation).toContain('не способен работать');
    // Group C: "Unable to care for self. Requires equivalent of institutional or hospital care.
    // Disease may be progressing rapidly."
    expect(run('karnofsky', { level: 40 }).explanation).toContain('быстро прогрессировать');
  });
});

describe('Rivermead Mobility Index (Collen 1991; items as in Russian clinical recommendations ID 814)', () => {
  const ITEMS_IN_ORDER = [
    'turnOver', // 1 turning over in bed
    'lyingToSitting', // 2 lying to sitting
    'sittingBalance', // 3 sitting balance, 10 s
    'sitToStand', // 4 sitting to standing, 15 s
    'standingUnsupported', // 5 standing unsupported, 10 s (the one observed item)
    'transfer', // 6 transfer
    'walkIndoors', // 7 walking indoors, with an aid if necessary
    'stairs', // 8 one flight of stairs
    'walkOutsideEven', // 9 walking outside, even ground
    'walkIndoorsNoAid', // 10 walking indoors, no aid
    'pickUp', // 11 picking off the floor
    'walkOutsideUneven', // 12 walking outside, uneven ground
    'bath', // 13 bathing
    'fourSteps', // 14 up and down four steps
    'run', // 15 running
  ] as const;

  it('has exactly the 15 published questions in the published order', () => {
    expect(schemaOf('rivermead-mobility').inputs.map((input) => input.id)).toEqual(ITEMS_IN_ORDER);
  });

  it('keeps the published distances, times and the observed standing item', () => {
    const label = (id: string) =>
      String(schemaOf('rivermead-mobility').inputs.find((input) => input.id === id)?.label);
    expect(label('sittingBalance')).toContain('10 секунд');
    expect(label('sitToStand')).toContain('15 секунд');
    expect(label('standingUnsupported')).toContain('10 секунд');
    expect(label('standingUnsupported')).toContain('наблюдение');
    expect(label('walkIndoors')).toContain('10 метров');
    expect(label('pickUp')).toContain('5 метров');
    expect(label('fourSteps')).toContain('4 ступеньки');
    expect(label('run')).toContain('4 секунды');
  });

  it('counts yes answers (0-15); a patient who walks indoors with an aid but not stairs scores 7', () => {
    const zeros = Object.fromEntries(ITEMS_IN_ORDER.map((id) => [id, 0])) as Inputs;
    expect(run('rivermead-mobility', zeros).score).toBe(0);
    // Items 1-7 yes (bed mobility, sitting, standing, transfer, 10 m with an aid): 7 points.
    const firstSeven = { ...zeros } as Inputs;
    for (const id of ITEMS_IN_ORDER.slice(0, 7)) firstSeven[id] = 1;
    expect(run('rivermead-mobility', firstSeven).score).toBe(7);
    const all = Object.fromEntries(ITEMS_IN_ORDER.map((id) => [id, 1])) as Inputs;
    expect(run('rivermead-mobility', all).score).toBe(15);
  });
});

describe('Kerdo vegetative index ((1 - DBP/HR) x 100; Russian clinical recommendations ID 109)', () => {
  it('computes the published formula', () => {
    // (1 - 80/72) x 100 = -11.11
    expect(run('kerdo-index', { diastolicBp: 80, heartRate: 72 }).score).toBeCloseTo(-100 / 9, 6);
    // (1 - 60/75) x 100 = 20
    expect(run('kerdo-index', { diastolicBp: 60, heartRate: 75 }).score).toBeCloseTo(20, 6);
  });

  it('reads the sign: positive sympathicotonia, zero eutonia, negative vagotonia', () => {
    expect(run('kerdo-index', { diastolicBp: 60, heartRate: 75 }).range).toBe('sympathicotonia');
    expect(run('kerdo-index', { diastolicBp: 72, heartRate: 72 })).toMatchObject({
      score: 0,
      range: 'eutonia',
    });
    expect(run('kerdo-index', { diastolicBp: 80, heartRate: 72 }).range).toBe('vagotonia');
    // One beat or one mmHg either side of zero flips the band: the sign is the only published cut.
    expect(run('kerdo-index', { diastolicBp: 71, heartRate: 72 }).range).toBe('sympathicotonia');
    expect(run('kerdo-index', { diastolicBp: 73, heartRate: 72 }).range).toBe('vagotonia');
  });
});

describe('Ruffier index ((P0 + P1 + P2 - 200) / 10 with beats per minute)', () => {
  it('equals the bpm formula when pulses are counted for 15 seconds', () => {
    // 15 s counts 18 / 33 / 22 = 72 / 132 / 88 bpm: (72 + 132 + 88 - 200) / 10 = 9.2
    const result = run('ruffier-index', { p0: 18, p1: 33, p2: 22 });
    expect(result.score).toBeCloseTo(9.2, 9);
    expect(result.range).toBe('average');
  });

  it('applies the HFJC 2014 Table 1 bands: <=0, 0.1-5, 5.1-10, 10.1-15, above 15', () => {
    // The athlete band is "0 or less"; 0.1 is the first "good" value (HFJC Table 1: <0, 0.1 to 5).
    const cases: ReadonlyArray<readonly [Inputs, number, string]> = [
      [{ p0: 15, p1: 20, p2: 15 }, 0, 'very-good'], // sum 50 -> (200 - 200) / 10 = 0
      [{ p0: 14, p1: 20, p2: 15 }, -0.4, 'very-good'], // sum 49 -> (196 - 200) / 10
      [{ p0: 15, p1: 20, p2: 16 }, 0.4, 'good'], // sum 51 -> (204 - 200) / 10
    ];
    for (const [inputs, expected, range] of cases) {
      const result = run('ruffier-index', inputs);
      expect(result.score).toBeCloseTo(expected, 9);
      expect(result.range).toBe(range);
    }
    // Upper edges (whole 15-second counts cannot hit 5.0 exactly from above, so use the nearest sums).
    // sum 62 -> 4.8 good; sum 63 -> 5.2 average; sum 75 -> 10 average; sum 76 -> 10.4 insufficient;
    // sum 87 -> 14.8 insufficient; sum 88 -> 15.2 poor.
    const edges: ReadonlyArray<readonly [number, number, string]> = [
      [62, 4.8, 'good'],
      [63, 5.2, 'average'],
      [75, 10, 'average'],
      [76, 10.4, 'insufficient'],
      [87, 14.8, 'insufficient'],
      [88, 15.2, 'poor'],
    ];
    for (const [sum, expected, range] of edges) {
      const result = run('ruffier-index', { p0: 20, p1: sum - 40, p2: 20 });
      expect(result.score, `sum ${sum}`).toBeCloseTo(expected, 9);
      expect(result.range, `sum ${sum}`).toBe(range);
    }
  });

  it('says that the Dickson index is a different formula', () => {
    const record = loadToolModuleRecords([NEURO]).find(
      (candidate) => candidate.id === 'minimed.calculator.ruffier-index',
    );
    const limitations = JSON.stringify(record?.definition['limitations']);
    expect(limitations).toContain('индекс Диксона');
    expect(limitations).toContain('P1 − 70');
    expect(record?.version).toBe('1.0.1');
  });
});

describe('Zung scales (psychology module)', () => {
  function registerModule(): void {
    for (const record of loadToolModuleRecords([PSYCH])) {
      if (record.kind === 'assessment') registerDownloadedAssessment(record);
    }
  }
  beforeAll(registerModule);
  afterEach(() => {
    clearDownloadedAssessments();
    registerModule();
  });

  async function rawAndRange(slug: string, response: (reverse: boolean, index: number) => number) {
    const definition = await loadAssessmentDefinition(slug);
    const answers = Object.fromEntries(
      definition.questions.map((question, index) => [
        question.id,
        response(question.reverse === true, index),
      ]),
    ) as AssessmentAnswers;
    const result = scoreAssessment(definition, answers);
    if (!result.ok) throw new Error(result.error);
    return {
      raw: result.value.scores[0]?.rawScore,
      range: result.value.evaluation?.verdict?.rangeId,
    };
  }

  it('SDS: prompts, reverse set and 1-4 scoring follow the published 20 items', async () => {
    const definition = await loadAssessmentDefinition('zung-self-rating-depression');
    expect(definition.questions).toHaveLength(20);
    expect(
      definition.questions.map((question, i) => (question.reverse ? i + 1 : 0)).filter(Boolean),
    ).toEqual([2, 5, 6, 11, 12, 14, 16, 17, 18, 20]);
    expect(definition.responseOptions.map((option) => option.value)).toEqual([1, 2, 3, 4]);
    // Item 19, the suicidal-ideation item, stays a plain (not reversed) item.
    expect(definition.questions[18]?.reverse).toBeUndefined();
    expect(definition.questions[18]?.prompt).toContain('другим было бы лучше');
  });

  it('SDS worked examples: raw sum, index = raw x 1.25 and the bands of Dunstan & Scott Table 1', async () => {
    // Every answer "often" (3): 10 plain x 3 + 10 reversed x (5 - 3) = 30 + 20 = 50 -> index 62.5
    const often = await rawAndRange('zung-self-rating-depression', () => 3);
    expect(often).toEqual({ raw: 50, range: 'moderate-severe' });
    // Plain items 4, reversed items 1 -> 10 x 4 + 10 x 4 = 80 -> index 100
    const worst = await rawAndRange('zung-self-rating-depression', (reverse) => (reverse ? 1 : 4));
    expect(worst).toEqual({ raw: 80, range: 'severe' });
    // Plain items 1, reversed items 4 -> 10 x 1 + 10 x 1 = 20 -> index 25
    const best = await rawAndRange('zung-self-rating-depression', (reverse) => (reverse ? 4 : 1));
    expect(best).toEqual({ raw: 20, range: 'normal' });
  });

  it('SDS: index 50 / 60 / 70 equal raw 40 / 48 / 56, never the index applied to the raw sum', async () => {
    // index = raw / 80 x 100: 39 -> 48.75, 40 -> 50.0, 47 -> 58.75, 48 -> 60.0, 55 -> 68.75, 56 -> 70.0
    const cases: ReadonlyArray<readonly [number, string]> = [
      [39, 'normal'],
      [40, 'mild-moderate'],
      [47, 'mild-moderate'],
      [48, 'moderate-severe'],
      [55, 'moderate-severe'],
      [56, 'severe'],
    ];
    const definition = await loadAssessmentDefinition('zung-self-rating-depression');
    for (const [raw, range] of cases) {
      // reach `raw` with plain items 1 and reversed items 4 (raw 20), then raise plain items.
      const answers: Record<string, number> = {};
      let remaining = raw - 20;
      for (const question of definition.questions) {
        if (question.reverse) {
          answers[question.id] = 4;
        } else {
          const add = Math.min(3, remaining);
          answers[question.id] = 1 + add;
          remaining -= add;
        }
      }
      // plain items give at most 10 x 3 = 30 extra; any remainder raises reversed items downward.
      for (const question of definition.questions) {
        if (remaining <= 0) break;
        if (question.reverse) {
          const add = Math.min(3, remaining);
          answers[question.id] = 4 - add;
          remaining -= add;
        }
      }
      const result = scoreAssessment(definition, answers as AssessmentAnswers);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.scores[0]?.rawScore, `raw ${raw}`).toBe(raw);
      expect(result.value.evaluation?.verdict?.rangeId, `raw ${raw}`).toBe(range);
      expect(raw * 1.25 >= 50, `index of raw ${raw}`).toBe(range !== 'normal');
    }
  });

  it('SAS: prompts, reverse set and worked examples follow the published 20 items', async () => {
    const definition = await loadAssessmentDefinition('zung-self-rating-anxiety');
    expect(definition.questions).toHaveLength(20);
    expect(
      definition.questions.map((question, i) => (question.reverse ? i + 1 : 0)).filter(Boolean),
    ).toEqual([5, 9, 13, 17, 19]);
    // Every answer "sometimes" (2): 15 plain x 2 + 5 reversed x (5 - 2) = 30 + 15 = 45 -> index 56.25
    expect(await rawAndRange('zung-self-rating-anxiety', () => 2)).toEqual({
      raw: 45,
      range: 'above',
    });
    // Plain items 1, reversed items 4 -> 15 x 1 + 5 x 1 = 20 -> index 25
    expect(await rawAndRange('zung-self-rating-anxiety', (reverse) => (reverse ? 4 : 1))).toEqual({
      raw: 20,
      range: 'below',
    });
    // Plain items 4, reversed items 1 -> 15 x 4 + 5 x 4 = 80 -> index 100
    expect(await rawAndRange('zung-self-rating-anxiety', (reverse) => (reverse ? 1 : 4))).toEqual({
      raw: 80,
      range: 'above',
    });
  });

  it('SAS: cut-offs are the raw sums 36 (index 45, Zung 1980) and 40 (index 50, Zung 1971)', async () => {
    // raw / 80 x 100: 35 -> 43.75, 36 -> 45.0, 39 -> 48.75, 40 -> 50.0
    const definition = await loadAssessmentDefinition('zung-self-rating-anxiety');
    const cases: ReadonlyArray<readonly [number, string]> = [
      [35, 'below'],
      [36, 'between'],
      [39, 'between'],
      [40, 'above'],
    ];
    for (const [raw, range] of cases) {
      const answers: Record<string, number> = {};
      let remaining = raw - 20;
      for (const question of definition.questions) {
        const add = Math.min(3, remaining);
        // plain item: 1 + add; reversed item 4 contributes 1, lowered answers contribute more.
        answers[question.id] = question.reverse ? 4 - add : 1 + add;
        remaining -= add;
      }
      const result = scoreAssessment(definition, answers as AssessmentAnswers);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.scores[0]?.rawScore, `raw ${raw}`).toBe(raw);
      expect(result.value.evaluation?.verdict?.rangeId, `raw ${raw}`).toBe(range);
    }
  });

  it('keeps the module files readable as JSON with the cited conversions', () => {
    const source = readFileSync(resolve(process.cwd(), PSYCH), 'utf8');
    expect(source).toContain('индекс = сумма × 1,25');
  });
});
