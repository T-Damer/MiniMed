import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { translateVerticalWheelToHorizontal } from '@/features/search/horizontal-wheel-scroll';

interface HorizontalScrollerProps {
  readonly class: string;
  readonly children: JSX.Element;
  readonly controls?: boolean;
  readonly hideScrollbar?: boolean;
  readonly controlLabel?: string;
}

export function HorizontalScroller(props: HorizontalScrollerProps): JSX.Element {
  let scroller: OverlayScrollbarsComponentRef | undefined;
  const [canScrollPrevious, setCanScrollPrevious] = createSignal(false);
  const [canScrollNext, setCanScrollNext] = createSignal(false);
  const updateControls = (instance = scroller?.osInstance()): void => {
    const viewport = instance?.elements().viewport;
    if (!viewport) return;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setCanScrollPrevious(viewport.scrollLeft > 2);
    setCanScrollNext(viewport.scrollLeft < maximum - 2);
  };
  const scroll = (direction: -1 | 1): void => {
    const viewport = scroller?.osInstance()?.elements().viewport;
    viewport?.scrollBy({
      left: direction * Math.max(160, viewport.clientWidth * 0.72),
      behavior: 'smooth',
    });
  };

  return (
    <div
      class={`horizontal-scroll-frame ${props.class}`}
      classList={{
        'has-controls': props.controls === true,
        'hide-scrollbar': props.hideScrollbar === true,
      }}
    >
      <Show when={props.controls && canScrollPrevious()}>
        <button
          class="horizontal-scroll-control previous"
          type="button"
          aria-label={`Прокрутить ${props.controlLabel ?? 'список'} влево`}
          onClick={() => scroll(-1)}
        >
          <AppGlyph name="arrow-left" />
        </button>
      </Show>
      <OverlayScrollbarsComponent
        ref={(value) => {
          scroller = value;
        }}
        class="horizontal-overlay-scroll os-theme-dark"
        options={{
          overflow: { x: 'scroll', y: 'hidden' },
          scrollbars: { autoHide: props.hideScrollbar ? 'scroll' : 'never' },
        }}
        events={{
          initialized: updateControls,
          updated: updateControls,
          scroll: updateControls,
        }}
        defer
        onWheel={(event) => {
          const viewport = scroller?.osInstance()?.elements().viewport;
          if (viewport) translateVerticalWheelToHorizontal(event, viewport);
        }}
      >
        {props.children}
      </OverlayScrollbarsComponent>
      <Show when={props.controls && canScrollNext()}>
        <button
          class="horizontal-scroll-control next"
          type="button"
          aria-label={`Прокрутить ${props.controlLabel ?? 'список'} вправо`}
          onClick={() => scroll(1)}
        >
          <AppGlyph name="arrow-left" />
        </button>
      </Show>
    </div>
  );
}
