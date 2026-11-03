import { motionRate } from '@/state/motion';

/**
 * A sheet whose content changes height (a skeleton giving way to the content, a section opening)
 * grows or shrinks to its new height instead of jumping: the sheet's height is animated from where
 * it is on screen to where the content puts it. It rides the same curve as the sheet's rise, and
 * `Element.animate` is retimed by the AnimationManager (state/motion.ts), so «Анимации: выкл.»
 * ends it at once.
 */
const HEIGHT_MS = 220;
const HEIGHT_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Less than this (px) is rounding, not a change of content. */
const MIN_CHANGE_PX = 2;
/** While the height moves the body may not show a scrollbar for content that is clipped. */
export const SHEET_RESIZING_CLASS = 'overlay-dialog-body--resizing';

/** The keyframes of a height change, or nothing when it is too small to show. */
export function sheetHeightFrames(visiblePx: number, naturalPx: number): Keyframe[] | undefined {
  if (Math.abs(naturalPx - visiblePx) < MIN_CHANGE_PX) return undefined;
  return [{ height: `${visiblePx}px` }, { height: `${naturalPx}px` }];
}

/**
 * Follows the height of the sheet's content. `canAnimate` says whether a change may be animated
 * right now (not while the sheet is pulled or leaving); a change that may not is applied at once.
 * Returns the function that stops following.
 */
export function followSheetHeight(
  panel: HTMLElement,
  body: HTMLElement,
  canAnimate: () => boolean,
): () => void {
  if (typeof ResizeObserver === 'undefined' || typeof panel.animate !== 'function') {
    return () => undefined;
  }
  const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  /** The height the content gave the sheet last time, where the next change starts from. */
  let settled = panel.offsetHeight;
  let running: Animation | undefined;

  const stop = (): void => {
    running?.cancel();
    running = undefined;
    body.classList.remove(SHEET_RESIZING_CLASS);
  };

  const follow = (): void => {
    // Mid-way through an earlier change the sheet is where its animation has taken it.
    const visible = running ? panel.offsetHeight : settled;
    stop();
    const natural = panel.offsetHeight;
    settled = natural;
    if (!canAnimate() || motionRate() === 0 || quiet?.matches) return;
    const frames = sheetHeightFrames(visible, natural);
    if (!frames) return;
    body.classList.add(SHEET_RESIZING_CLASS);
    const animation = panel.animate(frames, { duration: HEIGHT_MS, easing: HEIGHT_EASING });
    running = animation;
    const done = (): void => {
      if (running !== animation) return;
      running = undefined;
      body.classList.remove(SHEET_RESIZING_CLASS);
    };
    animation.finished.then(done, done);
  };

  // The content's children, not the sheet: the sheet's own height is what is being animated.
  const observer = new ResizeObserver(follow);
  const observeChildren = (): void => {
    observer.disconnect();
    for (const child of Array.from(body.children)) observer.observe(child);
  };
  observeChildren();
  const mutations = new MutationObserver(observeChildren);
  mutations.observe(body, { childList: true });

  return () => {
    observer.disconnect();
    mutations.disconnect();
    stop();
  };
}
