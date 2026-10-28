import { describe, expect, it } from 'vitest';

import { isOnline, presenceLabel } from '@/features/diary/dashboard/presence';

const NOW = new Date(2026, 9, 28, 14, 30, 0);
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (year: number, month: number, day: number, hour: number, minute: number): string =>
  new Date(year, month, day, hour, minute).toISOString();

describe('isOnline', () => {
  it('needs the flag and a fresh sighting', () => {
    expect(isOnline({ online: true, lastSeenAt: ago(20_000) }, NOW)).toBe(true);
    expect(isOnline({ online: false, lastSeenAt: ago(20_000) }, NOW)).toBe(false);
    expect(isOnline({ online: true }, NOW)).toBe(false);
    // The flag alone does not keep the dot green when no event ever turned it off.
    expect(isOnline({ online: true, lastSeenAt: ago(HOUR) }, NOW)).toBe(false);
  });
});

describe('presenceLabel', () => {
  it('says «в сети» while online', () => {
    expect(presenceLabel({ online: true, lastSeenAt: ago(5_000) }, NOW)).toBe('в сети');
  });

  it('is undefined when the phone was never seen', () => {
    expect(presenceLabel({ online: false }, NOW)).toBeUndefined();
    expect(presenceLabel({ online: false, lastSeenAt: 'not a date' }, NOW)).toBeUndefined();
  });

  it('counts minutes and hours with the right plural form', () => {
    const label = (ms: number) => presenceLabel({ online: false, lastSeenAt: ago(ms) }, NOW);
    expect(label(10_000 + 5 * MIN)).toBe('в сети 5 минут назад');
    expect(label(MIN + 10)).toBe('в сети 1 минуту назад');
    expect(label(22 * MIN)).toBe('в сети 22 минуты назад');
    expect(label(11 * MIN)).toBe('в сети 11 минут назад');
    expect(label(3 * MIN)).toBe('в сети 3 минуты назад');
    expect(label(HOUR)).toBe('в сети 1 час назад');
    expect(label(2 * HOUR + MIN)).toBe('в сети 2 часа назад');
    expect(label(5 * HOUR + 59 * MIN)).toBe('в сети 5 часов назад');
  });

  it('is «только что» for a sighting inside the last minute or ahead of this clock', () => {
    expect(presenceLabel({ online: false, lastSeenAt: ago(30_000) }, NOW)).toBe(
      'в сети только что',
    );
    expect(presenceLabel({ online: false, lastSeenAt: ago(-5 * MIN) }, NOW)).toBe(
      'в сети только что',
    );
  });

  it('names the day beyond six hours', () => {
    const label = (iso: string) => presenceLabel({ online: false, lastSeenAt: iso }, NOW);
    expect(label(at(2026, 9, 28, 7, 5))).toBe('в сети сегодня в 07:05');
    expect(label(at(2026, 9, 27, 21, 40))).toBe('в сети вчера в 21:40');
    expect(label(at(2026, 9, 12, 9, 0))).toBe('в сети 12 октября');
    expect(label(at(2026, 0, 3, 9, 0))).toBe('в сети 3 января');
    expect(label(at(2025, 11, 31, 23, 0))).toBe('в сети 31 декабря 2025');
  });
});
