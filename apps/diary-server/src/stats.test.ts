import { describe, expect, it } from 'bun:test';
import { DiaryAdminStatsSchema } from '@localmed/contracts';

import { buildServiceStats, weekStart } from './stats';
import type { ServiceStatsRaw } from './store';

const NOW = new Date('2026-11-10T12:00:00.000Z'); // a Tuesday

const raw: ServiceStatsRaw = {
  doctors: [
    { id: 'd1', email: 'a@x.ru', name: 'А', created_at: '2026-11-09T08:00:00.000Z' },
    { id: 'd2', email: 'b@x.ru', name: 'Б', created_at: '2026-09-01T08:00:00.000Z' },
  ],
  patients: [
    { id: 'p1', status: 'active', created_at: '2026-11-09T09:00:00.000Z' },
    { id: 'p2', status: 'active', created_at: '2026-10-20T09:00:00.000Z' },
    { id: 'p3', status: 'withdrawn', created_at: '2026-10-01T09:00:00.000Z' },
  ],
  members: [
    { patient_id: 'p1', doctor_id: 'd1' },
    { patient_id: 'p2', doctor_id: 'd1' },
    { patient_id: 'p3', doctor_id: 'd2' },
  ],
  records: [
    { patient_id: 'p1', total: 5, last7: 2, last30: 5, last_at: '2026-11-10T07:00:00.000Z' },
    { patient_id: 'p2', total: 3, last7: 0, last30: 1, last_at: '2026-10-25T07:00:00.000Z' },
  ],
  devices: [
    { patient_id: 'p1', phones: 1, carers: 1 },
    { patient_id: 'p3', phones: 1, carers: 0 },
  ],
  alerts: { total: 4, open: 1 },
  totals: [
    {
      doctor_id: 'd1',
      diaries: 2,
      prescriptions: 7,
      done7: 20,
      total7: 25,
      done30: 80,
      total30: 100,
      at: '2026-08-01T08:00:00.000Z',
    },
    {
      doctor_id: 'gone',
      diaries: 9,
      prescriptions: 9,
      done7: 1,
      total7: 1,
      done30: 1,
      total30: 1,
      at: '2026-11-01T08:00:00.000Z',
    },
  ],
};

describe('service overview', () => {
  it('counts weeks from Monday', () => {
    expect(weekStart(NOW)).toBe('2026-11-09');
    expect(weekStart(new Date('2026-11-08T23:59:00Z'))).toBe('2026-11-02');
  });

  it('sums the reported totals, however old, and shows them per doctor', () => {
    const stats = buildServiceStats(raw, NOW);
    expect(stats.diariesWithPlan).toBe(2);
    expect(stats.prescriptions).toBe(7);
    expect(stats.adherence7).toEqual({ done: 20, total: 25 });
    expect(stats.adherence30).toEqual({ done: 80, total: 100 });
    const first = stats.doctorRows.find((row) => row.email === 'a@x.ru');
    expect(first).toMatchObject({
      prescriptions: 7,
      adherence30: 0.8,
      totalsAt: '2026-08-01T08:00:00.000Z',
    });
    const silent = stats.doctorRows.find((row) => row.email === 'b@x.ru');
    expect(silent).toMatchObject({ prescriptions: null, adherence30: null, totalsAt: null });
    const empty = buildServiceStats({ ...raw, totals: [] }, NOW);
    expect(empty.prescriptions).toBe(0);
    expect(empty.adherence30).toEqual({ done: 0, total: 0 });
  });

  it('builds the aggregates and no patient identifier', () => {
    const stats = buildServiceStats(raw, NOW);
    expect(DiaryAdminStatsSchema.parse(stats)).toEqual(stats);
    expect(stats.doctors).toEqual({ total: 2, withPatients: 1, new7: 1, new30: 1 });
    expect(stats.patients).toEqual({
      total: 2,
      withdrawn: 1,
      withPhone: 1,
      withCarer: 1,
      active7: 1,
      active30: 2,
      new7: 1,
      new30: 2,
    });
    expect(stats.phones).toEqual({ patient: 2, carer: 1 });
    expect(stats.records).toEqual({ total: 8, last7: 2, last30: 6 });
    expect(stats.alerts).toEqual({ total: 4, open: 1 });
    expect(stats.weeks).toHaveLength(12);
    expect(stats.weeks.at(-1)).toEqual({ start: '2026-11-09', newDoctors: 1, newPatients: 1 });
    expect(stats.weeks.find((week) => week.start === '2026-10-19')?.newPatients).toBe(1);
    expect(stats.doctorRows[0]).toEqual({
      name: 'А',
      email: 'a@x.ru',
      patients: 2,
      activePatients: 1,
      lastActivityAt: '2026-11-10T07:00:00.000Z',
      prescriptions: 7,
      adherence30: 0.8,
      totalsAt: '2026-08-01T08:00:00.000Z',
    });
    // The withdrawn diary is not the doctor's patient any more.
    expect(stats.doctorRows[1]?.patients).toBe(0);
    expect(JSON.stringify(stats)).not.toMatch(/"p[123]"/u);
  });
});
