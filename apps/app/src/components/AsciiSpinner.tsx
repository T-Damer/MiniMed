import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import '@/components/AsciiSpinner.css';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { motionMs } from '@/state/motion';

/** The classic terminal spinner; the dash is an en dash so every frame is as wide as the others. */
export const ASCII_SPINNER_FRAMES: readonly string[] = ['|', '/', '–', '\\'];
/** Shown instead of the cycle when animations are off or the system asks for reduced motion. */
export const ASCII_SPINNER_STATIC_FRAME = '…';
const FRAME_MS = 110;

export interface AsciiSpinnerProps {
  readonly class?: string;
}

/**
 * A tiny «in progress» mark for dense controls (the find box). It cycles `| / – \` at the speed the
 * Animations setting chooses (`state/motion.ts`) and stands still when animations are off or the
 * system prefers reduced motion. The glyph is decorative: the host announces the state itself.
 */
export function AsciiSpinner(props: AsciiSpinnerProps): JSX.Element {
  const [frame, setFrame] = createSignal(0);
  const [animated, setAnimated] = createSignal(false);
  let timer: number | undefined;

  const stop = (): void => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
  };

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => {
      stop();
      const interval = motionMs(FRAME_MS);
      const canAnimate = !reduced.matches && interval > 0;
      setAnimated(canAnimate);
      if (!canAnimate) return;
      timer = window.setInterval(() => setFrame((value) => (value + 1) % 4), interval);
    };
    sync();
    reduced.addEventListener('change', sync);
    // The motion manager subscribed first, so `motionMs` already reflects the new speed.
    const unsubscribe = subscribeAppPreferences(sync);
    onCleanup(() => {
      stop();
      reduced.removeEventListener('change', sync);
      unsubscribe();
    });
  });

  return (
    <span
      class={`ascii-spinner${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'ascii-spinner--static': !animated() }}
      aria-hidden="true"
    >
      {animated() ? (ASCII_SPINNER_FRAMES[frame()] ?? '|') : ASCII_SPINNER_STATIC_FRAME}
    </span>
  );
}
