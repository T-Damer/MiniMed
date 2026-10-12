import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/psychology.json';
const NEW_SLUGS = [
  'zung-self-rating-depression',
  'zung-self-rating-anxiety',
  'hamilton-depression-rating-scale',
] as const;

function registerModule(): void {
  for (const record of loadToolModuleRecords([MODULE_FILE])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
}

beforeAll(registerModule);
afterEach(() => {
  clearDownloadedAssessments();
  registerModule();
});

/** Answers that reach `total` points: start from the lowest score on every item, then raise items. */
function answersForTotal(definition: AssessmentDefinition, total: number): AssessmentAnswers {
  const answers: Record<string, AssessmentResponseValue> = {};
  const headroom: Array<{ id: string; lowest: number; highest: number; reverse: boolean }> = [];
  let lowestTotal = 0;
  for (const question of definition.questions) {
    const options = question.responseOptions ?? definition.responseOptions;
    const values = options.map((option) => option.value);
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    lowestTotal += lowest;
    headroom.push({ id: question.id, lowest, highest, reverse: question.reverse === true });
    // Contributing the lowest score: the lowest value for a normal item, the highest for a reversed one.
    answers[question.id] = question.reverse ? highest : lowest;
  }
  let remaining = total - lowestTotal;
  for (const item of headroom) {
    if (remaining <= 0) break;
    const room = item.highest - item.lowest;
    const add = Math.min(room, remaining);
    answers[item.id] = item.reverse ? item.highest - add : item.lowest + add;
    remaining -= add;
  }
  if (remaining !== 0) throw new Error(`Cannot reach total ${total}`);
  return answers as AssessmentAnswers;
}

async function scoreTotal(slug: string, total: number) {
  const definition = await loadAssessmentDefinition(slug);
  const result = scoreAssessment(definition, answersForTotal(definition, total));
  if (!result.ok) throw new Error(result.error);
  return {
    raw: result.value.scores[0]?.rawScore,
    range: result.value.evaluation?.verdict?.rangeId,
    explanation: result.value.evaluation?.verdict?.explanation,
  };
}

describe('psychiatry questionnaires in the psychology module', () => {
  it('validates the new records and attributes them to real publications', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly { slug: string }[];
    };
    for (const slug of NEW_SLUGS) {
      const raw = source.tools.find((tool) => tool.slug === slug);
      expect(raw, slug).toBeDefined();
      const record = ToolDefinitionRecordSchema.parse(raw);
      expect(record.kind).toBe('assessment');
      expect(record.bankId).toBe('psychiatry');
      expect(record.sources.length).toBeGreaterThan(0);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        if (link.url) expect(link.url).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/u);
      }
    }
  });

  describe('Zung Self-Rating Depression Scale (Zung 1965: 20 items, 10 reversed, raw 20–80)', () => {
    const slug = 'zung-self-rating-depression';
    it('reverses exactly items 2, 5, 6, 11, 12, 14, 16, 17, 18 and 20', async () => {
      const definition = await loadAssessmentDefinition(slug);
      expect(definition.questions).toHaveLength(20);
      const reversed = definition.questions
        .map((question, index) => (question.reverse ? index + 1 : 0))
        .filter(Boolean);
      expect(reversed).toEqual([2, 5, 6, 11, 12, 14, 16, 17, 18, 20]);
    });
    it('gives 50 for uniform answers because ten items are reversed', async () => {
      const definition = await loadAssessmentDefinition(slug);
      const rarely = Object.fromEntries(
        definition.questions.map((q) => [q.id, 1]),
      ) as AssessmentAnswers;
      const always = Object.fromEntries(
        definition.questions.map((q) => [q.id, 4]),
      ) as AssessmentAnswers;
      const low = scoreAssessment(definition, rarely);
      const high = scoreAssessment(definition, always);
      // 10 plain items at 1 + 10 reversed items at 4 = 50 on both sides.
      expect(low.ok && low.value.scores[0]?.rawScore).toBe(50);
      expect(high.ok && high.value.scores[0]?.rawScore).toBe(50);
    });
    it('cuts at index 50, 60 and 70 (raw 40, 48, 56)', async () => {
      const cases: ReadonlyArray<readonly [number, string]> = [
        [20, 'normal'],
        [39, 'normal'],
        [40, 'mild-moderate'],
        [47, 'mild-moderate'],
        [48, 'moderate-severe'],
        [55, 'moderate-severe'],
        [56, 'severe'],
        [80, 'severe'],
      ];
      for (const [total, range] of cases) {
        const scored = await scoreTotal(slug, total);
        expect(scored.raw, `total ${total}`).toBe(total);
        expect(scored.range, `total ${total}`).toBe(range);
      }
    });
  });

  describe('Zung Self-Rating Anxiety Scale (Zung 1971: 20 items, 5 reversed, raw 20–80)', () => {
    const slug = 'zung-self-rating-anxiety';
    it('reverses exactly items 5, 9, 13, 17 and 19', async () => {
      const definition = await loadAssessmentDefinition(slug);
      expect(definition.questions).toHaveLength(20);
      const reversed = definition.questions
        .map((question, index) => (question.reverse ? index + 1 : 0))
        .filter(Boolean);
      expect(reversed).toEqual([5, 9, 13, 17, 19]);
    });
    it('cuts at index 45 and 50 (raw 36 and 40)', async () => {
      const cases: ReadonlyArray<readonly [number, string]> = [
        [20, 'below'],
        [35, 'below'],
        [36, 'between'],
        [39, 'between'],
        [40, 'above'],
        [80, 'above'],
      ];
      for (const [total, range] of cases) {
        const scored = await scoreTotal(slug, total);
        expect(scored.raw, `total ${total}`).toBe(total);
        expect(scored.range, `total ${total}`).toBe(range);
      }
    });
  });

  describe('Hamilton Depression Rating Scale, 17 items (Hamilton 1960; Minzdrav 2024 bands)', () => {
    const slug = 'hamilton-depression-rating-scale';
    it('has nine items scored 0–4 and eight scored 0–2, total 0–52', async () => {
      const definition = await loadAssessmentDefinition(slug);
      expect(definition.questions).toHaveLength(17);
      const maxima = definition.questions.map((question) =>
        Math.max(...(question.responseOptions ?? []).map((option) => option.value)),
      );
      expect(maxima.filter((value) => value === 4)).toHaveLength(9);
      expect(maxima.filter((value) => value === 2)).toHaveLength(8);
      expect(maxima.reduce((sum, value) => sum + value, 0)).toBe(52);
    });
    it('cuts at 7, 8, 13, 14, 18, 19, 22 and 23', async () => {
      const cases: ReadonlyArray<readonly [number, string]> = [
        [0, 'normal'],
        [7, 'normal'],
        [8, 'mild'],
        [13, 'mild'],
        [14, 'moderate'],
        [18, 'moderate'],
        [19, 'severe'],
        [22, 'severe'],
        [23, 'very-severe'],
        [52, 'very-severe'],
      ];
      for (const [total, range] of cases) {
        const scored = await scoreTotal(slug, total);
        expect(scored.raw, `total ${total}`).toBe(total);
        expect(scored.range, `total ${total}`).toBe(range);
      }
    });
  });
});
