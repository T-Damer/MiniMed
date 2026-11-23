export interface ScrollIndicatorGeometry {
  readonly visible: number;
  readonly total: number;
  readonly room: number;
  readonly trackTop?: number;
  readonly trackLeft?: number;
  readonly trackHeight?: number;
}

export interface ScrollIndicatorThumb {
  readonly shown: boolean;
  readonly size: number;
  readonly top: number;
}

/** Coalesce rapid ResizeObserver bursts (e.g. sliced long-document mounts) into post-layout checks. */
export const SCROLL_INDICATOR_RESIZE_MS = 120;

export function computeScrollIndicatorThumb(
  geometry: ScrollIndicatorGeometry,
  scrollTop: number,
): ScrollIndicatorThumb {
  const maxScroll = geometry.total - geometry.visible;
  if (maxScroll <= 1 || geometry.room <= 0) return { shown: false, size: 0, top: 0 };
  const size = Math.max(24, (geometry.room * geometry.visible) / geometry.total);
  const clampedScroll = Math.min(Math.max(0, scrollTop), maxScroll);
  const top = ((geometry.room - size) * clampedScroll) / maxScroll;
  return { shown: true, size, top };
}
