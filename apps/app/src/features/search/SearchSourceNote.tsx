import type { SourceScope } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { sourceNoteText } from '@/features/search/search-source-note';
import '@/features/search/search-source-note.css';

/**
 * The line above results that were limited to the source the query named («Красота и медицина
 * пневмония»), or above the listing of a bare source name. A limited search offers the way out.
 */
export function SearchSourceNote(props: {
  readonly scope: SourceScope;
  readonly onSearchEverywhere: () => void;
}): JSX.Element {
  return (
    <div class="search-source-note" role="status" data-testid="search-source-note">
      <AppGlyph name="books" class="search-source-note__icon" />
      <span class="search-source-note__text">{sourceNoteText(props.scope)}</span>
      <Show when={props.scope.remainder}>
        <button
          class="search-source-note__action"
          type="button"
          data-testid="search-source-everywhere"
          onClick={() => props.onSearchEverywhere()}
        >
          Искать везде
        </button>
      </Show>
    </div>
  );
}
