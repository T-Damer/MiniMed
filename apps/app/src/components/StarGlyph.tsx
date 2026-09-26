import type { JSX } from 'solid-js';

/** Favourite mark: outlined when off, filled when on. Colour follows `currentColor`. */
export function StarGlyph(props: {
  readonly filled: boolean;
  readonly class?: string;
}): JSX.Element {
  return (
    <svg class={`star-glyph ${props.class ?? ''}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points="12 2.6 14.53 9.12 21.51 9.51 16.09 13.93 17.88 20.69 12 16.9 6.12 20.69 7.91 13.93 2.49 9.51 9.47 9.12"
        fill={props.filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
    </svg>
  );
}
