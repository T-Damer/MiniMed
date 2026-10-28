import { TimeField as KobalteTimeField } from '@kobalte/core/time-field';
import { createEffect, createSignal, type JSX, on } from 'solid-js';

import '@/components/TimeField.css';
import { formatTimeValue, parseTimeValue, type TimeParts } from '@/components/time-value';

export interface TimeFieldProps {
  /** «HH:MM» (24 h) or '' when empty. Changing it from outside updates the segments in place. */
  readonly value: string;
  /** Called only with a complete, valid «HH:MM». */
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly class?: string;
  readonly disabled?: boolean;
  readonly 'aria-label'?: string;
}

const TRANSLATIONS_RU = {
  hour: 'час',
  minute: 'минута',
  second: 'секунда',
  am: 'ДП',
  pm: 'ПП',
  dayPeriod: 'ДП/ПП',
  timeZoneName: 'часовой пояс',
  selectedTimeDescription: (time: string) => `Выбрано время: ${time}`,
};

interface Draft {
  hour?: number;
  minute?: number;
}

function draftFromValue(value: string): Draft {
  return parseTimeValue(value) ?? {};
}

/** Kobalte reports changed parts as a partial object; keep only the defined numbers. */
function toDraft(time: TimeParts): Draft {
  const draft: Draft = {};
  if (time.hour !== undefined) draft.hour = time.hour;
  if (time.minute !== undefined) draft.minute = time.minute;
  return draft;
}

function isFilled(draft: Draft, segment: string): boolean {
  if (segment === 'hour') return draft.hour !== undefined;
  if (segment === 'minute') return draft.minute !== undefined;
  return true;
}

export function TimeField(props: TimeFieldProps): JSX.Element {
  // Partial input («1_:__») lives here; the parent only ever sees complete values.
  const [draft, setDraft] = createSignal<Draft>(draftFromValue(props.value));

  createEffect(
    on(
      () => props.value,
      (value) => {
        // Echo of our own emit: keep the draft as is.
        if (value === formatTimeValue(draft())) return;
        setDraft(draftFromValue(value));
      },
      { defer: true },
    ),
  );

  const handleChange = (next: TimeParts): void => {
    setDraft(toDraft(next));
    const formatted = formatTimeValue(next);
    if (formatted !== undefined && formatted !== props.value) props.onChange(formatted);
  };

  return (
    <KobalteTimeField
      class={`ui-time-field${props.class ? ` ${props.class}` : ''}`}
      value={draft()}
      onChange={handleChange}
      hourCycle={24}
      granularity="minute"
      forceLeadingZeros
      disabled={props.disabled ?? false}
      translations={TRANSLATIONS_RU}
    >
      <KobalteTimeField.Label
        class="ui-time-field__label"
        classList={{ 'ui-time-field__label--hidden': props.hideLabel ?? false }}
      >
        {props.label}
      </KobalteTimeField.Label>
      <KobalteTimeField.Input
        class="ui-time-field__input"
        {...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {})}
      >
        {(segment) => (
          <KobalteTimeField.Segment
            segment={segment()}
            class="ui-time-field__segment"
            classList={{ 'ui-time-field__segment--placeholder': !isFilled(draft(), segment()) }}
          />
        )}
      </KobalteTimeField.Input>
    </KobalteTimeField>
  );
}
