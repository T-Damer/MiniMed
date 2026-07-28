interface HorizontalScroller {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  scrollLeft: number;
}

type WheelDelta = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'preventDefault'>;

export function translateVerticalWheelToHorizontal(
  event: WheelDelta,
  scroller: HorizontalScroller,
): void {
  if (
    Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
    scroller.scrollWidth <= scroller.clientWidth
  ) {
    return;
  }
  const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
  if (
    (event.deltaY < 0 && scroller.scrollLeft <= 0) ||
    (event.deltaY > 0 && scroller.scrollLeft >= maxScrollLeft)
  ) {
    return;
  }
  event.preventDefault();
  scroller.scrollLeft += event.deltaY;
}
