import { describe, expect, it } from 'vitest';

import { DIARY_ADMIN_WEEKS, DiaryAdminStatsSchema, DiaryMeResponseSchema } from '../src/diary-sync';

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
  weeks: [{ start: '2026-11-09', newDoctors: 0, newPatients: 1 }],
  doctorRows: [
    {
      name: 'Д-р Иванова',
      email: 'ivanova@clinic.ru',
      patients: 2,
      activePatients: 1,
      lastActivityAt: null,
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
