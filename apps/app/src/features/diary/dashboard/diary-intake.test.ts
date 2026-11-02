import { describe, expect, it } from 'vitest';

import { medicineIntake, parseDose } from '@/features/diary/dashboard/diary-intake';
import {
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  type DiaryInvitation,
  diaryTemplate,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

const NOW = new Date(2026, 9, 20, 22, 0);

function invitation(): DiaryInvitation {
  const template = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: 'intakediary1',
      template: 'care',
      title: template?.title,
      // Issued on the 18th: the 17th and before have no data.
      issuedAt: new Date(2026, 9, 18, 9, 0).toISOString(),
      fields: template?.fields,
      plan: [
        {
          id: 'p1',
          name: 'Сертралин',
          dose: '50 мг',
          // The evening intake is half a dose.
          times: [{ time: '08:00' }, { time: '20:00', dose: '25 мг' }],
        },
        { id: 'p2', name: 'Гидроксизин', dose: '25 мг', asNeeded: true },
      ],
    },
    NOW.getTime(),
  );
}

function mark(diary: DiaryInvitation, day: number, time: string, value: object): DiaryEntry {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return parseDiaryEntry(
    diary,
    {
      id: `e${day}${time.replace(':', '')}${Object.keys(value).join('')}`,
      at: new Date(2026, 9, day, hours, minutes).toISOString(),
      values: { medication: value },
    },
    NOW.getTime(),
  );
}

describe('medicine intake per day', () => {
  it('reads doses in numbers, fractions and words', () => {
    expect(parseDose('50 мг')).toEqual({ amount: 50, unit: 'мг' });
    expect(parseDose('1,5 таблетки')).toEqual({ amount: 1.5, unit: 'таблетки' });
    expect(parseDose('1/2 таблетки')).toEqual({ amount: 0.5, unit: 'таблетки' });
    expect(parseDose('½ табл.')).toEqual({ amount: 0.5, unit: 'табл.' });
    expect(parseDose('по схеме')).toEqual({ amount: 1, unit: 'приём' });
    expect(parseDose(undefined)).toEqual({ amount: 1, unit: 'приём' });
  });

  it('sums the day, counts a skip and a missed intake as 0, and starts with the diary', () => {
    const diary = invitation();
    const entries = [
      mark(diary, 18, '08:05', { item: 'p1', done: true, slot: '08:00' }),
      mark(diary, 18, '20:10', { item: 'p1', done: true, slot: '20:00' }),
      mark(diary, 19, '08:05', { item: 'p1', done: true, slot: '08:00' }),
      mark(diary, 19, '20:10', { item: 'p1', done: false, slot: '20:00' }),
      mark(diary, 19, '14:00', { item: 'p2', done: true }),
      mark(diary, 19, '18:00', { item: 'p2', done: true }),
    ];
    const [sertraline, hydroxyzine] = medicineIntake(diary, entries, 5, NOW);
    expect(sertraline?.unit).toBe('мг');
    expect(sertraline?.days).toEqual([
      { day: '2026-10-18', taken: 75, prescribed: 75 },
      { day: '2026-10-19', taken: 50, prescribed: 75 },
      // Nothing marked on the 20th: both intakes count as 0, the plan still asks for 75.
      { day: '2026-10-20', taken: 0, prescribed: 75 },
    ]);
    // Taken when needed: the doses taken, no prescribed dots.
    expect(hydroxyzine?.days).toEqual([
      { day: '2026-10-18', taken: 0 },
      { day: '2026-10-19', taken: 50 },
      { day: '2026-10-20', taken: 0 },
    ]);
  });

  it('counts a marked intake at the dose it was marked at, not at a later plan', () => {
    const diary = invitation();
    // Marked on the 18th at 25 мг (the dose then); the plan now says 50 мг.
    const entries = [
      mark(diary, 18, '08:05', { item: 'p1', done: true, slot: '08:00', dose: '25 мг' }),
      mark(diary, 18, '20:10', { item: 'p1', done: false, slot: '20:00', dose: '12,5 мг' }),
      mark(diary, 19, '14:00', { item: 'p2', done: true, dose: '12,5 мг' }),
    ];
    const [sertraline, hydroxyzine] = medicineIntake(diary, entries, 3, NOW);
    expect(sertraline?.days[0]).toEqual({ day: '2026-10-18', taken: 25, prescribed: 37.5 });
    // Unmarked days know only today's plan.
    expect(sertraline?.days[1]).toEqual({ day: '2026-10-19', taken: 0, prescribed: 75 });
    expect(hydroxyzine?.days[1]).toEqual({ day: '2026-10-19', taken: 12.5 });
  });
});
