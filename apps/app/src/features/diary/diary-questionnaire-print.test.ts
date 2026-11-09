import { describe, expect, it } from 'vitest';

import { diaryQuestionnairePrintHtml } from '@/features/diary/diary-questionnaire-print';

const questions = [
  { prompt: 'Мало интереса или удовольствия', options: ['Ни разу', 'Несколько дней'] },
  { prompt: 'Подавленность', options: ['Ни разу', 'Несколько дней'] },
];

describe('a diary questionnaire on paper', () => {
  it('prints a blank with empty boxes and a date line', () => {
    const html = diaryQuestionnairePrintHtml({ title: 'PHQ-9', questions });
    expect(html).toContain('Дата: ____________');
    expect(html).not.toContain('class="option option--on"');
    expect(html.match(/class="box"/gu)).toHaveLength(4);
  });

  it('marks the answers; the result prints only when given (the doctor’s copy)', () => {
    const filled = questions.map((question) => ({ ...question, answer: 'Несколько дней' }));
    const patient = diaryQuestionnairePrintHtml({
      title: 'PHQ-9',
      questions: filled,
      at: '2026-11-09T10:00:00Z',
    });
    expect(patient.match(/class="option option--on"/gu)).toHaveLength(2);
    expect(patient).not.toContain('class="result"');
    const doctor = diaryQuestionnairePrintHtml({
      title: 'PHQ-9',
      questions: filled,
      result: '2 из 27 · Минимальная',
    });
    expect(doctor).toContain('2 из 27 · Минимальная');
  });

  it('escapes what it prints', () => {
    const html = diaryQuestionnairePrintHtml({
      title: '<b>x</b>',
      questions: [{ prompt: '<i>', options: [], answer: '<script>' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
