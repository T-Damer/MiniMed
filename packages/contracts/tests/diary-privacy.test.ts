import { describe, expect, it } from 'vitest';

import {
  DiaryMeResponseSchema,
  DiaryPrivacyAcceptanceSchema,
  DiaryPrivacyRecordSchema,
} from '../src/diary-sync';

describe('doctor privacy consent contract (152-ФЗ ст. 9)', () => {
  it('takes a version string and nothing without it', () => {
    expect(DiaryPrivacyAcceptanceSchema.parse({ version: ' service-privacy-1 ' })).toEqual({
      version: 'service-privacy-1',
    });
    expect(DiaryPrivacyAcceptanceSchema.safeParse({}).success).toBe(false);
    expect(DiaryPrivacyAcceptanceSchema.safeParse({ version: '  ' }).success).toBe(false);
    expect(DiaryPrivacyAcceptanceSchema.safeParse({ version: 'x'.repeat(65) }).success).toBe(false);
  });

  it('keeps what was accepted and when, or null before the doctor accepted', () => {
    const record = { version: 'v1', at: '2026-11-11T09:00:00.000Z' };
    expect(DiaryPrivacyRecordSchema.parse(record)).toEqual(record);
    expect(DiaryPrivacyRecordSchema.parse(null)).toBeNull();
    expect(DiaryPrivacyRecordSchema.safeParse({ version: 'v1' }).success).toBe(false);
  });

  it('rides along `/api/auth/me`, which still reads without it (an older server)', () => {
    const base = {
      doctor: {
        id: 'abcdefabcdef',
        email: 'doctor@clinic.test',
        name: 'Д-р Иванова',
        identity: { wrap: 'wrapkey', sign: 'signkey' },
      },
      identityBlob: 'sealed.blob',
    };
    expect(DiaryMeResponseSchema.parse(base).privacy).toBeUndefined();
    expect(DiaryMeResponseSchema.parse({ ...base, privacy: null }).privacy).toBeNull();
    const record = { version: 'v1', at: '2026-11-11T09:00:00.000Z' };
    expect(DiaryMeResponseSchema.parse({ ...base, privacy: record }).privacy).toEqual(record);
  });
});
