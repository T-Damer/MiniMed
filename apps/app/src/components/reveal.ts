import { motionMs } from '@/state/motion';

import '@/components/reveal.css';

/**
 * Scrolls to an element and shows where the scroll ended: once the element is really on screen
 * (not when the scroll starts) it gets a soft accent pulse of about a second. Use it wherever a
 * screen jumps the reader to something (a missing answer, an invalid field, a day in a list).
 *
 * Contract:
 * - `revealElement(el, options?)` scrolls `el` into view and returns a function that cancels the
 *   pending highlight (call it on cleanup; after the highlight played it does nothing).
 * - The highlight plays when at least `threshold` of the element (default 0.6), or of the
 *   viewport for an element taller than the screen, is visible. If that never happens (the page
 *   cannot scroll further, no IntersectionObserver) it plays after `fallbackMs` (default 1200).
 * - A second call for the same element restarts its highlight; other elements are independent.
 * - With «Анимации: выкл» or a reduced-motion system setting the scroll is instant and nothing
 *   is highlighted: the jump alone is the signal.
 * - It only scrolls and decorates: focus stays where the caller put it.
 */
export interface RevealOptions {
  /** Where the element lands in the viewport; the middle by default. */
  readonly block?: ScrollLogicalPosition;
  /** Share of the element that must be visible before the highlight plays (0 to 1). */
  readonly threshold?: number;
  /** The highlight plays at the latest after this long, arrived or not. */
  readonly fallbackMs?: number;
  /** Scroll only, no highlight. */
  readonly highlight?: boolean;
}

const HIGHLIGHT_CLASS = 'reveal-highlight';
const HIGHLIGHT_MS = 1000;

const pending = new WeakMap<Element, () => void>();

function withoutMotion(): boolean {
  return motionMs(1) === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function playHighlight(element: Element): void {
  element.classList.remove(HIGHLIGHT_CLASS);
  // A restarted animation needs a frame without the class.
  void (element as HTMLElement).offsetWidth;
  element.classList.add(HIGHLIGHT_CLASS);
  const stop = (): void => element.classList.remove(HIGHLIGHT_CLASS);
  element.addEventListener('animationend', stop, { once: true });
  window.setTimeout(stop, motionMs(HIGHLIGHT_MS) + 200);
}

export function revealElement(element: Element, options: RevealOptions = {}): () => void {
  pending.get(element)?.();
  const instant = withoutMotion();
  element.scrollIntoView({
    block: options.block ?? 'center',
    behavior: instant ? 'auto' : 'smooth',
  });
  if (instant || options.highlight === false) return () => undefined;

  const threshold = options.threshold ?? 0.6;
  let timer: number | undefined;
  let observer: IntersectionObserver | undefined;
  const cancel = (): void => {
    window.clearTimeout(timer);
    observer?.disconnect();
    pending.delete(element);
  };
  const arrive = (): void => {
    cancel();
    playHighlight(element);
  };
  timer = window.setTimeout(arrive, options.fallbackMs ?? 1200);
  pending.set(element, cancel);
  if (typeof IntersectionObserver === 'undefined') return cancel;
  observer = new IntersectionObserver(
    (entries) => {
      const seen = entries.some(
        (entry) =>
          entry.isIntersecting &&
          (entry.intersectionRatio >= threshold ||
            // An element taller than the screen can never be mostly visible.
            entry.intersectionRect.height >= window.innerHeight * threshold),
      );
      if (seen) arrive();
    },
    { threshold: [threshold] },
  );
  observer.observe(element);
  return cancel;
}
