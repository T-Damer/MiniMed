import { describe, expect, it } from 'vitest';

import { formatTimeValue, parseTimeValue } from '@/components/time-value';

describe('parseTimeValue', () => {
  it('parses a padded 24-hour time', () => {
    expect(parseTimeValue('08:05')).toEqual({ hour: 8, minute: 5 });
    expect(parseTimeValue('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeValue('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('accepts an unpadded hour', () => {
    expect(parseTimeValue('8:05')).toEqual({ hour: 8, minute: 5 });
  });

  it('rejects empty, malformed and out-of-range values', () => {
    for (const bad of [
      '',
      ':',
      '08',
      '08:5',
      '24:00',
      '12:60',
      '-1:00',
      'ab:cd',
      '08:05:00',
      '123:00',
    ]) {
      expect(parseTimeValue(bad), bad).toBeUndefined();
    }
  });
});

describe('formatTimeValue', () => {
  it('pads both parts', () => {
    expect(formatTimeValue({ hour: 8, minute: 5 })).toBe('08:05');
    expect(formatTimeValue({ hour: 0, minute: 0 })).toBe('00:00');
    expect(formatTimeValue({ hour: 23, minute: 59 })).toBe('23:59');
  });

  it('is undefined while a part is missing', () => {
    expect(formatTimeValue({})).toBeUndefined();
    expect(formatTimeValue({ hour: 8 })).toBeUndefined();
    expect(formatTimeValue({ minute: 5 })).toBeUndefined();
    expect(formatTimeValue({ hour: undefined, minute: 5 })).toBeUndefined();
  });

  it('is undefined for out-of-range or fractional parts', () => {
    expect(formatTimeValue({ hour: 24, minute: 0 })).toBeUndefined();
    expect(formatTimeValue({ hour: 8, minute: 60 })).toBeUndefined();
    expect(formatTimeValue({ hour: -1, minute: 0 })).toBeUndefined();
    expect(formatTimeValue({ hour: 8.5, minute: 0 })).toBeUndefined();
    expect(formatTimeValue({ hour: Number.NaN, minute: 0 })).toBeUndefined();
  });

  it('round-trips with parseTimeValue', () => {
    expect(formatTimeValue(parseTimeValue('07:30') ?? {})).toBe('07:30');
  });
});
