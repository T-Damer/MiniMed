import { createMemo, For, type JSX, onMount } from 'solid-js';

import { pluralize } from '@/diary/diary-format';
import { addDays, dayStart, type HeatDay } from '@/features/diary/diary-care';

// The first cell sits beside the month row; then Monday to Sunday.
const WEEKDAYS = ['', 'Пн', '', 'Ср', '', 'Пт', '', ''];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Monday of the week a day belongs to. */
export function weekStart(day: string): string {
  const weekday = (dayStart(day).getDay() + 6) % 7;
  return addDays(day, -weekday);
}

/**
 * Days the calendar shows: whole weeks from the earlier of «12 weeks ago» and the week the diary
 * started, to the end of this week; at most a year.
 */
export function heatmapRange(started: string, today: string): { from: string; to: string } {
  const recent = weekStart(addDays(today, -7 * 11));
  const year = weekStart(addDays(today, -7 * 52));
  const first = weekStart(started);
  const from = first < recent ? (first < year ? year : first) : recent;
  return { from, to: addDays(weekStart(today), 6) };
}

export function heatDayLabel(day: HeatDay): string {
  const date = dayStart(day.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (day.total > 0)
    return `${date}: ${day.done} из ${day.total} ${pluralize(day.total, 'отметки', 'отметок', 'отметок')}`;
  if (day.entries > 0) {
    return `${date}: ${day.entries} ${pluralize(day.entries, 'запись', 'записи', 'записей')}`;
  }
  return `${date}: нет записей`;
}

/**
 * Year calendar in the manner of a contribution graph: a column per week, a square per day, the
 * brighter the more of the day's plan was marked. Tapping a day opens it.
 */
export function DiaryHeatmap(props: {
  readonly days: readonly HeatDay[];
  readonly selected: string;
  readonly today: string;
  readonly onSelect: (day: string) => void;
}): JSX.Element {
  let scroller: HTMLDivElement | undefined;
  const weeks = createMemo(() => {
    const result: HeatDay[][] = [];
    for (let index = 0; index < props.days.length; index += 7) {
      result.push(props.days.slice(index, index + 7));
    }
    return result;
  });
  const monthLabel = (week: readonly HeatDay[], index: number): string => {
    const first = week[0];
    if (!first) return '';
    const month = dayStart(first.day).getMonth();
    const previous = weeks()[index - 1]?.[0];
    return index === 0 || (previous && dayStart(previous.day).getMonth() !== month)
      ? (MONTHS[month] ?? '')
      : '';
  };
  // The latest weeks are on the right: start scrolled there.
  onMount(() => {
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });

  return (
    <section class="diary-heat" aria-label="Календарь отметок">
      <div class="diary-heat__frame">
        <div class="diary-heat__weekdays" aria-hidden="true">
          <For each={WEEKDAYS}>{(name) => <span class="diary-heat__weekday">{name}</span>}</For>
        </div>
        <div class="diary-heat__scroller" ref={scroller}>
          <div class="diary-heat__grid">
            <For each={weeks()}>
              {(week, index) => (
                <div class="diary-heat__week">
                  <span class="diary-heat__month" aria-hidden="true">
                    {monthLabel(week, index())}
                  </span>
                  <For each={week}>
                    {(day) => (
                      <button
                        type="button"
                        class={`diary-heat__day diary-heat__day--level-${day.level}`}
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
                      />
                    )}
                  </For>
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
