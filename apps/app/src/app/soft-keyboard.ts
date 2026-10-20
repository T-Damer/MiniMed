/**
 * The on-screen keyboard and the floating bottom navigation.
 *
 * On Android (3-button navigation) the WebView resizes when the keyboard opens: Capacitor's
 * SystemBars pads the WebView's parent by the keyboard height, so `visualViewport.height` shrinks
 * and everything fixed to the bottom — the navigation pill — rides up above the keyboard. The
 * navigation has no use while one types, so it steps out of the way (`html.app-keyboard-open`, the
 * same slide as the reader chrome) from the moment a text field takes focus until the viewport has
 * its height back, and the focused field is scrolled to where it can be seen.
 *
 * The decisions are pure functions over plain numbers and a few element facts (the unit runner has
 * no DOM); {@link watchSoftKeyboard} wires them to focus and viewport events.
 */
import '@/app/soft-keyboard.css';
import { motionRate } from '@/state/motion';

/** A soft keyboard is far taller than a collapsing browser bar; below this it is not a keyboard. */
export const KEYBOARD_MIN_SHRINK_PX = 120;
/** After a field loses focus the viewport gets this long to grow back before it is the new normal. */
export const KEYBOARD_CLOSE_GRACE_MS = 700;
/** Space kept between a revealed field and the keyboard (or the top edge). */
export const REVEAL_MARGIN_PX = 16;
/** Focus is followed by the keyboard animation; one more look when it is done. */
const REVEAL_SETTLE_MS = 320;
/** Resize events arrive in bursts while the keyboard animates; act once, after the last. */
const REVEAL_DEBOUNCE_MS = 80;
/** How often the hidden bar checks whether its reason is gone. */
const WATCH_INTERVAL_MS = 400;

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** The facts about an element that decide whether it opens a keyboard. */
export interface FocusFacts {
  readonly tagName: string;
  readonly type?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly isContentEditable?: boolean | undefined;
}

/** True for a field the user types into (not a checkbox, a button, a locked or a read-only one). */
export function isTextEntry(facts: FocusFacts | null | undefined): boolean {
  if (!facts || facts.disabled === true) return false;
  const tag = facts.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return facts.readOnly !== true;
  if (tag === 'INPUT') {
    return (
      facts.readOnly !== true && !NON_TEXT_INPUT_TYPES.has((facts.type ?? 'text').toLowerCase())
    );
  }
  return facts.isContentEditable === true;
}

export interface KeyboardTrackerState {
  /** The viewport height with no keyboard: the largest recently seen. */
  readonly referenceHeight: number;
  readonly referenceWidth: number;
  /** Since when no field has focus although the viewport is still short (the keyboard closing). */
  readonly shrunkSince: number | undefined;
}

export interface KeyboardTrackerInput {
  readonly focused: boolean;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
  /** A touch device: focusing a field there brings the keyboard even before the viewport moves. */
  readonly coarsePointer: boolean;
  readonly now: number;
}

export function initialKeyboardTracker(
  viewportHeight: number,
  viewportWidth: number,
): KeyboardTrackerState {
  return { referenceHeight: viewportHeight, referenceWidth: viewportWidth, shrunkSince: undefined };
}

/**
 * One observation: the new state and whether the bottom navigation must be out of the way.
 * - a text field is focused on a touch device, or the viewport is visibly shorter: hidden;
 * - the field lost focus but the viewport has not grown back yet: still hidden, for a short grace
 *   (the keyboard animates out), so the bar does not appear above the closing keyboard;
 * - a width change is a rotation or a split screen: the height is measured afresh.
 */
export function stepKeyboardTracker(
  state: KeyboardTrackerState,
  input: KeyboardTrackerInput,
): { readonly state: KeyboardTrackerState; readonly hidden: boolean } {
  let reference = state.referenceHeight;
  if (input.viewportWidth !== state.referenceWidth) reference = input.viewportHeight;
  if (input.viewportHeight > reference) reference = input.viewportHeight;
  const shrunk = reference - input.viewportHeight >= KEYBOARD_MIN_SHRINK_PX;

  if (input.focused) {
    return {
      state: {
        referenceHeight: reference,
        referenceWidth: input.viewportWidth,
        shrunkSince: undefined,
      },
      hidden: input.coarsePointer || shrunk,
    };
  }
  if (!shrunk) {
    return {
      state: {
        referenceHeight: input.viewportHeight,
        referenceWidth: input.viewportWidth,
        shrunkSince: undefined,
      },
      hidden: false,
    };
  }
  const since = state.shrunkSince ?? input.now;
  if (input.now - since > KEYBOARD_CLOSE_GRACE_MS) {
    // The viewport stayed short without a field: it is the new normal, not a keyboard.
    return {
      state: {
        referenceHeight: input.viewportHeight,
        referenceWidth: input.viewportWidth,
        shrunkSince: undefined,
      },
      hidden: false,
    };
  }
  return {
    state: {
      referenceHeight: reference,
      referenceWidth: input.viewportWidth,
      shrunkSince: since,
    },
    hidden: true,
  };
}

