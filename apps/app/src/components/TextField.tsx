import { createUniqueId, type JSX, Show, splitProps } from 'solid-js';

import '@/components/TextField.css';

export interface TextFieldProps
  extends Omit<
    JSX.InputHTMLAttributes<HTMLInputElement>,
    'aria-describedby' | 'class' | 'id'
  > {
  readonly label: JSX.Element;
  readonly hint?: JSX.Element;
  readonly error?: JSX.Element;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly class?: string;
  readonly inputClass?: string;
  readonly 'aria-describedby'?: string;
}

export function TextField(props: TextFieldProps): JSX.Element {
  const [local, input] = splitProps(props, [
    'label',
    'hint',
    'error',
    'hideLabel',
    'id',
    'class',
    'inputClass',
    'aria-describedby',
  ]);
  const generatedId = createUniqueId();
  const fieldId = () => local.id ?? `ui-text-field-${generatedId}`;
  const hintId = () => `${fieldId()}-hint`;
  const errorId = () => `${fieldId()}-error`;
  const describedBy = (): string | undefined => {
    const ids = [
      local['aria-describedby'],
      local.hint ? hintId() : undefined,
      local.error ? errorId() : undefined,
    ].filter((value): value is string => Boolean(value));
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  return (
    <label
      class={`ui-text-field${local.class ? ` ${local.class}` : ''}`}
      for={fieldId()}
    >
      <span
        class="ui-text-field__label"
        classList={{ 'ui-text-field__label--hidden': local.hideLabel ?? false }}
      >
        {local.label}
      </span>
      <input
        {...input}
        id={fieldId()}
        class={`ui-text-field__input${local.inputClass ? ` ${local.inputClass}` : ''}`}
        classList={{ 'ui-text-field__input--error': Boolean(local.error) }}
        aria-describedby={describedBy()}
        aria-invalid={local.error ? 'true' : undefined}
      />
      <Show when={local.hint}>
        <span id={hintId()} class="ui-text-field__hint">
          {local.hint}
        </span>
      </Show>
      <Show when={local.error}>
        <span id={errorId()} class="ui-text-field__error" role="alert">
          {local.error}
        </span>
      </Show>
    </label>
  );
}
