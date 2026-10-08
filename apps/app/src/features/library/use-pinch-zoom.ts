import { type Accessor, createSignal, onCleanup } from 'solid-js';

import {
  clampPanZoom,
  clampPinchScale,
  contentPointAt,
  doubleTapScale,
  isDoubleTap,
  type PanZoom,
  PINCH_ZOOM_MIN,
  type PinchPoint,
  pinchScaledScrollSize,
  placeContentPoint,
  scrollDeltaForFocal,
  startPinch,
  stepPinchScale,
  type TapRecord,
  wheelScaleFactor,
} from '@/features/library/pinch-zoom-math';

const TAP_MAX_TRAVEL = 10;
const TAP_MAX_DURATION_MS = 300;
const ZOOM_TRANSITION_MS = 180;

export interface PinchZoomOptions {
  /** Grow the host so overflow:auto can reach every edge of the scaled content. */
  readonly expandScrollPort?: boolean;
  /** Keep the scaled content inside the host's horizontal bounds. */
  readonly lockHorizontalPan?: boolean;
  /**
   * Wheel zoom around the cursor. `'ctrl'`: Ctrl/⌘+wheel and a trackpad pinch (Chromium reports it
   * as Ctrl+wheel); `'always'`: a plain wheel too, for surfaces that have nothing else to scroll.
   * Off by default so the page's own scrolling and browser zoom keep working.
   */
  readonly wheelZoom?: 'ctrl' | 'always';
  /** Double click / double tap zooms to that point, and back out when already zoomed. */
  readonly doubleTapZoom?: boolean;
  /** The mouse (and, without a scrollport, one finger) drags the zoomed content. */
  readonly dragPan?: boolean;
  /**
   * The surface holds something that scrolls sideways by itself (a wide table): a finger may pan
   * both ways, so the browser does not swallow the horizontal swipe. Two-finger pinch still comes
   * through as pointer events.
   */
  readonly horizontalPan?: boolean;
}

/** What an image preview wants: wheel / pinch / double tap around the point, mouse drag to pan. */
export const IMAGE_ZOOM_OPTIONS: PinchZoomOptions = {
  wheelZoom: 'always',
  doubleTapZoom: true,
  dragPan: true,
};

export interface PinchZoomControls {
  readonly ref: (element: HTMLElement) => void;
  readonly contentRef: (element: HTMLElement) => void;
  readonly scale: Accessor<number>;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly reset: (options?: { animated?: boolean }) => void;
}

/** Scrolling is instant: `html { scroll-behavior: smooth }` would otherwise lag behind the zoom. */
interface ScrollHost {
  readonly element: HTMLElement | null;
  /** Visible box in client coordinates. */
  readonly rect: () => { left: number; top: number; right: number; bottom: number };
  readonly scrollBy: (dx: number, dy: number) => void;
}

