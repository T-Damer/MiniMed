import type { JSX } from 'solid-js';

export function CountBadge(props: { readonly value: number | string }): JSX.Element {
  return <span class="collection-count-badge">{props.value}</span>;
}