export interface VerticalSpan {
  readonly top: number;
  readonly bottom: number;
}

/**
 * How far the page must scroll (positive: content moves up) for `field` to sit inside `visible`
 * with `margin` to spare; 0 when it already does, or when it is taller than the free space (then
 * its top edge wins, so the start of a long field stays reachable).
 */
export function revealDelta(field: VerticalSpan, visible: VerticalSpan, margin: number): number {
  const top = visible.top + margin;
  const bottom = visible.bottom - margin;
  if (field.bottom - field.top > bottom - top) return field.top < top ? field.top - top : 0;
  if (field.top < top) return field.top - top;
  if (field.bottom > bottom) return field.bottom - bottom;
  return 0;
}

function focusFactsOf(element: Element | null): FocusFacts | null {
  if (!(element instanceof HTMLElement)) return null;
  const input = element instanceof HTMLInputElement ? element : undefined;
  const area = element instanceof HTMLTextAreaElement ? element : undefined;
  return {
    tagName: element.tagName,
    type: input?.type,
    readOnly: input?.readOnly ?? area?.readOnly,
    disabled: input?.disabled ?? area?.disabled,
    isContentEditable: element.isContentEditable,
  };
}

function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** The space above the keyboard that a field can be seen in. */
function visibleSpan(): VerticalSpan {
  const viewport = window.visualViewport;
  const safeTop = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
  );
  const top = (viewport?.offsetTop ?? 0) + (Number.isFinite(safeTop) ? safeTop : 0);
  const height = viewport?.height ?? window.innerHeight;
  return { top, bottom: (viewport?.offsetTop ?? 0) + height };
}

/** Scrolls the focused field (and its scrollers) so it is not under the keyboard. */
export function revealFocusedField(): void {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !isTextEntry(focusFactsOf(element))) return;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const delta = revealDelta(
    { top: rect.top, bottom: rect.bottom },
    visibleSpan(),
    REVEAL_MARGIN_PX,
  );
  if (delta === 0) return;
  element.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: motionRate() === 0 ? 'auto' : 'smooth',
  });
}

const OPEN_CLASS = 'app-keyboard-open';

/** Starts following focus and the viewport; returns the function that stops it. */
export function watchSoftKeyboard(root: HTMLElement = document.documentElement): () => void {
  const viewport = window.visualViewport;
  const height = (): number => viewport?.height ?? window.innerHeight;
  const width = (): number => viewport?.width ?? window.innerWidth;
  let tracker = initialKeyboardTracker(height(), width());
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let watchTimer: ReturnType<typeof setInterval> | undefined;

  const focused = (): boolean => isTextEntry(focusFactsOf(document.activeElement));

  const sync = (): void => {
    const step = stepKeyboardTracker(tracker, {
      focused: focused(),
      viewportHeight: height(),
      viewportWidth: width(),
      coarsePointer: isCoarsePointer(),
      now: performance.now(),
    });
    tracker = step.state;
    root.classList.toggle(OPEN_CLASS, step.hidden);
    // A focused field that is removed (the route changed) fires no `focusout`, and a closing keyboard
    // sends no event once the grace is over: while the bar is away, look again from time to time.
    if (step.hidden && watchTimer === undefined) watchTimer = setInterval(sync, WATCH_INTERVAL_MS);
    if (!step.hidden && watchTimer !== undefined) {
      clearInterval(watchTimer);
      watchTimer = undefined;
    }
  };

  const scheduleReveal = (): void => {
    if (revealTimer !== undefined) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = undefined;
      revealFocusedField();
    }, REVEAL_DEBOUNCE_MS);
  };

  const onFocusIn = (): void => {
    sync();
    if (!focused()) return;
    scheduleReveal();
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      revealFocusedField();
    }, REVEAL_SETTLE_MS);
  };
  // `focusout` fires before the next element is focused: read the active element afterwards.
  const onFocusOut = (): void => {
    queueMicrotask(sync);
  };
  const onViewportResize = (): void => {
    sync();
    if (focused()) scheduleReveal();
  };

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  viewport?.addEventListener('resize', onViewportResize);
  window.addEventListener('resize', onViewportResize);
  sync();
  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    viewport?.removeEventListener('resize', onViewportResize);
    window.removeEventListener('resize', onViewportResize);
    for (const timer of [revealTimer, settleTimer]) {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (watchTimer !== undefined) clearInterval(watchTimer);
    root.classList.remove(OPEN_CLASS);
  };
}
