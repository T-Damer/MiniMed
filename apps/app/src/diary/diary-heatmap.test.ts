import { describe, expect, it } from 'vitest';

import {
  activeHeatParts,
  heatFilterSummary,
  heatmapRange,
  heatTitle,
  monthEnd,
  shiftMonth,
  toggleHeatPart,
} from '@/diary/diary-heatmap-range';
import type { HeatPart } from '@/features/diary/diary-care';

describe('heatmapRange', () => {
  it('shows only the current month in full when the diary started this month', () => {
    const range = heatmapRange('2026-10-20', '2026-10-27');
    expect(range.months).toEqual(['2026-10']);
    expect(range.from).toBe('2026-10-01');
    expect(range.to).toBe('2026-10-31');
  });

  it('runs from the first of the starting month to the last of the current one', () => {
    const range = heatmapRange('2026-08-15', '2026-10-27');
    expect(range.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(range.from).toBe('2026-08-01');
    expect(range.to).toBe('2026-10-31');
  });

  it('keeps the current month whole even on its first day', () => {
    const range = heatmapRange('2026-01-05', '2026-02-01');
    expect(range.months).toEqual(['2026-01', '2026-02']);
    expect(range.to).toBe('2026-02-28');
  });

  it('knows leap years', () => {
    expect(heatmapRange('2028-02-10', '2028-02-11').to).toBe('2028-02-29');
  });

  it('shows at most twelve months, crossing the year boundary', () => {
    const range = heatmapRange('2020-03-01', '2026-10-27');
    expect(range.months).toHaveLength(12);
    expect(range.months[0]).toBe('2025-11');
    expect(range.months[11]).toBe('2026-10');
    expect(range.from).toBe('2025-11-01');
  });

  it('shows exactly twelve months when the diary is just that old', () => {
    const range = heatmapRange('2025-11-30', '2026-10-27');
    expect(range.months).toHaveLength(12);
    expect(range.from).toBe('2025-11-01');
  });

  it('falls back to the current month when the start is in the future', () => {
    expect(heatmapRange('2026-12-01', '2026-10-27').months).toEqual(['2026-10']);
  });
});

describe('month helpers', () => {
  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthEnd('2026-04')).toBe('2026-04-30');
  });

  it('titles a single month and a range', () => {
    expect(heatTitle('2026-10', '2026-10')).toBe('Октябрь 2026');
    expect(heatTitle('2025-11', '2026-10')).toBe('Ноябрь 2025 — октябрь 2026');
  });
});

describe('part filter', () => {
  const parts: readonly HeatPart[] = ['doses', 'scores', 'vitals', 'notes'];

  it('reads an empty or foreign choice as all parts', () => {
    expect(activeHeatParts(parts, new Set())).toEqual(parts);
    expect(activeHeatParts(parts, new Set<HeatPart>(['answers']))).toEqual(parts);
    expect(activeHeatParts(parts, new Set<HeatPart>(['scores', 'answers']))).toEqual(['scores']);
  });

  it('summarises the choice for the button', () => {
    expect(heatFilterSummary(parts, new Set())).toBe('Всё');
    expect(heatFilterSummary(parts, new Set(parts))).toBe('Всё');
    expect(heatFilterSummary(parts, new Set<HeatPart>(['doses']))).toBe('Лекарства');
    expect(heatFilterSummary(parts, new Set<HeatPart>(['doses', 'notes', 'vitals']))).toBe(
      '3 из 4',
    );
  });

  it('switches a part and never the last one off', () => {
    const one = toggleHeatPart(parts, new Set(), 'scores');
    expect([...one].sort()).toEqual(['doses', 'notes', 'vitals']);
    const alone = new Set<HeatPart>(['notes']);
    expect(toggleHeatPart(parts, alone, 'notes')).toEqual(alone);
    expect([...toggleHeatPart(parts, alone, 'doses')].sort()).toEqual(['doses', 'notes']);
  });
});
