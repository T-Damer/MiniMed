import { createEffect, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { AppGlyphName } from '@/components/AppGlyph';
import '@/components/PageHero.css';
import { PULSE_RATE, useFrameHealth } from '@/state/frame-health';
import { motionRate } from '@/state/motion';
import { holdLightStatusBar } from '@/state/system-bars';

/**
 * The band behind a page's header: the page itself is a sheet that starts over the band's lower
 * edge and slides over it as it scrolls, and the header's row (back, title, actions) stays pinned
 * at the top (owner 2026-10-28). Declared per route (`app/page-heroes.ts`) and rendered by `Page`
 * (AGENTS.md «Schema first»).
 */
export interface PageHero {
  /** The route's icon, large and faint at the band's right edge (`Page` draws it in the row). */
  readonly emblem?: AppGlyphName;
  /** A slow ECG trace across the band, like a monitor (still when animations are off). */
  readonly ambient?: 'ecg';
}

/** One heartbeat on a 120-unit period; four across a strip twice the band's width, so sliding it
    by half loops seamlessly. */
const ECG_BEAT = 'h34 l4 -3 l4 3 h8 l3 4 l5 -26 l5 32 l4 -10 h14 q6 -7 12 0 h27';

/**
 * The monitor's trace, and a live reading of the app itself (owner 2026-10-29): it turns yellow
 * and beats faster while frames are being dropped, red and faster still when the app struggles
 * (`state/frame-health.ts`).
 */
function EcgTrace(): JSX.Element {
  const health = useFrameHealth();
  let trace: SVGSVGElement | undefined;
  createEffect(() => {
    const rate = PULSE_RATE[health()] * Math.max(motionRate(), 0);
    if (!trace || rate === 0) return;
    for (const animation of trace.getAnimations()) animation.updatePlaybackRate(rate);
  });
  return (
    <svg
      ref={trace}
      class="page-hero__ecg"
      viewBox="0 0 480 48"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        class="page-hero__ecg-line"
        classList={{
          'page-hero__ecg-line--strained': health() === 'strained',
          'page-hero__ecg-line--poor': health() === 'poor',
        }}
        d={`M0 30 ${ECG_BEAT.repeat(4)}`}
      />
    </svg>
  );
}

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
          <EcgTrace />
        </Show>
      </div>
    </div>
  );
}

/**
 * The header shrinks into a bar as the page scrolls (owner 2026-10-28): it is sticky with its
 * bottom strip left on screen and its row (back, title, actions) sticky under the status bar;
 * scroll-driven, the description fades and the emblem shrinks into a small icon beside the bar's
 * title, where nothing covers it (it fades instead when the row has no room). Only headers
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
      setLength(element, '--page-hero-height', height);
      setLength(element, '--page-hero-row', rowHeight);
      setLength(element, '--page-hero-start', start);
      setLength(element, '--page-hero-end', end);
      // The row slides down over the title block under it: that block is gone by the time the
      // row reaches it, so a page that scrolls only a little never shows the two overlapping.
      const block = element.querySelector<HTMLElement>('.page__header');
      const clear = block ? block.offsetTop - (pinned.offsetTop + rowHeight) : end - start;
      setLength(element, '--page-hero-fade-end', start + Math.max(4, clear));
      measureEmblem(element, pinned, rowHeight);
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

/** The emblem's size at rest (PageHero.css) and in the bar. */
const EMBLEM_REST_REM = 9.5;
const EMBLEM_BAR_REM = 1.375;

/**
 * Where the emblem ends: a small icon just after the row's title, in the row's middle, where no
 * button covers it. A row with no room there (a search field, a long title, the actions) lets the
 * emblem fade instead of hiding it under a control.
 */
function measureEmblem(header: HTMLElement, row: HTMLElement, rowHeight: number): void {
  const emblem = row.querySelector<HTMLElement>('.page-hero__emblem');
  if (!emblem) return;
  // It is drawn in the row (above the row's pinned fill), placed from the header's top.
  setLength(header, '--page-hero-row-offset', row.offsetTop);
  const rest = remToPx(EMBLEM_REST_REM);
  const size = remToPx(EMBLEM_BAR_REM);
  const gap = remToPx(0.5);
  const headerBox = header.getBoundingClientRect();
  // The emblem's centre at rest, from its declared place (PageHero.css): its box sits 1.5rem above
  // the header's top and 1.75rem past the band's right edge. The row is already stuck under the
  // status bar while the emblem moves (it sticks before the header does), so the flight is
  // measured in the row, which stands still meanwhile.
  const insetRight = Number.parseFloat(header.style.getPropertyValue('--page-hero-inset-right'));
  const restX =
    headerBox.right + (Number.isFinite(insetRight) ? insetRight : 0) + remToPx(1.75) - rest / 2;
  const restY = rest / 2 - remToPx(1.5) - row.offsetTop;
  const title = row.querySelector<HTMLElement>('.page__title');
  const actions = row.querySelector<HTMLElement>('.page__right-actions');
  const titleRight = title?.getBoundingClientRect().right;
  const limit = actions?.getBoundingClientRect().left ?? headerBox.right;
  const room = titleRight !== undefined && titleRight + gap + size + gap <= limit;
  const endX = room && titleRight !== undefined ? titleRight + gap + size / 2 : restX;
  const endY = rowHeight / 2;
  setLength(header, '--page-hero-emblem-x', endX - restX);
  setLength(header, '--page-hero-emblem-y', endY - restY);
  header.style.setProperty(
    '--page-hero-emblem-scale',
    String(Math.round((size / rest) * 1000) / 1000),
  );
  header.style.setProperty('--page-hero-emblem-opacity', room ? '0.7' : '0');
}

/**
 * Measures again when the window's width or the status bar's inset changes (the insets are set on
 * the root's style, sometimes after the first paint). Only then: a browser's toolbars collapsing
 * while the page scrolls resize the window's height and the root's style is written on every
 * resize; measuring then un-stuck the header mid-scroll and restarted its scroll ranges (the
 * header flashed its end state on a slow scroll).
 */
export function watchInsets(measure: () => void): () => void {
  let width = window.innerWidth;
  let safeTop = measureSafeTop();
  const check = (): void => {
    const nextWidth = window.innerWidth;
    const nextSafeTop = measureSafeTop();
    if (nextWidth === width && nextSafeTop === safeTop) return;
    width = nextWidth;
    safeTop = nextSafeTop;
    measure();
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', check);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', check);
  };
}

/** Writes a measured length only when it changed: an unchanged write restarts nothing. */
export function setLength(element: HTMLElement, name: string, px: number): void {
  const value = `${Math.round(px * 100) / 100}px`;
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
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

export function remToPx(rem: number): number {
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
      setLength(element, '--page-hero-inset-left', Math.max(0, box.left - left));
      setLength(element, '--page-hero-inset-right', Math.max(0, right - box.right));
      setLength(element, '--page-hero-inset-top', box.top - outer.top);
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
