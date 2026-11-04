import { beforeEach, describe, expect, it } from 'vitest';

import {
  CHART_SETTINGS_KEY,
  createChartSettings,
  DEFAULT_CHART_SETTINGS,
  median,
  movingAverage,
  readChartSettings,
  toggleHidden,
} from '@/features/diary/dashboard/chart-settings';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  },
  configurable: true,
});

describe('the combined chart settings', () => {
  beforeEach(() => memory.clear());

  it('starts with every series shown, red days and names on, the last month', () => {
    expect(readChartSettings('d1', 'p1')).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('remembers each patient’s choice apart, for this doctor', () => {
    const [, change] = createChartSettings('d1', 'p1');
    change({ hidden: ['chart:mood:mood'], median: true, preset: '14' });
    const [again] = createChartSettings('d1', 'p1');
    expect(again()).toMatchObject({ hidden: ['chart:mood:mood'], median: true, preset: '14' });
    expect(readChartSettings('d1', 'p2')).toEqual(DEFAULT_CHART_SETTINGS);
    expect(readChartSettings('d2', 'p1')).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('reads a damaged entry as the defaults, field by field', () => {
    memory.set(
      CHART_SETTINGS_KEY,
      JSON.stringify({ 'd1:p1': { hidden: ['med:a', 4], median: 'yes', preset: '45' } }),
    );
    expect(readChartSettings('d1', 'p1')).toEqual({ ...DEFAULT_CHART_SETTINGS, hidden: ['med:a'] });
    memory.set(CHART_SETTINGS_KEY, '{oops');
    expect(readChartSettings('d1', 'p1')).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('turns one series off or back on and keeps the rest', () => {
    expect(toggleHidden(['a'], 'b', false)).toEqual(['a', 'b']);
    expect(toggleHidden(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(toggleHidden(['a'], 'a', false)).toEqual(['a']);
  });
});

describe('the chart statistics', () => {
  it('takes the middle value, the mean of the two middle ones for an even count', () => {
    expect(median([])).toBeUndefined();
    expect(median([140, 120, 130])).toBe(130);
    expect(median([1, 9, 3, 5])).toBe(4);
  });

  it('averages the last 7 calendar days at every day with a value, gaps left empty', () => {
    const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString();
    const average = movingAverage([
      { at: at(1), value: 140 },
      { at: at(1, 21), value: 130 },
      { at: at(3), value: 120 },
      { at: at(8), value: 110 },
      { at: at(20), value: 100 },
    ]);
    expect(average.map((point) => [new Date(point.at).getDate(), point.value])).toEqual([
      [1, 135],
      [3, 130],
      // 2 Oct to 8 Oct: the 1st has left the window.
      [8, 115],
      [20, 100],
    ]);
    expect(new Date(average[0]?.at ?? '').getHours()).toBe(12);
  });
});
