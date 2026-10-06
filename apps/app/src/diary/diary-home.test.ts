import { describe, expect, it } from 'vitest';

import {
  dayLabel,
  groupEntriesByDay,
  lastEntrySummary,
  periodLabel,
  sendDescription,
  sendSummary,
  todaySummary,
  whenLabel,
} from '@/diary/diary-home';
import { inputModeFor, numberProblem, numberProblems, rangeHint } from '@/diary/diary-validation';
import type { DiaryField, DiaryInvitation } from '@/features/diary/diary-model';
import { DIARY_FORMAT_VERSION, diaryTemplate } from '@/features/diary/diary-model';

// Local noon on 6 October 2026: every helper reads the local calendar day.
const NOW = new Date(2026, 9, 6, 12, 0, 0);

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 9, day, hour, minute).toISOString();
}

function entry(id: string, iso: string) {
  return { id, at: iso, values: { systolic: 120, diastolic: 80 } };
}

describe('sendSummary', () => {
  it('says there is nothing to send before the first entry', () => {
    expect(sendSummary({ total: 0, unsent: 0, changed: 0, sentAt: undefined })).toEqual({
      tone: 'empty',
      text: 'Записей пока нет',
      pending: 0,
    });
  });

  it('counts every entry as unsent until the doctor has had something', () => {
    expect(sendSummary({ total: 3, unsent: 3, changed: 0, sentAt: undefined })).toEqual({
      tone: 'pending',
      text: 'Не отправлено: 3 записи',
      pending: 3,
    });
    expect(sendSummary({ total: 1, unsent: 1, changed: 0, sentAt: undefined }).text).toBe(
      'Не отправлено: 1 запись',
    );
  });

  it('names the day of the last hand-over when everything is sent', () => {
    const summary = sendSummary({ total: 5, unsent: 0, changed: 0, sentAt: at(5, 9) });
    expect(summary.tone).toBe('done');
    expect(summary.text).toBe('Всё отправлено 5 окт.');
  });

  it('counts new and edited entries together after a hand-over', () => {
    const summary = sendSummary({ total: 5, unsent: 2, changed: 1, sentAt: at(5, 9) });
    expect(summary).toMatchObject({ tone: 'pending', text: 'Не отправлено: 3 записи', pending: 3 });
  });
});

describe('days', () => {
  it('labels today, yesterday and older days', () => {
    expect(dayLabel(at(6, 8), NOW)).toEqual({ title: 'Сегодня', date: '6 октября', today: true });
    expect(dayLabel(at(5, 23), NOW)).toEqual({
      title: 'Вчера',
      date: '5 октября',
      today: false,
    });
    expect(dayLabel(at(3, 8), NOW)).toEqual({
      title: 'Суббота',
      date: '3 октября',
      today: false,
    });
  });

  it('says when an entry was made in words', () => {
    expect(whenLabel(at(6, 7, 55), NOW)).toBe('сегодня в 07:55');
    expect(whenLabel(at(5, 8, 10), NOW)).toBe('вчера в 08:10');
    expect(whenLabel(at(2, 8, 10), NOW)).toBe('2 октября в 08:10');
  });

  it('groups newest day first and newest entry first, with today marked', () => {
    const days = groupEntriesByDay(
      [
        entry('a', at(4, 8)),
        entry('b', at(6, 7)),
        entry('c', at(6, 19)),
        entry('d', at(5, 8)),
        entry('e', at(4, 20)),
      ],
      NOW,
    );
    expect(days.map((day) => day.label.title)).toEqual(['Сегодня', 'Вчера', 'Воскресенье']);
    expect(days.map((day) => day.entries.map((item) => item.id))).toEqual([
      ['c', 'b'],
      ['d'],
      ['e', 'a'],
    ]);
    expect(days[0]?.label.today).toBe(true);
  });

  it('summarises today and the newest entry', () => {
    expect(todaySummary([], NOW)).toBe('Сегодня записей ещё нет');
    expect(todaySummary([entry('a', at(5, 8))], NOW)).toBe('Сегодня записей ещё нет');
    expect(todaySummary([entry('a', at(6, 7, 5)), entry('b', at(6, 9, 30))], NOW)).toBe(
      'Сегодня: 2 записи, последняя в 09:30',
    );
    expect(lastEntrySummary([], NOW)).toBe('Пока пусто');
    expect(lastEntrySummary([entry('a', at(5, 8)), entry('b', at(3, 8))], NOW)).toBe(
      'Последняя: вчера в 08:00',
    );
  });
});

