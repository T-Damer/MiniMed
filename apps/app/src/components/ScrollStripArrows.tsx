import { createEffect, createSignal, type JSX, on, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

/** How far one tap on an arrow moves the strip, as a share of its width. */
const STEP_SHARE = 0.72;
const MIN_STEP_PX = 160;

/**
 * Arrows for a horizontal strip that scrolls natively (no visible scrollbar): one at each end that
 * has more to show, none while everything fits. Put it next to the strip inside a
 * `scroll-strip` wrapper; for a strip built on `HorizontalScroller` use that component instead.
 *
 * ```tsx
 * <div class="scroll-strip">
 *   <ul ref={setStrip} class="my-strip">…</ul>
 *   <ScrollStripArrows target={strip} label="источники" />
 * </div>
 * ```
 */
export function ScrollStripArrows(props: {
  readonly target: () => HTMLElement | undefined;
  /** What scrolls, in the genitive: «источники» → «Прокрутить источники влево». */
  readonly label?: string;
}): JSX.Element {
  const [canPrevious, setCanPrevious] = createSignal(false);
  const [canNext, setCanNext] = createSignal(false);
  const measure = (strip: HTMLElement): void => {
    const maximum = Math.max(0, strip.scrollWidth - strip.clientWidth);
    setCanPrevious(Math.abs(strip.scrollLeft) > 2);
    setCanNext(Math.abs(strip.scrollLeft) < maximum - 2);
  };
  createEffect(
    on(props.target, (strip) => {
      if (!strip) return;
      const update = (): void => measure(strip);
      update();
      strip.addEventListener('scroll', update, { passive: true });
      const resize = new ResizeObserver(update);
      resize.observe(strip);
      // Items added or removed change the scroll width without resizing the strip itself.
      const mutation = new MutationObserver(update);
      mutation.observe(strip, { childList: true, subtree: true });
      onCleanup(() => {
        strip.removeEventListener('scroll', update);
        resize.disconnect();
        mutation.disconnect();
      });
    }),
  );
  const scroll = (direction: -1 | 1): void => {
    const strip = props.target();
    strip?.scrollBy({
      left: direction * Math.max(MIN_STEP_PX, strip.clientWidth * STEP_SHARE),
      behavior: 'smooth',
    });
  };
  const label = (): string => props.label ?? 'список';
  return (
    <>
      <Show when={canPrevious()}>
        <button
          class="horizontal-scroll-control previous"
          type="button"
          aria-label={`Прокрутить ${label()} влево`}
          onClick={() => scroll(-1)}
        >
          <AppGlyph name="arrow-left" />
        </button>
      </Show>
      <Show when={canNext()}>
        <button
          class="horizontal-scroll-control next"
          type="button"
          aria-label={`Прокрутить ${label()} вправо`}
          onClick={() => scroll(1)}
        >
          <AppGlyph name="arrow-left" />
        </button>
      </Show>
    </>
  );
}
