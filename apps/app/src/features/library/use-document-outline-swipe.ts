import { onCleanup } from 'solid-js';

const EDGE_WIDTH_PX = 24;
const SWIPE_THRESHOLD_PX = 56;

export interface OutlineSwipeBindings {
  readonly ref: (element: HTMLElement) => void;
}

export function useDocumentOutlineSwipe(options: {
  readonly outlineOpen: () => boolean;
  readonly openOutline: () => void;
  readonly closeOutline: () => void;
}): OutlineSwipeBindings {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let fromEdge = false;

  const onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
    fromEdge = !options.outlineOpen() && startX <= EDGE_WIDTH_PX;
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (!tracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
      tracking = false;
      return;
    }
    if (fromEdge && deltaX > SWIPE_THRESHOLD_PX) {
      options.openOutline();
      tracking = false;
      return;
    }
    if (options.outlineOpen() && deltaX < -SWIPE_THRESHOLD_PX) {
      options.closeOutline();
      tracking = false;
    }
  };

  const onTouchEnd = (): void => {
    tracking = false;
    fromEdge = false;
  };

  const bind = (node: HTMLElement): void => {
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchEnd, { passive: true });
    onCleanup(() => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
    });
  };

  return { ref: bind };
}