describe('what is sent', () => {
  const entries = [entry('a', at(2, 8)), entry('b', at(6, 7))];

  it('names the period of the records', () => {
    expect(periodLabel(entries)).toBe('2 окт. – 6 окт.');
    expect(periodLabel([entry('a', at(6, 7)), entry('b', at(6, 19))])).toBe('6 октября');
    expect(periodLabel([])).toBe('');
  });

  it('tells a patient who has never sent anything what goes to the doctor', () => {
    expect(sendDescription({ total: 2, unsent: 2, changed: 0, sentAt: undefined }, entries)).toBe(
      'Все записи: 2 записи, за 2 окт. – 6 окт. Врачу пока ничего не отправлено.',
    );
  });

  it('tells what the doctor already has and what is new since', () => {
    expect(
      sendDescription({ total: 2, unsent: 1, changed: 0, sentAt: at(4, 9) }, entries),
    ).toContain('Врач получил записи 4 окт. С тех пор новых или изменённых: 1.');
    expect(
      sendDescription({ total: 2, unsent: 0, changed: 0, sentAt: at(6, 9) }, entries),
    ).toContain('Всё это уже отправлено 6 окт.');
  });
});

describe('number validation', () => {
  const template = diaryTemplate('blood-pressure');
  if (!template) throw new Error('Template missing.');
  const invitation: DiaryInvitation = {
    v: DIARY_FORMAT_VERSION,
    id: 'abcdef123456',
    template: template.id,
    title: template.title,
    issuedAt: at(5, 8),
    fields: template.fields,
  };
  const field = (id: string): DiaryField => {
    const found = invitation.fields.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`No field ${id}`);
    return found;
  };

  it('asks for a required field and accepts an empty optional one', () => {
    expect(numberProblem(field('systolic'), '')).toBe('Заполните это поле.');
    expect(numberProblem(field('pulse'), '  ')).toBeUndefined();
  });

  it('refuses text and accepts a comma or spaces', () => {
    expect(numberProblem(field('systolic'), 'сто двадцать')).toBe(
      'Введите число цифрами, например 120.',
    );
    expect(numberProblem(field('systolic'), '12o')).toBe('Введите число цифрами, например 120.');
    expect(numberProblem(field('systolic'), ' 120 ')).toBeUndefined();
  });

  it('tells the range and what to check when the number is off', () => {
    expect(numberProblem(field('systolic'), '1200')).toBe(
      'Допустимо от 50 до 300 мм рт. ст. Проверьте, нет ли лишней цифры.',
    );
    expect(numberProblem(field('systolic'), '12')).toBe(
      'Допустимо от 50 до 300 мм рт. ст. Проверьте цифры.',
    );
  });

  it('accepts a decimal comma for fields that allow decimals', () => {
    const glucose = diaryTemplate('glucose')?.fields.find((candidate) => candidate.id === 'mmol');
    if (!glucose) throw new Error('No glucose field.');
    expect(numberProblem(glucose, '5,8')).toBeUndefined();
    expect(numberProblem(glucose, '0,1')).toContain('Допустимо от 0,5 до 40');
  });

  it('puts «lower below upper» on the lower field once both numbers are valid', () => {
    expect(numberProblems(invitation, { systolic: '120', diastolic: '130' })).toEqual({
      diastolic: '«Нижнее» должно быть меньше, чем «Верхнее». Проверьте, не перепутаны ли числа.',
    });
    expect(numberProblems(invitation, { systolic: '120', diastolic: '80', pulse: '70' })).toEqual(
      {},
    );
    expect(numberProblems(invitation, { systolic: '', diastolic: '80' })).toEqual({
      systolic: 'Заполните это поле.',
    });
  });

  it('shows the limits as a hint and picks a digits-only keyboard for whole numbers', () => {
    expect(rangeHint(field('systolic'))).toBe('от 50 до 300');
    expect(rangeHint(field('arm'))).toBeUndefined();
    expect(inputModeFor(field('systolic'))).toBe('numeric');
    expect(inputModeFor(field('pulse'))).toBe('numeric');
    const glucose = diaryTemplate('glucose')?.fields.find((candidate) => candidate.id === 'mmol');
    if (!glucose) throw new Error('No glucose field.');
    expect(inputModeFor(glucose)).toBe('decimal');
    expect(
      inputModeFor({ id: 'w', type: 'number', label: 'Вес', unit: 'кг', min: 30, max: 200 }),
    ).toBe('decimal');
  });
});
