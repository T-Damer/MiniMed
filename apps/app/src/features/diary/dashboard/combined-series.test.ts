import { describe, expect, it } from 'vitest';

import {
  combinedSources,
  combinedView,
  SHARE_KEY,
  trackMark,
} from '@/features/diary/dashboard/combined-series';
import type { MedicineIntake } from '@/features/diary/dashboard/diary-intake';
import type { DiaryEntry } from '@/features/diary/diary-model';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  },
  configurable: true,
});

const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString();
const entry = (day: number, values: DiaryEntry['values']): DiaryEntry =>
  ({ id: `${day}-${Object.keys(values ?? {}).join()}`, at: at(day), values }) as DiaryEntry;
const day = (date: number) => `2026-10-${String(date).padStart(2, '0')}`;

// Amlodipine begins on the 5th; pressure and pulse fall after it.
const entries = [1, 3, 5, 7, 9].map((date, index) =>
  entry(date, { systolic: 150 - index * 6, diastolic: 95 - index * 3, pulse: 88 - index * 3 }),
);
const intakes: MedicineIntake[] = [
  {
    itemId: 'amlo',
    name: 'Амлодипин',
    unit: 'мг',
    days: [
      { day: day(5), taken: 5, prescribed: 5 },
      { day: day(6), taken: 0, prescribed: 5, skipped: [{ time: '08:00', reason: 'forgot' }] },
      { day: day(7), taken: 5, prescribed: 5 },
      { day: day(8), taken: 0, prescribed: 5 },
    ],
  },
  {
    itemId: 'hydro',
    name: 'Гидроксизин',
    unit: 'мг',
    // Taken when needed: no plan, no share.
    days: [
      { day: day(6), taken: 25 },
      { day: day(7), taken: 0 },
    ],
  },
];
const TODAY = day(9);
const all = combinedSources({ intakes, entries, quizzes: [], today: TODAY });

describe('what the combined chart can show', () => {
  it('lists every indicator the patient recorded, the plan share and a track per medicine', () => {
    expect(all.sources.map((source) => [source.group, source.label])).toEqual([
      ['vitals', 'Давление: верхнее'],
      ['vitals', 'Давление: нижнее'],
      ['vitals', 'Пульс и сатурация: пульс, уд/мин'],
      ['medicine', 'Приём лекарств'],
    ]);
    expect(all.tracks.map((track) => [track.key, track.label])).toEqual([
      ['med:amlo', 'Амлодипин'],
      ['med:hydro', 'Гидроксизин'],
    ]);
    // Every series keeps one colour whatever else is hidden.
    const colors = [...all.sources, ...all.tracks].map((one) => one.color);
    expect(new Set(colors).size).toBe(colors.length);
    // The day the dose was missed is a 0 % day of the plan; today is not over yet.
    const share = all.sources.find((source) => source.key === SHARE_KEY);
    expect(share?.points.map((point) => point.value)).toEqual([100, 0, 100, 0]);
  });

  it('draws a period with the doctor’s choice: the missed dose a cross on its track', () => {
    const view = combinedView({
      ...all,
      intakes,
      hidden: ['chart:pressure:diastolic', 'med:hydro'],
      span: { from: day(4), to: day(9) },
      alarms: false,
    });
    expect(view.series.map((one) => one.label)).toEqual([
      'Давление: верхнее',
      'Пульс и сатурация: пульс, уд/мин',
      'Приём лекарств',
    ]);
    // Only the period's points, each line on the range it has there.
    expect(view.series[0]?.points.map((point) => point.value)).toEqual([138, 132, 126]);
    expect(view.series[0]?.low).toBeLessThan(126);
    expect(view.series[0]?.high).toBeGreaterThan(138);
    expect(view.tracks.map((track) => track.label)).toEqual(['Амлодипин']);
    expect(view.marksOn).toBe('tracks');
    expect(view.marks).toEqual([
      expect.objectContaining({
        day: day(6),
        value: 0,
        title: 'Амлодипин: пропущен приём',
        lines: ['08:00 — забыл(а)'],
      }),
    ]);
    expect(view.alarms).toEqual([]);
  });

  it('counts the 7-day average from the days before the period too', () => {
    const view = combinedView({
      ...all,
      intakes,
      hidden: [],
      span: { from: day(7), to: day(9) },
      alarms: false,
    });
    const systolic = view.series.find((one) => one.key === 'chart:pressure:systolic');
    // The 7th: the 1st, 3rd, 5th and 7th (150, 144, 138, 132); the 9th: from the 3rd on.
    expect(systolic?.average.map((point) => point.value)).toEqual([141, 135]);
  });

  it('puts the crosses back on the intake line when every track is hidden', () => {
    const view = combinedView({
      ...all,
      intakes,
      hidden: ['med:amlo', 'med:hydro'],
      span: { from: day(1), to: day(9) },
      alarms: true,
    });
    expect(view.tracks).toEqual([]);
    expect(view.marksOn).toBe('share');
    expect(view.marks).toEqual([expect.objectContaining({ day: day(6), value: 0 })]);
    // 150 and 144 are past the usual systolic red line: red days.
    expect(view.alarms.length).toBeGreaterThan(0);
    const none = combinedView({
      ...all,
      intakes,
      hidden: ['med:amlo', 'med:hydro', SHARE_KEY],
      span: { from: day(1), to: day(9) },
      alarms: true,
    });
    expect(none.marks).toEqual([]);
  });

  it('marks a day taken in full, in part or not at all', () => {
    expect(trackMark({ day: day(1), taken: 5, prescribed: 5 })).toBe('taken');
    expect(trackMark({ day: day(1), taken: 2.5, prescribed: 5 })).toBe('partial');
    expect(trackMark({ day: day(1), taken: 0, prescribed: 5 })).toBe('none');
    expect(trackMark({ day: day(1), taken: 25 })).toBe('taken');
  });
});
