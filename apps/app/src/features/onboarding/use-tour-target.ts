import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js';

import { motionMs } from '@/state/motion';
import { needsScroll, type Rect, rectOnScreen } from './onboarding-geometry';

export interface TourTarget {
  readonly rect: Rect;
  /** Corner radius of the control in pixels, so the ring follows its shape. */
  readonly radius: number;
  /** The control sits in fixed or sticky chrome: scrolling the page never moves it. */
  readonly pinned: boolean;
}

/** After a step begins the target may still be loading or scrolling: keep looking this long. */
const SETTLE_MS = 2_800;
/** Free band at the top and bottom of the screen the target is scrolled out of. */
const SCROLL_INSETS = { top: 96, bottom: 120 } as const;

function sameRect(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function radiusOf(element: Element, rect: Rect): number {
  const raw = getComputedStyle(element).borderTopLeftRadius;
  const half = Math.min(rect.width, rect.height) / 2;
  const value = raw.endsWith('%')
    ? (Number.parseFloat(raw) / 100) * Math.min(rect.width, rect.height)
    : Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), half) : 0;
}

/** A control inside fixed or sticky chrome (the bottom navigation) never moves with page scroll. */
function inPinnedLayer(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

/** The first of `names` that has an element on screen (`data-tour="name"`), with its box. */
export function findTourTarget(
  names: readonly string[],
):
  | { readonly element: HTMLElement; readonly target: TourTarget; readonly index: number }
  | undefined {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  for (const [index, name] of names.entries()) {
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`),
    )) {
      const box = element.getBoundingClientRect();
      const rect = { left: box.left, top: box.top, width: box.width, height: box.height };
      if (rectOnScreen(rect, viewport)) {
        return {
          element,
          target: { rect, radius: radiusOf(element, rect), pinned: inPinnedLayer(element) },
          index,
        };
      }
    }
  }
  return undefined;
}

/**
 * A control that exists and has a box but lies beyond the side of the screen, such as a slide of a
 * carousel that is not showing. Scrolling it into view brings the carousel to it.
 */
export function findOffscreenTourTarget(
  names: readonly string[],
  before = names.length,
): HTMLElement | undefined {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  for (const name of names.slice(0, before)) {
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`),
    )) {
      const box = element.getBoundingClientRect();
      const beside = box.right <= 0 || box.left >= viewport.width;
      const level = box.bottom > 0 && box.top < viewport.height;
      if (box.width > 0 && box.height > 0 && beside && level) return element;
    }
  }
  return undefined;
}

/**
 * Re-revealing a hidden slide at most this often. The home carousel does not autoplay while the
 * tour is open, but it restores its own slide when its screen is shown again, and that restore can
 * land on top of the first scroll toward the highlighted slide; asking again settles it.
 */
const REVEAL_EVERY_MS = 900;
/** How long a fallback waits for a preferred control that is being scrolled into view. */
const REVEAL_PATIENCE_MS = 1_500;

/**
 * Follows the control a step explains. It looks the element up by its `data-tour` name, scrolls it
 * into view once, and re-measures in an animation frame after scrolling, resizing, layout changes
 * and for a short while after the step begins (views switch, lists load, scrolling settles).
 * One measurement per frame at most, so tracking never thrashes layout.
 */
export function createTourTarget(
  names: Accessor<readonly string[]>,
  active: Accessor<boolean>,
): Accessor<TourTarget | undefined> {
  const [target, setTarget] = createSignal<TourTarget | undefined>();
  let frame: number | undefined;
  let settleUntil = 0;
  let scrolled = false;
  let lastReveal = Number.NEGATIVE_INFINITY;
  let stepStartedAt = 0;
  let observed: Element | undefined;
  const observer = new ResizeObserver(() => schedule());

  function measure(): void {
    frame = undefined;
    let found = active() ? findTourTarget(names()) : undefined;
    // A preferred control that is only out of sight (a carousel slide) is brought into view; its
    // fallback is not shown in the meantime, unless it never arrives.
    const hidden = active() ? findOffscreenTourTarget(names(), found?.index) : undefined;
    if (hidden) {
      if (performance.now() - lastReveal > REVEAL_EVERY_MS) {
        lastReveal = performance.now();
        hidden.scrollIntoView({
          block: 'nearest',
          inline: 'center',
          behavior: motionMs(1) === 0 ? 'auto' : 'smooth',
        });
      }
      if (performance.now() - stepStartedAt < REVEAL_PATIENCE_MS) found = undefined;
    }
    if (found) {
      if (observed !== found.element) {
        if (observed) observer.unobserve(observed);
        observer.observe(found.element);
        observed = found.element;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      if (
        !scrolled &&
        needsScroll(found.target.rect, viewport, SCROLL_INSETS) &&
        !found.target.pinned
      ) {
        scrolled = true;
        found.element.scrollIntoView({
          block: 'center',
          behavior: motionMs(1) === 0 ? 'auto' : 'smooth',
        });
      }
    } else if (observed) {
      observer.unobserve(observed);
      observed = undefined;
    }
    const previous = target();
    const next = found?.target;
    const changed =
      (previous === undefined) !== (next === undefined) ||
      (previous !== undefined && next !== undefined && !sameRect(previous.rect, next.rect));
    if (changed) setTarget(next);
    // Keep measuring while the step settles or while the box is still moving.
    if (active() && (performance.now() < settleUntil || changed)) schedule();
  }

  function schedule(): void {
    if (frame === undefined) frame = requestAnimationFrame(measure);
  }

  createEffect(
    on([names, active], () => {
      scrolled = false;
      lastReveal = Number.NEGATIVE_INFINITY;
      stepStartedAt = performance.now();
      settleUntil = stepStartedAt + SETTLE_MS;
      if (active()) schedule();
      else setTarget(undefined);
    }),
  );
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  onCleanup(() => {
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  return target;
}
