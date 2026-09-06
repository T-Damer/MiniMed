import { type Accessor, createEffect, onCleanup } from 'solid-js';

/** Keep the preview between visible app chrome; scrolling its own text stays local. */
export function useInlinePreviewBounds(
  open: Accessor<boolean>,
  card: Accessor<HTMLElement | undefined>,
  close: () => void,
): void {
  createEffect(() => {
    if (!open()) return;
    let frame = 0;
    let offset = 0;
    const position = (): void => {
      const element = card();
      if (!element) return;
      const viewport = window.visualViewport;
      let top = (viewport?.offsetTop ?? 0) + 8;
      let bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
      for (const chrome of Array.from(
        document.querySelectorAll<HTMLElement>(
          '.app-bottom-nav, .page__header, .route-sticky-chrome, .overlay-dialog-header',
        ),
      )) {
        const rect = chrome.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom <= top || rect.top >= bottom) continue;
        if (chrome.matches('.app-bottom-nav')) bottom = Math.min(bottom, rect.top - 8);
        else if (rect.top < window.innerHeight / 2) top = Math.max(top, rect.bottom + 8);
      }
      element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const rect = element.getBoundingClientRect();
      const naturalTop = rect.top - offset;
      offset = Math.max(top, Math.min(naturalTop, bottom - rect.height)) - naturalTop;
      element.style.translate = `0 ${offset}px`;
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const scroll = (event: Event): void => {
      if (!(event.target instanceof Node) || !card()?.contains(event.target)) close();
    };
    const observer = new ResizeObserver(schedule);
    const element = card();
    if (element) observer.observe(element);
    schedule();
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    });
  });
}
