import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import {
  computeScrollIndicatorThumb,
  SCROLL_INDICATOR_RESIZE_MS,
  type ScrollIndicatorGeometry,
} from '@/components/scroll-indicator-layout';

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
  /**
   * The track follows the target's box on screen (`position: fixed`), for a scroll area that is
   * itself the panel (a popover) and has no positioned box around it to hold the thumb.
   */
  readonly fixed?: boolean;
  readonly class?: string;
}): JSX.Element {
  const [shown, setShown] = createSignal(false);
  const [overlay, setOverlay] = createSignal(false);
  const [moreBelow, setMoreBelow] = createSignal(false);
  let track: HTMLDivElement | undefined;
  let thumb: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let resizeTimer: number | undefined;
  let geometry: ScrollIndicatorGeometry | undefined;
  let geometryDirty = true;
  let initialized = false;
  let lastShown = false;
  let lastTrackTop = Number.NaN;
  let lastTrackLeft = Number.NaN;
  let lastTrackHeight = Number.NaN;
  let lastThumbSize = Number.NaN;
  let lastThumbTop = Number.NaN;

  const scroller = (): HTMLElement | undefined =>
    props.target
      ? props.target()
      : ((document.scrollingElement as HTMLElement | null) ?? undefined);

  const measureGeometry = (element: HTMLElement): ScrollIndicatorGeometry => {
    const visible = props.target ? element.clientHeight : window.innerHeight;
    const total = element.scrollHeight;
    if (total - visible <= 1) return { visible, total, room: 0 };
    if (props.target && props.fixed) {
      const box = element.getBoundingClientRect();
      const trackHeight = Math.max(0, box.height - 12);
      return {
        visible,
        total,
        room: trackHeight,
        trackTop: box.top + 6,
        trackLeft: box.right - 7,
        trackHeight,
      };
    }
    if (props.target) {
      return {
        visible,
        total,
        room: visible,
        trackTop: element.offsetTop,
        trackHeight: visible,
      };
    }
    return { visible, total, room: track?.clientHeight ?? 0 };
  };

  const isHiddenInInactiveView = (): boolean => {
    const view = track?.closest('.app-view');
    return Boolean(view && !view.classList.contains('active'));
  };

  const applyDraw = (): void => {
    if (isHiddenInInactiveView()) return;
    const element = scroller();
    if (!element) return;
    // Read phase first: never read layout after mutating styles or classes.
    const scrollTop = element.scrollTop;
    const scrolledPastKnown =
      geometry !== undefined &&
      geometry.total > geometry.visible &&
      scrollTop + geometry.visible > geometry.total + 1;
    if (geometryDirty || !geometry || scrolledPastKnown) {
      geometry = measureGeometry(element);
      geometryDirty = false;
    }
    const next = computeScrollIndicatorThumb(geometry, scrollTop);
    setMoreBelow(geometry.total - geometry.visible - scrollTop > 2);

    // Write phase: mutate only changed properties so steady scrolling touches only `transform`.
    if (next.shown !== lastShown) {
      lastShown = next.shown;
      setShown(next.shown);
    }
    if (!next.shown || !track || !thumb) return;
    if (geometry.trackTop !== undefined && geometry.trackTop !== lastTrackTop) {
      lastTrackTop = geometry.trackTop;
      track.style.top = `${geometry.trackTop}px`;
    }
    if (geometry.trackLeft !== undefined && geometry.trackLeft !== lastTrackLeft) {
      lastTrackLeft = geometry.trackLeft;
      track.style.left = `${geometry.trackLeft}px`;
    }
    if (geometry.trackHeight !== undefined && geometry.trackHeight !== lastTrackHeight) {
      lastTrackHeight = geometry.trackHeight;
      track.style.height = `${geometry.trackHeight}px`;
    }
    if (Number.isNaN(lastThumbSize) || Math.abs(next.size - lastThumbSize) > 0.25) {
      lastThumbSize = next.size;
      thumb.style.height = `${next.size}px`;
    }
    if (Number.isNaN(lastThumbTop) || Math.abs(next.top - lastThumbTop) > 0.25) {
      lastThumbTop = next.top;
      thumb.style.transform = `translateY(${next.top}px)`;
    }
  };

  const scheduleScroll = (): void => {
    if (isHiddenInInactiveView()) return;
    if (!scrollFrame) {
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        applyDraw();
      });
    }
  };

  onMount(() => {
    const nativeOverlay = hasOverlayScrollbars();
    setOverlay(nativeOverlay);
    const element = scroller();
    if (!element) return;
    const source: HTMLElement | Window = props.target ? element : window;
    // One scrollbar: the native overlay bar hides while this thumb stands in for it.
    const host = props.target ? element : document.documentElement;
    if (nativeOverlay) host.classList.add('scroll-indicator-host');
    let observedContent: Element | null = props.target ? element.firstElementChild : null;

    const flushGeometry = (): void => {
      resizeTimer = undefined;
      initialized = true;
      if (props.target) {
        const nextContent = element.firstElementChild;
        if (nextContent !== observedContent) {
          if (observedContent) observer.unobserve(observedContent);
          observedContent = nextContent;
          if (observedContent) observer.observe(observedContent);
        }
      }
      applyDraw();
    };
    const scheduleGeometry = (delayMs: number): void => {
      geometryDirty = true;
      if (resizeTimer !== undefined) return;
      resizeTimer = window.setTimeout(flushGeometry, delayMs);
    };
    const onWindowResize = (): void => {
      scheduleGeometry(0);
    };

    source.addEventListener('scroll', scheduleScroll, { passive: true });
    window.addEventListener('resize', onWindowResize);
    const observer = new ResizeObserver(() => {
      scheduleGeometry(initialized ? SCROLL_INDICATOR_RESIZE_MS : 0);
    });
    observer.observe(props.target ? element : document.body);
    // Content that grows inside a fixed-height area changes only the scroll height.
    if (observedContent) observer.observe(observedContent);
    scheduleGeometry(0);
    onCleanup(() => {
      source.removeEventListener('scroll', scheduleScroll);
      window.removeEventListener('resize', onWindowResize);
      observer.disconnect();
      if (nativeOverlay) host.classList.remove('scroll-indicator-host');
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    });
  });

  return (
    <div
      ref={track}
      class={`scroll-indicator ${props.fixed ? 'scroll-indicator--fixed' : props.target ? 'scroll-indicator--inner' : 'scroll-indicator--page'} ${props.class ?? ''}`}
      classList={{ 'scroll-indicator--shown': shown(), 'scroll-indicator--native': !overlay() }}
      aria-hidden="true"
    >
      <div
        ref={thumb}
        class="scroll-indicator__thumb"
        classList={{ 'scroll-indicator__thumb--native': !overlay() }}
      />
      <span
        class="scroll-indicator__cue"
        classList={{ 'scroll-indicator__cue--shown': moreBelow() }}
      />
    </div>
  );
}
