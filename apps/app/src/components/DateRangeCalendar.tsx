import { batch, createMemo, createSignal, For, Index, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  addDay,
  addDays,
  addRange,
  type DayRange,
  dayNumber,
  describeRanges,
  localDayKey,
  normalizeRanges,
  presetRange,
  rangesContain,
  removeDay,
  shortDay,
} from '@/components/date-ranges';
import { motionMs } from '@/state/motion';

import './DateRangeCalendar.css';

export interface DateRangeCalendarProps {
  /** Selected days as ranges; the component keeps them sorted and merged. */
  readonly value: readonly DayRange[];
  readonly onChange: (next: DayRange[]) => void;
  /** The local day treated as «today» (ringed; start of the presets). Defaults to the real today. */
  readonly today?: string | undefined;
  /** Earliest and latest selectable day, inclusive. */
  readonly min?: string | undefined;
  readonly max?: string | undefined;
  readonly class?: string | undefined;
}

const MONTHS_NOMINATIVE = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

const WEEKDAYS = [
  { short: 'Пн', full: 'понедельник' },
  { short: 'Вт', full: 'вторник' },
  { short: 'Ср', full: 'среда' },
  { short: 'Чт', full: 'четверг' },
  { short: 'Пт', full: 'пятница' },
  { short: 'Сб', full: 'суббота' },
  { short: 'Вс', full: 'воскресенье' },
] as const;

const PRESET_DAYS = [7, 14, 30] as const;

interface MonthView {
  readonly year: number;
  /** 0-based. */
  readonly month: number;
}

interface DayCell {
  readonly day: string;
  readonly date: number;
}

function monthOf(day: string): MonthView {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1 };
}

function monthStart(view: MonthView): string {
  return `${String(view.year).padStart(4, '0')}-${String(view.month + 1).padStart(2, '0')}-01`;
}

