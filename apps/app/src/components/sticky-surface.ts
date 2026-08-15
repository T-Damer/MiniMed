import { onCleanup, onMount } from 'solid-js';

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
      const isStuck =
        window.scrollY > 1 &&
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
    schedule();
    onCleanup(() => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
}
