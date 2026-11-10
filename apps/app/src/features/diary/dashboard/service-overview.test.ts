import type { DiaryAdminStats } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  doctorTotalsCells,
  lastActivityLabel,
  overviewTiles,
  shareLabel,
  weekBars,
} from '@/features/diary/dashboard/service-overview';

const STATS: DiaryAdminStats = {
  generatedAt: '2026-11-10T12:00:00.000Z',
  doctors: { total: 21, withPatients: 12, new7: 2, new30: 5 },
  patients: {
    total: 40,
    withdrawn: 3,
    withPhone: 30,
    withCarer: 4,
    active7: 20,
    active30: 31,
    new7: 3,
    new30: 9,
  },
  phones: { patient: 33, carer: 5 },
  records: { total: 1200, last7: 140, last30: 520 },
  alerts: { total: 9, open: 0 },
  diariesWithPlan: 14,
  prescriptions: 37,
  adherence7: { done: 90, total: 120 },
  adherence30: { done: 300, total: 480 },
  weeks: [
    { start: '2026-11-02', newDoctors: 0, newPatients: 0 },
    { start: '2026-11-09', newDoctors: 1, newPatients: 8 },
  ],
  doctorRows: [],
};

describe('service overview helpers', () => {
  it('shares round, and a dash replaces a division by zero', () => {
    expect(shareLabel(30, 40)).toBe('75 %');
    expect(shareLabel(1, 3)).toBe('33 %');
    expect(shareLabel(0, 0)).toBe('—');
  });

  it('declares one tile per figure with Russian counters', () => {
    const tiles = overviewTiles(STATS);
    const byId = Object.fromEntries(tiles.map((tile) => [tile.id, tile]));
    expect(tiles.map((tile) => tile.id)).toEqual([
      'doctors',
      'patients',
      'phones',
      'carers',
      'records',
      'prescriptions',
      'adherence',
      'active',
      'alerts',
      'withdrawn',
    ]);
    expect(byId['doctors']).toMatchObject({ value: '21', label: 'врач' });
    expect(byId['patients']).toMatchObject({ value: '40', label: 'дневников' });
    expect(byId['phones']?.hint).toBe('75 %');
    expect(byId['carers']?.label).toBe('телефонов близких');
    expect(byId['active']?.hint).toBe('50 % · за месяц 31');
    // No open alerts is a quiet tile; one open turns it red.
    expect(byId['prescriptions']).toMatchObject({
      value: '37',
      label: 'Назначений',
      hint: 'в 14 дневниках',
    });
    expect(byId['adherence']).toMatchObject({
      value: '75 % / 63 %',
      label: 'Приём по плану, 7 дней / 30 дней',
    });
    expect(
      overviewTiles({ ...STATS, adherence7: { done: 0, total: 0 } }).find(
        (tile) => tile.id === 'adherence',
      )?.value,
    ).toBe('— / 63 %');
    expect(byId['alerts']?.tone).toBe('default');
    const urgent = overviewTiles({ ...STATS, alerts: { total: 9, open: 2 } });
    expect(urgent.find((tile) => tile.id === 'alerts')?.tone).toBe('danger');
  });

  it('scales weekly bars to the tallest and keeps a small count visible', () => {
    const bars = weekBars(STATS.weeks);
    expect(bars[0]).toMatchObject({ label: '2 ноя', doctorsHeight: 0, patientsHeight: 0 });
    expect(bars[1]).toMatchObject({ label: '9 ноя', patientsHeight: 100 });
    expect(bars[1]?.doctorsHeight).toBe(13);
    expect(
      weekBars([{ start: '2026-11-09', newDoctors: 1, newPatients: 200 }])[0]?.doctorsHeight,
    ).toBe(4);
    expect(weekBars([])).toEqual([]);
  });

  it('shows the reported totals, with the date when they are older than 30 days', () => {
    const now = new Date(2026, 10, 10, 15, 0);
    const fresh = {
      prescriptions: 6,
      adherence30: 0.8,
      totalsAt: new Date(2026, 10, 9).toISOString(),
    };
    expect(doctorTotalsCells(fresh, now)).toMatchObject({ prescriptions: '6', adherence: '80 %' });
    const old = { ...fresh, totalsAt: new Date(2026, 8, 12, 12).toISOString() };
    expect(doctorTotalsCells(old, now).adherence).toBe('80 % · 12 сен');
    expect(doctorTotalsCells({ ...fresh, adherence30: null }, now).adherence).toBe('—');
    expect(
      doctorTotalsCells({ prescriptions: null, adherence30: null, totalsAt: null }, now),
    ).toMatchObject({
      prescriptions: '—',
      adherence: '—',
    });
  });

  it('says when the last record was written', () => {
    const now = new Date(2026, 10, 10, 15, 0);
    expect(lastActivityLabel(null, now)).toBe('нет записей');
    expect(lastActivityLabel(new Date(2026, 10, 10, 1, 0).toISOString(), now)).toBe('сегодня');
    expect(lastActivityLabel(new Date(2026, 10, 9, 23, 0).toISOString(), now)).toBe('вчера');
    expect(lastActivityLabel(new Date(2026, 10, 5, 12, 0).toISOString(), now)).toBe('5 дн. назад');
    expect(lastActivityLabel('not a date', now)).toBe('нет записей');
  });
});
