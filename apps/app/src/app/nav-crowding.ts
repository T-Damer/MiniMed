/**
 * Whether the bottom bar leaves room beside it for the floating tools (scroll to top, «Добавить»).
 * A phone with five or six tabs has a bar that reaches the right edge; the tools then stand above
 * the bar instead of under it. The answer is the root variable `--nav-crowded` (1 or 0), which the
 * floating tools' `bottom` reads, so no selector depends on where either element sits in the DOM.
 */

/** Width the floating tools need at the right edge: the control, its edge margin and a gap. */
const TOOLS_RESERVE_PX = 44 + 12 + 8;

export function navLeavesRoomForTools(navRight: number, viewportWidth: number): boolean {
  return navRight <= viewportWidth - TOOLS_RESERVE_PX;
}

/** Keeps `--nav-crowded` on the document root in step with the bar's size; returns the cleanup. */
export function watchNavCrowding(nav: HTMLElement): () => void {
  const root = document.documentElement;
  const update = (): void => {
    const crowded = !navLeavesRoomForTools(nav.getBoundingClientRect().right, window.innerWidth);
    root.style.setProperty('--nav-crowded', crowded ? '1' : '0');
  };
  const observer = new ResizeObserver(update);
  observer.observe(nav);
  window.addEventListener('resize', update);
  update();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', update);
    root.style.removeProperty('--nav-crowded');
  };
}
