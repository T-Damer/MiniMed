/**
 * Programmatic jumps inside a long reader (a table-of-contents tap, find next / previous).
 *
 * A single `scrollIntoView` computed from the layout at the moment of the call is wrong in a long
 * document: sections far from the viewport are laid out with an estimated height
 * (`content-visibility: auto`), images and late-mounted sections change heights, and a smooth
 * animation chases a target that moves while it runs. The jump therefore scrolls instantly,
 * measures again every frame, corrects the remainder and only finishes once the target has stood
 * still for a few frames. The user's own scrolling cancels it.
 */
import { holdReaderChrome } from '@/state/reader-chrome-hold';

export type ReaderJumpAlign = 'start' | 'center';

export interface ReaderJumpViewport {
  /** Top of the area the reader text may use, in viewport pixels (below the sticky chrome). */
  readonly top: number;
  /** Bottom of that area (above the bottom navigation). */
  readonly bottom: number;
}

export interface ReaderJumpTargetRect {
  readonly top: number;
  readonly height: number;
}

/** A remainder below this many pixels counts as arrived. */
export const READER_JUMP_TOLERANCE_PX = 2;
/** Frames the target must stand still (inside the tolerance) before the jump finishes. */
export const READER_JUMP_STABLE_FRAMES = 4;
/** The longest a jump keeps correcting itself. */
export const READER_JUMP_MAX_MS = 2500;
/** Breathing room kept between a centred target and the edges of the reading area. */
const READER_JUMP_EDGE_PX = 8;

/**
 * Pixels the scroller still has to move so that the target sits where the jump wants it: `start`
 * puts its top edge at `startOffset` (the section's `scroll-margin-top`, i.e. below the sticky
 * headings), `center` puts it in the middle of the reading area, or at the top of the area when the
 * target is taller than the area. Positive means scroll down.
 */
export function readerJumpDelta(
  rect: ReaderJumpTargetRect,
  align: ReaderJumpAlign,
  viewport: ReaderJumpViewport,
  startOffset: number,
): number {
  if (align === 'start') return rect.top - startOffset;
  const areaHeight = viewport.bottom - viewport.top;
  if (rect.height > areaHeight - READER_JUMP_EDGE_PX * 2) {
    return rect.top - (viewport.top + READER_JUMP_EDGE_PX);
  }
  return rect.top + rect.height / 2 - (viewport.top + areaHeight / 2);
}

export function isReaderJumpArrived(delta: number): boolean {
  return Math.abs(delta) <= READER_JUMP_TOLERANCE_PX;
}

function isScrollable(element: HTMLElement): boolean {
  const overflowY = getComputedStyle(element).overflowY;
  return (
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight + 1
  );
}

/** A block with its own scrolling inside the text (a wide table): never the reader's scroller. */
const NESTED_SCROLLER_SELECTOR = '.document-rich-table__scroller';

/** The nearest scrolling ancestor, or `null` when the page itself scrolls. */
export function readerScrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) return null;
    if (parent.matches(NESTED_SCROLLER_SELECTOR)) continue;
    if (isScrollable(parent)) return parent;
  }
  return null;
}

/**
 * A target inside a block that scrolls on its own (a wide table) must also be brought into view
 * inside that block, sideways and, for a table taller than its box, up or down; the page-level
 * vertical jump does neither.
 */
export function revealReaderTargetInScrollers(target: HTMLElement): void {
  const targetRect = target.getBoundingClientRect();
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) return;
    if (parent.matches(NESTED_SCROLLER_SELECTOR) && parent.scrollHeight > parent.clientHeight + 1) {
      const box = parent.getBoundingClientRect();
      // The pinned header row covers the top of the box.
      const pinned = parent.querySelector<HTMLElement>('.document-rich-table__cell--pin-row');
      const top = box.top + (pinned?.offsetHeight ?? 0);
      if (targetRect.top < top) {
        parent.scrollTop -= top - targetRect.top + READER_JUMP_EDGE_PX;
      } else if (targetRect.bottom > box.bottom) {
        parent.scrollTop += targetRect.bottom - box.bottom + READER_JUMP_EDGE_PX;
      }
    }
    const overflowX = getComputedStyle(parent).overflowX;
    if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
    if (parent.scrollWidth <= parent.clientWidth + 1) continue;
    const parentRect = parent.getBoundingClientRect();
    if (targetRect.left < parentRect.left) {
      parent.scrollLeft -= parentRect.left - targetRect.left + READER_JUMP_EDGE_PX;
    } else if (targetRect.right > parentRect.right) {
      parent.scrollLeft += targetRect.right - parentRect.right + READER_JUMP_EDGE_PX;
    }
  }
}

function pixelCustomProperty(element: HTMLElement | null, name: string): number {
  if (!element) return Number.NaN;
  return Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
}

function readerViewport(target: HTMLElement, scroller: HTMLElement | null): ReaderJumpViewport {
  const scrollerRect = scroller?.getBoundingClientRect();
  let top = scrollerRect?.top ?? 0;
  let bottom = scrollerRect?.bottom ?? window.innerHeight;
  // The chrome may be mid-transition when a jump starts, so use its measured height rather than
  // its current position.
  const chromeHeight = pixelCustomProperty(
    target.closest<HTMLElement>('.document-page'),
    '--document-chrome-height',
  );
  if (Number.isFinite(chromeHeight)) top = Math.max(top, chromeHeight);
  const bottomNavigation = document.querySelector<HTMLElement>('.app-bottom-nav');
  if (bottomNavigation && bottomNavigation.offsetHeight > 0 && !scroller) {
    bottom = Math.min(bottom, window.innerHeight - bottomNavigation.offsetHeight);
  }
  return { top, bottom: Math.max(bottom, top + 1) };
}

