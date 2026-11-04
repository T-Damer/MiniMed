import { describe, expect, it } from 'vitest';

import {
  clampSpan,
  presetSpan,
  shiftSpan,
  spanDays,
  spanLabel,
  spanNow,
  spanPreset,
  spanTimes,
} from '@/features/diary/dashboard/chart-period';

const TODAY = '2026-11-04';

describe('the charts period', () => {
  it('takes the last N days up to today and knows it again as that preset', () => {
    const week = presetSpan('7', TODAY);
    expect(week).toEqual({ from: '2026-10-29', to: TODAY });
    expect(spanDays(week)).toBe(7);
    expect(spanPreset(week, TODAY)).toBe('7');
    expect(spanPreset(presetSpan('30', TODAY), TODAY)).toBe('30');
    // The same length ending yesterday, or a length with no preset, is a custom span.
    expect(spanPreset({ from: '2026-10-28', to: '2026-11-03' }, TODAY)).toBeUndefined();
    expect(spanPreset({ from: '2026-11-01', to: TODAY }, TODAY)).toBeUndefined();
  });

  it('steps back the whole length, forward no further than today', () => {
    const week = presetSpan('7', TODAY);
    const back = shiftSpan(week, -1, TODAY);
    expect(back).toEqual({ from: '2026-10-22', to: '2026-10-28' });
    expect(shiftSpan(back, 1, TODAY)).toEqual(week);
    // Three days back: forward lands on the last week, not past today.
    expect(shiftSpan({ from: '2026-10-26', to: '2026-11-01' }, 1, TODAY)).toEqual(week);
    expect(shiftSpan(week, 1, TODAY)).toEqual(week);
  });

  it('crosses a month and a daylight-saving change by whole days', () => {
    expect(spanDays({ from: '2026-10-20', to: '2026-11-02' })).toBe(14);
    expect(spanDays({ from: '2026-03-25', to: '2026-04-03' })).toBe(10);
  });

  it('puts typed dates in order and keeps the span inside the diary and today', () => {
    expect(clampSpan({ from: '2026-11-02', to: '2026-10-30' }, TODAY)).toEqual({
      from: '2026-10-30',
      to: '2026-11-02',
    });
    // Past today: moved back whole.
    expect(clampSpan({ from: '2026-11-01', to: '2026-11-07' }, TODAY)).toEqual({
      from: '2026-10-29',
      to: TODAY,
    });
    // Before the diary began: cut at its first day.
    expect(clampSpan({ from: '2026-10-01', to: '2026-10-20' }, TODAY, '2026-10-10')).toEqual({
      from: '2026-10-10',
      to: '2026-10-20',
    });
  });

  it('ends the axis now today and at midnight for a past span', () => {
    const now = new Date(2026, 10, 4, 15, 30);
    const today = spanTimes({ from: '2026-11-01', to: TODAY }, now);
    expect(new Date(today.from)).toEqual(new Date(2026, 10, 1));
    expect(today.to).toBe(now.getTime());
    const past = spanTimes({ from: '2026-10-01', to: '2026-10-07' }, now);
    expect(new Date(past.to)).toEqual(new Date(2026, 9, 8));
    expect(spanNow({ from: '2026-10-01', to: '2026-10-07' }, now)).toEqual(
      new Date(2026, 9, 8, 0, 0, 0, -1),
    );
    expect(spanNow({ from: '2026-11-01', to: TODAY }, now)).toBe(now);
  });

  it('names the span in short dates, with the year only when it is not this one', () => {
    expect(spanLabel({ from: '2026-10-29', to: TODAY }, TODAY)).toBe('29 окт. – 4 нояб.');
    expect(spanLabel({ from: TODAY, to: TODAY }, TODAY)).toBe('4 нояб.');
    expect(spanLabel({ from: '2025-12-30', to: '2026-01-05' }, TODAY)).toBe(
      '30 дек. 2025 г. – 5 янв.',
    );
  });
});
