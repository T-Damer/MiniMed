/**
 * Arriving on a page (owner 2026-10-29): its content blocks grow from a slightly smaller form and
 * fade in, one after another, quickly. Only blocks on screen take part, and chrome stays put: the
 * route header, sticky rows and layered overlays (a header or bar that moved would read as a
 * jump). `Element.animate`, so the motion manager retimes it and «Анимации: выкл.» ends it at once
 * (state/motion.ts); nothing waits for it, taps go through at once.
 *
 * Leaving a page is the same blocks, shrinking and fading at once (`animatePageLeave`).
 */
import { motionMs } from '@/state/motion';

// 0.2 s: the owner found 160 ms too abrupt (2026-10-31).
const DURATION_MS = 200;
const STAGGER_MS = 25;
const MAX_BLOCKS = 8;
const KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'scale(0.94)' },
  { opacity: 1, transform: 'none' },
];

/** The element that holds a page's blocks: single-child wrappers are looked through. */
function contentRoot(view: Element): Element {
  let root = view;
  for (let depth = 0; depth < 3 && root.children.length === 1; depth += 1) {
    const only = root.firstElementChild;
    if (!only) break;
    root = only;
  }
  return root;
}

function takesPart(element: HTMLElement): boolean {
  if (element.matches('header.page')) return false;
  const position = getComputedStyle(element).position;
  if (position === 'sticky' || position === 'fixed' || position === 'absolute') return false;
  const box = element.getBoundingClientRect();
  return box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
}

function partsOf(root: Element): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && takesPart(child),
  );
}

/** The blocks of the page on screen that take part in an entry or an exit. */
function pageBlocks(view: Element): HTMLElement[] {
  let blocks = partsOf(contentRoot(view));
  // One block holding the whole page (a workspace wrapper) would zoom as a whole: its sections
  // grow in instead.
  for (let depth = 0; depth < 4 && blocks.length === 1; depth += 1) {
    const inner = partsOf(blocks[0] as HTMLElement);
    if (inner.length === 0) break;
    blocks = inner;
  }
  return blocks.slice(0, MAX_BLOCKS);
}

let enterClaimed = false;

/**
 * A navigation that starts the entry itself, in the same task as the mount (route-motion.ts), says
 * so before it changes the address; the address listener then leaves the entry to it. An entry
 * started a frame after the mount would show the whole page for that frame first.
 */
export function claimPageEnter(): void {
  enterClaimed = true;
}

/** Whether a navigation has claimed its entry; reading it clears the claim. */
export function consumePageEnterClaim(): boolean {
  const claimed = enterClaimed;
  enterClaimed = false;
  return claimed;
}

const LEAVE_MS = 130;
/** The exit is undone if the page is still there this long after it began (the route did not change). */
const LEAVE_GIVE_UP_MS = 700;

/**
 * Starts the exit of the page on screen: its blocks shrink a little and fade, at once, on the
 * compositor, so a tap is answered in the next frame while the next page is still being mounted
 * (mounting it blocks the main thread for a hundred milliseconds). Blocks that are removed when the
 * route changes take their animation with them; if nothing changes the exit is cancelled and the
 * page is as it was. Returns whether an exit started.
 */
export function animatePageLeave(view: Element | null): boolean {
  if (!view || typeof Element.prototype.animate !== 'function') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const blocks = pageBlocks(view);
  if (blocks.length === 0) return false;
  const animations = blocks.map((block) =>
    block.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.97)' },
      ],
      { duration: LEAVE_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    ),
  );
  window.setTimeout(
    () => {
      for (const animation of animations) animation.cancel();
    },
    Math.max(LEAVE_GIVE_UP_MS, motionMs(LEAVE_GIVE_UP_MS)),
  );
  return true;
}

/** Starts the entry on the view's blocks; false when none has laid out yet (a lazy page). */
export function animatePageEnter(view: Element | null): boolean {
  if (!view || typeof Element.prototype.animate !== 'function') return true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  const blocks = pageBlocks(view);
  if (blocks.length === 0) return false;
  blocks.forEach((block, index) => {
    block.animate(KEYFRAMES, {
      duration: DURATION_MS,
      delay: index * STAGGER_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'backwards',
    });
  });
  return true;
}
