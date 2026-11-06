import { anyAgeScope } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  assessmentTallies,
  formatCompletedAssessment,
  scoreAssessment,
} from '@/features/assessments/assessment-engine';
import {
  firstUnansweredIndex,
  questionPageCount,
  questionPageOf,
  questionPageRange,
} from '@/features/assessments/assessment-paging';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

/** A keyed inventory in miniature: items answered true/false/«?», two counted scales, a corrected
 *  score that uses the first, a standard score that uses the corrected one, and a table. */
const definition: AssessmentDefinition = {
  schemaVersion: 2,
  id: 'test.keyed',
  slug: 'test-keyed',
  title: 'Ключевой опросник',
  shortTitle: 'Ключевой',
  aliases: [],
  bankId: 'psychology',
  bankLabel: 'Психология',
  category: 'self-reflection',
  description: 'Проверка шагов подсчёта.',
  estimatedMinutes: 1,
  audience: 'Взрослые',
  ageScope: anyAgeScope('тест'),
  responseOptions: [
    { value: 1, label: 'Верно', shortLabel: 'В' },
    { value: 0, label: 'Неверно', shortLabel: 'Н' },
    { value: 2, label: 'Не знаю', shortLabel: '?' },
  ],
  pageSize: 2,
  scales: [
    { id: 'items', label: 'Ответы', shortLabel: 'Ответы', description: 'все', context: true },
    {
      id: 'k-raw',
      label: 'K сырой',
      shortLabel: 'K',
      description: 'пункты 1 (верно) и 2 (неверно)',
      formula: '(answer_q1 == 1) + (answer_q2 == 0)',
      hidden: true,
    },
    {
      id: 'a-raw',
      label: 'A сырой',
      shortLabel: 'A',
      description: 'пункты 3 и 4 (верно)',
      formula: '(answer_q3 == 1) + (answer_q4 == 1) + (answer_q5 == 1)',
      hidden: true,
    },
    {
      id: 'a-corrected',
      label: 'A + 0,5K',
      shortLabel: 'A+K',
      description: 'коррекция',
      formula: 'score_a_raw + round(0.5 * score_k_raw)',
      hidden: true,
    },
    {
      id: 'a-t',
      label: 'A, T-балл',
      shortLabel: 'A (T)',
      description: 'линейный T',
      formula: 'round(50 + 10 * (score_a_corrected - 2) / 1)',
      hidden: true,
    },
  ],
  questions: ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => ({
    id,
    prompt: `Утверждение ${id}`,
    scaleId: 'items',
  })),
  interpretations: [{ when: 'score_a_t >= 0', headline: 'Профиль', message: 'Т-баллы ниже.' }],
  tallies: [
    {
      id: 'unknown',
      value: 2,
      label: 'Не знаю',
      warnAt: 2,
      warning: 'Слишком много ответов «не знаю».',
    },
  ],
  tables: [
    {
      id: 'scores',
      title: 'Баллы',
      columns: ['Сырой', '+K', 'T'],
      rows: [{ label: 'A', cells: ['score_a_raw', 'score_a_corrected', 'score_a_t'] }],
    },
  ],
  disclaimer: 'Тест.',
  evidenceNote: 'Тест.',
  license: { kind: 'project-original', notice: 'Тест.' },
};

describe('chained scale formulas', () => {
  it('counts keyed answers, corrects by an earlier scale and converts to a standard score', () => {
    const result = scoreAssessment(definition, { q1: 1, q2: 0, q3: 1, q4: 1, q5: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // K = 2, A = 2, A + round(0.5 × 2) = 3, T = 50 + 10 × (3 − 2) = 60.
    expect(result.value.tables?.[0]?.rows[0]?.cells).toEqual([2, 3, 60]);
    // Hidden steps and the context scale are not listed as scores.
    expect(result.value.scores).toEqual([]);
    expect(result.value.headline).toBe('Профиль');
    expect(result.value.tallies).toEqual([{ id: 'unknown', label: 'Не знаю', count: 1 }]);
  });

  it('warns once the tally reaches its level, in the result and in its text', () => {
    const result = scoreAssessment(definition, { q1: 2, q2: 0, q3: 1, q4: 1, q5: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tallies?.[0]?.warning).toBe('Слишком много ответов «не знаю».');
    const text = formatCompletedAssessment(definition, result.value);
    expect(text).toContain('Не знаю: 2. Слишком много ответов «не знаю».');
    expect(text).toContain('Баллы (Сырой · +K · T):');
    expect(text).toContain('- A: 2 · 3 · 60');
    expect(
      formatCompletedAssessment(definition, result.value, '', { tablesAsText: false }),
    ).not.toContain('Баллы (');
  });

  it('counts tallies on a draft as well', () => {
    expect(assessmentTallies(definition, { q1: 2 })).toEqual([
      { id: 'unknown', label: 'Не знаю', count: 1 },
    ]);
  });

  it('fails the scoring on a broken table cell instead of printing a wrong number', () => {
    const broken: AssessmentDefinition = {
      ...definition,
      tables: [
        {
          id: 'x',
          title: 'Сломано',
          columns: ['A'],
          rows: [{ label: 'A', cells: ['score_none'] }],
        },
      ],
    };
    const result = scoreAssessment(broken, { q1: 1, q2: 0, q3: 1, q4: 1, q5: 2 });
    expect(result.ok).toBe(false);
  });
});

describe('question pages', () => {
  it('splits the questions by pageSize and resumes on the first unanswered one', () => {
    expect(questionPageCount(definition)).toBe(3);
    expect(questionPageRange(definition, 2)).toEqual({ start: 4, end: 5 });
    expect(firstUnansweredIndex(definition, { q1: 1, q2: 0, q3: 1 })).toBe(3);
    expect(questionPageOf(definition, 3)).toBe(1);
    expect(firstUnansweredIndex(definition, { q1: 1, q2: 0, q3: 1, q4: 1, q5: 0 })).toBe(4);
  });

  it('keeps one page without pageSize', () => {
    const { pageSize: _unused, ...unpaged } = definition;
    expect(questionPageCount(unpaged)).toBe(1);
    expect(questionPageRange(unpaged, 0)).toEqual({ start: 0, end: 5 });
  });
});
