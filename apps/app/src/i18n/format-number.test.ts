import { describe, expect, it } from 'vitest';

import { formatByteSize, formatDecimal, formatPercentValue } from './format-number';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe('formatDecimal', () => {
  it('uses a decimal comma and never a point', () => {
    expect(formatDecimal(1.4)).toBe('1,4');
    expect(formatDecimal(8.5)).toBe('8,5');
    expect(formatDecimal(1.14, 2)).toBe('1,14');
    expect(formatDecimal(12, 0)).toBe('12');
  });

  it('writes a negative value with the real minus sign and drops the sign of a rounded zero', () => {
    expect(formatDecimal(-0.7)).toBe('−0,7');
    expect(formatDecimal(-0.04)).toBe('0,0');
    expect(formatDecimal(Number.NaN)).toBe('');
  });
});

describe('formatPercentValue', () => {
  it('reads «−0,7 %» for the value the report showed as «-0.7 %»', () => {
    expect(formatPercentValue(-0.7)).toBe('−0,7 %');
    expect(formatPercentValue(12.5)).toBe('12,5 %');
  });
});

describe('formatByteSize', () => {
  it('formats every size of the downloads page the same way', () => {
    expect(formatByteSize(300 * 1024)).toBe('300 КБ');
    expect(formatByteSize(1)).toBe('1 КБ');
    expect(formatByteSize(1.4 * MIB)).toBe('1,4 МБ');
    expect(formatByteSize(8.5 * MIB)).toBe('8,5 МБ');
    expect(formatByteSize(286 * MIB)).toBe('286 МБ');
    expect(formatByteSize(1.14 * GIB)).toBe('1,1 ГБ');
  });

  it('does not show «10,0 МБ» for a value that rounds up to ten', () => {
    expect(formatByteSize(9.97 * MIB)).toBe('10 МБ');
  });

  it('never contains a decimal point', () => {
    for (const bytes of [512, 1536, 5 * MIB + 300_000, 3 * GIB + 1_000_000]) {
      expect(formatByteSize(bytes)).not.toContain('.');
    }
  });
});
