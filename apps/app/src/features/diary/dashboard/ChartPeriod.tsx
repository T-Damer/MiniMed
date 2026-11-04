import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { DateField } from '@/components/DateField';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  type ChartSpan,
  clampSpan,
  spanDays,
  spanLabel,
} from '@/features/diary/dashboard/chart-period';
import { addDays, dayStart } from '@/features/diary/diary-care';

import '@/features/diary/dashboard/chart-settings.css';

/** Any dates for the charts' period: «С» and «По», each change applied at once. */
export function ChartDatesSheet(props: {
  readonly span: ChartSpan;
  readonly today: string;
  readonly onSpan: (span: ChartSpan) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const set = (span: ChartSpan): void => props.onSpan(clampSpan(span, props.today));
  return (
    <OverlayDialog open title="Период" onClose={props.onClose}>
      <div class="diary-chart-dates">
        <DateField
          label="С"
          value={props.span.from}
          max={props.span.to}
          onChange={(from) => from && set({ from, to: props.span.to })}
        />
        <DateField
          label="По"
          value={props.span.to}
          min={props.span.from}
          max={props.today}
          onChange={(to) => to && set({ from: props.span.from, to })}
        />
        <Button variant="primary" onClick={props.onClose}>
          Готово
        </Button>
      </div>
    </OverlayDialog>
  );
}

/** One line of the overview, its values already on 0–100. */
export interface BrushLine {
  readonly color: string;
  readonly points: readonly { readonly at: string; readonly value: number }[];
}

const WIDTH = 1000;
const HEIGHT = 40;

type Drag =
  | { readonly kind: 'move'; readonly startX: number; readonly start: ChartSpan }
  | { readonly kind: 'from' | 'to'; readonly startX: number; readonly start: ChartSpan };

/**
 * The whole diary in a strip under the chart with the shown period as a window (DIARY-CHARTS):
 * drag the window to move the period, its edges to widen or narrow it, tap the strip to centre the
 * period there. The arrow keys move the window by a day. The chart follows when the finger lifts.
 */
export function ChartBrush(props: {
  readonly first: string;
  readonly today: string;
  readonly span: ChartSpan;
  readonly lines: readonly BrushLine[];
  readonly onSpan: (span: ChartSpan) => void;
}): JSX.Element {
  let strip: HTMLDivElement | undefined;
  const [preview, setPreview] = createSignal<ChartSpan>();
  const total = (): number => Math.max(1, spanDays({ from: props.first, to: props.today }));
  const shown = (): ChartSpan => preview() ?? props.span;
  /** Days from the first day; may be negative or past the end for a span outside the diary. */
  const offset = (day: string): number => spanDays({ from: props.first, to: day }) - 1;
  const left = (): number => Math.max(0, offset(shown().from) / total());
  const right = (): number => Math.min(1, (offset(shown().to) + 1) / total());
  const dayAt = (clientX: number): number => {
    const box = strip?.getBoundingClientRect();
    if (!box?.width) return 0;
    return Math.round(((clientX - box.left) / box.width) * total());
  };
  const fit = (span: ChartSpan): ChartSpan => {
    const length = spanDays(span);
    let from = span.from < props.first ? props.first : span.from;
    let to = addDays(from, length - 1);
    if (to > props.today) {
      to = props.today;
      from = addDays(to, 1 - length) < props.first ? props.first : addDays(to, 1 - length);
    }
    return { from, to };
  };
  let drag: Drag | undefined;
  const moveTo = (clientX: number): void => {
    if (!drag) return;
    const days = dayAt(clientX) - dayAt(drag.startX);
    const { start } = drag;
    if (drag.kind === 'move') {
      setPreview(fit({ from: addDays(start.from, days), to: addDays(start.to, days) }));
    } else if (drag.kind === 'from') {
      const from = addDays(start.from, days);
      setPreview({
        from: from > start.to ? start.to : from < props.first ? props.first : from,
        to: start.to,
      });
    } else {
      const to = addDays(start.to, days);
      setPreview({
        from: start.from,
        to: to < start.from ? start.from : to > props.today ? props.today : to,
      });
    }
  };
  const finish = (): void => {
    const next = preview();
    drag = undefined;
    setPreview(undefined);
    if (next && (next.from !== props.span.from || next.to !== props.span.to)) props.onSpan(next);
  };
  const begin = (event: PointerEvent, kind: Drag['kind']): void => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    drag = { kind, startX: event.clientX, start: props.span };
  };
  const centre = (event: PointerEvent): void => {
    const length = spanDays(props.span);
    const middle = addDays(props.first, dayAt(event.clientX));
    props.onSpan(
      fit({
        from: addDays(middle, -Math.floor(length / 2)),
        to: addDays(middle, length - 1 - Math.floor(length / 2)),
      }),
    );
  };
  const onKey = (event: KeyboardEvent): void => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    props.onSpan(fit({ from: addDays(props.span.from, step), to: addDays(props.span.to, step) }));
  };
  onCleanup(() => {
    drag = undefined;
  });
  const start = (): number => dayStart(props.first).getTime();
  const width = (): number => total() * 86_400_000;
  const path = (line: BrushLine): string =>
    line.points
      .map((point, index) => {
        const x = ((Date.parse(point.at) - start()) / width()) * WIDTH;
        const y = HEIGHT - 3 - (Math.min(100, Math.max(0, point.value)) / 100) * (HEIGHT - 6);
        return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div class="diary-chart-brush">
      <div
        ref={strip}
        class="diary-chart-brush__strip"
        onPointerDown={centre}
        onPointerMove={(event) => moveTo(event.clientX)}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <svg
          class="diary-chart-brush__lines"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <For each={props.lines}>
            {(line) => (
              <path
                d={path(line)}
                fill="none"
                stroke={line.color}
                stroke-width="1.25"
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
        </svg>
        <div
          class="diary-chart-brush__window"
          classList={{ 'diary-chart-brush__window--dragging': preview() !== undefined }}
          style={{ left: `${left() * 100}%`, width: `${Math.max(0, right() - left()) * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Период на графике"
          aria-valuemin={0}
          aria-valuemax={total() - 1}
          aria-valuenow={Math.max(0, offset(shown().from))}
          aria-valuetext={spanLabel(shown(), props.today)}
          onPointerDown={(event) => begin(event, 'move')}
          onKeyDown={onKey}
        >
          <span
            class="diary-chart-brush__handle diary-chart-brush__handle--from"
            onPointerDown={(event) => begin(event, 'from')}
          />
          <span
            class="diary-chart-brush__handle diary-chart-brush__handle--to"
            onPointerDown={(event) => begin(event, 'to')}
          />
        </div>
      </div>
      <Show when={preview()}>
        {(span) => <p class="diary-chart-brush__label">{spanLabel(span(), props.today)}</p>}
      </Show>
    </div>
  );
}
