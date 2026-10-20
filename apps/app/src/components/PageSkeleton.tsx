import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { navigateBack } from '@/state/app-back';

import './page-skeleton.css';

/** Widths (in percent) of the placeholder text lines: ragged, like a paragraph. */
const LINE_WIDTHS: readonly number[] = [100, 96, 100, 88, 100, 42, 100, 94, 100, 70];

/**
 * The page under a header while it loads: a title bar, a meta bar and a few lines of text, drawn on
 * the reader's own paper so the real page replaces it without the layout moving. Quiet bars with one
 * soft sweep (a transform); with animations off they simply stay.
 */
export function PageSkeletonBody(props: {
  readonly lines?: number;
  /** A paper card on the desk (a root tab) instead of the reader's full-width paper. */
  readonly card?: boolean;
  /** A status line above the bars (why the page waits). */
  readonly notice?: JSX.Element;
}): JSX.Element {
  return (
    <article
      class="page-skeleton__paper"
      classList={{ 'page-skeleton__paper--card': props.card === true }}
      aria-hidden="true"
      data-testid="page-skeleton-body"
    >
      {props.notice ? <div class="page-skeleton__notice">{props.notice}</div> : null}
      <span class="page-skeleton__bar page-skeleton__bar--title" />
      <span class="page-skeleton__bar page-skeleton__bar--meta" />
      <div class="page-skeleton__lines">
        <For each={LINE_WIDTHS.slice(0, props.lines ?? LINE_WIDTHS.length)}>
          {(width) => <span class="page-skeleton__bar" style={{ width: `${width}%` }} />}
        </For>
      </div>
    </article>
  );
}

/**
 * A whole screen while its code or data loads: the reader's header row (a working back button, the
 * contents button held in its place, a breadcrumb bar) and the body skeleton. Back is the app's one
 * history step; with no entry below it the screen is replaced by `fallbackHash`.
 */
export function PageSkeleton(props: {
  /** Where back leads when nothing app-owned lies below this screen. */
  readonly fallbackHash?: string;
  /** A root tab has nothing to go back to: no header row, only the body. */
  readonly headless?: boolean;
  /** A status line between the header row and the bars (why the page waits). */
  readonly notice?: JSX.Element;
}): JSX.Element {
  return (
    <div
      class="page-skeleton"
      classList={{ 'page-skeleton--headless': props.headless === true }}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Загрузка страницы"
    >
      {props.headless ? null : (
        <header class="page-skeleton__chrome">
          <NavBack
            class="page-skeleton__back"
            aria-label="Назад"
            onClick={() => navigateBack(props.fallbackHash ?? '#/search')}
            icon={<AppGlyph name="arrow-left" class="page-skeleton__back-icon" />}
          />
          <button
            type="button"
            class="page-skeleton__toggle"
            aria-hidden="true"
            tabIndex={-1}
            disabled
          >
            <AppGlyph name="menu" class="page-skeleton__toggle-icon" />
          </button>
          <span class="page-skeleton__bar page-skeleton__bar--crumb" aria-hidden="true" />
        </header>
      )}
      <PageSkeletonBody card={props.headless === true} notice={props.notice} />
    </div>
  );
}
