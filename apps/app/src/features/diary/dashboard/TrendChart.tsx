import type { Chart as ChartInstance } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createEffect, type JSX, onCleanup } from 'solid-js';

import type { SeriesPoint } from '@/features/diary/dashboard/diary-insights';

export interface TrendSeries {
  readonly label: string;
  readonly points: readonly SeriesPoint[];
  /** CSS custom property for the line colour (`--theme-accent`, `--theme-danger`…). */
  readonly color: string;
}

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * A small time chart for one group of measurements (wellbeing, pressure and pulse, saturation,
 * questionnaire totals). Points are spaced by time; the y range can be fixed (0–10, 0–27).
 */
export function TrendChart(props: {
  readonly title: string;
  readonly series: readonly TrendSeries[];
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** Time range shown (ms); the chosen period, so a single point does not stretch the axis. */
  readonly from?: number | undefined;
  readonly to?: number | undefined;
  /** Horizontal guide lines, e.g. the questionnaire band limits. */
  readonly guides?: readonly number[];
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let chart: ChartInstance<'line', { x: number; y: number }[]> | undefined;

  const render = (): void => {
    if (!canvas) return;
    const text = token('--theme-text-muted', '#6b6458');
    const grid = token('--theme-border', '#ddd4c2');
    const data = {
      datasets: props.series.map((series) => ({
        label: series.label,
        data: series.points.map((point) => ({ x: Date.parse(point.at), y: point.value })),
        borderColor: token(series.color, '#3c6478'),
        backgroundColor: token(series.color, '#3c6478'),
        pointRadius: 2.5,
        borderWidth: 2,
        tension: 0.25,
      })),
    };
    chart?.destroy();
    chart = new ChartJs(canvas, {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            display: props.series.length > 1,
            labels: { color: text, boxWidth: 10, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              title: (items) => shortDate(new Date(items[0]?.parsed.x ?? 0).toISOString()),
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            ...(props.from === undefined ? {} : { min: props.from }),
            ...(props.to === undefined ? {} : { max: props.to }),
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
          y: {
            ...(props.min === undefined ? {} : { min: props.min }),
            ...(props.max === undefined ? {} : { max: props.max }),
            ticks: { color: text, maxTicksLimit: 6 },
            grid: {
              color: (context) =>
                props.guides?.includes(Number(context.tick.value))
                  ? token('--theme-warning', '#b06a12')
                  : grid,
            },
          },
        },
      },
    });
  };

  // Runs after the canvas is in the page and again whenever the series change.
  createEffect(render);
  onCleanup(() => chart?.destroy());

  return (
    <figure class="diary-chart">
      <figcaption class="diary-chart__title">{props.title}</figcaption>
      <div class="diary-chart__canvas-box">
        <canvas class="diary-chart__canvas" ref={canvas} aria-label={props.title} role="img" />
      </div>
    </figure>
  );
}
