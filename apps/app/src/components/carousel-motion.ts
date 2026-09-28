/** The slide one step away, wrapping at both ends so autoplay and arrows never dead-end. */
export function carouselStep(index: number, count: number, direction: -1 | 1): number {
  if (count <= 0) return 0;
  return (((index + direction) % count) + count) % count;
}

/** The slide whose start is nearest the track's scroll position. */
export function carouselIndexAt(scrollLeft: number, slideWidth: number, count: number): number {
  if (count <= 0 || slideWidth <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / slideWidth)));
}

export interface CarouselAutoplayState {
  readonly reducedMotion: boolean;
  /** The user swiped, pressed an arrow or otherwise took over: autoplay stays off. */
  readonly takenOver: boolean;
  /** Pointer over the carousel or focus inside it: autoplay waits. */
  readonly held: boolean;
  readonly pageHidden: boolean;
}

/** Whether an autoplay tick may advance the carousel now. */
export function carouselAutoplayMayAdvance(state: CarouselAutoplayState): boolean {
  return !state.reducedMotion && !state.takenOver && !state.held && !state.pageHidden;
}
