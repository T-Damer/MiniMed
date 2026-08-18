import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { useDocumentBookReadingMode } from '@/features/library/document-reading-mode';

export function DocumentBookModeButton(): JSX.Element {
  const readingMode = useDocumentBookReadingMode();
  return (
    <Show when={readingMode.showBookModeButton()}>
      <button
        type="button"
        class="document-book-mode-button"
        classList={{ 'document-book-mode-button--active': readingMode.bookMode() }}
        aria-label="Режим книги"
        aria-pressed={readingMode.bookMode()}
        onClick={readingMode.toggleBookMode}
      >
        <AppGlyph name="book-open" class="document-book-mode-button__icon" />
      </button>
    </Show>
  );
}
