import { type JSX, Show, splitProps } from 'solid-js';

import '@/components/ChoiceChip.css';

export interface ChoiceChipProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon?: JSX.Element;
  /** Secondary line, e.g. the document family or a download size. */
  readonly detail?: JSX.Element | undefined;
  /** Accent chips carry the recommended next step; plain chips are alternatives. */
  readonly accent?: boolean | undefined;
  /** A one-line chip with a small icon, for a corner of a card header. */
  readonly compact?: boolean | undefined;
}

/** A tappable choice that reads as a button, not as inline link text. */
export function ChoiceChip(props: ChoiceChipProps): JSX.Element {
  const [local, button] = splitProps(props, [
    'icon',
    'detail',
    'accent',
    'compact',
    'class',
    'children',
  ]);
  return (
    <button
      type="button"
      {...button}
      class={`choice-chip ${local.accent ? 'choice-chip--accent' : ''} ${local.compact ? 'choice-chip--compact' : ''} ${local.class ?? ''}`
        .replace(/ {2,}/gu, ' ')
        .trim()}
    >
      <Show when={local.icon}>{(icon) => <span class="choice-chip__icon">{icon()}</span>}</Show>
      <span class="choice-chip__copy">
        <span class="choice-chip__label">{local.children}</span>
        <Show when={local.detail}>
          {(detail) => <span class="choice-chip__detail">{detail()}</span>}
        </Show>
      </span>
    </button>
  );
}

export function ChoiceChipList(props: {
  readonly label?: string;
  readonly class?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <fieldset class={`choice-chip-list ${props.class ?? ''}`.trim()} aria-label={props.label}>
      {props.children}
    </fieldset>
  );
}
