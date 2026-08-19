import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { SearchField } from '@/components/SearchField';
import { matchesCatalogQuery } from '@/features/modules/laws-documents-helpers';
import { openDocumentOverlay } from '@/state/document-navigation';

interface LawsDocumentsViewProps {
  readonly module: ContentModuleCatalogEntry;
  readonly installed: boolean;
  readonly documentTitle: (document: ContentModuleCatalogEntry['documents'][number]) => string;
  readonly documentDate: (documentVersionId: string) => string;
  readonly onBack: () => void;
}

export function LawsDocumentsView(props: LawsDocumentsViewProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const documents = createMemo(() => {
    const trimmed = query().trim();
    if (!trimmed) return props.module.documents;
    return props.module.documents.filter((document) =>
      matchesCatalogQuery(trimmed, [
        props.documentTitle(document),
        document.documentId,
        document.status,
      ]),
    );
  });

  return (
    <section class="laws-documents-page" aria-label={props.module.title}>
      <header class="laws-documents-page__header knowledge-subroute-heading knowledge-subroute-heading--blurred sticky-surface route-sticky-chrome">
        <NavBack
          class="laws-documents-page__back knowledge-back-button knowledge-subroute-heading__control"
          aria-label="Назад к наборам документов"
          onClick={props.onBack}
          icon={<AppGlyph name="arrow-left" class="laws-documents-page__back-icon" />}
        />
        <div class="laws-documents-page__heading">
          <h1 class="laws-documents-page__title">{props.module.title}</h1>
          <p class="laws-documents-page__subtitle">{props.module.description}</p>
        </div>
      </header>
      <div class="laws-documents-page__body">
        <SearchField
          class="laws-documents-page__search"
          id="laws-documents-search"
          label="Поиск по документам"
          value={query()}
          onInput={setQuery}
          placeholder="Название или номер приказа"
        />
        <Show
          when={documents().length > 0}
          fallback={<p class="laws-documents-page__empty">Документы не найдены.</p>}
        >
          <div class="laws-documents-page__list">
            <For each={documents()}>
              {(document) => {
                const canOpen = () => props.installed;
                return (
                  <button
                    type="button"
                    class="module-document-row"
                    classList={{ 'module-document-row-openable': canOpen() }}
                    disabled={!canOpen()}
                    onClick={() => {
                      if (canOpen()) openDocumentOverlay(document.documentId);
                    }}
                  >
                    <strong>{props.documentTitle(document)}</strong>
                    <span>
                      {props.documentDate(document.documentVersionId)} ·{' '}
                      {document.status === 'active'
                        ? 'действующая редакция'
                        : document.status === 'historical'
                          ? 'историческая редакция'
                          : 'предыдущая редакция'}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
