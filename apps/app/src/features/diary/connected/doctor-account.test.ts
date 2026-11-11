import { DEMO_ACCESS_CODE } from '@localmed/diary-sync';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiaryApiError, diaryAuth } from '@/features/diary/connected/diary-api';
import {
  PrivacyConsentRequired,
  readAccessCode,
  signInWithCode,
} from '@/features/diary/connected/doctor-account';

vi.mock('@/features/diary/diary-links', () => ({ diaryServiceBase: () => 'http://diary.test' }));
vi.mock('@/features/diary/connected/diary-api', async (original) => {
  const actual = await original<typeof import('@/features/diary/connected/diary-api')>();
  return {
    ...actual,
    diaryAuth: {
      prelogin: vi.fn(async () => ({
        kdf: { salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 100_000 },
      })),
      login: vi.fn(async () => {
        throw new actual.DiaryApiError(401, 'Неверный адрес или пароль.');
      }),
      register: vi.fn(async () => {
        throw new actual.DiaryApiError(403, 'stop here');
      }),
    },
  };
});

describe('access codes', () => {
  it('reads a code in any case and with any separators', () => {
    expect(readAccessCode('K2CM-R5AG-2M4R')).toBe('K2CM-R5AG-2M4R');
    expect(readAccessCode(' k2cm r5ag 2m4r ')).toBe('K2CM-R5AG-2M4R');
    expect(readAccessCode('k2cmr5ag2m4r')).toBe('K2CM-R5AG-2M4R');
  });

  it('leaves e-mails and half-typed codes alone', () => {
    expect(readAccessCode('doctor@clinic.ru')).toBeUndefined();
    expect(readAccessCode('K2CM-R5AG')).toBeUndefined();
    expect(readAccessCode('K2CM-R5AG-2M4R-X')).toBeUndefined();
    expect(readAccessCode('')).toBeUndefined();
  });
});

describe('a code that opens a new account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is refused without the ticked consent, before anything is sent to register', async () => {
    await expect(
      signInWithCode({ code: 'K2CM-R5AG-2M4R', rememberDevice: false }),
    ).rejects.toBeInstanceOf(PrivacyConsentRequired);
    expect(diaryAuth.register).not.toHaveBeenCalled();
  });

  it('registers with the accepted policy version once it is ticked', async () => {
    await expect(
      signInWithCode({
        code: 'K2CM-R5AG-2M4R',
        rememberDevice: false,
        privacyVersion: 'service-privacy-test',
      }),
    ).rejects.toBeInstanceOf(DiaryApiError);
    const sent = vi.mocked(diaryAuth.register).mock.calls[0]?.[1];
    expect(sent?.privacy).toEqual({ version: 'service-privacy-test' });
  });

  it('needs no consent for the public demo account', async () => {
    await expect(
      signInWithCode({ code: DEMO_ACCESS_CODE, rememberDevice: false }),
    ).rejects.toBeInstanceOf(DiaryApiError);
    const sent = vi.mocked(diaryAuth.register).mock.calls[0]?.[1];
    expect(sent?.privacy).toBeUndefined();
  });
});
