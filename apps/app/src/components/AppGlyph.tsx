import type { JSX } from 'solid-js';

export type AppGlyphName =
  | 'search'
  | 'archive'
  | 'modules'
  | 'history'
  | 'menu'
  | 'notes'
  | 'brain'
  | 'list-checks'
  | 'system'
  | 'close'
  | 'graph'
  | 'calculator'
  | 'list'
  | 'arrow-left'
  | 'arrow-up'
  | 'book-open'
  | 'refresh'
  | 'download'
  | 'minus'
  | 'edit'
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
      {(props.name === 'brain' || props.name === 'list-checks') && (
        <>
          <path d="m3 6 2 2 4-4" />
          <path d="m3 16 2 2 4-4" />
          <path d="M13 6h8M13 12h8M13 18h8" />
        </>
      )}
      {props.name === 'system' && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.5 1a8 8 0 0 0-2-1.2L14 3h-4l-.4 2.7a8 8 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.5-1a8 8 0 0 0 2 1.2L10 21h4l.4-2.7a8 8 0 0 0 2-1.2l2.5 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
        </>
      )}
      {props.name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
      {props.name === 'minus' && <path d="M5 12h14" />}
      {(props.name === 'graph' || props.name === 'calculator') && (
        <>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M8 6h8M16 14v4" />
          <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01" />
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
      {props.name === 'arrow-left' && (
        <path
          d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"
          fill="currentColor"
          stroke="none"
          transform="scale(0.09375)"
        />
      )}
      {props.name === 'arrow-up' && <path d="m5 14 7-7 7 7M12 7v13" />}
      {props.name === 'book-open' && (
        <path
          d="M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z"
          fill="currentColor"
          stroke="none"
          transform="scale(0.09375)"
        />
      )}
      {props.name === 'refresh' && (
        <>
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M6.1 8.5A7 7 0 0 1 18.8 9L20 12M4 12l1.2 3A7 7 0 0 0 17.9 15.5" />
        </>
      )}
      {props.name === 'download' && <path d="M12 3v12m-4-4 4 4 4-4M5 20h14" />}
      {props.name === 'edit' && (
        <>
          <path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z" />
          <path d="m14.6 7 2.8 2.8" />
        </>
      )}
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
