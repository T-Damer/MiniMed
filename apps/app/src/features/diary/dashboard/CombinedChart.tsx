import type { Chart as ChartInstance } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createEffect, type JSX, onCleanup } from 'solid-js';

import type { SeriesPoint } from '@/features/diary/dashboard/diary-insights';
import { alarmPlugin } from '@/features/diary/dashboard/TrendChart';

/** One line of the combined chart: drawn on its own range, told in its own units. */
export interface CombinedSeries {
  readonly label: string;
  readonly unit?: string;
  readonly points: readonly SeriesPoint[];
  /** The value drawn at the bottom and at the top of the chart. */
  readonly low: number;
  readonly high: number;
}

/**
 * Distinct line colours, readable on the light paper and the dark desk alike; a chart of many
 * lines cannot lean on the few theme accents.
 */
const PALETTE = [
  '#3c78a0',
  '#d0812e',
  '#b8504a',
  '#4f9a6c',
  '#8a6bb8',
  '#2fa3a3',
  '#c2648f',
  '#8c8a2e',
  '#a3764d',
  '#5e70b0',
] as const;

/** A sensible range for a value without a fixed scale: the values seen, a little padded. */
export function rangeOf(points: readonly SeriesPoint[]): { low: number; high: number } {
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (!Number.isFinite(low)) return { low: 0, high: 1 };
  const pad = high === low ? Math.max(1, Math.abs(high) * 0.1) : (high - low) * 0.15;
  return { low: low - pad, high: high + pad };
}

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Everything at once (owner 2026-11-03: «a single one combining stats, many lines, no limit
 * lines»): every series on one time axis, each stretched to its own range so the shapes compare;
 * the tooltip gives the real values. Days past a red line are painted behind the lines; tapping a
 * name in the legend hides or shows its line.
 */
export function CombinedChart(props: {
  readonly series: readonly CombinedSeries[];
  readonly from: number;
  readonly to: number;
  /** Times of points past the doctor's red lines (any series). */
  readonly alarms: readonly number[];
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let chart: ChartInstance<'line', { x: number; y: number; value: number }[]> | undefined;

  const render = (): void => {
    if (!canvas) return;
    const text = token('--theme-text-muted', '#6b6458');
    const grid = token('--theme-border', '#ddd4c2');
    const danger = token('--theme-danger', '#b3261e');
    const alarms = props.alarms;
    const series = props.series;
    chart?.destroy();
    chart = new ChartJs(canvas, {
      type: 'line',
      data: {
        datasets: series.map((one, index) => {
          const color = PALETTE[index % PALETTE.length] ?? PALETTE[0];
          const span = one.high - one.low || 1;
          return {
            label: one.label,
            data: one.points.map((point) => ({
              x: Date.parse(point.at),
              y: ((point.value - one.low) / span) * 100,
              value: point.value,
            })),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
          };
        }),
      },
      plugins: [
        alarmPlugin(
          () => alarms,
          () => danger,
        ),
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: text, boxWidth: 10, boxHeight: 10, font: { size: 11 } },
          },
          tooltip: {
            mode: 'index',
            callbacks: {
              title: (items) =>
                new Date(items[0]?.parsed.x ?? 0).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                }),
              label: (item) => {
                const one = series[item.datasetIndex];
                const raw = (item.raw as { value: number }).value;
                const value = Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
                return `${item.dataset.label}: ${value}${one?.unit ? ` ${one.unit}` : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: props.from,
            max: props.to,
            ticks: {
              color: text,
              maxTicksLimit: 6,
              callback: (value) =>
                new Date(Number(value)).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                }),
            },
            grid: { color: grid },
          },
          // Each line has its own scale: the shared axis has no numbers to read.
          y: { min: -4, max: 104, ticks: { display: false }, grid: { color: grid } },
        },
      },
    });
  };

  createEffect(render);
  onCleanup(() => chart?.destroy());

  return (
    <figure class="diary-chart diary-chart--combined">
      <div class="diary-chart__canvas-box diary-chart__canvas-box--tall">
        <canvas
          class="diary-chart__canvas"
          ref={canvas}
          role="img"
          aria-label={`Все показатели вместе: ${props.series.map((one) => one.label).join(', ')}`}
        />
      </div>
    </figure>
  );
}
