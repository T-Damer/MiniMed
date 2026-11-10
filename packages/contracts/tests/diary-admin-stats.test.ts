import { describe, expect, it } from 'vitest';

import {
  DIARY_ADMIN_WEEKS,
  DIARY_TOTALS_MAX,
  DiaryAdminStatsSchema,
  DiaryDoctorTotalsSchema,
  DiaryMeResponseSchema,
} from '../src/diary-sync';

const STATS = {
  generatedAt: '2026-11-10T12:00:00.000Z',
  doctors: { total: 2, withPatients: 1, new7: 1, new30: 2 },
  patients: {
    total: 3,
    withdrawn: 1,
    withPhone: 2,
    withCarer: 1,
    active7: 1,
    active30: 2,
    new7: 0,
    new30: 1,
  },
  phones: { patient: 2, carer: 1 },
  records: { total: 40, last7: 5, last30: 20 },
  alerts: { total: 3, open: 1 },
  diariesWithPlan: 2,
  prescriptions: 5,
  adherence7: { done: 6, total: 8 },
  adherence30: { done: 20, total: 30 },
  weeks: [{ start: '2026-11-09', newDoctors: 0, newPatients: 1 }],
  doctorRows: [
    {
      name: 'Д-р Иванова',
      email: 'ivanova@clinic.ru',
      patients: 2,
      activePatients: 1,
      lastActivityAt: null,
      prescriptions: 5,
      adherence30: 0.5,
      totalsAt: '2026-11-09T10:00:00.000Z',
    },
  ],
};

describe('service overview contract (ADR-0026 §7)', () => {
  it('accepts the aggregates', () => {
    expect(DiaryAdminStatsSchema.parse(STATS)).toEqual(STATS);
    expect(DIARY_ADMIN_WEEKS).toBe(12);
  });

  it('refuses a negative or fractional count and a missing block', () => {
    expect(
      DiaryAdminStatsSchema.safeParse({ ...STATS, records: { ...STATS.records, total: -1 } })
        .success,
    ).toBe(false);
    expect(
      DiaryAdminStatsSchema.safeParse({ ...STATS, alerts: { total: 1.5, open: 0 } }).success,
    ).toBe(false);
    const { alerts: _alerts, ...partial } = STATS;
    expect(DiaryAdminStatsSchema.safeParse(partial).success).toBe(false);
  });

  it('drops anything else a server might add, such as a patient identifier', () => {
    const parsed = DiaryAdminStatsSchema.parse({ ...STATS, patientIds: ['abc'] });
    expect('patientIds' in parsed).toBe(false);
  });

  it('keeps /api/auth/me backwards compatible: admin is optional', () => {
    const me = {
      doctor: {
        id: 'abcdefghijkl',
        email: 'a@b.ru',
        name: 'А',
        identity: { wrap: 'a'.repeat(43), sign: 'b'.repeat(43) },
      },
      identityBlob: 'abc.def',
    };
    expect(DiaryMeResponseSchema.parse(me).admin).toBeUndefined();
    expect(DiaryMeResponseSchema.parse({ ...me, admin: true }).admin).toBe(true);
  });
});

const TOTALS = {
  diaries: 3,
  prescriptions: 8,
  adherence7: { done: 20, total: 30 },
  adherence30: { done: 70, total: 100 },
};

describe('doctor totals contract (ADR-0026 §7)', () => {
  it('takes whole non-negative numbers, done not above total', () => {
    expect(DiaryDoctorTotalsSchema.parse(TOTALS)).toEqual(TOTALS);
    const zero = { ...TOTALS, adherence7: { done: 0, total: 0 } };
    expect(DiaryDoctorTotalsSchema.safeParse(zero).success).toBe(true);
    expect(DiaryDoctorTotalsSchema.safeParse({ ...TOTALS, diaries: -1 }).success).toBe(false);
    expect(DiaryDoctorTotalsSchema.safeParse({ ...TOTALS, diaries: 1.5 }).success).toBe(false);
    expect(
      DiaryDoctorTotalsSchema.safeParse({ ...TOTALS, prescriptions: DIARY_TOTALS_MAX + 1 }).success,
    ).toBe(false);
    expect(
      DiaryDoctorTotalsSchema.safeParse({ ...TOTALS, adherence30: { done: 5, total: 4 } }).success,
    ).toBe(false);
  });

  it('refuses anything else, so a patient id or a name cannot ride along', () => {
    expect(DiaryDoctorTotalsSchema.safeParse({ ...TOTALS, patientId: 'abc' }).success).toBe(false);
  });
});
