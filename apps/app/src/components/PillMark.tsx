import type { JSX } from 'solid-js';

import { pillHue, pillLetter } from '@/components/pill-mark';

import '@/components/PillMark.css';

/**
 * A medicine's mark (owner 2026-11-04): a round tablet with the first letter of its
 * name, tinted by the name. Decorative: the row says the name in words.
 */
export function PillMark(props: { readonly name: string; readonly class?: string }): JSX.Element {
  return (
    <svg
      class={`pill-mark${props.class ? ` ${props.class}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ '--pill-hue': String(pillHue(props.name)) }}
    >
      <circle class="pill-mark__body" cx="12" cy="12" r="10.75" />
      <text
        class="pill-mark__letter"
        x="12"
        y="12.6"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {pillLetter(props.name)}
      </text>
    </svg>
  );
}
