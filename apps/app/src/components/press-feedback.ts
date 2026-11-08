/**
 * Pressed controls shrink a little while the finger is down (AGENTS.md «Motion»: ≈0.96) and spring
 * back when it lifts — every tappable thing in the app, without each component asking for it.
 * Under a fingertip that scale is a pixel or two, so a held press also shades the control
 * (press-feedback.css), as iOS highlights a touched control. Controls drawn as physical keys (a
 * face on a ledge: `.ui-button` and the primary-depth ones) neither shrink nor shade: they sink
 * onto their ledge, drawn in CSS from `data-pressed` (owner 2026-11-04).
 *
 * Letting go springs back past full size and settles (owner 2026-11-08: presses should feel fun,
 * spring animations are ideal), but never so far that the control pokes out of a box that clips it
 * or the screen: the overshoot is capped by the room around it (`maxUnclippedScale`), and with no
 * room it simply returns.
 *
 * The scale is the independent `scale` property played with `Element.animate`, so it composes with
 * a control's own `transform` and `transition`, the AnimationManager retimes it (state/motion.ts)
 * and «Анимации: выкл.» skips it. A tap is shorter than the animation: the pressed state is held
 * for a minimum time, so a quick tap still shows it (and a navigation that starts a frame later
 * does not hide it).
 */
import { motionRate } from '@/state/motion';

import '@/components/press-feedback.css';

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

/**
 * Set on the pressed control for as long as the press shows, at least {@link PRESS_HOLD_MS}. Its
 * value says how the press is drawn in CSS: a key on a ledge sinks, a control shades
 * (press-feedback.css) unless it paints a background image of its own (a striped cell, a shutter),
 * which the shade would cover — that one only scales.
 */
export const PRESSED_ATTRIBUTE = 'data-pressed';
type PressLook = 'ledge' | 'shade' | '';

/** The shortest time a press stays visible, so a quick tap is not over before it is seen. */
export const PRESS_HOLD_MS = 120;
const PRESS_IN_MS = 90;
/** The spring back: longer than a plain release because it overshoots and settles (≤ 300 ms). */
const PRESS_OUT_MS = 300;
const ROW_SCALE = 0.98;
const CONTROL_SCALE = 0.96;
/** How far past full size a released control springs: a button bounces, a wide row only stirs. */
const CONTROL_OVERSHOOT = 1.04;
const ROW_OVERSHOOT = 1.012;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The largest scale (about the centre) at which `box` still fits inside `clip`: a control at the
 * edge of a clipping card or of the screen has no room to grow and gets 1.
 */
export function maxUnclippedScale(box: Box, clip: Box): number {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width <= 0 || height <= 0) return 1;
  const roomX = Math.min(box.left - clip.left, clip.right - box.right);
  const roomY = Math.min(box.top - clip.top, clip.bottom - box.bottom);
  const room = Math.min((2 * roomX) / width, (2 * roomY) / height);
  return Math.max(1, 1 + room);
}

/**
 * Keyframes of a damped spring from `from` to 1 that first swings to `peak` (> 1) and settles
 * with a smaller swing back; with `peak` ≤ 1 it returns without overshoot.
 */
export function springBackKeyframes(from: number, peak: number): Keyframe[] {
  if (peak <= 1.001) return [{ scale: String(from) }, { scale: '1' }];
  const swing = peak - 1;
  const round = (value: number): string => value.toFixed(4);
  return [
    { scale: round(from), offset: 0, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
    { scale: round(peak), offset: 0.38, easing: 'ease-in-out' },
    { scale: round(1 - swing * 0.35), offset: 0.68, easing: 'ease-in-out' },
    { scale: round(1 + swing * 0.1), offset: 0.86, easing: 'ease-in-out' },
    { scale: '1', offset: 1 },
  ];
}

/** The box a control may grow into: the screen, cut by every ancestor that clips its overflow. */
function clipBox(element: HTMLElement): Box {
  let clip: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = node.getBoundingClientRect();
    clip = {
      left: Math.max(clip.left, box.left),
      top: Math.max(clip.top, box.top),
      right: Math.min(clip.right, box.right),
      bottom: Math.min(clip.bottom, box.bottom),
    };
  }
  return clip;
}

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
  /** How far the release may spring past full size (1: no overshoot). */
  readonly peak: number;
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
  const computed = getComputedStyle(element).scale;
  const from = computed === 'none' ? 1 : Number.parseFloat(computed) || 1;
  animation.cancel();
  const back = element.animate(springBackKeyframes(from, press.peak), {
    duration: PRESS_OUT_MS,
    easing: 'linear',
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
  const look: PressLook = ledged
    ? 'ledge'
    : getComputedStyle(element).backgroundImage === 'none'
      ? 'shade'
      : '';
  element.setAttribute(PRESSED_ATTRIBUTE, look);
  const animation =
    ledged || scale === null || !moving()
      ? undefined
      : element.animate([{ scale: '1' }, { scale: String(scale) }], {
          duration: PRESS_IN_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        });
  // Measured at full size, before the press shrinks it: the room the spring back may use.
  const peak =
    animation && scale !== null
      ? Math.min(
          scale === ROW_SCALE ? ROW_OVERSHOOT : CONTROL_OVERSHOOT,
          maxUnclippedScale(box, clipBox(element)),
        )
      : 1;
  current = {
    element,
    pointerId: event.pointerId,
    startedAt: performance.now(),
    animation,
    peak,
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
