import { describe, expect, it } from 'vitest';
import { dictatedPlan, dictatedRowIssue } from '@/features/diary/dashboard/dictated-plan';

describe('dictated prescription drafts', () => {
  it('keeps source lines and reads explicit dose, number, and intake times', () => {
    const { rows } = dictatedPlan(
      'Назначить Препарат А по 0,5 мг в восемь утра и в 20:30.\nПрепарат Б 1 таблетку при необходимости.',
    );
    expect(rows.map(({ source }) => source)).toEqual([
      'Назначить Препарат А по 0,5 мг в восемь утра и в 20:30.',
      'Препарат Б 1 таблетку при необходимости.',
    ]);
    expect(rows[0]?.section).toMatchObject({
      title: 'Препарат А',
      dose: '0,5 мг',
      times: [{ time: '08:00' }, { time: '20:30' }],
    });
    expect(rows[1]?.section).toMatchObject({
      title: 'Препарат Б',
      dose: '1 табл.',
      asNeeded: true,
      times: [],
    });
    expect(rows.map(({ section }) => dictatedRowIssue(section))).toEqual([undefined, undefined]);
    expect(rows[0]?.section.id).not.toBe(rows[1]?.section.id);
  });

  it('turns an explicitly spoken quantity into a numeric dose and preserves its units', () => {
    const { rows } = dictatedPlan(
      'Назначаю пациентке Препарат А, по пять миллиграммов в восемь утра. Препарат Б 10 мг по половине таблетки в 20:00.',
    );
    expect(rows[0]?.section).toMatchObject({
      title: 'Препарат А',
      dose: '5 мг',
      times: [{ time: '08:00' }],
    });
    expect(rows[1]?.section).toMatchObject({ title: 'Препарат Б', dose: '', times: [] });
  });

  it('leaves an ambiguous schedule unresolved in full', () => {
    const { rows } = dictatedPlan(
      'Препарат А 5 мг в 08:00 и вечером; Препарат Б 2 мг в 25:00; Препарат В 1 мг',
    );
    expect(rows.map(({ section }) => section.times)).toEqual([[], [], []]);
    expect(
      rows.every(({ section }) => Boolean(dictatedRowIssue(section)) && !section.asNeeded),
    ).toBe(true);
  });

  it('does not convert cancellation, weight-based dosing or taper instructions into new doses', () => {
    const { rows } = dictatedPlan(
      'Не назначать Препарат А 5 мг в 08:00; Препарат Б 2 мг/кг в 15:00; Снизить Препарат В 2 мг в 19:00',
    );
    expect(rows.map(({ section }) => section.dose)).toEqual(['', '', '']);
    expect(rows.every(({ section }) => Boolean(dictatedRowIssue(section)))).toBe(true);
  });
});
