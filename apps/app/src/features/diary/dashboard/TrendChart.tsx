import type { Chart as ChartInstance, Plugin } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createEffect, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';

import { dayAxis, tappedDay, zonePlugin } from '@/features/diary/dashboard/chart-days';
import type { SeriesPoint } from '@/features/diary/dashboard/diary-insights';

export interface TrendSeries {
  readonly label: string;
  readonly points: readonly SeriesPoint[];
  /** CSS custom property for the line colour (`--theme-accent`, `--theme-danger`…). */
  readonly color: string;
  /** Drawn against the right axis (another unit: saturation next to pulse). */
  readonly axis?: 'right';
  /**
   * `target`: a dotted step line, no points — what the plan asks for (the prescribed dose next to
   * the dose taken, owner 2026-11-03: «a dotted line, like the limits we set»). `dots`: points only.
   */
  readonly style?: 'line' | 'dots' | 'target';
}

/** A «red line»: the level above (or below) which a value is a reason to worry. */
export interface TrendLimit {
  readonly value: number;
  readonly label: string;
  readonly axis?: 'right';
  /** Which side is the worry: that side of the line is always painted red behind the lines. */
  readonly kind?: 'above' | 'below';
}

const DAY_MS = 86_400_000;

/**
 * Days painted red behind the lines (owner 2026-11-03: «when a dot hits a warning level»): one
 * soft column per point past a red line, a day wide.
 */
export function alarmPlugin(
  times: () => readonly number[],
  color: () => string,
  alpha = 0.16,
): Plugin<'line'> {
  return {
    id: 'diary-alarms',
    beforeDatasetsDraw(chart) {
      const marks = times();
      const x = chart.scales['x'];
      if (!marks.length || !x) return;
      const { ctx, chartArea } = chart;
      const day = Math.abs(x.getPixelForValue(DAY_MS) - x.getPixelForValue(0));
      const width = Math.max(6, Math.min(day * 0.9, 28));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color();
      for (const time of marks) {
        const center = x.getPixelForValue(time);
        if (center < chartArea.left - width || center > chartArea.right + width) continue;
        const left = Math.max(chartArea.left, center - width / 2);
        const right = Math.min(chartArea.right, center + width / 2);
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      }
      ctx.restore();
    },
  };
}

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function dayDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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
  /** One value per day: the tooltip names the day without a time. */
  readonly daily?: boolean;
  /** A tap on the chart opens that day (DIARY21). */
  readonly onDay?: ((day: string) => void) | undefined;
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
          ...(series.style === 'dots'
            ? {
                showLine: false,
                pointRadius: 5,
                pointBorderWidth: 2,
                pointBackgroundColor: 'transparent',
              }
            : series.style === 'target'
              ? {
                  borderDash: [5, 4],
                  borderWidth: 2,
                  stepped: 'middle' as const,
                  pointRadius: 0,
                  pointHitRadius: 8,
                }
              : { pointRadius: 2.5, borderWidth: 2, tension: props.daily ? 0 : 0.25 }),
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
      plugins: [
        zonePlugin(
          () =>
            (props.limits ?? []).flatMap((limit) =>
              limit.kind ? [{ value: limit.value, kind: limit.kind, axis: limit.axis }] : [],
            ),
          () => danger,
        ),
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        onClick: (event, _elements, current) => {
          const day = tappedDay(current, event.x);
          if (day) props.onDay?.(day);
        },
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
              title: (items) =>
                (props.daily ? dayDate : shortDate)(
                  new Date(items[0]?.parsed.x ?? 0).toISOString(),
                ),
            },
          },
        },
        scales: {
          x:
            props.from !== undefined && props.to !== undefined
              ? dayAxis(props.from, props.to, text, grid)
              : {
                  type: 'linear',
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
