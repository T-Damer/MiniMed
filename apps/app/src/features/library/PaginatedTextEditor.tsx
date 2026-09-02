import { createEffect, createSignal, For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  joinUserLibraryTextPages,
  splitUserLibraryTextPages,
} from '@/state/user-library-text-pages';

interface PaginatedTextEditorProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function PaginatedTextEditor(props: PaginatedTextEditorProps): JSX.Element {
  const [pages, setPages] = createSignal<readonly string[]>(splitUserLibraryTextPages(props.value));

  createEffect(() => {
    if (joinUserLibraryTextPages(pages()) === props.value) return;
    setPages(splitUserLibraryTextPages(props.value));
  });

  const updatePages = (next: readonly string[]): void => {
    setPages(next);
    props.onChange(joinUserLibraryTextPages(next));
  };

  const updatePage = (pageIndex: number, value: string): void => {
    const next = [...pages()];
    next.splice(pageIndex, 1, ...splitUserLibraryTextPages(value));
    updatePages(next);
  };

  const removePage = (pageIndex: number): void => {
    if (pages().length <= 1) return;
    updatePages(pages().filter((_, index) => index !== pageIndex));
  };

  return (
    <section class="paginated-text-editor" aria-label={props.label}>
      <For each={pages()}>
        {(page, index) => (
          <section
            class="paginated-text-editor__page"
            aria-label={`Страница ${String(index() + 1)}`}
          >
            <header class="paginated-text-editor__page-header">
              <span class="paginated-text-editor__page-number">Страница {index() + 1}</span>
              <Button
                type="button"
                variant="icon"
                class="paginated-text-editor__remove-page"
                aria-label={`Удалить страницу ${String(index() + 1)}`}
                title="Удалить страницу"
                disabled={pages().length <= 1}
                onClick={() => removePage(index())}
                icon={<AppGlyph name="trash" class="paginated-text-editor__remove-page-icon" />}
              />
            </header>
            <textarea
              class="paginated-text-editor__input"
              value={page}
              aria-label={`Текст страницы ${String(index() + 1)}`}
              autofocus={index() === 0}
              onInput={(event) => updatePage(index(), event.currentTarget.value)}
            />
          </section>
        )}
      </For>
      <Button
        type="button"
        variant="secondary"
        class="paginated-text-editor__add-page"
        onClick={() => updatePages([...pages(), ''])}
        icon={<AppGlyph name="plus" class="paginated-text-editor__add-page-icon" />}
      >
        Новая страница
      </Button>
    </section>
  );
}
