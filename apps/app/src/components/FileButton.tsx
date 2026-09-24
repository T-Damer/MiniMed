import { type JSX, splitProps } from 'solid-js';

import '@/components/FileButton.css';

export type FileButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface FileButtonProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class' | 'type'> {
  readonly children: JSX.Element;
  readonly class?: string;
  readonly variant?: FileButtonVariant;
}

export function FileButton(props: FileButtonProps): JSX.Element {
  const [local, input] = splitProps(props, ['children', 'class', 'variant', 'disabled']);
  const variant = () => local.variant ?? 'secondary';

  return (
    <label
      class={`ui-file-button ui-file-button--${variant()}${local.class ? ` ${local.class}` : ''}`}
      classList={{ 'ui-file-button--disabled': local.disabled ?? false }}
    >
      <input {...input} class="ui-file-button__input" type="file" disabled={local.disabled} />
      <span class="ui-file-button__label">{local.children}</span>
    </label>
  );
}
