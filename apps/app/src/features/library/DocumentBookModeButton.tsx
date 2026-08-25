import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import {
  setTwoPageMode,
  useDocumentBookReadingMode,
} from '@/features/library/document-reading-mode';

/**
 * Floating reading-menu trigger (the only reading-mode control): toggles book
 * mode and, for PDFs, the two-page spread.
 */
export function DocumentBookModeButton(): JSX.Element {
  const readingMode = useDocumentBookReadingMode();
  const actions = (): readonly AppContextMenuAction[] => [
    {
      id: 'reading-book',
      label: 'Режим чтения',
      ...(readingMode.bookMode() ? { icon: 'check' as const } : {}),
      onSelect: readingMode.toggleBookMode,
    },
    {
      id: 'reading-two-page',
      label: 'Разворот из двух страниц',
      disabled: !readingMode.pdfActive(),
      ...(readingMode.twoPageMode() ? ({ icon: 'check' } as const) : {}),
      onSelect: () => setTwoPageMode(!readingMode.twoPageMode()),
    },
  ];
  return (
    <Show when={readingMode.showBookModeButton()}>
      <AppContextMenu class="document-book-mode-button" hideButton actions={actions()}>
        <button
          type="button"
          class="document-book-mode-button__trigger"
          classList={{
            'document-book-mode-button__trigger--active': readingMode.bookMode(),
          }}
          aria-label="Режим чтения"
          title="Режим чтения"
          onClick={requestContextMenu}
        >
          <AppGlyph name="book-open" class="document-book-mode-button__icon" />
        </button>
      </AppContextMenu>
    </Show>
  );
}
