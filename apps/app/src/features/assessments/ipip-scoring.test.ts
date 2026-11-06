import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assessmentDefinitionFromRecord } from '@/features/assessments/assessment-definition';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

/** IPIP 50-item Big-Five markers against the IPIP key (`content/tool-sources/ipip-bfm-50`). */
const source = JSON.parse(
  readFileSync(resolve(process.cwd(), 'content/tool-sources/ipip-bfm-50/items.json'), 'utf8'),
) as { items: { n: number; factor: number; keyed: '+' | '-'; en: string; ru: string }[] };
const records = loadToolModuleRecords(['content/tool-modules/psychology.json']);
const load = (id: string) => {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`No ${id}`);
  return assessmentDefinitionFromRecord(record);
};

describe('IPIP-50', () => {
  const russian = load('minimed.assessment.ipip-bfm-50');
  const english = load('minimed.assessment.ipip-bfm-50-en');

  it('keeps the IPIP order, factors and keys in both languages with the same question ids', () => {
    expect(russian.questions.map((question) => question.id)).toEqual(
      english.questions.map((question) => question.id),
    );
    expect(english.questions.map((question) => question.prompt)).toEqual(
      source.items.map((item) => item.en),
    );
    expect(russian.questions.map((question) => question.reverse === true)).toEqual(
      source.items.map((item) => item.keyed === '-'),
    );
    expect(russian.variants?.map((variant) => variant.assessmentId)).toEqual([
      russian.id,
      english.id,
    ]);
  });

  it('scores +keyed items 1–5 and −keyed items 5–1, ten items per factor', () => {
    // «Very Accurate» on every item: each factor gets 5 per +keyed and 1 per −keyed item.
    const answers = Object.fromEntries(russian.questions.map((question) => [question.id, 5]));
    const result = scoreAssessment(russian, answers);
    if (!result.ok) throw new Error(result.error);
    for (const factor of [1, 2, 3, 4, 5]) {
      const items = source.items.filter((item) => item.factor === factor);
      expect(items).toHaveLength(10);
      const expected = items.reduce((sum, item) => sum + (item.keyed === '+' ? 5 : 1), 0);
      const scaleId = russian.scales[factor - 1]?.id;
      expect(result.value.scores.find((score) => score.scaleId === scaleId)?.rawScore).toBe(
        expected,
      );
    }
  });
});
