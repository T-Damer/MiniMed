import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { pluralize } from '@/diary/diary-format';
import {
  activeHeatParts,
  heatFilterSummary,
  heatmapRange,
  heatTitle,
  toggleHeatPart,
} from '@/diary/diary-heatmap-range';
import {
  dayStart,
  HEAT_PART_LABEL,
  type HeatDay,
  type HeatPart,
} from '@/features/diary/diary-care';

import './diary-heatmap.css';

export { heatmapRange, heatTitle };

/** No choice made: every part counts. */
const ALL_PARTS: ReadonlySet<HeatPart> = new Set();

// The first cell sits beside the month label row; then Monday to Sunday.
const WEEKDAYS = ['', 'Пн', '', 'Ср', '', 'Пт', '', ''];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function heatDayLabel(day: HeatDay): string {
  const date = dayStart(day.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const symptoms = day.symptoms > 0 ? ', есть симптомы' : '';
  if (day.total > 0)
    return `${date}: ${day.done} из ${day.total} ${pluralize(day.total, 'отметки', 'отметок', 'отметок')}${symptoms}`;
  if (day.entries > 0) {
    return `${date}: ${day.entries} ${pluralize(day.entries, 'запись', 'записи', 'записей')}${symptoms}`;
  }
  return `${date}: нет записей${symptoms}`;
}

interface HeatMonth {
  readonly key: string;
  readonly label: string;
  /** Empty cells before the 1st so that the weeks line up on Mondays. */
  readonly offset: number;
  readonly days: readonly HeatDay[];
}

function groupMonths(days: readonly HeatDay[]): HeatMonth[] {
  const groups = new Map<string, HeatDay[]>();
  for (const day of days) {
    const key = day.day.slice(0, 7);
    const list = groups.get(key);
    if (list) list.push(day);
    else groups.set(key, [day]);
  }
  const months: HeatMonth[] = [];
  for (const [key, list] of groups) {
    const [year, number] = key.split('-').map(Number) as [number, number];
    const first = list[0];
    const label =
      months.length === 0 || number === 1
        ? `${MONTHS[number - 1] ?? ''} ${year}`
        : (MONTHS[number - 1] ?? '');
    months.push({
      key,
      label,
      offset: first ? (dayStart(first.day).getDay() + 6) % 7 : 0,
      days: list,
    });
  }
  return months;
}

/**
 * Month calendar card in the manner of a contribution graph: the current month in full and the
 * months before it, a square per day, the brighter the more of the day's plan was marked. Tapping
 * a day opens it. Arrows page through the months when they do not all fit. With two or more
 * `parts` and `onInclude`, a menu in the title row chooses which parts of the plan the colours
 * count (`days` must then be computed with the same `include`).
 */
export function DiaryHeatmap(props: {
  readonly days: readonly HeatDay[];
  readonly selected: string;
  readonly today: string;
  readonly onSelect: (day: string) => void;
  /** Parts of the plan this diary has; the menu shows when there are at least two. */
  readonly parts?: readonly HeatPart[];
  /** Parts the colours count; absent, all of them. */
  readonly include?: ReadonlySet<HeatPart>;
  readonly onInclude?: (next: ReadonlySet<HeatPart>) => void;
  /** Symptom level 0–4 by day the caller computed (e.g. questionnaires above the norm). */
  readonly symptomDays?: ReadonlyMap<string, HeatDay['symptoms']>;
}): JSX.Element {
  let scroller: HTMLDivElement | undefined;
  let grid: HTMLDivElement | undefined;
  // The days' own symptoms and those the caller computed (questionnaires), the worse of the two.
  const shown = createMemo(() =>
    props.symptomDays
      ? props.days.map((day) => ({
          ...day,
          symptoms: Math.max(
            day.symptoms,
            props.symptomDays?.get(day.day) ?? 0,
          ) as HeatDay['symptoms'],
        }))
      : props.days,
  );
  const months = createMemo(() => groupMonths(shown()));
  const title = createMemo(() => {
    const list = months();
    const first = list[0];
    const last = list[list.length - 1];
    return first && last ? heatTitle(first.key, last.key) : '';
  });
  const [overflow, setOverflow] = createSignal(false);
  const [canBack, setCanBack] = createSignal(false);
  const [canForward, setCanForward] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  let filter: HTMLDivElement | undefined;
  let filterButton: HTMLButtonElement | undefined;
  const filterParts = (): readonly HeatPart[] =>
    props.onInclude && (props.parts?.length ?? 0) > 1 ? (props.parts ?? []) : [];
  const included = (): ReadonlySet<HeatPart> => props.include ?? ALL_PARTS;
  const chosen = createMemo(() => activeHeatParts(filterParts(), included()));

  // An open menu closes on a press outside it and on Escape (focus goes back to its button).
  createEffect(() => {
    if (!menuOpen()) return;
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !filter?.contains(event.target)) setMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      filterButton?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onEscape);
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onEscape);
    });
  });

  const measure = (): void => {
    if (!scroller) return;
    const room = scroller.scrollWidth - scroller.clientWidth;
    setOverflow(room > 2);
    setCanBack(scroller.scrollLeft > 2);
    setCanForward(scroller.scrollLeft < room - 2);
  };
  let frame = 0;
  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };

  // The current month is on the right: open scrolled there.
  onMount(() => {
    if (!scroller) return;
    scroller.scrollLeft = scroller.scrollWidth;
    measure();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(scroller);
    if (grid) observer?.observe(grid);
    onCleanup(() => {
      scroller?.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    });
  });

  /** Scroll to the start of the previous or next month block. */
  const page = (direction: -1 | 1): void => {
    if (!scroller || !grid) return;
    const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
    const starts = Array.from(grid.children).map(
      (block) => block.getBoundingClientRect().left - origin,
    );
    const here = scroller.scrollLeft;
    const target =
      direction < 0
        ? starts.filter((start) => start < here - 2).pop()
        : starts.find((start) => start > here + 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = target ?? (direction < 0 ? 0 : scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section class="diary-heat" aria-label="Календарь отметок">
      <header class="diary-heat__head">
        <h3 class="diary-heat__title">{title()}</h3>
        <div class="diary-heat__tools">
          <Show when={filterParts().length > 1}>
            <div class="diary-heat__filter" ref={filter}>
              <button
                type="button"
                class="diary-heat__filter-button"
                classList={{
                  'diary-heat__filter-button--partial': chosen().length < filterParts().length,
                }}
                aria-label="Что учитывать в календаре"
                aria-haspopup="true"
                aria-expanded={menuOpen()}
                ref={filterButton}
                onClick={() => setMenuOpen(!menuOpen())}
              >
                <AppGlyph name="sliders-horizontal" class="diary-heat__filter-icon" />
                <span class="diary-heat__filter-text">
                  {heatFilterSummary(filterParts(), included())}
                </span>
              </button>
              <Show when={menuOpen()}>
                <fieldset class="diary-heat__menu" aria-label="Что учитывать в календаре">
                  <For each={filterParts()}>
                    {(part) => (
                      <button
                        type="button"
                        class="diary-heat__option"
                        aria-pressed={chosen().includes(part)}
                        onClick={() =>
                          props.onInclude?.(toggleHeatPart(filterParts(), included(), part))
                        }
                      >
                        <span
                          class="diary-heat__option-mark"
                          classList={{ 'diary-heat__option-mark--on': chosen().includes(part) }}
                          aria-hidden="true"
                        >
                          <AppGlyph
                            name="check"
                            class={`diary-heat__option-check${chosen().includes(part) ? ' diary-heat__option-check--on' : ''}`}
                          />
                        </span>
                        <span class="diary-heat__option-label">{HEAT_PART_LABEL[part]}</span>
                      </button>
                    )}
                  </For>
                </fieldset>
              </Show>
            </div>
          </Show>
          <Show when={overflow()}>
            <div class="diary-heat__nav">
              <button
                type="button"
                class="diary-heat__arrow"
                aria-label="Раньше"
                disabled={!canBack()}
                onClick={() => page(-1)}
              >
                <AppGlyph name="caret-left" class="diary-heat__arrow-icon" />
              </button>
              <button
                type="button"
                class="diary-heat__arrow"
                aria-label="Позже"
                disabled={!canForward()}
                onClick={() => page(1)}
              >
                <AppGlyph name="caret-right" class="diary-heat__arrow-icon" />
              </button>
            </div>
          </Show>
        </div>
      </header>
      <div class="diary-heat__frame">
        <div class="diary-heat__weekdays" aria-hidden="true">
          <For each={WEEKDAYS}>{(name) => <span class="diary-heat__weekday">{name}</span>}</For>
        </div>
        <div class="diary-heat__scroller" ref={scroller}>
          <div class="diary-heat__grid" ref={grid}>
            <For each={months()}>
              {(month, index) => (
                <div
                  class="diary-heat__month"
                  classList={{ 'diary-heat__month--divided': index() > 0 }}
                >
                  <span
                    class="diary-heat__month-label"
                    classList={{
                      'diary-heat__month-label--current': index() === months().length - 1,
                    }}
                    aria-hidden="true"
                  >
                    {month.label}
                  </span>
                  <div class="diary-heat__cells">
                    <For each={Array.from({ length: month.offset })}>
                      {() => <span class="diary-heat__pad" aria-hidden="true" />}
                    </For>
                    <For each={month.days}>
                      {(day) => (
                        <button
                          type="button"
                          class={`diary-heat__day diary-heat__day--level-${day.level} diary-heat__day--symptoms-${day.symptoms}`}
                          classList={{
                            'diary-heat__day--selected': day.day === props.selected,
                            'diary-heat__day--today': day.day === props.today,
                            'diary-heat__day--future': day.day > props.today,
                          }}
                          disabled={day.day > props.today}
                          tabindex={day.day === props.selected ? 0 : -1}
                          title={heatDayLabel(day)}
                          aria-label={heatDayLabel(day)}
                          aria-pressed={day.day === props.selected}
                          onClick={() => props.onSelect(day.day)}
                        >
                          {Number(day.day.slice(8))}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
      <div class="diary-heat__legend" aria-hidden="true">
        <span class="diary-heat__legend-text">Меньше</span>
        <For each={[0, 1, 2, 3, 4]}>
          {(level) => <span class={`diary-heat__swatch diary-heat__swatch--level-${level}`} />}
        </For>
        <span class="diary-heat__legend-text">Больше</span>
      </div>
    </section>
  );
}
