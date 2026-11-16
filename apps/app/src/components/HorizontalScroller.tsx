import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { translateVerticalWheelToHorizontal } from '@/features/search/horizontal-wheel-scroll';
import { hapticFeedback } from '@/state/haptics';
import { uiSounds } from '@/state/ui-sounds';

interface HorizontalScrollerProps {
  readonly class: string;
  readonly viewportClass?: string;
  readonly children: JSX.Element;
  readonly controls?: boolean;
  readonly hideScrollbar?: boolean;
  readonly controlLabel?: string;
  /** Extra class for both arrows, e.g. to re-centre them on a padded row. */
  readonly controlClass?: string;
  /**
   * A plain scrolling box instead of an OverlayScrollbars instance: for scrollers a page has many
   * of (every table of a document). Each instance kept resize and mutation observers and
   * re-measured with a forced layout whenever the page around it changed — 50–75 ms apiece inside
   * one frame of a drug instruction on a phone (performance log 0.6.109). This one measures when
   * it comes into view and when it is scrolled; its bar is hidden either way.
   */
  readonly light?: boolean;
}

export function HorizontalScroller(props: HorizontalScrollerProps): JSX.Element {
  let scroller: OverlayScrollbarsComponentRef | undefined;
  let lastScrollLeft = 0;
  const [canScrollPrevious, setCanScrollPrevious] = createSignal(false);
  const [canScrollNext, setCanScrollNext] = createSignal(false);
  let lightViewport: HTMLDivElement | undefined;
  const viewportOf = (instance = scroller?.osInstance()): HTMLElement | undefined =>
    lightViewport ?? instance?.elements().viewport;
  const measure = (viewport: HTMLElement | undefined): void => {
    if (!viewport) return;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setCanScrollPrevious(viewport.scrollLeft > 2);
    setCanScrollNext(viewport.scrollLeft < maximum - 2);
  };
  const updateControls = (instance = scroller?.osInstance()): void => measure(viewportOf(instance));
  const handleScroll = (instance = scroller?.osInstance()): void => {
    const viewport = viewportOf(instance);
    if (viewport) {
      const delta = Math.abs(viewport.scrollLeft - lastScrollLeft);
      if (delta >= 28) {
        lastScrollLeft = viewport.scrollLeft;
        uiSounds.play('swipe');
        hapticFeedback('selection');
      }
    }
    measure(viewport);
  };
  // The light box: one measurement per frame at most, and only while it is on screen.
  let frame: number | undefined;
  const measureSoon = (scrolled: boolean): void => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (scrolled) handleScroll();
      else measure(lightViewport);
    });
  };
  onMount(() => {
    const viewport = lightViewport;
    if (!viewport || typeof IntersectionObserver === 'undefined') {
      if (viewport) measureSoon(false);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) measureSoon(false);
    });
    observer.observe(viewport);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  const scroll = (direction: -1 | 1): void => {
    const viewport = viewportOf();
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
          class={`horizontal-scroll-control previous ${props.controlClass ?? ''}`}
          type="button"
          aria-label={`Прокрутить ${props.controlLabel ?? 'список'} влево`}
          onClick={() => scroll(-1)}
        >
          <AppGlyph name="arrow-left" />
        </button>
      </Show>
      <Show
        when={!props.light}
        fallback={
          <div
            ref={(element) => {
              lightViewport = element;
            }}
            class={`horizontal-native-scroll ${props.viewportClass ?? ''}`}
            classList={{
              'horizontal-overlay-scroll--more-before': canScrollPrevious(),
              'horizontal-overlay-scroll--more-after': canScrollNext(),
            }}
            on:scroll={{ handleEvent: () => measureSoon(true), passive: true }}
            onWheel={(event) => {
              if (lightViewport) translateVerticalWheelToHorizontal(event, lightViewport);
            }}
          >
            {props.children}
          </div>
        }
      >
        <OverlayScrollbarsComponent
          ref={(value) => {
            scroller = value;
          }}
          class={`horizontal-overlay-scroll os-theme-dark ${props.viewportClass ?? ''}`}
          classList={{
            'horizontal-overlay-scroll--more-before': canScrollPrevious(),
            'horizontal-overlay-scroll--more-after': canScrollNext(),
          }}
          options={{
            overflow: { x: 'scroll', y: 'hidden' },
            scrollbars: { autoHide: props.hideScrollbar ? 'scroll' : 'never' },
          }}
          events={{
            initialized: (instance) => {
              lastScrollLeft = instance.elements().viewport?.scrollLeft ?? 0;
              updateControls(instance);
            },
            updated: updateControls,
            scroll: handleScroll,
          }}
          defer
          onWheel={(event) => {
            const viewport = scroller?.osInstance()?.elements().viewport;
            if (viewport) translateVerticalWheelToHorizontal(event, viewport);
          }}
        >
          {props.children}
        </OverlayScrollbarsComponent>
      </Show>
      <Show when={props.controls && canScrollNext()}>
        <button
          class={`horizontal-scroll-control next ${props.controlClass ?? ''}`}
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
