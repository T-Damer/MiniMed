import type { Chart as ChartInstance } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createEffect, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';

import type { SeriesPoint } from '@/features/diary/dashboard/diary-insights';

export interface TrendSeries {
  readonly label: string;
  readonly points: readonly SeriesPoint[];
  /** CSS custom property for the line colour (`--theme-accent`, `--theme-danger`…). */
  readonly color: string;
  /** Drawn against the right axis (another unit: saturation next to pulse). */
  readonly axis?: 'right';
}

/** A «red line»: the level above (or below) which a value is a reason to worry. */
export interface TrendLimit {
  readonly value: number;
  readonly label: string;
  readonly axis?: 'right';
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
  /** Dashed red lines from the doctor's thresholds (`state/assessment-limits`). */
  readonly limits?: readonly TrendLimit[];
  /** Fixed range of the right axis. */
  readonly rightMin?: number | undefined;
  readonly rightMax?: number | undefined;
  /** Opens the doctor's «Порог тревоги» for this chart (a pencil in the title row). */
  readonly onLimit?: (() => void) | undefined;
  /** The latest value needs attention: a filled bell in the title row opens why. */
  readonly warning?: { readonly label: string; readonly onOpen: () => void } | undefined;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let chart: ChartInstance<'line', { x: number; y: number }[]> | undefined;

  const render = (): void => {
    if (!canvas) return;
    const text = token('--theme-text-muted', '#6b6458');
    const grid = token('--theme-border', '#ddd4c2');
    const danger = token('--theme-danger', '#b3261e');
    const times = props.series.flatMap((series) =>
      series.points.map((point) => Date.parse(point.at)),
    );
    const start = props.from ?? Math.min(...times);
    const end = props.to ?? Math.max(...times);
    const right = props.series.some((series) => series.axis === 'right');
    const data = {
      datasets: [
        ...props.series.map((series) => ({
          label: series.label,
          data: series.points.map((point) => ({ x: Date.parse(point.at), y: point.value })),
          borderColor: token(series.color, '#3c6478'),
          backgroundColor: token(series.color, '#3c6478'),
          pointRadius: 2.5,
          borderWidth: 2,
          tension: 0.25,
          yAxisID: series.axis === 'right' ? 'y2' : 'y',
        })),
        ...(props.limits ?? []).map((limit) => ({
          label: limit.label,
          data: [
            { x: start, y: limit.value },
            { x: end, y: limit.value },
          ],
          borderColor: danger,
          backgroundColor: danger,
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          pointHitRadius: 0,
          yAxisID: limit.axis === 'right' ? 'y2' : 'y',
        })),
      ],
    };
    const limitLabels = new Set((props.limits ?? []).map((limit) => limit.label));
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
            labels: {
              color: text,
              boxWidth: 10,
              font: { size: 11 },
              filter: (item) => !limitLabels.has(item.text),
            },
          },
          tooltip: {
            filter: (item) => !limitLabels.has(item.dataset.label ?? ''),
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
          ...(right
            ? {
                y2: {
                  position: 'right' as const,
                  ...(props.rightMin === undefined ? {} : { min: props.rightMin }),
                  ...(props.rightMax === undefined ? {} : { max: props.rightMax }),
                  ticks: { color: text, maxTicksLimit: 6 },
                  grid: { drawOnChartArea: false },
                },
              }
            : {}),
        },
      },
    });
  };

  // Runs after the canvas is in the page and again whenever the series change.
  createEffect(render);
  onCleanup(() => chart?.destroy());

  return (
    <figure class="diary-chart">
      <figcaption class="diary-chart__head">
        <span class="diary-chart__title">{props.title}</span>
        <span class="diary-chart__actions">
          <Show when={props.warning}>
            {(warning) => (
              <Button
                variant="icon"
                class="diary-chart__warning"
                icon={<AppGlyph name="bell-fill" />}
                aria-label={warning().label}
                onClick={() => warning().onOpen()}
              />
            )}
          </Show>
          <Show when={props.onLimit}>
            {(open) => (
              <Button
                variant="icon"
                class="diary-chart__limit"
                icon={<AppGlyph name="edit" />}
                aria-label={`Порог тревоги: ${props.title}`}
                onClick={() => open()()}
              />
            )}
          </Show>
        </span>
      </figcaption>
      <div class="diary-chart__canvas-box">
        <canvas class="diary-chart__canvas" ref={canvas} aria-label={props.title} role="img" />
      </div>
    </figure>
  );
}