function startOffsetOf(target: HTMLElement, scroller: HTMLElement | null): number {
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop);
  return (Number.isFinite(margin) ? margin : 0) + (scroller?.getBoundingClientRect().top ?? 0);
}

function scrollPositionOf(scroller: HTMLElement | null): number {
  return scroller ? scroller.scrollTop : window.scrollY;
}

function scrollByInstantly(scroller: HTMLElement | null, delta: number): void {
  // `behavior: 'instant'` also beats the page-wide `scroll-behavior: smooth`.
  if (scroller) scroller.scrollBy({ top: delta, behavior: 'instant' });
  else window.scrollBy({ top: delta, behavior: 'instant' });
}

/**
 * How far the reading line has passed the aligned start of `target`, in pixels: the number a
 * restored position hands back to `jumpReaderTo` as `offset`. Zero when the target sits exactly
 * where a table-of-contents jump would put it; negative while it is still below that place.
 */
export function readerOffsetWithin(target: HTMLElement): number {
  const scroller = readerScrollParent(target);
  return Math.round(startOffsetOf(target, scroller) - target.getBoundingClientRect().top);
}

export interface ReaderJumpOptions {
  readonly align: ReaderJumpAlign;
  /**
   * With `align: 'start'`: land this many pixels past the target's aligned start, i.e. the place a
   * reader had reached inside a section (`readerOffsetWithin`). A function is read every frame, for
   * an offset that depends on the target's own size (a share of it) while that size settles.
   */
  readonly offset?: number | (() => number);
  /** Called once with the target when it first exists in the document. */
  readonly onTarget?: (target: HTMLElement) => void;
  /** Called when the jump ends: the target stood still, could not be reached, or never appeared. */
  readonly onSettled?: (target: HTMLElement | null) => void;
  /** Keep the reader controls visible during the jump (default true). */
  readonly holdChrome?: boolean;
}

const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

let cancelActiveJump: (() => void) | undefined;

/**
 * Brings the element returned by `resolve` to its place and keeps correcting until it stays there.
 * `resolve` is called every frame: the target may only appear once its section has mounted.
 * Returns a function that cancels the jump. A new jump cancels the one before it.
 */
export function jumpReaderTo(
  resolve: () => HTMLElement | null | undefined,
  options: ReaderJumpOptions,
): () => void {
  cancelActiveJump?.();
  if (options.holdChrome !== false) holdReaderChrome(READER_JUMP_MAX_MS);

  const startedAt = performance.now();
  let frame: number | undefined;
  let stableFrames = 0;
  let stalledFrames = 0;
  let announced = false;
  let lastTarget: HTMLElement | null = null;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const name of USER_SCROLL_EVENTS) window.removeEventListener(name, cancel, true);
    if (cancelActiveJump === cancel) cancelActiveJump = undefined;
    options.onSettled?.(lastTarget);
  };
  // The user took over: stop correcting, and do not report a settled jump.
  function cancel(): void {
    if (finished) return;
    finished = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const name of USER_SCROLL_EVENTS) window.removeEventListener(name, cancel, true);
    if (cancelActiveJump === cancel) cancelActiveJump = undefined;
  }

  const step = (): void => {
    frame = undefined;
    if (finished) return;
    const target = resolve() ?? null;
    if (target?.isConnected) {
      lastTarget = target;
      if (!announced) {
        announced = true;
        options.onTarget?.(target);
      }
      revealReaderTargetInScrollers(target);
      const scroller = readerScrollParent(target);
      const offset =
        typeof options.offset === 'function' ? options.offset() : (options.offset ?? 0);
      const delta = readerJumpDelta(
        target.getBoundingClientRect(),
        options.align,
        readerViewport(target, scroller),
        startOffsetOf(target, scroller) - (options.align === 'start' ? offset : 0),
      );
      if (isReaderJumpArrived(delta)) {
        stableFrames += 1;
        stalledFrames = 0;
      } else {
        stableFrames = 0;
        const before = scrollPositionOf(scroller);
        scrollByInstantly(scroller, delta);
        // At the end of the page the remainder cannot be scrolled away: stop trying.
        stalledFrames = scrollPositionOf(scroller) === before ? stalledFrames + 1 : 0;
      }
      if (stableFrames >= READER_JUMP_STABLE_FRAMES || stalledFrames >= READER_JUMP_STABLE_FRAMES) {
        finish();
        return;
      }
    }
    if (performance.now() - startedAt > READER_JUMP_MAX_MS) {
      finish();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  // Listeners are added after the current event, so the tap or key that started the jump does not
  // cancel it.
  frame = requestAnimationFrame(() => {
    if (finished) return;
    for (const name of USER_SCROLL_EVENTS) {
      window.addEventListener(name, cancel, { capture: true, passive: true });
    }
    step();
  });
  cancelActiveJump = cancel;
  return cancel;
}
