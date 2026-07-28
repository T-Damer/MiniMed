import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import type { JSX } from 'solid-js';

import { translateVerticalWheelToHorizontal } from '@/features/search/horizontal-wheel-scroll';

interface HorizontalScrollerProps {
  readonly class: string;
  readonly children: JSX.Element;
}

export function HorizontalScroller(props: HorizontalScrollerProps): JSX.Element {
  let scroller: OverlayScrollbarsComponentRef | undefined;

  return (
    <OverlayScrollbarsComponent
      ref={(value) => {
        scroller = value;
      }}
      class={`horizontal-overlay-scroll os-theme-dark ${props.class}`}
      options={{
        overflow: { x: 'scroll', y: 'hidden' },
        scrollbars: { autoHide: 'never' },
      }}
      defer
      onWheel={(event) => {
        const viewport = scroller?.osInstance()?.elements().viewport;
        if (viewport) translateVerticalWheelToHorizontal(event, viewport);
      }}
    >
      {props.children}
    </OverlayScrollbarsComponent>
  );
}
