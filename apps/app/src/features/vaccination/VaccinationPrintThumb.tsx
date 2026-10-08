import { createEffect, createSignal, type JSX, on, onCleanup } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

/** The thumbnail follows the sheet this long after the last change ("Live previews"). */
export const THUMB_DELAY_MS = 350;

/**
 * Header print button: a small live view of the handout with a printer on it. It is the same page
 * the preview and the print show, scaled down; tapping it opens the preview.
 */
export function VaccinationPrintThumb(props: {
  readonly html: string;
  readonly onOpen: () => void;
}): JSX.Element {
  const [html, setHtml] = createSignal(props.html);
  createEffect(
    on(
      () => props.html,
      (next) => {
        const timer = setTimeout(() => setHtml(next), THUMB_DELAY_MS);
        onCleanup(() => clearTimeout(timer));
      },
      { defer: true },
    ),
  );
  return (
    <div class="vax-thumb">
      {/* Decorative: the real page is in the preview; no script runs in it. */}
      <iframe
        class="vax-thumb__frame"
        title="Миниатюра листа для мамы"
        tabindex="-1"
        aria-hidden="true"
        sandbox="allow-same-origin"
        srcdoc={html()}
      />
      <button
        type="button"
        class="vax-thumb__button"
        aria-label="Печать"
        title="Печать"
        onClick={props.onOpen}
      >
        <span class="vax-thumb__badge">
          <AppGlyph name="printer" class="vax-thumb__icon" />
        </span>
      </button>
    </div>
  );
}
