import { createUniqueId, type JSX, Show, splitProps } from 'solid-js';

import '@/components/Checkbox.css';

export interface CheckboxProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class' | 'id' | 'type'> {
  readonly label: JSX.Element;
  readonly hint?: JSX.Element;
  readonly id?: string;
  readonly class?: string;
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  const [local, input] = splitProps(props, ['label', 'hint', 'id', 'class', 'disabled']);
  const generatedId = createUniqueId();
  const inputId = () => local.id ?? `ui-checkbox-${generatedId}`;
  const hintId = () => `${inputId()}-hint`;

  return (
    <label
      class={`ui-checkbox${local.class ? ` ${local.class}` : ''}`}
      classList={{ 'ui-checkbox--disabled': local.disabled ?? false }}
      for={inputId()}
    >
      <input
        {...input}
        id={inputId()}
        class="ui-checkbox__input"
        type="checkbox"
        disabled={local.disabled}
        aria-describedby={local.hint ? hintId() : undefined}
      />
      <span class="ui-checkbox__copy">
        <span class="ui-checkbox__label">{local.label}</span>
        <Show when={local.hint}>
          <span id={hintId()} class="ui-checkbox__hint">
            {local.hint}
          </span>
        </Show>
      </span>
    </label>
  );
}
