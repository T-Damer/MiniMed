/**
 * Arriving on a page (owner 2026-10-29): its content blocks grow from a slightly smaller form and
 * fade in, one after another, quickly. Only blocks on screen take part, and chrome stays put: the
 * route header, sticky rows and layered overlays (a header or bar that moved would read as a
 * jump). `Element.animate`, so the motion manager retimes it and «Анимации: выкл.» ends it at once
 * (state/motion.ts); nothing waits for it, taps go through at once.
 */

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

/** Starts the entry on the view's blocks; false when none has laid out yet (a lazy page). */
export function animatePageEnter(view: Element | null): boolean {
  if (!view || typeof Element.prototype.animate !== 'function') return true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  let blocks = partsOf(contentRoot(view));
  // One block holding the whole page (a workspace wrapper) would zoom as a whole: its sections
  // grow in instead.
  for (let depth = 0; depth < 4 && blocks.length === 1; depth += 1) {
    const inner = partsOf(blocks[0] as HTMLElement);
    if (inner.length === 0) break;
    blocks = inner;
  }
  if (blocks.length === 0) return false;
  blocks = blocks.slice(0, MAX_BLOCKS);
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
