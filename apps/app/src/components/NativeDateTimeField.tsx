import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

function formatDisplay(value: string, type: 'date' | 'time'): string {
  if (!value) return '';
  if (type === 'time') return value;
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

/**
 * Consistent-looking field that opens the platform's native date/time picker
 * via showPicker() — same behaviour on every device, one visual style.
 */
export function NativeDateTimeField(props: {
  readonly type: 'date' | 'time';
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  let input: HTMLInputElement | undefined;

  const open = (): void => {
    if (!input || props.disabled) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {
      // Browsers without showPicker fall back to a click below.
    }
    input.click();
  };

  return (
    <span class="native-datetime-field__wrapper">
      <button
        type="button"
        class="native-datetime-field"
        classList={{ 'native-datetime-field--empty': !props.value }}
        aria-label={props.label}
        title={props.label}
        disabled={props.disabled}
        onClick={open}
      >
        <AppGlyph
          name={props.type === 'date' ? 'calendar' : 'clock'}
          class="native-datetime-field__icon"
        />
        <span class="native-datetime-field__value">
          {formatDisplay(props.value, props.type) || props.placeholder}
        </span>
      </button>
      <input
        ref={(element) => {
          input = element;
        }}
        class="visually-hidden"
        type={props.type}
        value={props.value}
        tabIndex={-1}
        aria-hidden="true"
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </span>
  );
}
