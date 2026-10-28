import { type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import '@/components/PageHero.css';
import { holdLightStatusBar } from '@/state/system-bars';

/**
 * The band behind a page's header: the page itself is a sheet that starts over the band's lower
 * edge and slides over it as it scrolls, and the header's row (back, title, actions) stays pinned
 * at the top (owner 2026-10-28). Declared per route (`app/page-heroes.ts`) and rendered by `Page`
 * (AGENTS.md «Schema first»).
 */
export interface PageHero {
  /** The route's icon, large and faint at the band's right edge. */
  readonly emblem?: AppGlyphName;
  /** A slow ECG trace across the band, like a monitor (still when animations are off). */
  readonly ambient?: 'ecg';
}

/** One heartbeat on a 120-unit period; four across a strip twice the band's width, so sliding it
    by half loops seamlessly. */
const ECG_BEAT = 'h34 l4 -3 l4 3 h8 l3 4 l5 -26 l5 32 l4 -10 h14 q6 -7 12 0 h27';

/** The band: colour, emblem and trace. Decorative; the header's own content sits on it. */
export function PageHeroBand(props: {
  readonly hero: PageHero;
  readonly class?: string;
}): JSX.Element {
  let band: HTMLDivElement | undefined;
  // Under the status bar the band is dark: light status-bar text while it is there.
  onMount(() => {
    if (!band || typeof IntersectionObserver === 'undefined') return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) release ??= holdLightStatusBar();
        else {
          release?.();
          release = undefined;
        }
      },
      // The top few percent of the screen: where the status bar is.
      { rootMargin: '0px 0px -96% 0px' },
    );
    observer.observe(band);
    onCleanup(() => {
      observer.disconnect();
      release?.();
    });
  });
  return (
    <div ref={band} class={`page-hero${props.class ? ` ${props.class}` : ''}`} aria-hidden="true">
      <div class="page-hero__art">
        <Show when={props.hero.ambient === 'ecg'}>
          <svg
            class="page-hero__ecg"
            viewBox="0 0 480 48"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path class="page-hero__ecg-line" d={`M0 30 ${ECG_BEAT.repeat(4)}`} />
          </svg>
        </Show>
      </div>
      {/* Outside the art: the art fades as the page scrolls, the emblem shrinks into the bar. */}
      <Show when={props.hero.emblem}>
        {(name) => <AppGlyph name={name()} class="page-hero__emblem" />}
      </Show>
    </div>
  );
}

/**
 * The header shrinks into a bar as the page scrolls (owner 2026-10-28): it is sticky with its
 * bottom strip left on screen and its row (back, title, actions) sticky under the status bar;
 * scroll-driven, the emblem slides into the strip and the description fades. Only headers
 * with a row do this: a bar with nothing to tap is not worth its room. The distances are measured
 * here (on resize, never per frame) and handed to CSS (`--page-hero-*`); without scroll-driven
 * animations the header simply scrolls away (components/PageHero.css).
 */
