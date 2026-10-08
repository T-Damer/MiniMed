import { createEffect, Index, type JSX, on } from 'solid-js';

import '@/components/RollingNumber.css';

/** One digit change: the old glyph leaves and the new one arrives, 180 ms (retimed by the motion manager). */
const ROLL_MS = 180;
const ROLL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** How far a glyph travels, as a share of its own height: enough to read as rolling, short enough to stay quick. */
const ROLL_TRAVEL = 0.55;

/** The digits of `value`, units first, so a digit keeps its column when the number grows or shrinks. */
function digitsUnitsFirst(value: number): readonly string[] {
  return String(Math.max(0, Math.trunc(value)))
    .split('')
    .reverse();
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The digit slides out and its replacement slides in, the way a number changes in iOS: upwards
 * when the number grows, downwards when it falls. A change that arrives while another is still
 * moving cancels it, so a fast scroll never queues animations behind itself.
 */
function rollDigit(
  host: HTMLElement,
  glyph: HTMLElement,
  previous: string,
  direction: 1 | -1,
): void {
  if (prefersReducedMotion()) return;
  for (const stale of Array.from(host.querySelectorAll('.rolling-number__ghost'))) stale.remove();
  for (const animation of glyph.getAnimations()) animation.cancel();
  const ghost = document.createElement('span');
  ghost.className = 'rolling-number__glyph rolling-number__ghost';
  ghost.textContent = previous;
  host.append(ghost);
  const entering = direction * ROLL_TRAVEL * 100;
  const options: KeyframeAnimationOptions = {
    duration: ROLL_MS,
    easing: ROLL_EASING,
    fill: 'both',
  };
  const leaving = ghost.animate(
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: `translateY(${String(-entering)}%)`, opacity: 0 },
    ],
    options,
  );
  leaving.addEventListener('finish', () => ghost.remove());
  leaving.addEventListener('cancel', () => ghost.remove());
  glyph.animate(
    [
      { transform: `translateY(${String(entering)}%)`, opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    options,
  );
}

function RollingDigit(props: {
  readonly digit: string;
  readonly direction: () => 1 | -1;
}): JSX.Element {
  let host: HTMLSpanElement | undefined;
  let glyph: HTMLSpanElement | undefined;
  let shown = props.digit;
  createEffect(
    on(
      () => props.digit,
      (digit) => {
        const previous = shown;
        shown = digit;
        if (previous === digit || !host || !glyph) return;
        rollDigit(host, glyph, previous, props.direction());
      },
      { defer: true },
    ),
  );
  return (
    <span
      ref={(element) => {
        host = element;
      }}
      class="rolling-number__digit"
    >
      <span
        ref={(element) => {
          glyph = element;
        }}
        class="rolling-number__glyph"
      >
        {props.digit}
      </span>
    </span>
  );
}

/**
 * A number whose digits roll when it changes. Purely decorative: the owner of the number puts the
 * spoken value on its own control (`aria-label`), so the digits are hidden from assistive tech.
 */
export function RollingNumber(props: {
  readonly value: number;
  readonly class?: string;
}): JSX.Element {
  let direction: 1 | -1 = 1;
  let last = props.value;
  createEffect(
    on(
      () => props.value,
      (value) => {
        direction = value >= last ? 1 : -1;
        last = value;
      },
      { defer: true },
    ),
  );
  return (
    <span class={`rolling-number${props.class ? ` ${props.class}` : ''}`} aria-hidden="true">
      <Index each={digitsUnitsFirst(props.value)}>
        {(digit) => <RollingDigit digit={digit()} direction={() => direction} />}
      </Index>
    </span>
  );
}
