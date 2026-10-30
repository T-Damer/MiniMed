import { describe, expect, it } from 'vitest';

import { readAccessCode } from '@/features/diary/connected/doctor-account';

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