function findScrollHost(from: HTMLElement | undefined): ScrollHost {
  let node = from?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/u.test(`${style.overflowX} ${style.overflowY}`)) {
      const element = node;
      return {
        element,
        rect: () => element.getBoundingClientRect(),
        scrollBy: (dx, dy) => element.scrollBy({ left: dx, top: dy, behavior: 'instant' }),
      };
    }
    node = node.parentElement;
  }
  return {
    element: null,
    rect: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
    scrollBy: (dx, dy) => window.scrollBy({ left: dx, top: dy, behavior: 'instant' }),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * In-place pinch zoom (1–3×). Every way of zooming — two-finger pinch, wheel / trackpad pinch,
 * double tap, the buttons — keeps the point being looked at under the cursor or the fingers: the
 * surface either scrolls (`expandScrollPort`) or pans by a clamped translation to compensate.
 */
export function usePinchZoom(options: PinchZoomOptions = {}): PinchZoomControls {
  const expandScrollPort = options.expandScrollPort === true;
  const lockHorizontalPan = options.lockHorizontalPan === true;
  const wheelMode = options.wheelZoom;
  const doubleTapZoom = options.doubleTapZoom === true;
  const dragPan = options.dragPan === true;
  const horizontalPan = options.horizontalPan === true;
  let root: HTMLElement | undefined;
  let content: HTMLElement | undefined;
  let scale = PINCH_ZOOM_MIN;
  let translateX = 0;
  let translateY = 0;
  let naturalWidth = 0;
  let naturalHeight = 0;
  const [scaleSignal, setScaleSignal] = createSignal(PINCH_ZOOM_MIN);
  const pointers = new Map<number, PinchPoint>();
  let pinch: ReturnType<typeof startPinch> = null;
  let resetTimer: number | undefined;
  let transitionTimer: number | undefined;
  let pinchFrame: number | undefined;
  let wheelFrame: number | undefined;
  let wheelFactor = 1;
  let wheelPoint: PinchPoint = { x: 0, y: 0 };
  let drag: { readonly pointerId: number; last: PinchPoint } | null = null;
  let tapStart: (PinchPoint & { readonly time: number }) | null = null;
  let lastTap: TapRecord | null = null;
  let gestureHadPinch = false;
  let lastPointerType = '';

  const measureNatural = (): void => {
    if (!content || scale > PINCH_ZOOM_MIN + 0.001) return;
    naturalWidth = Math.max(content.scrollWidth, content.offsetWidth);
    naturalHeight = Math.max(content.scrollHeight, content.offsetHeight);
  };

  const clearScrollPort = (): void => {
    if (!root || !content) return;
    content.style.width = '';
    content.style.minWidth = '';
    content.style.maxWidth = '';
    content.style.height = '';
    content.style.minHeight = '';
    content.style.maxHeight = '';
    content.style.transformOrigin = '';
    root.style.width = '';
    root.style.minWidth = '';
    root.style.height = '';
    root.style.minHeight = '';
  };

  const applyScrollPort = (): void => {
    if (!root || !content) return;
    if (scale <= PINCH_ZOOM_MIN + 0.001) {
      clearScrollPort();
      return;
    }
    const width = pinchScaledScrollSize(naturalWidth, scale);
    const height = pinchScaledScrollSize(naturalHeight, scale);
    content.style.width = `${naturalWidth}px`;
    content.style.minWidth = `${naturalWidth}px`;
    content.style.maxWidth = `${naturalWidth}px`;
    content.style.height = `${naturalHeight}px`;
    content.style.minHeight = `${naturalHeight}px`;
    content.style.maxHeight = `${naturalHeight}px`;
    content.style.transformOrigin = '0 0';
    if (lockHorizontalPan) {
      root.style.width = '';
      root.style.minWidth = '';
    } else {
      root.style.width = `${width}px`;
      root.style.minWidth = `${width}px`;
    }
    root.style.height = `${height}px`;
    root.style.minHeight = `${height}px`;
  };

  const syncAffordances = (): void => {
    if (!root) return;
    const draggable = dragPan && scale > PINCH_ZOOM_MIN + 0.001;
    root.style.cursor = draggable ? 'grab' : '';
  };

  const applyTransform = (): void => {
    if (!content) return;
    if (scale <= PINCH_ZOOM_MIN + 0.001) {
      scale = PINCH_ZOOM_MIN;
      translateX = 0;
      translateY = 0;
      content.style.transform = '';
      content.style.transformOrigin = '';
      if (expandScrollPort) clearScrollPort();
      setScaleSignal(PINCH_ZOOM_MIN);
      syncAffordances();
      return;
    }
    if (expandScrollPort) {
      applyScrollPort();
      content.style.transform = `scale(${scale})`;
    } else {
      content.style.transformOrigin = '0 0';
      content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
    setScaleSignal(scale);
    syncAffordances();
  };

  const surfaceSize = (): { width: number; height: number } => ({
    width: root?.clientWidth ?? 0,
    height: root?.clientHeight ?? 0,
  });

  /** The unscaled content point drawn at `client` (client coordinates). */
  const contentPointUnder = (client: PinchPoint): PinchPoint => {
    const rect = root?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    if (expandScrollPort) return { x: (client.x - left) / scale, y: (client.y - top) / scale };
    return contentPointAt(
      { scale, x: translateX, y: translateY },
      { x: client.x - left, y: client.y - top },
    );
  };

  /** Zoom to `nextScale` with the content point `at` staying under `client`. */
  const placeAt = (at: PinchPoint, nextScale: number, client: PinchPoint): void => {
    if (!root) return;
    const next = clampPinchScale(nextScale);
    if (expandScrollPort) {
      if (scale <= PINCH_ZOOM_MIN + 0.001) measureNatural();
      scale = next;
      applyTransform();
      const rect = root.getBoundingClientRect();
      const delta = scrollDeltaForFocal({ x: rect.left, y: rect.top }, at, client, scale);
      findScrollHost(root).scrollBy(lockHorizontalPan ? 0 : delta.x, delta.y);
      return;
    }
    const rect = root.getBoundingClientRect();
    const state = placeContentPoint(
      at,
      { x: client.x - rect.left, y: client.y - rect.top },
      next,
      surfaceSize(),
    );
    scale = state.scale;
    translateX = state.x;
    translateY = state.y;
    applyTransform();
  };

  /** Centre of the part of the surface that is on screen: where the buttons zoom around. */
  const visibleCentre = (): PinchPoint => {
    const rect = root?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const host = expandScrollPort ? findScrollHost(root).rect() : rect;
    const left = Math.max(rect.left, host.left);
    const top = Math.max(rect.top, host.top);
    const right = Math.min(rect.right, host.right);
    const bottom = Math.min(rect.bottom, host.bottom);
    return right > left && bottom > top
      ? { x: (left + right) / 2, y: (top + bottom) / 2 }
      : { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  };

  const zoomTo = (nextScale: number, client: PinchPoint, animated = false): void => {
    if (animated && content && !expandScrollPort && !prefersReducedMotion()) {
      content.style.transition = `transform ${ZOOM_TRANSITION_MS}ms ease-out`;
      if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
      transitionTimer = window.setTimeout(() => {
        if (content) content.style.transition = '';
        transitionTimer = undefined;
      }, ZOOM_TRANSITION_MS + 20);
    }
    placeAt(contentPointUnder(client), nextScale, client);
  };

  const applyPinch = (): void => {
    pinchFrame = undefined;
    if (pointers.size !== 2 || !pinch) return;
    const [first, second] = [...pointers.values()];
    if (!first || !second) return;
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    placeAt(pinch.content, pinch.scale * (distance / pinch.distance), centre);
  };

  const schedulePinch = (): void => {
    if (pinchFrame !== undefined) return;
    pinchFrame = requestAnimationFrame(applyPinch);
  };

  const beginPinch = (): void => {
    const [first, second] = [...pointers.values()];
    if (!first || !second || !root) return;
    if (expandScrollPort) measureNatural();
    // Same state as `contentPointUnder`, expressed against the surface so `startPinch` can use it.
    const rect = root.getBoundingClientRect();
    const local = (point: PinchPoint): PinchPoint => ({
      x: point.x - rect.left,
      y: point.y - rect.top,
    });
    const state: PanZoom = expandScrollPort
      ? { scale, x: 0, y: 0 }
      : { scale, x: translateX, y: translateY };
    pinch = startPinch(state, local(first), local(second));
    gestureHadPinch = true;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!root) return;
    lastPointerType = event.pointerType;
    const nearestSurface =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-pinch-zoom-surface]')
        : null;
    if (nearestSurface && nearestSurface !== root) return;
    const point = { x: event.clientX, y: event.clientY };
    if (event.pointerType === 'mouse') {
      if (event.button !== 0 || !dragPan || scale <= PINCH_ZOOM_MIN + 0.001) return;
      drag = { pointerId: event.pointerId, last: point };
      root.setPointerCapture(event.pointerId);
      root.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }
    root.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      gestureHadPinch = false;
      tapStart = { ...point, time: event.timeStamp };
      if (dragPan && !expandScrollPort && scale > PINCH_ZOOM_MIN + 0.001) {
        drag = { pointerId: event.pointerId, last: point };
      }
    } else {
      tapStart = null;
      drag = null;
    }
    if (pointers.size === 2) beginPinch();
  };

  const dragBy = (point: PinchPoint): void => {
    if (!drag || !root) return;
    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    drag.last = point;
    if (expandScrollPort) {
      findScrollHost(root).scrollBy(lockHorizontalPan ? 0 : -dx, -dy);
      return;
    }
    const state = clampPanZoom({ scale, x: translateX + dx, y: translateY + dy }, surfaceSize());
    translateX = state.x;
    translateY = state.y;
    applyTransform();
  };

  const onPointerMove = (event: PointerEvent): void => {
    const point = { x: event.clientX, y: event.clientY };
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      dragBy(point);
      if (event.pointerType !== 'mouse') pointers.set(event.pointerId, point);
      return;
    }
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point);
    if (tapStart && Math.hypot(point.x - tapStart.x, point.y - tapStart.y) > TAP_MAX_TRAVEL) {
      tapStart = null;
    }
    if (pointers.size !== 2 || !pinch) return;
    event.preventDefault();
    schedulePinch();
  };

  const finishTap = (event: PointerEvent): void => {
    const start = tapStart;
    tapStart = null;
    if (!doubleTapZoom || !start || gestureHadPinch) return;
    if (event.timeStamp - start.time > TAP_MAX_DURATION_MS) return;
    const tap: TapRecord = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    if (isDoubleTap(lastTap, tap)) {
      lastTap = null;
      zoomTo(doubleTapScale(scale), tap, true);
      return;
    }
    lastTap = tap;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
      syncAffordances();
    }
    if (event.pointerType === 'mouse') {
      try {
        root?.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
      return;
    }
    if (pinchFrame !== undefined) {
      cancelAnimationFrame(pinchFrame);
      applyPinch();
    }
    if (event.type === 'pointerup' && pointers.size === 1) finishTap(event);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (scale <= PINCH_ZOOM_MIN) applyTransform();
    if (pointers.size === 0) {
      tapStart = null;
      try {
        root?.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
    }
  };

  const flushWheel = (): void => {
    wheelFrame = undefined;
    const factor = wheelFactor;
    wheelFactor = 1;
    if (!root || Math.abs(Math.log(factor)) < 1e-4) return;
    if (scale <= PINCH_ZOOM_MIN + 0.001 && factor < 1) return;
    zoomTo(scale * factor, wheelPoint);
  };

  const onWheel = (event: WheelEvent): void => {
    if (!wheelMode || !root) return;
    const pinchGesture = event.ctrlKey || event.metaKey;
    if (wheelMode === 'ctrl' && !pinchGesture) return;
    event.preventDefault();
    wheelFactor *= wheelScaleFactor(event.deltaY, event.deltaMode, pinchGesture);
    wheelPoint = { x: event.clientX, y: event.clientY };
    if (wheelFrame === undefined) wheelFrame = requestAnimationFrame(flushWheel);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    // A double tap on a touch screen is handled from the pointer events.
    if (!doubleTapZoom || !root || lastPointerType !== 'mouse') return;
    const nearestSurface =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-pinch-zoom-surface]')
        : null;
    if (nearestSurface && nearestSurface !== root) return;
    event.preventDefault();
    zoomTo(doubleTapScale(scale), { x: event.clientX, y: event.clientY }, true);
  };

  const bindRoot = (element: HTMLElement): void => {
    root = element;
    element.style.touchAction =
      dragPan && !expandScrollPort
        ? 'none'
        : (expandScrollPort && !lockHorizontalPan) || horizontalPan
          ? 'pan-x pan-y'
          : 'pan-y';
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('dblclick', onDoubleClick);
    onCleanup(() => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('dblclick', onDoubleClick);
      if (pinchFrame !== undefined) cancelAnimationFrame(pinchFrame);
      if (wheelFrame !== undefined) cancelAnimationFrame(wheelFrame);
      if (resetTimer !== undefined) window.clearTimeout(resetTimer);
      if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    });
  };

  const bindContent = (element: HTMLElement): void => {
    content = element;
    if (!expandScrollPort || typeof ResizeObserver !== 'function') {
      measureNatural();
      return;
    }
    const observer = new ResizeObserver(() => {
      measureNatural();
    });
    observer.observe(element);
    measureNatural();
    onCleanup(() => observer.disconnect());
  };

  const zoomIn = (): void => {
    measureNatural();
    zoomTo(stepPinchScale(scale, 1), visibleCentre());
  };

  const zoomOut = (): void => {
    measureNatural();
    zoomTo(stepPinchScale(scale, -1), visibleCentre());
  };

  const reset = (resetOptions?: { animated?: boolean }): void => {
    if (!content || scale <= PINCH_ZOOM_MIN) {
      scale = PINCH_ZOOM_MIN;
      translateX = 0;
      translateY = 0;
      applyTransform();
      return;
    }
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
      resetTimer = undefined;
    }
    if (resetOptions?.animated) {
      content.style.transition = 'transform 200ms ease';
      scale = PINCH_ZOOM_MIN;
      translateX = 0;
      translateY = 0;
      content.style.transform = expandScrollPort
        ? `scale(${PINCH_ZOOM_MIN})`
        : `translate(0px, 0px) scale(${PINCH_ZOOM_MIN})`;
      resetTimer = window.setTimeout(() => {
        if (content) content.style.transition = '';
        resetTimer = undefined;
        applyTransform();
      }, 200);
      setScaleSignal(PINCH_ZOOM_MIN);
      syncAffordances();
      return;
    }
    scale = PINCH_ZOOM_MIN;
    translateX = 0;
    translateY = 0;
    applyTransform();
  };

  return {
    ref: bindRoot,
    contentRef: bindContent,
    scale: scaleSignal,
    zoomIn,
    zoomOut,
    reset,
  };
}
