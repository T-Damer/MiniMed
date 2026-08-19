import { type Accessor, createSignal, onCleanup } from 'solid-js';

import {
  clampPinchScale,
  PINCH_ZOOM_MIN,
  pinchScaledScrollSize,
  stepPinchScale,
} from '@/features/library/pinch-zoom-math';

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface PinchZoomOptions {
  /** Grow the host so overflow:auto can reach every edge of the scaled content. */
  readonly expandScrollPort?: boolean;
}

export interface PinchZoomControls {
  readonly ref: (element: HTMLElement) => void;
  readonly contentRef: (element: HTMLElement) => void;
  readonly scale: Accessor<number>;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly reset: (options?: { animated?: boolean }) => void;
}

/** In-place pinch zoom (1–3×) with vertical scroll preserved for single-finger pans. */
export function usePinchZoom(options: PinchZoomOptions = {}): PinchZoomControls {
  const expandScrollPort = options.expandScrollPort === true;
  let root: HTMLElement | undefined;
  let content: HTMLElement | undefined;
  let scale = PINCH_ZOOM_MIN;
  let translateX = 0;
  let translateY = 0;
  let naturalWidth = 0;
  let naturalHeight = 0;
  const [scaleSignal, setScaleSignal] = createSignal(PINCH_ZOOM_MIN);
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance: number | null = null;
  let pinchStartScale = PINCH_ZOOM_MIN;
  let pinchStartCenter: { x: number; y: number } | null = null;
  let pinchStartTranslate = { x: 0, y: 0 };
  let resetTimer: number | undefined;

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
    root.style.width = `${width}px`;
    root.style.minWidth = `${width}px`;
    root.style.height = `${height}px`;
    root.style.minHeight = `${height}px`;
  };

  const applyTransform = (): void => {
    if (!content) return;
    if (scale <= PINCH_ZOOM_MIN + 0.001) {
      scale = PINCH_ZOOM_MIN;
      translateX = 0;
      translateY = 0;
      content.style.transform = '';
      if (expandScrollPort) clearScrollPort();
      setScaleSignal(PINCH_ZOOM_MIN);
      return;
    }
    if (expandScrollPort) {
      applyScrollPort();
      content.style.transform = `scale(${scale})`;
    } else {
      content.style.transformOrigin = 'center center';
      content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
    setScaleSignal(scale);
  };

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = root?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!root || event.pointerType === 'mouse') return;
    root.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, localPoint(event.clientX, event.clientY));
    if (pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      pinchStartDistance = distance(first, second);
      pinchStartScale = scale;
      pinchStartCenter = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      pinchStartTranslate = { x: translateX, y: translateY };
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, localPoint(event.clientX, event.clientY));
    if (pointers.size !== 2 || pinchStartDistance === null || !pinchStartCenter) return;
    event.preventDefault();
    const [first, second] = [...pointers.values()];
    if (!first || !second) return;
    const nextDistance = distance(first, second);
    if (pinchStartDistance <= 0) return;
    const nextScale = clampPinchScale(pinchStartScale * (nextDistance / pinchStartDistance));
    if (expandScrollPort) {
      if (scale <= PINCH_ZOOM_MIN + 0.001) measureNatural();
      scale = nextScale;
      applyTransform();
      return;
    }
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const scaleRatio = nextScale / pinchStartScale;
    translateX = pinchStartTranslate.x + (center.x - pinchStartCenter.x) * (scaleRatio - 1);
    translateY = pinchStartTranslate.y + (center.y - pinchStartCenter.y) * (scaleRatio - 1);
    scale = nextScale;
    applyTransform();
  };

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchStartDistance = null;
      pinchStartCenter = null;
    }
    if (scale <= PINCH_ZOOM_MIN) applyTransform();
    if (pointers.size === 0) {
      try {
        root?.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
    }
  };

  const bindRoot = (element: HTMLElement): void => {
    root = element;
    element.style.touchAction = expandScrollPort ? 'pan-x pan-y' : 'pan-y';
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    onCleanup(() => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      if (resetTimer !== undefined) window.clearTimeout(resetTimer);
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
    scale = stepPinchScale(scale, 1);
    applyTransform();
  };

  const zoomOut = (): void => {
    measureNatural();
    scale = stepPinchScale(scale, -1);
    applyTransform();
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
