import { describe, expect, it } from 'vitest';

import { intakeCharts, skipMarks } from '@/features/diary/dashboard/diary-charts';
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
      // The evening intake marked as skipped is kept for the chart's red cross.
      { day: '2026-10-19', taken: 50, prescribed: 75, skipped: [{ time: '20:00', dose: '25 мг' }] },
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
    expect(sertraline?.days[0]).toEqual({
      day: '2026-10-18',
      taken: 25,
      prescribed: 37.5,
      skipped: [{ time: '20:00', dose: '12,5 мг' }],
    });
    // Unmarked days know only today's plan.
    expect(sertraline?.days[1]).toEqual({ day: '2026-10-19', taken: 0, prescribed: 75 });
    expect(hydroxyzine?.days[1]).toEqual({ day: '2026-10-19', taken: 12.5 });
  });

  it('crosses out the intakes the patient marked as skipped, with the reason and the note', () => {
    const diary = invitation();
    const skip = parseDiaryEntry(
      diary,
      {
        id: 'skip19am',
        at: new Date(2026, 9, 19, 9, 0).toISOString(),
        values: { medication: { item: 'p1', done: false, slot: '08:00', reason: 'ran-out' } },
        note: 'Аптека была закрыта',
      },
      NOW.getTime(),
    );
    const entries = [skip, mark(diary, 19, '20:10', { item: 'p1', done: true, slot: '20:00' })];
    const intakes = medicineIntake(diary, entries, 3, NOW);
    const [sertraline] = intakeCharts(intakes);
    // One cross, on the 19th, at the dose taken that day; the unmarked 18th and 20th have none.
    expect(sertraline?.marks).toEqual([
      {
        at: new Date(2026, 9, 19, 12, 0).toISOString(),
        value: 25,
        day: '2026-10-19',
        title: 'Пропущен приём',
        lines: ['08:00 · 50 мг — закончилось', '«Аптека была закрыта»'],
      },
    ]);
    // On the combined chart the card names the medicine; the cross sits where it is told.
    expect(skipMarks(intakes, () => 33)[0]).toMatchObject({
      value: 33,
      lines: ['Сертралин · 08:00 · 50 мг — закончилось', '«Аптека была закрыта»'],
    });
  });
});
