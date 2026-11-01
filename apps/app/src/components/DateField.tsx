import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  dayInBounds,
  displayDay,
  formatDayValue,
  MONTHS_NOMINATIVE,
  maskTypedDay,
  monthGrid,
  parseDayValue,
  readTypedDay,
  shiftDay,
  spokenDay,
  todayValue,
  WEEKDAYS_SHORT,
} from '@/components/date-value';
import { SheetPopover } from '@/components/SheetPopover';

import '@/components/DateField.css';

/**
 * The one date field of the app (owner 2026-11-01: no native date pickers, they differ between
 * browsers and phones). Type «ДД.ММ.ГГГГ» — the dots come by themselves — or pick the day in a
 * calendar: a Kobalte popover beside the field on wide screens, the paper sheet on phones
 * (`SheetPopover`). The title of the calendar switches to months and years, for birth dates.
 */
export interface DateFieldProps {
  /** `YYYY-MM-DD` or '' (as the native input's value was). */
  readonly value: string;
  /** Called with a complete valid day, or '' when the field is cleared. */
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly min?: string | undefined;
  readonly max?: string | undefined;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly id?: string;
  readonly class?: string;
  readonly inputClass?: string;
  /** Extra class on the framed control (input + calendar button), e.g. the editor's dashed frame. */
  readonly controlClass?: string;
  readonly placeholder?: string;
  /** Shown under the field (and marks it invalid), like TextField's. */
  readonly error?: string | undefined;
  readonly 'data-testid'?: string;
}

type View = 'days' | 'months' | 'years';

let fieldCount = 0;

