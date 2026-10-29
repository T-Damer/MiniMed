import { createEffect, onCleanup } from 'solid-js';

import { remToPx, setLength, watchInsets } from '@/components/PageHero';

/**
 * How much scroll the field takes to become the row's pill: short, so it stays a whole field until
 * it nearly reaches the row (a long morph left a faded ghost of the field on screen, owner
 * 2026-10-29).
 */
const MORPH_DISTANCE_REM = 3;

/**
 * The search field turns into the top row's pill as the page scrolls (owner 2026-10-29): the
 * field's outline is clipped down to the pill's shape while it rises to the row, its contents
 * dissolve into the pill's surface, the pill takes over where the field meets it and the row
 * becomes the band's bar. Everything is a function of the scroll position (scroll-driven CSS on
 * opacity and clip-path, styles/compact-release.css «search field morph»): the field keeps moving with the scroll
 * itself, so nothing lags a frame behind it. Measured here on resize, never per frame
 * (`--search-morph-*` on the page); without scroll-driven animations the row swaps by state.
 */
export function useSearchFieldMorph(parts: {
  readonly page: () => HTMLElement | undefined;
  readonly field: () => HTMLFormElement | undefined;
  readonly row: () => HTMLElement | undefined;
  readonly pill: () => HTMLElement | undefined;
}): void {
  createEffect(() => {
    const page = parts.page();
    const field = parts.field();
    const row = parts.row();
    const pill = parts.pill();
    if (!page || !field || !row || !pill || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const fieldBox = field.getBoundingClientRect();
      const pillBox = pill.getBoundingClientRect();
      if (fieldBox.height === 0 || pillBox.width === 0) return;
      // Where the pill rests once the row is stuck (its sticky `top`), whatever the scroll now.
      const stuckTop = Number.parseFloat(getComputedStyle(row).top) || 0;
      const pillTop = stuckTop + (pillBox.top - row.getBoundingClientRect().top);
      const end = fieldBox.top + window.scrollY - pillTop;
      if (end <= 0) return;
      const start = Math.max(0, end - remToPx(MORPH_DISTANCE_REM));
      setLength(page, '--search-morph-start', start);
      setLength(page, '--search-morph-end', end);
      setLength(page, '--search-morph-left', pillBox.left - fieldBox.left);
      setLength(page, '--search-morph-right', fieldBox.right - pillBox.right);
      setLength(page, '--search-morph-bottom', fieldBox.height - pillBox.height);
      field.classList.add('query-sheet--morph');
      pill.classList.add('search-field-pill--morph');
    };
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    observer.observe(row);
    observer.observe(page);
    const stopInsets = watchInsets(measure);
    onCleanup(() => {
      observer.disconnect();
      stopInsets();
      field.classList.remove('query-sheet--morph');
      pill.classList.remove('search-field-pill--morph');
    });
  });
}
