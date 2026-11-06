import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assessmentDefinitionFromRecord } from '@/features/assessments/assessment-definition';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  ScoredAssessment,
} from '@/features/assessments/assessment-types';
import { evaluateCalculatorExpression } from '@/features/calculators/calculator-expression';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

/**
 * СМИЛ (Собчик, 2003) checked against the book itself: the keys of pp. 142–144, the K table and the
 * raw-score marks of the profile sheets on pp. 215–216, as transcribed in
 * `content/tool-sources/smil-sobchik-2003/`.
 */
type Sex = 'male' | 'female';
const source = <T>(name: string): T =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), 'content/tool-sources/smil-sobchik-2003', name), 'utf8'),
  ) as T;
const keys = source<{ scales: Record<string, { true: number[]; false: number[] }> }>(
  'keys.json',
).scales;
const norms = source<{
  kCorrection: { table: Record<string, { '0.5': number; '0.4': number; '0.2': number }> };
  meansAndSds: { sheetMarks: Record<Sex, Record<string, [number, number][]>> };
}>('norms.json');

const records = loadToolModuleRecords(['content/tool-modules/mmpi.json']);
const definitionOf = (sex: Sex): AssessmentDefinition => {
  const record = records.find(
    (candidate) =>
      candidate.id ===
      (sex === 'male' ? 'minimed.assessment.smil-men' : 'minimed.assessment.smil-women'),
  );
  if (!record) throw new Error(`No СМИЛ ${sex} definition`);
  return assessmentDefinitionFromRecord(record);
};

