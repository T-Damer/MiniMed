import { createUniqueId, type JSX, Show, splitProps } from 'solid-js';

import '@/components/TextArea.css';

export interface TextAreaProps
  extends Omit<
    JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
    'aria-describedby' | 'class' | 'id'
  > {
  readonly label: JSX.Element;
  readonly hint?: JSX.Element;
  readonly error?: JSX.Element;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly class?: string;
  readonly textareaClass?: string;
  readonly 'aria-describedby'?: string;
}

export function TextArea(props: TextAreaProps): JSX.Element {
  const [local, textarea] = splitProps(props, [
    'label',
    'hint',
    'error',
    'hideLabel',
    'id',
    'class',
    'textareaClass',
    'aria-describedby',
  ]);
  const generatedId = createUniqueId();
  const fieldId = () => local.id ?? `ui-text-area-${generatedId}`;
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
    <label class={`ui-text-area${local.class ? ` ${local.class}` : ''}`} for={fieldId()}>
      <span class="ui-text-area__label" classList={{ 'sr-only': local.hideLabel ?? false }}>
        {local.label}
      </span>
      <textarea
        {...textarea}
        id={fieldId()}
        class={`ui-text-area__control${local.textareaClass ? ` ${local.textareaClass}` : ''}`}
        classList={{ 'ui-text-area__control--error': Boolean(local.error) }}
        aria-describedby={describedBy()}
        aria-invalid={local.error ? 'true' : undefined}
      />
      <Show when={local.hint}>
        <span id={hintId()} class="ui-text-area__hint">
          {local.hint}
        </span>
      </Show>
      <Show when={local.error}>
        <span id={errorId()} class="ui-text-area__error" role="alert">
          {local.error}
        </span>
      </Show>
    </label>
  );
}
