import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import '@/components/SegmentedControl.css';

export interface SegmentedControlOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count?: number | undefined;
  /** An option that exists but cannot be chosen now; explain why next to the control. */
  readonly disabled?: boolean | undefined;
}

/**
 * A single-choice switch between views, built on native radio inputs so arrow keys, focus order
 * and screen-reader semantics come from the browser.
 */
export function SegmentedControl<T extends string>(props: {
  readonly label: string;
  readonly options: readonly SegmentedControlOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly class?: string;
  /** Fills the width: equal columns, labels centred (a phone-width row of a few options). */
  readonly stretch?: boolean;
}): JSX.Element {
  const name = createUniqueId();
  const [focusVisible, setFocusVisible] = createSignal<T>();
  return (
    <fieldset
      class={`segmented-control ${props.class ?? ''}`.trim()}
      classList={{ 'segmented-control--stretch': props.stretch === true }}
    >
      <legend class="segmented-control__legend sr-only">{props.label}</legend>
      <For each={props.options}>
        {(option) => (
          <label
            class="segmented-control__option"
            classList={{
              'segmented-control__option--selected': option.value === props.value,
              'segmented-control__option--focus-visible': focusVisible() === option.value,
              'segmented-control__option--disabled': option.disabled === true,
              'segmented-control__option--stretch': props.stretch === true,
            }}
          >
            <input
              class="segmented-control__input sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === props.value}
              disabled={option.disabled === true}
              onChange={() => props.onChange(option.value)}
              onFocus={(event) => {
                if (event.currentTarget.matches(':focus-visible'))
                  setFocusVisible(() => option.value);
              }}
              onBlur={() => setFocusVisible(undefined)}
            />
            <span class="segmented-control__label">{option.label}</span>
            <Show when={option.count !== undefined && option.count > 0}>
              <span class="segmented-control__count">{option.count}</span>
            </Show>
          </label>
        )}
      </For>
    </fieldset>
  );
}
