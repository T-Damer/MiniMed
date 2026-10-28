import { createSignal, type JSX, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';

import '@/components/floating-action-button.css';

/** The column of floating controls (scroll-to-top, small window) mounted once by `App`. */
export const FLOATING_CONTROLS_HOST_ID = 'app-floating-controls';

export interface FloatingActionButtonProps {
  /** What the button does: «Добавить пациента». Names the button for assistive tech and as a tooltip. */
  readonly label: string;
  readonly onClick: () => void;
  /** Defaults to «+». */
  readonly icon?: AppGlyphName;
  readonly disabled?: boolean;
  readonly class?: string;
}

/**
 * Round «+» button at the bottom-right, above the bottom navigation. It joins the app's floating
 * controls column when that exists (so it never overlaps scroll-to-top) and otherwise fixes itself
 * to the corner. It rises and fades in when it appears and shrinks a little while pressed.
 */
export function FloatingActionButton(props: FloatingActionButtonProps): JSX.Element {
  // The host is rendered by `App` around the routes, so look it up once mounted, not while creating.
  const [host, setHost] = createSignal<HTMLElement | null | undefined>(undefined);
  onMount(() => setHost(document.getElementById(FLOATING_CONTROLS_HOST_ID)));

  const button = (inHost: boolean): JSX.Element => (
    <button
      type="button"
      class={`ui-fab${inHost ? '' : ' ui-fab--fixed'}${props.class ? ` ${props.class}` : ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <AppGlyph name={props.icon ?? 'plus'} class="ui-fab__icon" />
    </button>
  );

  return (
    <Show when={host() !== undefined}>
      <Show when={host()} fallback={button(false)}>
        {(mount) => <Portal mount={mount()}>{button(true)}</Portal>}
      </Show>
    </Show>
  );
}