const PROFILE = ['L', 'F', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
const K_SHARE: Partial<Record<(typeof PROFILE)[number], '0.5' | '0.4' | '1' | '0.2'>> = {
  '1': '0.5',
  '4': '0.4',
  '7': '1',
  '8': '1',
  '9': '0.2',
};

function answerAll(definition: AssessmentDefinition, value: number): AssessmentAnswers {
  return Object.fromEntries(definition.questions.map((question) => [question.id, value]));
}

function profileRows(result: ScoredAssessment): Map<string, readonly (number | null)[]> {
  const table = result.tables?.find((candidate) => candidate.id === 'profile');
  if (!table) throw new Error('No profile table');
  return new Map(table.rows.map((row, index) => [PROFILE[index] as string, row.cells] as const));
}

/** The T the profile sheet shows for a raw score: straight between its two nearest marks. */
function sheetT(sex: Sex, scale: string, raw: number): number {
  const marks = [...(norms.meansAndSds.sheetMarks[sex][scale] ?? [])].sort((a, b) => a[0] - b[0]);
  const below = marks.filter(([x]) => x <= raw).at(-1) ?? marks[0];
  const above = marks.find(([x]) => x >= raw) ?? marks.at(-1);
  if (!below || !above) throw new Error(`No marks for ${sex} ${scale}`);
  if (above[0] === below[0]) return below[1];
  return below[1] + ((above[1] - below[1]) * (raw - below[0])) / (above[0] - below[0]);
}

/** Raw score straight from the printed key, as a scorer with the stencil would count it. */
function keyedRaw(scale: string, sex: Sex, answers: (n: number) => number): number {
  const key = keys[scale === '5' ? `5-${sex}` : scale];
  if (!key) throw new Error(`No key ${scale}`);
  return (
    key.true.filter((n) => answers(n) === 1).length +
    key.false.filter((n) => answers(n) === 0).length
  );
}

function expectedProfile(sex: Sex, answer: (n: number) => number) {
  const k = keyedRaw('K', sex, answer);
  const share = norms.kCorrection.table[String(k)];
  if (!share) throw new Error(`No K row ${k}`);
  return PROFILE.map((scale) => {
    const raw = keyedRaw(scale, sex, answer);
    const fraction = K_SHARE[scale];
    const corrected = fraction === undefined ? raw : raw + (fraction === '1' ? k : share[fraction]);
    return { scale, raw, corrected };
  });
}

describe('СМИЛ: raw → +K → T against the book', () => {
  for (const sex of ['male', 'female'] as const) {
    for (const [label, value] of [
      ['all «Верно»', 1],
      ['all «Неверно»', 0],
    ] as const) {
      it(`${sex}, ${label}: keys, K table and profile sheet agree`, () => {
        const definition = definitionOf(sex);
        const result = scoreAssessment(definition, answerAll(definition, value));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = profileRows(result.value);
        for (const expected of expectedProfile(sex, () => value)) {
          const [raw, corrected, t] = rows.get(expected.scale) ?? [];
          expect(raw, `${sex} ${expected.scale} raw`).toBe(expected.raw);
          expect(corrected, `${sex} ${expected.scale} +K`).toBe(expected.corrected);
          // The sheet is drawn by hand; the formula stays within 1,5 T of its marks.
          const fromSheet = sheetT(sex, expected.scale, expected.corrected);
          const inRange = (norms.meansAndSds.sheetMarks[sex][expected.scale] ?? []).some(
            ([x]) => x <= expected.corrected,
          );
          const aboveRange = (norms.meansAndSds.sheetMarks[sex][expected.scale] ?? []).some(
            ([x]) => x >= expected.corrected,
          );
          if (inRange && aboveRange) {
            expect(
              Math.abs((t ?? 0) - fromSheet),
              `${sex} ${expected.scale} T`,
            ).toBeLessThanOrEqual(1.5);
          }
        }
      });
    }
  }

  it('worked example (men, all «Верно»): raw → +K → T', () => {
    // K = 1 (item 96): 0,5K = 1, 0,4K = 1 (sheet table, p. 215), 0,2K = 0. T by hand with the men's
    // M and σ: K 50 + 10·(1 − 12,46)/5,31 = 28,4; 1: (12 − 11,28)/3,91 → 51,8; 4: (25 − 18,82)/4,25 →
    // 64,5; 7: (39 − 22,9)/4,91 → 82,8; 8: (60 − 22,28)/5,21 → 122,4; 9: (35 − 16,8)/3,98 → 95,7.
    // The sheet reads K 28,4, 1 51,8, 4 64,0, 7 82,6, 9 95,5 at these raw scores.
    const definition = definitionOf('male');
    const result = scoreAssessment(definition, answerAll(definition, 1));
    if (!result.ok) throw new Error(result.error);
    const rows = profileRows(result.value);
    expect(rows.get('K')).toEqual([1, 1, 28]);
    expect(rows.get('1')).toEqual([11, 12, 52]);
    expect(rows.get('4')).toEqual([24, 25, 65]);
    expect(rows.get('7')).toEqual([38, 39, 83]);
    expect(rows.get('8')).toEqual([59, 60, 122]);
    expect(rows.get('9')).toEqual([35, 35, 96]);
  });

  it('every printed mark of both profile sheets is within 1,5 T of the formula', () => {
    for (const sex of ['male', 'female'] as const) {
      const definition = definitionOf(sex);
      for (const [scale, marks] of Object.entries(norms.meansAndSds.sheetMarks[sex])) {
        if (scale === '?') continue;
        const id = scale.toLowerCase();
        const formula = definition.scales.find((candidate) => candidate.id === `t-${id}`)?.formula;
        expect(formula, `${sex} ${scale}`).toBeDefined();
        for (const [raw, t] of marks) {
          const value = evaluateCalculatorExpression(formula ?? '', { [`score_corr_${id}`]: raw });
          if (typeof value !== 'number') throw new Error(`${sex} ${scale}: no number`);
          expect(Math.abs(value - t), `${sex} ${scale} raw ${raw}`).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('takes the K fractions from the profile sheet table', () => {
    const definition = definitionOf('female');
    for (const [k, share] of Object.entries(norms.kCorrection.table)) {
      // Answer K items so that K = k: item 96 «Верно» counts first, then «Неверно» on the rest.
      const kItems = [96, ...(keys['K']?.false ?? [])].slice(0, Number(k));
      const answers: Record<string, number> = answerAll(definition, 2);
      for (const n of kItems) answers[`smil-${String(n).padStart(3, '0')}`] = n === 96 ? 1 : 0;
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      const rows = profileRows(result.value);
      const raw1 = rows.get('1')?.[0] ?? 0;
      const raw4 = rows.get('4')?.[0] ?? 0;
      const raw9 = rows.get('9')?.[0] ?? 0;
      expect(rows.get('K')?.[0], `K ${k}`).toBe(Number(k));
      expect((rows.get('1')?.[1] ?? 0) - raw1, `0,5K at ${k}`).toBe(share['0.5']);
      expect((rows.get('4')?.[1] ?? 0) - raw4, `0,4K at ${k}`).toBe(share['0.4']);
      expect((rows.get('9')?.[1] ?? 0) - raw9, `0,2K at ${k}`).toBe(share['0.2']);
    }
  });

  it('counts «Не знаю» and checks the 27 «обвести кружочком» items', () => {
    const definition = definitionOf('male');
    const allUnknown = scoreAssessment(definition, answerAll(definition, 2));
    if (!allUnknown.ok) throw new Error(allUnknown.error);
    expect(allUnknown.value.tallies).toEqual([
      expect.objectContaining({ id: 'unknown', count: 566, warning: expect.any(String) }),
    ]);
    expect(allUnknown.value.headline).toBe('Профиль недостоверен: слишком много ответов «Не знаю»');
    expect(allUnknown.value.alerts?.map((alert) => alert.id)).toContain('cannot-say-invalid');
    expect(allUnknown.value.alerts?.map((alert) => alert.id)).not.toContain('missed-checks');

    const allTrue = scoreAssessment(definition, answerAll(definition, 1));
    if (!allTrue.ok) throw new Error(allTrue.error);
    expect(allTrue.value.alerts?.map((alert) => alert.id)).toContain('missed-checks');
    const checks = definition.questions.filter((question) =>
      question.prompt.includes('обвести кружочком'),
    );
    expect(checks).toHaveLength(27);
  });

  it('draws the profile from the T scores', () => {
    const definition = definitionOf('female');
    const result = scoreAssessment(definition, answerAll(definition, 0));
    if (!result.ok) throw new Error(result.error);
    const chart = result.value.visuals?.[0];
    const rows = profileRows(result.value);
    expect(chart?.labels).toEqual([...PROFILE]);
    expect(chart?.datasets[0]?.data).toEqual(PROFILE.map((scale) => rows.get(scale)?.[2]));
  });
});
