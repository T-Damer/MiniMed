/**
 * Pressed controls shrink a little while the finger is down (AGENTS.md «Motion»: ≈0.96) and spring
 * back when it lifts — every tappable thing in the app, without each component asking for it.
 * Controls drawn as physical keys (a face on a ledge: `.ui-button` and the primary-depth ones) do
 * not shrink: they sink onto their ledge, drawn in CSS from `data-pressed` (owner 2026-11-04).
 *
 * The scale is the independent `scale` property played with `Element.animate`, so it composes with
 * a control's own `transform` and `transition`, the AnimationManager retimes it (state/motion.ts)
 * and «Анимации: выкл.» skips it. A tap is shorter than the animation: the pressed state is held
 * for a minimum time, so a quick tap still shows it (and a navigation that starts a frame later
 * does not hide it).
 */
import { motionRate } from '@/state/motion';

const PRESSABLE = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  'label[for]',
  '[data-pressable]',
].join(', ');

const NOT_PRESSABLE = '[disabled], [aria-disabled="true"], [data-no-press]';

/** Keys on a ledge: CSS sinks them while `data-pressed` is set (Button.css, primary-depth.css). */
const LEDGED = [
  '.ui-button:not(.ui-button--quiet)',
  '.ui-file-button--primary',
  '.home-feature__action:not(.home-feature__action--secondary)',
  '.assessment-card-actions__button--primary',
  '.assessment-submit-panel__button',
  '.assessment-panel-actions__button--primary',
  '.package-row__button--primary',
  '.search-quick-access__all',
].join(', ');

/** Set on the pressed control for as long as the press shows, at least {@link PRESS_HOLD_MS}. */
export const PRESSED_ATTRIBUTE = 'data-pressed';

/** The shortest time a press stays visible, so a quick tap is not over before it is seen. */
export const PRESS_HOLD_MS = 120;
const PRESS_IN_MS = 90;
const PRESS_OUT_MS = 180;
const ROW_SCALE = 0.98;
const CONTROL_SCALE = 0.96;

/**
 * The scale a control of this size takes when pressed: small controls shrink to 0.96, wide rows
 * (a list row, a card) only a little, and big surfaces not at all.
 */
export function pressScale(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): number | null {
  if (width <= 0 || height <= 0) return null;
  if (height > 0.4 * viewportHeight || width * height > 0.3 * viewportWidth * viewportHeight) {
    return null;
  }
  return width > 0.6 * viewportWidth ? ROW_SCALE : CONTROL_SCALE;
}

interface Press {
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly startedAt: number;
  /** Absent for a key on a ledge (it sinks in CSS) and with reduced motion (shade only). */
  readonly animation: Animation | undefined;
  releaseTimer: number | undefined;
}

let current: Press | undefined;

function release(press: Press): void {
  if (current === press) current = undefined;
  window.clearTimeout(press.releaseTimer);
  const { element, animation } = press;
  element.removeAttribute(PRESSED_ATTRIBUTE);
  if (!animation) return;
  if (!element.isConnected) {
    animation.cancel();
    return;
  }
  const from = getComputedStyle(element).scale;
  animation.cancel();
  const back = element.animate([{ scale: from === 'none' ? '1' : from }, { scale: '1' }], {
    duration: PRESS_OUT_MS,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  });
  back.addEventListener('finish', () => back.cancel(), { once: true });
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (!(event.target instanceof Element)) return;
  const element = event.target.closest<HTMLElement>(PRESSABLE);
  if (!element || element.matches(NOT_PRESSABLE) || element.closest(NOT_PRESSABLE)) return;
  if (current) release(current);
  const box = element.getBoundingClientRect();
  const scale = pressScale(box.width, box.height, window.innerWidth, window.innerHeight);
  const ledged = element.matches(LEDGED);
  if (scale === null && !ledged) return;
  element.setAttribute(PRESSED_ATTRIBUTE, '');
  const animation =
    ledged || scale === null || !moving()
      ? undefined
      : element.animate([{ scale: '1' }, { scale: String(scale) }], {
          duration: PRESS_IN_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        });
  current = {
    element,
    pointerId: event.pointerId,
    startedAt: performance.now(),
    animation,
    releaseTimer: undefined,
  };
}

function onPointerEnd(event: PointerEvent): void {
  const press = current;
  if (!press || press.pointerId !== event.pointerId) return;
  // A cancelled touch is a scroll, not a tap: it lets go at once. A lift waits out the hold.
  const wait =
    event.type === 'pointercancel'
      ? 0
      : Math.max(0, PRESS_HOLD_MS - (performance.now() - press.startedAt));
  if (wait === 0) {
    release(press);
    return;
  }
  press.releaseTimer = window.setTimeout(() => release(press), wait);
}

/** Scale animations run unless the app's animations are off or the system asks for less motion. */
function moving(): boolean {
  return (
    motionRate() !== 0 &&
    typeof Element.prototype.animate === 'function' &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** Starts the press feedback for the whole document; returns the function that stops it. */
export function installPressFeedback(root: Document = document): () => void {
  const options = { capture: true, passive: true } as const;
  root.addEventListener('pointerdown', onPointerDown, options);
  root.addEventListener('pointerup', onPointerEnd, options);
  root.addEventListener('pointercancel', onPointerEnd, options);
  return () => {
    root.removeEventListener('pointerdown', onPointerDown, options);
    root.removeEventListener('pointerup', onPointerEnd, options);
    root.removeEventListener('pointercancel', onPointerEnd, options);
    if (current) release(current);
  };
}