export function useHeroScroll(
  header: () => HTMLElement | undefined,
  row: () => HTMLElement | undefined,
  enabled: () => boolean,
): void {
  onMount(() => {
    const element = header();
    if (!enabled() || !element || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      // The row may appear after mount (header actions arriving later): read it every time.
      const pinned = row();
      if (!pinned || !element.isConnected) return;
      const box = naturalBox(element);
      if (box.height === 0) return;
      const safeTop = measureSafeTop();
      const lip = remToPx(1.25);
      const height = element.offsetHeight;
      const top = box.top + window.scrollY;
      const rowHeight = pinned.offsetHeight;
      const bar = safeTop + rowHeight + remToPx(0.5) + lip;
      const start = Math.max(0, top - safeTop);
      const end = top + height - bar;
      if (end <= start) return;
      // The sticky offset itself is CSS (`--safe-top` live): the status bar's inset may arrive
      // after this measurement (Capacitor sets it once the WebView reports it).
      element.style.setProperty('--page-hero-height', `${height}px`);
      element.style.setProperty('--page-hero-row', `${rowHeight}px`);
      element.style.setProperty('--page-hero-start', `${start}px`);
      element.style.setProperty('--page-hero-end', `${end}px`);
      // The row slides down over the title block under it: that block is gone by the time the
      // row reaches it, so a page that scrolls only a little never shows the two overlapping.
      const block = element.querySelector<HTMLElement>('.page__header');
      const clear = block ? block.offsetTop - (pinned.offsetTop + rowHeight) : end - start;
      element.style.setProperty('--page-hero-fade-end', `${start + Math.max(4, clear)}px`);
      // The emblem's centre rests 3.25rem below the header's top (PageHero.css: 1.5rem above the
      // band's inner edge, 9.5rem tall); it ends in the row's middle.
      const target = safeTop + rowHeight / 2 - (bar - height);
      element.style.setProperty('--page-hero-emblem-shift', `${target - remToPx(3.25)}px`);
      element.classList.add('page--hero-sticky');
      pinned.classList.add('page__above-header--sticky');
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const stopInsets = watchInsets(measure);
    onCleanup(() => {
      observer.disconnect();
      stopInsets();
    });
  });
}

/**
 * Measures again when the window resizes or the root's inline style changes (the safe-area insets
 * are set there, sometimes after the first paint).
 */
function watchInsets(measure: () => void): () => void {
  const observer = new MutationObserver(measure);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', measure);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', measure);
  };
}

/**
 * The header's box where it sits in the page, not where it is stuck: measuring a stuck header
 * mid-scroll shifted the band and the scroll ranges (the header jittered while scrolling).
 */
function naturalBox(element: HTMLElement): DOMRect {
  if (!element.classList.contains('page--hero-sticky')) return element.getBoundingClientRect();
  element.classList.remove('page--hero-sticky');
  const box = element.getBoundingClientRect();
  element.classList.add('page--hero-sticky');
  return box;
}

function remToPx(rem: number): number {
  return rem * Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
}

/**
 * Lets the band reach its surface's edges and the screen top whatever the surface's padding: the
 * header states how far it sits from them (`--page-hero-inset-*`), measured, not assumed.
 */
export function useHeroBleed(header: () => HTMLElement | undefined, enabled: () => boolean): void {
  onMount(() => {
    const element = header();
    if (!enabled() || !element || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const box = naturalBox(element);
      if (box.height === 0) return;
      const surface =
        element.closest('.page-surface, .model-status-view, .diary-page') ?? element.parentElement;
      if (!surface) return;
      const outer = surface.getBoundingClientRect();
      // Never past the screen's sides (a wider surface would scroll the page sideways).
      const left = Math.max(outer.left, 0);
      const right = Math.min(outer.right, document.documentElement.clientWidth);
      element.style.setProperty('--page-hero-inset-left', `${Math.max(0, box.left - left)}px`);
      element.style.setProperty('--page-hero-inset-right', `${Math.max(0, right - box.right)}px`);
      element.style.setProperty('--page-hero-inset-top', `${box.top - outer.top}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const stopInsets = watchInsets(measure);
    // A screen that slides or fades in was measured mid-way: measure again once it has settled.
    // Only the screen's own entrance (its view or page), not every control's transition inside it.
    const settle = element.closest('.app-view, .diary-page') ?? element.parentElement;
    const settled = (event: Event): void => {
      if (event.target === settle) measure();
    };
    settle?.addEventListener('animationend', settled);
    settle?.addEventListener('transitionend', settled);
    onCleanup(() => {
      observer.disconnect();
      stopInsets();
      settle?.removeEventListener('animationend', settled);
      settle?.removeEventListener('transitionend', settled);
    });
  });
}

/** The status bar's height in CSS pixels (`--safe-top`). */
function measureSafeTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:var(--safe-top, 0px);visibility:hidden';
  document.body.append(probe);
  const height = probe.offsetHeight;
  probe.remove();
  return height;
}
