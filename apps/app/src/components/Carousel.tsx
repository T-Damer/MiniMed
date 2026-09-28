import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  carouselAutoplayMayAdvance,
  carouselIndexAt,
  carouselStep,
} from '@/components/carousel-motion';

import './Carousel.css';

export interface CarouselSlide {
  readonly id: string;
  readonly render: () => JSX.Element;
}

/**
 * One slide at a time on a native scroll-snap track: swipe, arrows, equal slide heights. Optional
 * autoplay waits while the pointer or focus is inside, stops for good once the user takes over,
 * and never runs with reduced motion or on a hidden page.
 */
export function Carousel(props: {
  readonly class?: string;
  readonly label: string;
  readonly slides: readonly CarouselSlide[];
  readonly startIndex?: number;
  readonly autoplayMs?: number;
}): JSX.Element {
  let track: HTMLDivElement | undefined;
  const [index, setIndex] = createSignal(0);
  const [held, setHeld] = createSignal(false);
  const [takenOver, setTakenOver] = createSignal(false);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const count = (): number => props.slides.length;

  // Slide a programmatic scroll is heading to: the counter shows it at once and ignores the
  // positions passed on the way, so it never flickers back through the previous slide.
  let target: number | undefined;
  const show = (next: number, smooth: boolean): void => {
    if (!track) return;
    target = next;
    setIndex(next);
    track.scrollTo({
      left: next * track.clientWidth,
      behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto',
    });
  };
  const step = (direction: -1 | 1): void => {
    setTakenOver(true);
    show(carouselStep(index(), count(), direction), true);
  };

  onMount(() => {
    if (!track) return;
    const element = track;
    const start = Math.min(Math.max(0, props.startIndex ?? 0), Math.max(0, count() - 1));
    show(start, false);
    // Keep the current slide in place when the width changes (rotation, split view).
    const resize = new ResizeObserver(() => {
      element.scrollTo({ left: index() * element.clientWidth });
    });
    resize.observe(element);
    onCleanup(() => resize.disconnect());
    if (!props.autoplayMs) return;
    const timer = window.setInterval(() => {
      const mayAdvance = carouselAutoplayMayAdvance({
        reducedMotion: reducedMotion.matches,
        takenOver: takenOver(),
        held: held(),
        pageHidden: document.hidden,
      });
      if (mayAdvance && count() > 1) show(carouselStep(index(), count(), 1), true);
    }, props.autoplayMs);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <section
      class={`carousel ${props.class ?? ''}`}
      aria-roledescription="карусель"
      aria-label={props.label}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      <div class="carousel__bar">
        <span class="carousel__label">{props.label}</span>
        <Show when={count() > 1}>
          <span class="carousel__position" aria-live={takenOver() ? 'polite' : 'off'}>
            {index() + 1} из {count()}
          </span>
          <div class="carousel__controls">
            <button
              type="button"
              class="carousel__arrow"
              aria-label="Предыдущая"
              onClick={() => step(-1)}
            >
              <AppGlyph class="carousel__arrow-icon" name="caret-left" />
            </button>
            <button
              type="button"
              class="carousel__arrow"
              aria-label="Следующая"
              onClick={() => step(1)}
            >
              <AppGlyph class="carousel__arrow-icon" name="caret-right" />
            </button>
          </div>
        </Show>
      </div>
      <div
        ref={track}
        class="carousel__track"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (target !== undefined) {
            if (Math.abs(element.scrollLeft - target * element.clientWidth) > 1) return;
            target = undefined;
          }
          setIndex(carouselIndexAt(element.scrollLeft, element.clientWidth, count()));
        }}
        onPointerDown={() => {
          target = undefined;
          setTakenOver(true);
        }}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
          target = undefined;
          setTakenOver(true);
        }}
      >
        <For each={props.slides}>
          {(slide, position) => (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA carousel slides are role="group" containers, not form fieldsets.
            <div
              class="carousel__slide"
              role="group"
              aria-roledescription="слайд"
              aria-label={`${position() + 1} из ${count()}`}
            >
              {slide.render()}
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