export function DateField(props: DateFieldProps): JSX.Element {
  fieldCount += 1;
  const id = (): string => props.id ?? `ui-date-field-${fieldCount}`;
  const errorId = (): string => `${id()}-error`;
  const [typed, setTyped] = createSignal(displayDay(props.value));
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<View>('days');
  // The month on screen and the day with keyboard focus inside the grid.
  const [shown, setShown] = createSignal({ year: 2000, month: 1 });
  const [cursor, setCursor] = createSignal(todayValue());
  let grid: HTMLDivElement | undefined;

  createEffect(
    on(
      () => props.value,
      (value) => {
        // Our own emit: keep what is being typed.
        if (readTypedDay(typed()) === value) return;
        setTyped(displayDay(value));
      },
      // Not deferred: a value set in the same tick as the mount (a prefilled form) must show.
    ),
  );

  const openCalendar = (next: boolean): void => {
    if (next) {
      const start = parseDayValue(props.value) ?? parseDayValue(clampToBounds(todayValue()));
      if (start) {
        setShown({ year: start.year, month: start.month });
        setCursor(formatDayValue(start));
      }
      setView('days');
    }
    setOpen(next);
  };

  const clampToBounds = (value: string): string => {
    if (props.min && value < props.min) return props.min;
    if (props.max && value > props.max) return props.max;
    return value;
  };

  const commitTyped = (text: string): void => {
    // A pasted ISO day (another app, a test) is taken as it is.
    const pasted = /^\s*\d{4}-\d{2}-\d{2}\s*$/u.test(text) ? readTypedDay(text) : undefined;
    const masked = pasted ? displayDay(pasted) : maskTypedDay(text);
    setTyped(masked);
    if (!masked) {
      if (props.value) props.onChange('');
      return;
    }
    const value = readTypedDay(masked);
    // min/max bound the calendar; a typed day goes to the form, whose own check explains it.
    if (value && value !== props.value) props.onChange(value);
  };

  const pick = (value: string): void => {
    if (!dayInBounds(value, props.min, props.max)) return;
    setTyped(displayDay(value));
    if (value !== props.value) props.onChange(value);
    setOpen(false);
  };

  const moveCursor = (days: number): void => {
    const next = shiftDay(cursor(), days);
    if (!dayInBounds(next, props.min, props.max)) return;
    setCursor(next);
    const parts = parseDayValue(next);
    if (parts) setShown({ year: parts.year, month: parts.month });
    queueMicrotask(() => grid?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus());
  };

  const onGridKey = (event: KeyboardEvent): void => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in steps) {
      event.preventDefault();
      moveCursor(steps[event.key] as number);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(cursor());
    }
  };

  const stepMonth = (delta: number): void => {
    const { year, month } = shown();
    const index = year * 12 + (month - 1) + delta;
    setShown({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };

  const cells = createMemo(() => monthGrid(shown().year, shown().month));
  const today = todayValue();
  const yearPage = createMemo(() => {
    const first = shown().year - (shown().year % 12);
    return Array.from({ length: 12 }, (_, index) => first + index);
  });

  return (
    <div class={`ui-date-field${props.class ? ` ${props.class}` : ''}`}>
      <label
        class="ui-date-field__label"
        classList={{ 'ui-date-field__label--hidden': props.hideLabel ?? false }}
        for={id()}
      >
        {props.label}
      </label>
      <div
        class={`ui-date-field__control${props.controlClass ? ` ${props.controlClass}` : ''}`}
        classList={{
          'ui-date-field__control--disabled': props.disabled ?? false,
          'ui-date-field__control--error': Boolean(props.error),
        }}
      >
        <input
          id={id()}
          class={`ui-date-field__input${props.inputClass ? ` ${props.inputClass}` : ''}`}
          type="text"
          inputMode="numeric"
          autocomplete="off"
          placeholder={props.placeholder ?? 'ДД.ММ.ГГГГ'}
          aria-label={props.hideLabel ? props.label : undefined}
          value={typed()}
          disabled={props.disabled}
          required={props.required}
          aria-invalid={props.error ? 'true' : undefined}
          aria-describedby={props.error ? errorId() : undefined}
          data-testid={props['data-testid']}
          onInput={(event) => commitTyped(event.currentTarget.value)}
          onBlur={() => {
            // An incomplete or impossible day is shown back as the last good value.
            if (typed() && !readTypedDay(typed())) setTyped(displayDay(props.value));
          }}
        />
        <SheetPopover
          open={open()}
          onOpenChange={openCalendar}
          title={props.label}
          triggerClass="ui-date-field__trigger"
          triggerLabel="Открыть календарь"
          trigger={<AppGlyph name="calendar" class="ui-date-field__glyph" />}
          contentClass="ui-date-field__popover"
          placement="bottom-end"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => grid?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus());
          }}
        >
          <div class="ui-date-field__calendar">
            <div class="ui-date-field__head">
              <button
                type="button"
                class="ui-date-field__step"
                aria-label={view() === 'years' ? 'Раньше' : 'Предыдущий месяц'}
                onClick={() =>
                  view() === 'years'
                    ? stepMonth(-144)
                    : view() === 'months'
                      ? stepMonth(-12)
                      : stepMonth(-1)
                }
              >
                <AppGlyph name="caret-left" class="ui-date-field__step-glyph" />
              </button>
              <button
                type="button"
                class="ui-date-field__title"
                aria-label="Выбрать месяц и год"
                onClick={() => setView(view() === 'days' ? 'years' : 'days')}
              >
                {view() === 'days'
                  ? `${MONTHS_NOMINATIVE[shown().month - 1]} ${shown().year}`
                  : view() === 'months'
                    ? String(shown().year)
                    : `${yearPage()[0]}–${yearPage()[11]}`}
              </button>
              <button
                type="button"
                class="ui-date-field__step"
                aria-label={view() === 'years' ? 'Позже' : 'Следующий месяц'}
                onClick={() =>
                  view() === 'years'
                    ? stepMonth(144)
                    : view() === 'months'
                      ? stepMonth(12)
                      : stepMonth(1)
                }
              >
                <AppGlyph name="caret-right" class="ui-date-field__step-glyph" />
              </button>
            </div>
            <Show when={view() === 'days'}>
              <div class="ui-date-field__weekdays" aria-hidden="true">
                <For each={WEEKDAYS_SHORT}>
                  {(day) => <span class="ui-date-field__weekday">{day}</span>}
                </For>
              </div>
              <div
                ref={grid}
                class="ui-date-field__grid"
                role="grid"
                aria-label={`${MONTHS_NOMINATIVE[shown().month - 1]} ${shown().year}`}
                onKeyDown={onGridKey}
              >
                <For each={cells()}>
                  {(day) => {
                    const value = (): string =>
                      day === null ? '' : formatDayValue({ ...shown(), day });
                    return (
                      <Show when={day !== null} fallback={<span class="ui-date-field__blank" />}>
                        <button
                          type="button"
                          role="gridcell"
                          class="ui-date-field__day"
                          classList={{
                            'ui-date-field__day--selected': value() === props.value,
                            'ui-date-field__day--today': value() === today,
                          }}
                          aria-label={spokenDay(value())}
                          aria-selected={value() === props.value}
                          disabled={!dayInBounds(value(), props.min, props.max)}
                          tabIndex={value() === cursor() ? 0 : -1}
                          data-cursor={value() === cursor() ? 'true' : undefined}
                          onClick={() => pick(value())}
                        >
                          {day}
                        </button>
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>
            <Show when={view() === 'years'}>
              <div class="ui-date-field__choices">
                <For each={yearPage()}>
                  {(year) => (
                    <button
                      type="button"
                      class="ui-date-field__choice"
                      classList={{ 'ui-date-field__choice--current': year === shown().year }}
                      aria-pressed={year === shown().year}
                      disabled={
                        (props.min !== undefined && year < Number(props.min.slice(0, 4))) ||
                        (props.max !== undefined && year > Number(props.max.slice(0, 4)))
                      }
                      onClick={() => {
                        setShown({ year, month: shown().month });
                        setView('months');
                      }}
                    >
                      {year}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={view() === 'months'}>
              <div class="ui-date-field__choices">
                <For each={MONTHS_NOMINATIVE}>
                  {(name, index) => (
                    <button
                      type="button"
                      class="ui-date-field__choice"
                      classList={{
                        'ui-date-field__choice--current': index() + 1 === shown().month,
                      }}
                      aria-pressed={index() + 1 === shown().month}
                      onClick={() => {
                        setShown({ year: shown().year, month: index() + 1 });
                        setView('days');
                      }}
                    >
                      {name.slice(0, 3)}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </SheetPopover>
      </div>
      <Show when={props.error}>
        <span id={errorId()} class="ui-date-field__error" role="alert">
          {props.error}
        </span>
      </Show>
    </div>
  );
}
