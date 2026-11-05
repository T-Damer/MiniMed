/**
 * What the diary's time charts share (DIARY21, owner 2026-11-03): a label for every day or every
 * other day, as many as fit; the red zone past each «порог тревоги», always painted, so a point in
 * it is a bad day at a glance; and the day under a tap.
 */
import type { Chart, Plugin, Scale } from 'chart.js';

import { dayKey } from '@/features/diary/diary-care';

/** Noon of every local day from `from` to `to`: one tick per day, between the days' points. */
export function dayTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  if (start.getTime() < from) start.setDate(start.getDate() + 1);
  for (const day = start; day.getTime() <= to; day.setDate(day.getDate() + 1)) {
    ticks.push(day.getTime());
  }
  return ticks;
}

/** «4 окт.» on the first tick and on the 1st of a month, the bare day number elsewhere. */
export function dayTickLabel(value: number, index: number): string {
  const date = new Date(value);
  return index === 0 || date.getDate() === 1
    ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    : String(date.getDate());
}

/** The x axis options of a day-ticked time chart; Chart.js skips the labels that do not fit. */
export function dayAxis(from: number, to: number, color: string, grid: string) {
  return {
    type: 'linear' as const,
    min: from,
    max: to,
    afterBuildTicks: (scale: Scale) => {
      scale.ticks = dayTicks(from, to).map((value) => ({ value }));
    },
    ticks: {
      color,
      autoSkip: true,
      autoSkipPadding: 6,
      maxRotation: 0,
      font: { size: 10 },
      callback: (value: string | number, index: number) => dayTickLabel(Number(value), index),
    },
    grid: { color: grid },
  };
}

export interface ChartZone {
  readonly value: number;
  readonly kind: 'above' | 'below';
  readonly axis?: 'right' | undefined;
}

/** Paints the side of each red line that means worry, behind the lines. */
export function zonePlugin(
  zones: () => readonly ChartZone[],
  color: () => string,
  alpha = 0.12,
): Plugin<'line'> {
  return {
    id: 'diary-zones',
    beforeDatasetsDraw(chart: Chart<'line'>) {
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color();
      for (const zone of zones()) {
        const scale = chart.scales[zone.axis === 'right' ? 'y2' : 'y'];
        if (!scale) continue;
        const y = Math.min(
          chartArea.bottom,
          Math.max(chartArea.top, scale.getPixelForValue(zone.value)),
        );
        if (zone.kind === 'above')
          ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, y - chartArea.top);
        else ctx.fillRect(chartArea.left, y, chartArea.width, chartArea.bottom - y);
      }
      ctx.restore();
    },
  };
}

/** The local day under a tap on the chart, if it fell inside the plot. */
export function tappedDay(chart: Chart, x: number | null | undefined): string | undefined {
  const scale = chart.scales['x'];
  if (x === null || x === undefined || !scale) return undefined;
  const { left, right } = chart.chartArea;
  if (x < left || x > right) return undefined;
  return dayKey(new Date(scale.getValueForPixel(x) ?? Date.now()));
}
