import { describe, expect, it } from 'vitest';

import { chartSeries, DIARY_CHARTS } from '@/features/diary/dashboard/diary-charts';
import type { DiaryEntry } from '@/features/diary/diary-model';
import { MEASUREMENT_LIMIT_LABEL } from '@/state/assessment-limits';

const entry = (at: string, values: DiaryEntry['values'], check?: string): DiaryEntry =>
  ({ id: at, at, values, ...(check ? { check } : {}) }) as DiaryEntry;

describe('diary charts as data', () => {
  it('declares unique charts, each with named red lines the doctor can set', () => {
    expect(new Set(DIARY_CHARTS.map((chart) => chart.id)).size).toBe(DIARY_CHARTS.length);
    for (const chart of DIARY_CHARTS) {
      expect(chart.limits?.length).toBeGreaterThan(0);
      for (const limit of chart.limits ?? [])
        expect(MEASUREMENT_LIMIT_LABEL[limit.id]).toBeTruthy();
    }
  });

  it('splits by checkpoint and hides a chart without points', () => {
    const entries = [
      entry('2026-10-20T09:00:00.000Z', { wellbeing: 4 }, 'am'),
      entry('2026-10-20T21:00:00.000Z', { wellbeing: 7 }, 'pm'),
      entry('2026-10-21T09:00:00.000Z', { pulse: 80 }),
    ];
    const wellbeing = DIARY_CHARTS.find((chart) => chart.id === 'wellbeing');
    const pressure = DIARY_CHARTS.find((chart) => chart.id === 'pressure');
    const pulse = DIARY_CHARTS.find((chart) => chart.id === 'pulse-spo2');
    if (!wellbeing || !pressure || !pulse) throw new Error('charts missing');
    expect(chartSeries(wellbeing, entries).map((one) => one.points.map((p) => p.value))).toEqual([
      [4],
      [7],
    ]);
    expect(chartSeries(pressure, entries)).toEqual([]);
    expect(chartSeries(pulse, entries).map((one) => one.points.length)).toEqual([1, 0]);
  });
});
