import type { JSX } from 'solid-js';

export type AppGlyphName =
  | 'search'
  | 'archive'
  | 'modules'
  | 'history'
  | 'menu'
  | 'notes'
  | 'brain'
  | 'system'
  | 'close'
  | 'graph'
  | 'list'
  | 'arrow-up'
  | 'download'
  | 'trash';

export function AppGlyph(props: {
  readonly name: AppGlyphName;
  readonly class?: string;
}): JSX.Element {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {props.name === 'search' && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.4 15.4 4.1 4.1" />
        </>
      )}
      {props.name === 'archive' && (
        <>
          <path d="M4 7.5h16v11H4z" />
          <path d="M6 4.5h12l2 3H4zM9 11h6" />
        </>
      )}
      {props.name === 'modules' && (
        <>
          <path d="m12 3 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
        </>
      )}
      {props.name === 'history' && (
        <>
          <path d="M4.3 9A8 8 0 1 1 5 16.4" />
          <path d="M4 4.8V9h4.2M12 7.5V12l3 1.8" />
        </>
      )}
      {props.name === 'menu' && <path d="M4 7h16M4 12h16M4 17h16" />}
      {props.name === 'notes' && (
        <>
          <path d="M6 3.5h9.5L19 7v13.5H6Z" />
          <path d="M15 3.5V7h4M9 11h7M9 14.5h7M9 18h4.5" />
        </>
      )}
      {props.name === 'brain' && (
        <>
          <path d="M9.2 4.8A3.2 3.2 0 0 0 6 8v.4a3.4 3.4 0 0 0-1.8 5.9A3.6 3.6 0 0 0 7.6 20H10V4.8Z" />
          <path d="M14.8 4.8A3.2 3.2 0 0 1 18 8v.4a3.4 3.4 0 0 1 1.8 5.9 3.6 3.6 0 0 1-3.4 5.7H14V4.8Z" />
          <path d="M10 8.1c-1 .2-1.8 1-1.8 2 0 1 .7 1.8 1.8 2M14 8.1c1 .2 1.8 1 1.8 2 0 1-.7 1.8-1.8 2M10 12.1c-1.1.2-2 .9-2 2.1 0 1 .8 1.9 2 2.1M14 12.1c1.1.2 2 .9 2 2.1 0 1-.8 1.9-2 2.1" />
        </>
      )}
      {props.name === 'system' && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.5 1a8 8 0 0 0-2-1.2L14 3h-4l-.4 2.7a8 8 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.5-1a8 8 0 0 0 2 1.2L10 21h4l.4-2.7a8 8 0 0 0 2-1.2l2.5 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
        </>
      )}
      {props.name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
      {props.name === 'graph' && (
        <>
          <circle cx="6" cy="12" r="2.2" />
          <circle cx="17.5" cy="6" r="2.2" />
          <circle cx="17.5" cy="18" r="2.2" />
          <path d="m8 11 7.4-4M8 13l7.4 4" />
        </>
      )}
      {props.name === 'list' && (
        <>
          <path d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4" cy="6" r=".8" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r=".8" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r=".8" fill="currentColor" stroke="none" />
        </>
      )}
      {props.name === 'arrow-up' && <path d="m5 14 7-7 7 7M12 7v13" />}
      {props.name === 'download' && <path d="M12 3v12m-4-4 4 4 4-4M5 20h14" />}
      {props.name === 'trash' && (
        <>
          <path d="M4.5 6h15" />
          <path d="M8 6V4.5h8V6" />
          <path d="M7 6l.8 13h8.4L17 6" />
          <path d="M10 9.5v6.5M14 9.5v6.5" />
        </>
      )}
    </svg>
  );
}
