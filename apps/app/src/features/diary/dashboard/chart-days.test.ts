import { describe, expect, it } from 'vitest';

import { dayTickLabel, dayTicks } from '@/features/diary/dashboard/chart-days';
import { type OverviewSignal, overviewSummary } from '@/features/diary/dashboard/patient-overview';

describe('day ticks of the diary charts', () => {
  it('puts one tick at noon of every day in the range', () => {
    const from = new Date(2026, 9, 30, 18, 0).getTime();
    const to = new Date(2026, 10, 3, 9, 0).getTime();
    const ticks = dayTicks(from, to).map((tick) => new Date(tick));
    expect(ticks.map((tick) => [tick.getDate(), tick.getHours()])).toEqual([
      [31, 12],
      [1, 12],
      [2, 12],
    ]);
  });

  it('names the month on the first tick and on the 1st, the day number elsewhere', () => {
    const ticks = dayTicks(new Date(2026, 9, 31, 0).getTime(), new Date(2026, 10, 3, 0).getTime());
    expect(ticks.map((tick, index) => dayTickLabel(tick, index))).toEqual([
      '31 окт.',
      '1 нояб.',
      '2',
    ]);
  });
});

describe('the folded statistics line', () => {
  const signal = (tone: OverviewSignal['tone']) => ({ tone }) as OverviewSignal;
  it('counts what needs a look, or says the week was calm', () => {
    expect(overviewSummary([signal('danger'), signal('danger'), signal('warn')])).toBe(
      '2 тревожных · 1 требует внимания',
    );
    expect(overviewSummary([signal('default'), signal('good')])).toBe('неделя спокойная');
  });
});
