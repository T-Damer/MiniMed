import type { JSX } from 'solid-js';

export type NavIconName = 'search' | 'archive' | 'history' | 'status';

interface NavIconProps {
  readonly name: NavIconName;
}

export function NavIcon(props: NavIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {props.name === 'search' && (
        <>
          <circle cx="10.5" cy="10.5" r="5.8" />
          <path d="m15 15 4.2 4.2" />
          <path d="M7.5 10.5h6M10.5 7.5v6" class="nav-icon-faint" />
        </>
      )}
      {props.name === 'archive' && (
        <>
          <path d="M4 7.5h6l1.5-2H20v13H4z" />
          <path d="M4 9.5h16M8 13h8" class="nav-icon-faint" />
        </>
      )}
      {props.name === 'history' && (
        <>
          <path d="M5.3 8.2A7.6 7.6 0 1 1 4.5 14" />
          <path d="M5.2 4.8v4h4" />
          <path d="M12 8v4.5l3 1.8" class="nav-icon-faint" />
        </>
      )}
      {props.name === 'status' && (
        <>
          <path d="M5 18V9M10 18V5M15 18v-7M20 18V7" />
          <path d="M3.5 18.5h18" class="nav-icon-faint" />
        </>
      )}
    </svg>
  );
}
