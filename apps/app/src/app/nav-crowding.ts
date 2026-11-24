/**
 * Whether the bottom bar leaves room beside it for the floating tools (scroll to top, «Добавить»).
 * A phone with five or six tabs has a bar that reaches the right edge; the tools then stand above
 * the bar instead of under it. The answer is the root variable `--nav-crowded` (1 or 0), which the
 * floating tools' `bottom` reads, so no selector depends on where either element sits in the DOM.
 */

/** Width the floating tools need at each edge: the control (up to 48 px), its edge margin and a gap. */
const TOOLS_RESERVE_PX = 48 + 12 + 8;

export function navLeavesRoomForTools(
  navRight: number,
  viewportWidth: number,
  navLeft?: number,
  safeLeft = 0,
  safeRight = 0,
): boolean {
  const rightClear = navRight <= viewportWidth - (TOOLS_RESERVE_PX + safeRight);
  const leftClear = navLeft === undefined ? true : navLeft >= TOOLS_RESERVE_PX + safeLeft;
  return rightClear && leftClear;
}

function readSafeInsetPx(name: '--safe-left' | '--safe-right'): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Keeps `--nav-crowded` on the document root in step with the bar's size; returns the cleanup. */
export function watchNavCrowding(nav: HTMLElement): () => void {
  const root = document.documentElement;
  const update = (): void => {
    const rect = nav.getBoundingClientRect();
    const crowded = !navLeavesRoomForTools(
      rect.right,
      window.innerWidth,
      rect.left,
      readSafeInsetPx('--safe-left'),
      readSafeInsetPx('--safe-right'),
    );
    root.style.setProperty('--nav-crowded', crowded ? '1' : '0');
    // The same answer for selectors that switch a layout (the update button beside or above the bar).
    root.dataset['navCrowded'] = crowded ? '1' : '0';
  };
  const observer = new ResizeObserver(update);
  observer.observe(nav);
  window.addEventListener('resize', update);
  update();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', update);
    root.style.removeProperty('--nav-crowded');
    delete root.dataset['navCrowded'];
  };
}
