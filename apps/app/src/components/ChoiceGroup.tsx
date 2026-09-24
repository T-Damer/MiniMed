import { createUniqueId, For, type JSX, Show } from 'solid-js';

import '@/components/ChoiceGroup.css';

export interface ChoiceOption {
  readonly value: string;
  readonly label: JSX.Element;
  readonly hint?: JSX.Element;
  readonly disabled?: boolean;
}

export interface ChoiceGroupProps {
  readonly legend: JSX.Element;
  readonly options: readonly ChoiceOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly name?: string;
  readonly hint?: JSX.Element;
  readonly error?: JSX.Element;
  readonly class?: string;
  readonly disabled?: boolean;
  readonly orientation?: 'vertical' | 'horizontal';
}

export function ChoiceGroup(props: ChoiceGroupProps): JSX.Element {
  const generatedId = createUniqueId();
  const name = () => props.name ?? `ui-choice-group-${generatedId}`;
  const hintId = () => `${name()}-hint`;
  const errorId = () => `${name()}-error`;
  const describedBy = (): string | undefined => {
    const ids = [props.hint ? hintId() : undefined, props.error ? errorId() : undefined].filter(
      (value): value is string => Boolean(value),
    );
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  return (
    <fieldset
      class={`ui-choice-group${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'ui-choice-group--disabled': props.disabled ?? false }}
      aria-describedby={describedBy()}
      aria-invalid={props.error ? 'true' : undefined}
      disabled={props.disabled}
    >
      <legend
        class="ui-choice-group__legend"
        classList={{ 'ui-choice-group__legend--error': Boolean(props.error) }}
      >
        {props.legend}
      </legend>
      <div
        class="ui-choice-group__options"
        classList={{ 'ui-choice-group__options--horizontal': props.orientation === 'horizontal' }}
      >
        <For each={props.options}>
          {(option) => (
            <label class="ui-choice-group__option">
              <input
                class="ui-choice-group__input"
                type="radio"
                name={name()}
                value={option.value}
                checked={props.value === option.value}
                disabled={option.disabled}
                onChange={() => props.onChange(option.value)}
              />
              <span class="ui-choice-group__copy">
                <span class="ui-choice-group__label">{option.label}</span>
                <Show when={option.hint}>
                  <span class="ui-choice-group__option-hint">{option.hint}</span>
                </Show>
              </span>
            </label>
          )}
        </For>
      </div>
      <Show when={props.hint}>
        <span id={hintId()} class="ui-choice-group__hint">
          {props.hint}
        </span>
      </Show>
      <Show when={props.error}>
        <span id={errorId()} class="ui-choice-group__error" role="alert">
          {props.error}
        </span>
      </Show>
    </fieldset>
  );
}