function shiftMonth(view: MonthView, delta: number): MonthView {
  const index = view.year * 12 + view.month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

function daysInMonth(view: MonthView): number {
  return dayNumber(monthStart(shiftMonth(view, 1))) - dayNumber(monthStart(view));
}

/** Weeks of the month, Monday first; `undefined` pads the days of the neighbouring months. */
function monthWeeks(view: MonthView): (DayCell | undefined)[][] {
  const first = monthStart(view);
  // 1970-01-01 (day 0) was a Thursday; Monday-first column of a day number:
  const offset = (((dayNumber(first) + 3) % 7) + 7) % 7;
  const total = daysInMonth(view);
  const weeks: (DayCell | undefined)[][] = [];
  let week: (DayCell | undefined)[] = Array.from({ length: offset }, () => undefined);
  for (let date = 1; date <= total; date += 1) {
    week.push({ day: addDays(first, date - 1), date });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(undefined);
    weeks.push(week);
  }
  return weeks;
}

function dayLabel(day: string, selected: boolean, today: boolean, pending: boolean): string {
  const parts = [`${Number(day.slice(8))} ${MONTHS_GENITIVE[Number(day.slice(5, 7)) - 1] ?? ''}`];
  if (pending) parts.push('начало диапазона');
  else if (selected) parts.push('выбрано');
  if (today) parts.push('сегодня');
  return parts.join(', ');
}

/**
 * A month calendar for picking single days and ranges («how long to take it»). Tap a free day to
 * start, tap another to add the range between, tap the same day again for one day; tap a selected
 * day to remove it (a range splits). Presets count from today.
 */
export function DateRangeCalendar(props: DateRangeCalendarProps): JSX.Element {
  const today = (): string => props.today ?? localDayKey();
  const ranges = createMemo(() => normalizeRanges(props.value));
  const [view, setView] = createSignal<MonthView>(monthOf(ranges()[0]?.from ?? today()));
  const [pending, setPending] = createSignal<string | undefined>(undefined);
  const [focusDay, setFocusDay] = createSignal<string | undefined>(undefined);
  let weeksElement: HTMLDivElement | undefined;
  let gridElement: HTMLFieldSetElement | undefined;

  const weeks = createMemo(() => monthWeeks(view()));
  const title = createMemo(() => `${MONTHS_NOMINATIVE[view().month] ?? ''} ${view().year}`);

  const isDisabled = (day: string): boolean =>
    (props.min !== undefined && day < props.min) || (props.max !== undefined && day > props.max);

  const canGoPrev = (): boolean => {
    const min = props.min;
    return min === undefined || addDays(monthStart(view()), -1) >= min;
  };
  const canGoNext = (): boolean => {
    const max = props.max;
    return max === undefined || monthStart(shiftMonth(view(), 1)) <= max;
  };

  /** The one day in the Tab order: the focused one, else the first selected, today or the 1st. */
  const tabDay = createMemo((): string => {
    const current = view();
    const inMonth = (day: string | undefined): day is string =>
      day !== undefined && monthStart(monthOf(day)) === monthStart(current);
    const focused = focusDay();
    if (inMonth(focused) && !isDisabled(focused)) return focused;
    for (const week of weeks()) {
      for (const cell of week) {
        if (cell && rangesContain(ranges(), cell.day) && !isDisabled(cell.day)) return cell.day;
      }
    }
    if (inMonth(today()) && !isDisabled(today())) return today();
    for (const week of weeks()) {
      for (const cell of week) if (cell && !isDisabled(cell.day)) return cell.day;
    }
    return monthStart(current);
  });

  const slideGrid = (direction: number): void => {
    const duration = motionMs(180);
    if (!weeksElement || duration === 0 || typeof weeksElement.animate !== 'function') return;
    weeksElement.animate(
      [
        { opacity: 0, transform: `translateX(${direction * 14}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  };

  const goToMonth = (next: MonthView, direction: number): void => {
    setView(next);
    slideGrid(direction);
  };

  const focusButton = (day: string): void => {
    gridElement?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  };

  const moveFocus = (target: string): void => {
    if (isDisabled(target)) return;
    const direction = monthStart(monthOf(target)) < monthStart(view()) ? -1 : 1;
    batch(() => {
      setFocusDay(target);
      if (monthStart(monthOf(target)) !== monthStart(view())) goToMonth(monthOf(target), direction);
    });
    focusButton(target);
  };

  const select = (day: string): void => {
    if (isDisabled(day)) return;
    setFocusDay(day);
    const start = pending();
    if (start !== undefined) {
      setPending(undefined);
      props.onChange(start === day ? addDay(ranges(), day) : addRange(ranges(), start, day));
      return;
    }
    if (rangesContain(ranges(), day)) {
      props.onChange(removeDay(ranges(), day));
      return;
    }
    setPending(day);
  };

  const applyPreset = (days: number): void => {
    setPending(undefined);
    props.onChange(presetRange(today(), days));
    goToMonth(monthOf(today()), 0);
  };

  const clear = (): void => {
    setPending(undefined);
    props.onChange([]);
  };

  const presetActive = (days: number): boolean => {
    const preset = presetRange(today(), days)[0];
    const current = ranges();
    return (
      preset !== undefined &&
      current.length === 1 &&
      current[0]?.from === preset.from &&
      current[0]?.to === preset.to
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const day = target.getAttribute('data-day') ?? undefined;
    if (event.key === 'Escape' && pending() !== undefined) {
      event.preventDefault();
      setPending(undefined);
      return;
    }
    if (day === undefined) return;
    const column = (((dayNumber(day) + 3) % 7) + 7) % 7;
    let next: string | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(day, -1);
        break;
      case 'ArrowRight':
        next = addDays(day, 1);
        break;
      case 'ArrowUp':
        next = addDays(day, -7);
        break;
      case 'ArrowDown':
        next = addDays(day, 7);
        break;
      case 'Home':
        next = addDays(day, -column);
        break;
      case 'End':
        next = addDays(day, 6 - column);
        break;
      case 'PageUp':
      case 'PageDown': {
        const month = shiftMonth(monthOf(day), event.key === 'PageUp' ? -1 : 1);
        next = addDays(monthStart(month), Math.min(Number(day.slice(8)), daysInMonth(month)) - 1);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    moveFocus(next);
  };

  const summary = (): string => {
    const start = pending();
    return start === undefined
      ? describeRanges(ranges())
      : `С ${shortDay(start, false)} — выберите последний день`;
  };

  const dayClass = (cell: DayCell, column: number, week: (DayCell | undefined)[]): string => {
    const day = cell.day;
    const classes = ['date-range-calendar__day'];
    if (isDisabled(day)) classes.push('date-range-calendar__day--disabled');
    if (day === today()) classes.push('date-range-calendar__day--today');
    if (pending() === day) {
      classes.push('date-range-calendar__day--pending');
    } else if (rangesContain(ranges(), day)) {
      const before = rangesContain(ranges(), addDays(day, -1));
      const after = rangesContain(ranges(), addDays(day, 1));
      classes.push('date-range-calendar__day--selected');
      if (!before && !after) classes.push('date-range-calendar__day--single');
      else if (!before) classes.push('date-range-calendar__day--start');
      else if (!after) classes.push('date-range-calendar__day--end');
      else classes.push('date-range-calendar__day--middle');
      if (before && (column === 0 || !week[column - 1]))
        classes.push('date-range-calendar__day--row-start');
      if (after && (column === 6 || !week[column + 1]))
        classes.push('date-range-calendar__day--row-end');
    }
    return classes.join(' ');
  };

  return (
    <div class={`date-range-calendar ${props.class ?? ''}`.trim()}>
      <div class="date-range-calendar__header">
        <button
          type="button"
          class="date-range-calendar__nav"
          aria-label="Предыдущий месяц"
          disabled={!canGoPrev()}
          onClick={() => goToMonth(shiftMonth(view(), -1), -1)}
        >
          <AppGlyph name="caret-left" class="date-range-calendar__nav-icon" />
        </button>
        <div class="date-range-calendar__title" aria-live="polite">
          {title()}
        </div>
        <button
          type="button"
          class="date-range-calendar__nav"
          aria-label="Следующий месяц"
          disabled={!canGoNext()}
          onClick={() => goToMonth(shiftMonth(view(), 1), 1)}
        >
          <AppGlyph name="caret-right" class="date-range-calendar__nav-icon" />
        </button>
      </div>
      <fieldset
        class="date-range-calendar__grid"
        aria-label={title()}
        ref={gridElement}
        onKeyDown={onKeyDown}
      >
        <div class="date-range-calendar__weekdays" aria-hidden="true">
          <For each={WEEKDAYS}>
            {(weekday) => <div class="date-range-calendar__weekday">{weekday.short}</div>}
          </For>
        </div>
        <div class="date-range-calendar__weeks" ref={weeksElement}>
          <For each={weeks()}>
            {(week) => (
              <div class="date-range-calendar__week">
                <Index each={week}>
                  {(cell, column) => (
                    <div class="date-range-calendar__cell">
                      <Show when={cell()}>
                        {(c) => (
                          <button
                            type="button"
                            class={dayClass(c(), column, week)}
                            data-day={c().day}
                            tabIndex={tabDay() === c().day ? 0 : -1}
                            aria-pressed={rangesContain(ranges(), c().day) || pending() === c().day}
                            aria-disabled={isDisabled(c().day) || undefined}
                            aria-label={dayLabel(
                              c().day,
                              rangesContain(ranges(), c().day),
                              c().day === today(),
                              pending() === c().day,
                            )}
                            onClick={() => select(c().day)}
                          >
                            {c().date}
                          </button>
                        )}
                      </Show>
                    </div>
                  )}
                </Index>
              </div>
            )}
          </For>
        </div>
      </fieldset>

      <div class="date-range-calendar__presets">
        <For each={PRESET_DAYS}>
          {(days) => (
            <button
              type="button"
              class={`date-range-calendar__preset ${presetActive(days) ? 'date-range-calendar__preset--active' : ''}`.trim()}
              aria-pressed={presetActive(days)}
              onClick={() => applyPreset(days)}
            >
              {days} дней
            </button>
          )}
        </For>
        <button
          type="button"
          class={`date-range-calendar__preset ${ranges().length === 0 && pending() === undefined ? 'date-range-calendar__preset--active' : ''}`.trim()}
          aria-pressed={ranges().length === 0 && pending() === undefined}
          onClick={clear}
        >
          Без срока
        </button>
      </div>

      <div class="date-range-calendar__summary" aria-live="polite">
        {summary()}
      </div>
    </div>
  );
}
