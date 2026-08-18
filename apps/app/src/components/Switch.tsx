import { type JSX, splitProps } from 'solid-js';

import '@/components/Switch.css';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly 'aria-label': string;
  readonly class?: string;
}

export function Switch(props: SwitchProps): JSX.Element {
  const [local, rest] = splitProps(props, ['checked', 'onChange', 'aria-label', 'class']);

  return (
    <button
      {...rest}
      type="button"
      class={`ui-switch ${local.class ?? ''}`.trim()}
      classList={{ 'ui-switch--on': local.checked }}
      role="switch"
      aria-checked={local.checked}
      aria-label={local['aria-label']}
      onClick={() => local.onChange(!local.checked)}
    >
      <span class="ui-switch__track" aria-hidden="true">
        <span class="ui-switch__thumb" />
      </span>
    </button>
  );
}
