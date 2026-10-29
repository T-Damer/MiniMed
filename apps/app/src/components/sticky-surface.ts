import { onCleanup, onMount } from 'solid-js';

export function useStickySurface(element: () => HTMLElement | undefined): void {
  onMount(() => {
    let frame: number | undefined;
    let viewObserver: MutationObserver | undefined;

    const update = (): void => {
      const node = element();
      if (!node) return;
      if (!viewObserver) {
        const view = node.closest('.app-view');
        if (view) {
          viewObserver = new MutationObserver(schedule);
          viewObserver.observe(view, {
            attributes: true,
            attributeFilter: ['class', 'hidden'],
          });
        }
      }
      if (node.getClientRects().length === 0) {
        node.classList.remove('sticky-surface--stuck');
        return;
      }
      const stickyTop = Number.parseFloat(getComputedStyle(node).top);
      const scrollY = window.scrollY;
      const isStuck =
        Number.isFinite(stickyTop) &&
        scrollY > 1 &&
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
    window.visualViewport?.addEventListener('resize', schedule);
    const rootClassObserver = new MutationObserver(schedule);
    rootClassObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    schedule();
    onCleanup(() => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      rootClassObserver.disconnect();
      viewObserver?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
}
