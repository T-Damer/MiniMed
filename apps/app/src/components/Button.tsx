import { type JSX, Show, splitProps } from 'solid-js';

import '@/components/Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'icon';

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: JSX.Element;
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, button] = splitProps(props, ['variant', 'icon', 'class', 'children']);
  const variant = (): ButtonVariant => local.variant ?? 'secondary';

  return (
    <button {...button} class={`ui-button ui-button--${variant()} ${local.class ?? ''}`.trim()}>
      <Show when={local.icon}>{(icon) => <span class="ui-button__icon">{icon()}</span>}</Show>
      <Show when={variant() !== 'icon'}>
        <span class="ui-button__label">{local.children}</span>
      </Show>
    </button>
  );
}
