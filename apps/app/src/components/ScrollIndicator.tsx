import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import './ScrollIndicator.css';

let overlayScrollbars: boolean | undefined;

/**
 * Whether this browser draws overlay scrollbars that fade out when idle (phones, macOS): a native
 * scrollbar that takes no room. Classic scrollbars stay on screen and need no indicator.
 */
export function hasOverlayScrollbars(): boolean {
  if (overlayScrollbars !== undefined) return overlayScrollbars;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  overlayScrollbars = probe.offsetWidth - probe.clientWidth === 0;
  probe.remove();
  return overlayScrollbars;
}

/**
 * A thin thumb that always shows where a scroll area is and how much of it is on screen (owner
 * 2026-10-30: «scroll should always be visible»). Shown only where the native scrollbar is an
 * overlay that hides, and only while the area overflows; it never takes pointer input. Without
 * `target` it follows the page; with one, it overlays that element (the caller's box is
 * `position: relative`).
 */
export function ScrollIndicator(props: {
  readonly target?: () => HTMLElement | undefined;
  readonly class?: string;
}): JSX.Element {
  const [shown, setShown] = createSignal(false);
  let track: HTMLDivElement | undefined;
  let thumb: HTMLDivElement | undefined;
  let frame = 0;

  const scroller = (): HTMLElement | undefined =>
    props.target
      ? props.target()
      : ((document.scrollingElement as HTMLElement | null) ?? undefined);

  const draw = (): void => {
    frame = 0;
    const element = scroller();
    if (!element) return;
    const visible = props.target ? element.clientHeight : window.innerHeight;
    const total = element.scrollHeight;
    const overflow = total - visible > 1;
    setShown(overflow);
    if (!overflow || !track || !thumb) return;
    if (props.target) {
      track.style.top = `${element.offsetTop}px`;
      track.style.height = `${element.clientHeight}px`;
    }
    const room = track.clientHeight;
    const size = Math.max(24, (room * visible) / total);
    const top = ((room - size) * element.scrollTop) / (total - visible);
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${top}px)`;
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  onMount(() => {
    if (!hasOverlayScrollbars()) return;
    const element = scroller();
    if (!element) return;
    const source: HTMLElement | Window = props.target ? element : window;
    source.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(props.target ? element : document.body);
    // Content that grows inside a fixed-height area changes only the scroll height.
    const content = props.target ? element.firstElementChild : undefined;
    if (content) observer.observe(content);
    schedule();
    onCleanup(() => {
      source.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    });
  });

  return (
    <div
      ref={track}
      class={`scroll-indicator ${props.target ? 'scroll-indicator--inner' : 'scroll-indicator--page'} ${props.class ?? ''}`}
      classList={{ 'scroll-indicator--shown': shown() }}
      aria-hidden="true"
    >
      <div ref={thumb} class="scroll-indicator__thumb" />
    </div>
  );
}
