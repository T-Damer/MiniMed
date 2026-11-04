/**
 * A tap on a diary chart and its red crosses (DIARY23, owner 2026-11-04: «when a patient marks a
 * dose as missed, show a red cross; a tap shows what happened and leads further»): the crosses as
 * a Chart.js dataset drawn above the lines, a button over each, and the card a tap on any day
 * opens next to it, with «Подробнее» opening that day. A dose nobody marked is a gap in the data,
 * not a cross.
 */
import type { Chart, ChartEvent, LegendItem, Plugin } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { tappedDay } from '@/features/diary/dashboard/chart-days';
import { useHistoryLayer } from '@/state/use-history-layer';

/** One crossed-out day on a chart and what its card tells. */
export interface ChartMark {
  /** Where the cross sits: ISO time on x, the value on y (the chart's own units). */
  readonly at: string;
  readonly value: number;
  /** Local day `YYYY-MM-DD` that «Подробнее» opens. */
  readonly day: string;
  /** «Пропущен приём», «Пропущено приёмов: 2». */
  readonly title: string;
  /** One line per skipped intake, the patient's note in quotes after its line. */
  readonly lines: readonly string[];
}

/** The crosses' legend name. */
export const MARK_LABEL = 'Пропущено';

/** The crosses as a dataset: points only, drawn last (on top of the lines), easy to hit. */
export function markDataset(marks: readonly ChartMark[], color: string, yAxisID = 'y') {
  return {
    label: MARK_LABEL,
    data: marks.map((mark) => ({ x: Date.parse(mark.at), y: mark.value })),
    showLine: false,
    pointStyle: 'crossRot' as const,
    pointRadius: 8,
    pointHoverRadius: 9,
    pointBorderWidth: 3.5,
    pointHoverBorderWidth: 3.5,
    pointHitRadius: 16,
    // A cross on 0 sits on the axis: drawn whole, not cut at the plot's edge.
    clip: false as const,
    borderColor: color,
    backgroundColor: color,
    // The highest order is drawn first: the crosses stay above the lines they sit on.
    order: -1,
    yAxisID,
  };
}

/** Legend items: the crosses as a cross, every other series keeps its usual square. */
export function markLegendLabels(chart: Chart): LegendItem[] {
  return ChartJs.defaults.plugins.legend.labels
    .generateLabels(chart)
    .map((item) => (item.text === MARK_LABEL ? item : { ...item, pointStyle: 'rect' }));
}

/** Where something is drawn, in the chart's CSS pixels. */
interface Spot {
  readonly x: number;
  readonly y: number;
}

