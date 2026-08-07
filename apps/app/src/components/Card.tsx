import type { JSX } from 'solid-js';

export function Card(props: {
  readonly class?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <article class={`paper-card ui-card ${props.class ?? ''}`.trim()}>{props.children}</article>
  );
}
