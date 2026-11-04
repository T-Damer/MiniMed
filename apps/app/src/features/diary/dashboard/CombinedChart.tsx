import type { Chart as ChartInstance, Plugin } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createEffect, For, type JSX, onCleanup, onMount, Show, untrack } from 'solid-js';
import { dayAxis } from '@/features/diary/dashboard/chart-days';
import {
  chartValue,
  MARK_LABEL,
  markDataset,
  useChartDays,
} from '@/features/diary/dashboard/chart-marks';
import { median } from '@/features/diary/dashboard/chart-settings';
import {
  type CombinedSeries,
  type CombinedView,
  type MedicineTrack,
  trackMark,
} from '@/features/diary/dashboard/combined-series';
import { alarmPlugin } from '@/features/diary/dashboard/TrendChart';
import { dayKey } from '@/features/diary/diary-care';

export type { CombinedSeries } from '@/features/diary/dashboard/combined-series';

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** A palette colour (`#3c78a0`) at `alpha`: the measured line behind its average. */
function faded(color: string, alpha: number): string {
  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** What each dataset is, by its index: the tooltip and the day card tell them apart. */
type DatasetInfo =
  | { readonly kind: 'series' | 'average'; readonly series: CombinedSeries }
  | { readonly kind: 'median' | 'marks' }
  | { readonly kind: 'track'; readonly track: MedicineTrack };

/** Marks sit a little below the middle of their track; its name is above them. */
const TRACK_MARK_Y = 0.14;

/** The medicine tracks' bands and names, under the marks. */
function tracksPlugin(tracks: () => readonly MedicineTrack[], text: string): Plugin<'line'> {
  return {
    id: 'diary-tracks',
    beforeDatasetsDraw(chart) {
      const scale = chart.scales['tracks'];
      const list = tracks();
      if (!scale || !list.length) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      list.forEach((track, row) => {
        const top = scale.getPixelForValue(row - 0.5);
        const bottom = scale.getPixelForValue(row + 0.5);
        if (row % 2 === 0) {
          ctx.globalAlpha = 0.07;
          ctx.fillStyle = text;
          ctx.fillRect(chartArea.left, top, chartArea.width, bottom - top);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = text;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(track.label, chartArea.left + 4, top + 2, chartArea.width - 8);
      });
      ctx.restore();
    },
  };
}

/**
 * Everything at once (owner 2026-11-03: «a single one combining stats, many lines, no limit
 * lines»): the series the doctor chose on one time axis, each stretched to its own range so the
 * shapes compare, and under them a track per medicine — a square a day it was taken (hollow when
 * only in part), a red cross a day the patient marked a dose as missed (DIARY-CHARTS, owner
 * 2026-11-04: «did the pressure and the pulse fall after amlodipine began»). A median line or a
 * 7-day average on request; days past a red line painted behind. The tooltip gives the real
 * values, a tap opens the day; a name under the chart hides its line.
 */
export function CombinedChart(props: {
  readonly view: CombinedView;
  readonly from: number;
  readonly to: number;
  readonly median: boolean;
  readonly average: boolean;
  readonly legend: boolean;
  /** A tap on a name under the chart hides that line or track. */
  readonly onHide?: ((key: string) => void) | undefined;
  /** A tap on the chart opens that day's details. */
  readonly onDay?: ((day: string) => void) | undefined;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let chart: ChartInstance<'line', { x: number; y: number; value: number }[]> | undefined;
  let marksAt = -1;
  const card = useChartDays();
  /** The day's values in their own units; the time first when a series has several that day. */
  const dayValues = (day: string): string[] => [
    ...props.view.series.flatMap((one) => {
      const points = one.points.filter((point) => dayKey(point.at) === day);
      return points.map((point) => {
        const time =
          points.length > 1
            ? `${new Date(point.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · `
            : '';
        return `${time}${one.label}: ${chartValue(point.value)}${one.unit ? ` ${one.unit}` : ''}`;
      });
    }),
    ...props.view.tracks.flatMap((track) => {
      const one = track.days.find((candidate) => candidate.day === day);
      if (!one || trackMark(one) === 'none') return [];
      const planned = one.prescribed === undefined ? '' : ` из ${chartValue(one.prescribed)}`;
      return [`${track.label}: ${chartValue(one.taken)}${planned} ${track.unit}`];
    }),
  ];

  const render = (): void => {
    if (!canvas) return;
    card.close();
    const { series, tracks, marks, alarms, marksOn } = props.view;
    const text = token('--theme-text-muted', '#6b6458');
    const grid = token('--theme-border', '#ddd4c2');
    const danger = token('--theme-danger', '#b3261e');
    const scaled = (one: CombinedSeries, value: number): number =>
      ((value - one.low) / (one.high - one.low || 1)) * 100;
    const infos: DatasetInfo[] = [];
    const datasets = [];
    for (const one of series) {
      infos.push({ kind: 'series', series: one });
      datasets.push({
        label: one.label,
        data: one.points.map((point) => ({
          x: Date.parse(point.at),
          y: scaled(one, point.value),
          value: point.value,
        })),
        borderColor: props.average ? faded(one.color, 0.35) : one.color,
        backgroundColor: props.average ? faded(one.color, 0.35) : one.color,
        borderWidth: props.average ? 1.25 : 2,
        pointRadius: props.average ? 1.5 : 2,
        tension: 0.25,
        yAxisID: 'y',
      });
      if (props.average) {
        infos.push({ kind: 'average', series: one });
        datasets.push({
          label: `${one.label}, среднее за 7 дней`,
          data: one.average.map((point) => ({
            x: Date.parse(point.at),
            y: scaled(one, point.value),
            value: point.value,
          })),
          borderColor: one.color,
          backgroundColor: one.color,
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.3,
          yAxisID: 'y',
        });
      }
      const middle = props.median ? median(one.points.map((point) => point.value)) : undefined;
      if (middle !== undefined) {
        infos.push({ kind: 'median' });
        datasets.push({
          label: `${one.label}, медиана`,
          data: [props.from, props.to].map((x) => ({ x, y: scaled(one, middle), value: middle })),
          borderColor: one.color,
          backgroundColor: one.color,
          borderWidth: 1.25,
          borderDash: [5, 4],
          pointRadius: 0,
          yAxisID: 'y',
        });
      }
    }
    tracks.forEach((track, row) => {
      const shown = track.days.filter((day) => trackMark(day) !== 'none');
      infos.push({ kind: 'track', track });
      datasets.push({
        label: track.label,
        data: shown.map((day) => ({
          x: Date.parse(`${day.day}T12:00:00`),
          y: row + TRACK_MARK_Y,
          value: day.taken,
        })),
        showLine: false,
        pointStyle: 'rect' as const,
        pointRadius: 5,
        pointHoverRadius: 6,
        pointBorderWidth: 1.5,
        borderColor: track.color,
        backgroundColor: shown.map((day) =>
          trackMark(day) === 'taken' ? track.color : faded(track.color, 0.15),
        ),
        yAxisID: 'tracks',
      });
    });
    marksAt = -1;
    if (marks.length) {
      marksAt = datasets.length;
      infos.push({ kind: 'marks' });
      const onTracks = marksOn === 'tracks';
      datasets.push({
        ...markDataset(marks, danger, onTracks ? 'tracks' : 'y'),
        data: marks.map((mark) => ({
          x: Date.parse(mark.at),
          y: onTracks ? mark.value + TRACK_MARK_Y : mark.value,
          value: mark.value,
        })),
        ...(onTracks ? { pointRadius: 6, pointHoverRadius: 7, pointBorderWidth: 3 } : {}),
      });
    }
    chart?.destroy();
    chart = new ChartJs(canvas, {
      type: 'line',
      data: { datasets },
      plugins: [
        alarmPlugin(
          () => alarms,
          () => danger,
        ),
        tracksPlugin(() => tracks, text),
        card.plugin(() => marksAt),
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        onClick: (event, _elements, current) => card.tap(current, event),
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            filter: (item) => {
              const kind = infos[item.datasetIndex]?.kind;
              return kind !== 'median' && kind !== 'marks';
            },
            callbacks: {
              title: (items) =>
                new Date(items[0]?.parsed.x ?? 0).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                }),
              label: (item) => {
                const info = infos[item.datasetIndex];
                const raw = (item.raw as { value: number }).value;
                if (info?.kind === 'track')
                  return `${info.track.label}: ${chartValue(raw)} ${info.track.unit}`;
                const unit = info && 'series' in info ? info.series.unit : undefined;
                return `${item.dataset.label}: ${chartValue(raw)}${unit ? ` ${unit}` : ''}`;
              },
            },
          },
        },
        scales: {
          x: dayAxis(props.from, props.to, text, grid),
          // Each line has its own scale: the shared axis has no numbers to read.
          y: {
            min: -4,
            max: 104,
            ticks: { display: false },
            grid: { color: grid },
            ...(tracks.length ? { stack: 'combined', stackWeight: 4, weight: 1 } : {}),
          },
          ...(tracks.length
            ? {
                tracks: {
                  type: 'linear' as const,
                  min: -0.5,
                  max: tracks.length - 0.5,
                  reverse: true,
                  stack: 'combined',
                  // Each track as tall as about a fifth of the lines' plot.
                  stackWeight: Math.max(0.6, tracks.length * 0.55),
                  weight: 0,
                  ticks: { display: false },
                  grid: { display: false },
                  border: { display: false },
                },
              }
            : {}),
        },
      },
    });
  };

  // The first draw waits two frames: the canvas work blocked the page's entry animation, which
  // then popped in (DIARY21). Later changes redraw at once.
  let drawn = false;
  createEffect(() => {
    void [props.view, props.from, props.to, props.median, props.average];
    if (drawn) untrack(render);
  });
  onMount(() => {
    const frame = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => {
        drawn = true;
        render();
      });
    });
    let next = 0;
    onCleanup(() => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(next);
    });
  });
  // No tooltip over an open card: the card tells that day.
  createEffect(() => {
    const open = card.open() !== undefined;
    const tooltip = chart?.options.plugins?.tooltip;
    if (!chart || !tooltip || tooltip.enabled === !open) return;
    tooltip.enabled = !open;
    chart.update('none');
  });
  onCleanup(() => chart?.destroy());

  const names = (): string =>
    [...props.view.series, ...props.view.tracks].map((one) => one.label).join(', ');

  return (
    <figure class="diary-chart diary-chart--combined">
      <div
        class="diary-chart__canvas-box diary-chart__canvas-box--tall"
        style={{ '--combined-tracks': String(props.view.tracks.length) }}
      >
        <canvas
          class="diary-chart__canvas"
          ref={canvas}
          role="img"
          aria-label={`Все показатели вместе: ${names()}`}
        />
        <card.Layer marks={props.view.marks} values={dayValues} onDay={props.onDay} />
      </div>
      <Show when={props.legend && (props.view.series.length || props.view.tracks.length)}>
        <ul class="diary-combined-legend" aria-label="Что на графике">
          <For each={props.view.series}>
            {(one) => (
              <li>
                <button
                  type="button"
                  class="diary-combined-legend__item"
                  aria-label={`Скрыть: ${one.label}`}
                  onClick={() => props.onHide?.(one.key)}
                >
                  <span
                    class="diary-combined-legend__line"
                    style={{ 'background-color': one.color }}
                    aria-hidden="true"
                  />
                  {one.label}
                </button>
              </li>
            )}
          </For>
          <For each={props.view.tracks}>
            {(track) => (
              <li>
                <button
                  type="button"
                  class="diary-combined-legend__item"
                  aria-label={`Скрыть: ${track.label}`}
                  onClick={() => props.onHide?.(track.key)}
                >
                  <span
                    class="diary-combined-legend__square"
                    style={{ 'background-color': track.color }}
                    aria-hidden="true"
                  />
                  {track.label}
                </button>
              </li>
            )}
          </For>
          <Show when={props.view.marks.length}>
            <li class="diary-combined-legend__item diary-combined-legend__item--static">
              <span class="diary-mark-card__cross" aria-hidden="true" />
              {MARK_LABEL}
            </li>
          </Show>
        </ul>
      </Show>
    </figure>
  );
}
