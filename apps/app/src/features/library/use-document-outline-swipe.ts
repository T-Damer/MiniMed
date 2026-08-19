import { onCleanup } from 'solid-js';

import { createHorizontalGestureManager } from '@/state/horizontal-gesture';

const EDGE_WIDTH_PX = 44;

export interface OutlineSwipeBindings {
  readonly ref: (element: HTMLElement) => void;
}

export function useDocumentOutlineSwipe(options: {
  readonly outlineOpen: () => boolean;
  readonly openOutline: () => void;
  readonly closeOutline: () => void;
}): OutlineSwipeBindings {
  const gesture = createHorizontalGestureManager({
    thresholdPx: 58,
    axisLockPx: 9,
    velocityThresholdPxPerMs: 0.5,
  });
  let fromEdge = false;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    fromEdge = !options.outlineOpen() && event.clientX <= EDGE_WIDTH_PX;
    if (!options.outlineOpen() && !fromEdge) return;
    gesture.start(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const direction = gesture.move(
      event.pointerId,
      event.clientX,
      event.clientY,
      event.timeStamp,
    );
    if (!direction) return;
    if (fromEdge && direction === 'right' && !options.outlineOpen()) {
      options.openOutline();
    } else if (direction === 'left' && options.outlineOpen()) {
      options.closeOutline();
    }
    fromEdge = false;
  };

  const onPointerEnd = (event: PointerEvent): void => {
    gesture.end(event.pointerId);
    fromEdge = false;
  };

  const bind = (node: HTMLElement): void => {
    const previousTouchAction = node.style.touchAction;
    node.style.touchAction = 'pan-y pinch-zoom';
    node.addEventListener('pointerdown', onPointerDown, { passive: true });
    node.addEventListener('pointermove', onPointerMove, { passive: true });
    node.addEventListener('pointerup', onPointerEnd, { passive: true });
    node.addEventListener('pointercancel', onPointerEnd, { passive: true });
    onCleanup(() => {
      node.style.touchAction = previousTouchAction;
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerEnd);
      node.removeEventListener('pointercancel', onPointerEnd);
    });
  };

  return { ref: bind };
}
