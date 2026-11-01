import { describe, expect, it } from 'vitest';

import {
  dayInBounds,
  displayDay,
  firstWeekday,
  maskTypedDay,
  monthGrid,
  parseDayValue,
  readTypedDay,
  shiftDay,
  spokenDay,
} from '@/components/date-value';

describe('date values', () => {
  it('reads only real calendar days', () => {
    expect(parseDayValue('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDayValue('2025-02-29')).toBeUndefined();
    expect(parseDayValue('2025-13-01')).toBeUndefined();
    expect(parseDayValue('')).toBeUndefined();
    expect(displayDay('2025-03-07')).toBe('07.03.2025');
    expect(displayDay('nonsense')).toBe('');
    expect(spokenDay('2025-03-07')).toBe('7 марта 2025');
  });

  it('masks typing and accepts only complete, possible days', () => {
    expect(maskTypedDay('1')).toBe('1');
    expect(maskTypedDay('1203')).toBe('12.03');
    expect(maskTypedDay('12a03/2025x9')).toBe('12.03.2025');
    expect(readTypedDay('12.03.2025')).toBe('2025-03-12');
    expect(readTypedDay('31.04.2025')).toBeUndefined();
    expect(readTypedDay('12.03.20')).toBeUndefined();
  });

  it('builds Monday-first month grids and moves by days across months', () => {
    // 1 November 2026 is a Sunday.
    expect(firstWeekday(2026, 11)).toBe(6);
    const grid = monthGrid(2026, 11);
    expect(grid.slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
    expect(grid.length % 7).toBe(0);
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayInBounds('2026-11-01', '2026-01-01', '2026-12-31')).toBe(true);
    expect(dayInBounds('2027-01-01', undefined, '2026-12-31')).toBe(false);
  });
});
