import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import '@/features/medications/drug-screen.css';

/**
 * «Разделы 7»: the way into the document's sections from a drug screen, one small button that
 * opens the contents drawer (the reader's own outline). It replaces a scrolling strip of section
 * chips that took a row of the first screen and cut every label short; on wide layouts the outline
 * is always beside the text and the button is hidden.
 */
export function DrugSectionIndex(props: {
  readonly count: number;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <div class="drug-section-index">
      <button
        type="button"
        class="drug-section-index__button"
        aria-label={`Разделы документа: ${String(props.count)}`}
        title="Оглавление"
        data-testid="drug-sections-button"
        onClick={props.onOpen}
      >
        <AppGlyph name="list-bullets" class="drug-section-index__icon" />
        <span>Разделы</span>
        <span class="drug-section-index__count">{props.count}</span>
      </button>
    </div>
  );
}
