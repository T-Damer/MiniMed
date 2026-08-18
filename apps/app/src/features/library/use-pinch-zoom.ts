import { onCleanup } from 'solid-js';

const MIN_SCALE = 1;
const MAX_SCALE = 3;

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

export interface PinchZoomSurfaceBindings {
  readonly ref: (element: HTMLElement) => void;
  readonly contentRef: (element: HTMLElement) => void;
}

/** In-place pinch zoom (1–3×) with vertical scroll preserved for single-finger pans. */
export function usePinchZoom(): PinchZoomSurfaceBindings {
  let root: HTMLElement | undefined;
  let content: HTMLElement | undefined;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance: number | null = null;
  let pinchStartScale = 1;
  let pinchStartCenter: { x: number; y: number } | null = null;
  let pinchStartTranslate = { x: 0, y: 0 };

  const applyTransform = (): void => {
    if (!content) return;
    if (scale <= MIN_SCALE + 0.001) {
      scale = MIN_SCALE;
      translateX = 0;
      translateY = 0;
      content.style.transform = '';
      return;
    }
    content.style.transformOrigin = 'center center';
    content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
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
    const nextScale = clampScale(pinchStartScale * (nextDistance / pinchStartDistance));
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
    if (scale <= MIN_SCALE) applyTransform();
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
    element.style.touchAction = 'pan-y';
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    onCleanup(() => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
    });
  };

  const bindContent = (element: HTMLElement): void => {
    content = element;
  };

  return { ref: bindRoot, contentRef: bindContent };
}
