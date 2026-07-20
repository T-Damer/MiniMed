import type { JSX } from 'solid-js';

interface BrandMarkProps {
  readonly class?: string;
  readonly title?: string;
}

export function BrandMark(props: BrandMarkProps): JSX.Element {
  const title = (): string => props.title ?? 'MiniMed — медицинские знания и документы';

  return (
    <svg
      class={props.class}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title()}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title()}</title>
      <path d="M13 12.5h31.5l7 7V54H13z" fill="#f6eedb" stroke="#263f36" stroke-width="2.4" />
      <path d="M44.5 12.5v8h7" fill="#d7c49a" stroke="#263f36" stroke-width="2.4" />
      <path d="M9 18.5h4V54h33v4H9z" fill="#b79d66" opacity=".9" />
      <path
        d="M23 27.5 32 36l9-8.5M32 36v9"
        fill="none"
        stroke="#44685a"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="23" cy="27.5" r="3.4" fill="#8c4d42" />
      <circle cx="41" cy="27.5" r="3.4" fill="#8c4d42" />
      <circle cx="32" cy="45" r="3.4" fill="#8c4d42" />
      <path d="M17.5 19.5h13" stroke="#b39f78" stroke-width="2" stroke-linecap="round" />
      <path d="M17.5 23h8" stroke="#b39f78" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}