/** The tapped day: where its card points, and the plot's edges and a day's width for its band. */
interface OpenDay extends Spot {
  readonly day: string;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

const DAY_MS = 86_400_000;

/** What a chart tells about one day: one line per value («Принято: 10», «09:02 · Пульс: 72»). */
export type DayValues = (day: string) => readonly string[];

/** «10», «36.6». */
export function chartValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A tap on a chart shows that day first (owner 2026-11-04: «first you click and see a tooltip, in
 * it a «Подробнее» button opens the day»): a card next to the finger with the day's values, and
 * the red cross's reasons when the patient marked a dose as missed; «Подробнее» opens the day's
 * sheet. Each drawn cross also gets a button over it (a tap target, a name for screen readers, a
 * keyboard stop) that shows its day. A tap outside closes the card, and the chart's own tap that
 * follows is swallowed (`justClosed`), so closing a card does not open another one.
 */
export function useChartDays() {
  const [open, setOpen] = createSignal<OpenDay | undefined>();
  const [spots, setSpots] = createSignal<readonly Spot[]>([]);
  let area = { top: 0, bottom: 0, width: 0 };
  let closedAt = 0;
  const close = (): void => {
    if (!open()) return;
    closedAt = performance.now();
    setOpen(undefined);
  };
  const justClosed = (): boolean => performance.now() - closedAt < 400;
  const show = (day: string, at: Spot): void => {
    setOpen({ day, ...at, ...area });
  };
  // A history layer like every popover: back closes the card, not the page.
  useHistoryLayer(() => open() !== undefined, close);
  return {
    open,
    close,
    /** The chart's own tap: the day under the finger shows its card next to it. */
    tap: (chart: Chart, event: ChartEvent): void => {
      if (justClosed()) return;
      const day = tappedDay(chart, event.x);
      const scale = chart.scales['x'];
      if (!day || !scale) return;
      const noon = new Date(`${day}T12:00:00`).getTime();
      const { top, bottom } = chart.chartArea;
      // The day's middle, so its band covers the day's points.
      show(day, { x: scale.getPixelForValue(noon), y: event.y ?? (top + bottom) / 2 });
    },
    /** Keeps the plot's edges and the crosses of dataset `index()` after every draw. */
    plugin: (index: () => number): Plugin<'line'> => ({
      id: 'diary-chart-days',
      afterDraw(chart) {
        const scale = chart.scales['x'];
        area = {
          top: chart.chartArea.top,
          bottom: chart.chartArea.bottom,
          width: scale ? Math.abs(scale.getPixelForValue(DAY_MS) - scale.getPixelForValue(0)) : 0,
        };
        const at = index();
        const next =
          at < 0 ? [] : chart.getDatasetMeta(at).data.map((point) => ({ x: point.x, y: point.y }));
        const now = spots();
        const same =
          next.length === now.length &&
          next.every((spot, i) => spot.x === now[i]?.x && spot.y === now[i]?.y);
        if (!same) setSpots(next);
      },
    }),
    /** The crosses' buttons, the open day's band and its card, laid over the canvas. */
    Layer: (props: {
      readonly marks: readonly ChartMark[];
      readonly values: DayValues;
      readonly onDay?: ((day: string) => void) | undefined;
    }): JSX.Element => (
      <>
        <For each={spots()}>
          {(spot, index) => {
            const mark = () => props.marks[index()];
            return (
              <Show when={mark()}>
                {(one) => (
                  <button
                    type="button"
                    class="diary-chart__mark"
                    style={{ left: `${spot.x}px`, top: `${spot.y}px` }}
                    aria-label={`${one().title}, ${dayDate(one().day)}`}
                    aria-expanded={open()?.day === one().day}
                    onClick={() => (open()?.day === one().day ? close() : show(one().day, spot))}
                  />
                )}
              </Show>
            );
          }}
        </For>
        <Show when={open()}>
          {(current) => (
            <>
              <span
                class="diary-chart__day-line"
                style={{
                  left: `${current().x}px`,
                  top: `${current().top}px`,
                  width: `${Math.max(4, current().width)}px`,
                  height: `${current().bottom - current().top}px`,
                }}
              />
              <DayCard
                open={current()}
                marks={props.marks.filter((mark) => mark.day === current().day)}
                values={props.values(current().day)}
                onClose={close}
                {...(props.onDay
                  ? {
                      onMore: (day: string) => {
                        close();
                        props.onDay?.(day);
                      },
                    }
                  : {})}
              />
            </>
          )}
        </Show>
      </>
    ),
  };
}

/** «пт, 30 октября». */
function dayDate(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
}

/**
 * The day's card: under the plot, so the day's band and points stay in view; kept inside the
 * chart's width. The day, then a red cross with what the patient said, then the values;
 * «Подробнее» opens the day. Escape and a tap anywhere else close it.
 */
function DayCard(props: {
  readonly open: OpenDay;
  readonly marks: readonly ChartMark[];
  readonly values: readonly string[];
  readonly onMore?: (day: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  let card: HTMLDivElement | undefined;
  onMount(() => {
    // A cross's own button toggles the card itself.
    const outside = (event: PointerEvent): void => {
      const target = event.target as Element;
      if (card?.contains(target) || target.closest?.('.diary-chart__mark')) return;
      props.onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey);
    });
  });
  return (
    <div
      ref={card}
      class="diary-mark-card"
      role="dialog"
      aria-label={dayDate(props.open.day)}
      style={{ '--mark-x': `${props.open.x}px`, '--mark-y': `${props.open.bottom}px` }}
    >
      <p class="diary-mark-card__date">{dayDate(props.open.day)}</p>
      <For each={props.marks}>
        {(mark) => (
          <div class="diary-mark-card__miss">
            <p class="diary-mark-card__title">
              <span class="diary-mark-card__cross" aria-hidden="true" />
              {mark.title}
            </p>
            <ul class="diary-mark-card__lines">
              <For each={mark.lines}>
                {(line) => (
                  <li classList={{ 'diary-mark-card__note': line.startsWith('«') }}>{line}</li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
      <Show when={props.values.length || !props.marks.length}>
        <ul class="diary-mark-card__lines diary-mark-card__values">
          <For each={props.values} fallback={<li class="diary-mark-card__note">Нет записей</li>}>
            {(line) => <li>{line}</li>}
          </For>
        </ul>
      </Show>
      <Show when={props.onMore}>
        {(more) => (
          <Button
            class="diary-mark-card__more"
            variant="quiet"
            onClick={() => more()(props.open.day)}
          >
            Подробнее
          </Button>
        )}
      </Show>
    </div>
  );
}
