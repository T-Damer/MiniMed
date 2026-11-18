import { onCleanup } from 'solid-js';

// Keep the layout stable through the end of a fling or a jump to a heading.
const SCROLL_QUIET_MS = 550;

/** Enrich only nearby chunks, one per idle frame. Scrolling past a chunk cancels queued work. */
export function createReaderViewportWork() {
  const tasks = new Map<Element, () => void>();
  const nearby = new Set<Element>();
  let frame: number | undefined;
  let idle: number | undefined;
  let quietTimer: number | undefined;
  let scrolledAt = -Infinity;
  const hasIdleCallback = typeof window.requestIdleCallback === 'function';
  const rememberScroll = (): void => {
    scrolledAt = performance.now();
  };
  window.addEventListener('scroll', rememberScroll, { capture: true, passive: true });

  const schedule = (): void => {
    if (nearby.size === 0 || frame !== undefined || idle !== undefined || quietTimer !== undefined)
      return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const run = (): void => {
        idle = undefined;
        const wait = SCROLL_QUIET_MS - (performance.now() - scrolledAt);
        if (wait > 0) {
          quietTimer = window.setTimeout(() => {
            quietTimer = undefined;
            schedule();
          }, wait);
          return;
        }
        const element = nearby.values().next().value;
        if (!element) return;
        nearby.delete(element);
        const work = tasks.get(element);
        tasks.delete(element);
        observer?.unobserve(element);
        work?.();
        schedule();
      };
      idle = hasIdleCallback ? window.requestIdleCallback(run) : window.setTimeout(run, 0);
    });
  };
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting && tasks.has(entry.target)) nearby.add(entry.target);
              else nearby.delete(entry.target);
            }
            schedule();
          },
          { rootMargin: '0px 0px 50% 0px' },
        )
      : undefined;

  onCleanup(() => {
    window.removeEventListener('scroll', rememberScroll, true);
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (quietTimer !== undefined) window.clearTimeout(quietTimer);
    if (idle === undefined) return;
    if (hasIdleCallback) window.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
  });

  return (element: Element, work: () => void): (() => void) => {
    tasks.set(element, work);
    if (observer) observer.observe(element);
    else {
      nearby.add(element);
      schedule();
    }
    return () => {
      observer?.unobserve(element);
      tasks.delete(element);
      nearby.delete(element);
    };
  };
}
