import { createEffect, createUniqueId, For, type JSX, Show, splitProps } from 'solid-js';

import '@/components/SelectField.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectFieldProps
  extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'class' | 'id' | 'children'> {
  readonly label: JSX.Element;
  readonly options: readonly SelectOption[];
  readonly hint?: JSX.Element;
  readonly error?: JSX.Element;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly class?: string;
  /** Extra class on the `<select>` itself, e.g. for a larger control. */
  readonly controlClass?: string;
}

/** Labelled native select with the same label, hint and error layout as TextField. */
export function SelectField(props: SelectFieldProps): JSX.Element {
  const [local, select] = splitProps(props, [
    'label',
    'options',
    'hint',
    'error',
    'hideLabel',
    'id',
    'class',
    'controlClass',
  ]);
  const generatedId = createUniqueId();
  let control: HTMLSelectElement | undefined;
  // The element's own `value` is applied before its options exist, so apply it again once they do.
  createEffect(() => {
    const value = select.value;
    void local.options.length;
    if (control && value !== undefined) control.value = String(value);
  });
  const fieldId = () => local.id ?? `ui-select-field-${generatedId}`;
  const hintId = () => `${fieldId()}-hint`;
  const errorId = () => `${fieldId()}-error`;
  const describedBy = (): string | undefined =>
    [local.hint ? hintId() : undefined, local.error ? errorId() : undefined]
      .filter((value): value is string => Boolean(value))
      .join(' ') || undefined;

  return (
    <label class={`ui-select-field${local.class ? ` ${local.class}` : ''}`} for={fieldId()}>
      <span
        class="ui-select-field__label"
        classList={{ 'ui-select-field__label--hidden': local.hideLabel ?? false }}
      >
        {local.label}
      </span>
      <select
        {...select}
        ref={(element) => {
          control = element;
          const forwarded = select.ref;
          if (typeof forwarded === 'function') forwarded(element);
        }}
        id={fieldId()}
        class={`ui-select-field__control${local.controlClass ? ` ${local.controlClass}` : ''}`}
        classList={{ 'ui-select-field__control--error': Boolean(local.error) }}
        aria-describedby={describedBy()}
        aria-invalid={local.error ? 'true' : undefined}
      >
        <For each={local.options}>
          {(option) => (
            <option value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          )}
        </For>
      </select>
      <Show when={local.hint}>
        <span id={hintId()} class="ui-select-field__hint">
          {local.hint}
        </span>
      </Show>
      <Show when={local.error}>
        <span id={errorId()} class="ui-select-field__error" role="alert">
          {local.error}
        </span>
      </Show>
    </label>
  );
}
