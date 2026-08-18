import { onCleanup, onMount } from 'solid-js';

const ROOT_VIEW_ENTER_SELECTOR = '.root-view-enter-forward, .root-view-enter-backward';

export function scrollYForStickyElement(
  node: Element,
  windowScrollY: number,
  root: HTMLElement = document.documentElement,
): number {
  if (!node.closest(ROOT_VIEW_ENTER_SELECTOR)) {
    return windowScrollY;
  }
  const parsed = Number.parseFloat(
    getComputedStyle(root).getPropertyValue('--root-view-enter-to-scroll'),
  );
  return Number.isFinite(parsed) ? parsed : windowScrollY;
}

export function useStickySurface(element: () => HTMLElement | undefined): void {
  onMount(() => {
    let frame: number | undefined;

    const update = (): void => {
      const node = element();
      if (!node) return;
      if (node.getClientRects().length === 0) {
        node.classList.remove('sticky-surface--stuck');
        return;
      }
      const stickyTop = Number.parseFloat(getComputedStyle(node).top);
      const scrollY = scrollYForStickyElement(node, window.scrollY);
      const isStuck =
        scrollY > 1 &&
        Number.isFinite(stickyTop) &&
        node.getBoundingClientRect().top <= stickyTop + 1;
      node.classList.toggle('sticky-surface--stuck', isStuck);
    };
    const schedule = (): void => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        update();
      });
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const rootClassObserver = new MutationObserver(schedule);
    rootClassObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    schedule();
    onCleanup(() => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      rootClassObserver.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
}
