import { describe, expect, it, vi } from 'vitest';

import {
  adherence,
  alertCause,
  exportCsv,
  exportRows,
  fieldSeries,
  medicineAdherence,
  questionnaireSeries,
} from '@/features/diary/dashboard/diary-insights';
import { atTime } from '@/features/diary/diary-care';
import { careInvitation, emptyCareDraft, newCareSection } from '@/features/diary/diary-care-draft';
import { type DiaryEntry, parseDiaryEntry } from '@/features/diary/diary-model';

const NOW = new Date(2026, 9, 21, 23, 0);
const invitation = (() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 7, 0));
  try {
    return careInvitation({
      id: 'patient0000000000001',
      draft: {
        ...emptyCareDraft(),
        sections: [
          {
            ...newCareSection('drug'),
            title: 'Сертралин',
            dose: '50 мг',
            times: [{ time: '08:00', meal: 'after' }],
          },
          ...emptyCareDraft().sections.slice(1),
        ],
      },
      doctor: 'Д-р',
      note: '',
    });
  } finally {
    vi.useRealTimers();
  }
})();

function entry(value: Record<string, unknown>): DiaryEntry {
  return parseDiaryEntry(invitation, value, NOW.getTime());
}

const entries = [
  entry({
    id: 'dose00000001',
    at: atTime('2026-10-20', '08:05'),
    values: { medication: { item: 'p1', done: true, slot: '08:00' } },
  }),
  entry({
    id: 'dose00000002',
    at: atTime('2026-10-21', '09:00'),
    values: { medication: { item: 'p1', done: false, slot: '08:00' } },
    note: 'Забыл; таблетки "кончились"',
  }),
  entry({
    id: 'mood00000001',
    at: atTime('2026-10-21', '09:10'),
    values: { wellbeing: 4 },
    check: 'am',
  }),
  entry({
    id: 'mood00000002',
    at: atTime('2026-10-21', '21:10'),
    values: { wellbeing: 7 },
    check: 'pm',
  }),
  entry({
    id: 'phq000000001',
    at: atTime('2026-10-21', '12:00'),
    values: {},
    check: 'q-phq-9',
    answers: {
      'phq9-01': 2,
      'phq9-02': 2,
      'phq9-03': 1,
      'phq9-04': 1,
      'phq9-05': 1,
      'phq9-06': 1,
      'phq9-07': 1,
      'phq9-08': 0,
      'phq9-09': 1,
      'phq9-difficulty': 1,
    },
  }),
];

describe('diary insights for the doctor', () => {
  it('counts adherence of the plan and of each medicine', () => {
    const week = adherence(invitation, entries, 2, NOW);
    expect(week.total).toBeGreaterThan(0);
    expect(week.done).toBeLessThanOrEqual(week.total);
    expect(medicineAdherence(invitation, entries, 2, NOW)).toEqual([
      { itemId: 'p1', name: 'Сертралин 50 мг', taken: 1, skipped: 1, planned: 2 },
    ]);
  });

  it('splits wellbeing into morning and evening series', () => {
    expect(fieldSeries(entries, 'wellbeing', 'am').map((point) => point.value)).toEqual([4]);
    expect(fieldSeries(entries, 'wellbeing').map((point) => point.value)).toEqual([4, 7]);
  });

  it('scores questionnaires with their schema, alerts included', async () => {
    const [phq] = await questionnaireSeries(invitation, entries);
    expect(phq?.title).toBe('PHQ-9');
    expect(phq?.points[0]?.total).toBe(10);
    expect(phq?.points[0]?.max).toBe(27);
    expect(phq?.points[0]?.alerts.join(' ')).toContain('Пункт 9');
    expect(phq?.points[0]?.alertDetails[0]?.message).toBeTruthy();
  });

  it('finds the answers behind an alert: the last alerting entry before it', async () => {
    const series = await questionnaireSeries(invitation, entries);
    const point = series[0]?.points[0];
    if (!point) throw new Error('No questionnaire point.');
    const cause = alertCause(series, new Date(Date.parse(point.at) + 30_000).toISOString());
    expect(cause?.point.entryId).toBe(point.entryId);
    expect(cause?.title).toBe('PHQ-9');
    expect(alertCause(series, new Date(Date.parse(point.at) - 3_600_000).toISOString())).toBe(
      undefined,
    );
  });

  it('exports one row per entry; CSV quotes what needs quoting', () => {
    const rows = exportRows(invitation, entries);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ kind: 'Приём', values: 'принято' });
    expect(rows[0]?.what).toContain('Сертралин');
    const csv = exportCsv(rows);
    expect(csv.startsWith('﻿Дата;Время;Вид')).toBe(true);
    expect(csv).toContain('"Забыл; таблетки ""кончились"""');
  });
});
