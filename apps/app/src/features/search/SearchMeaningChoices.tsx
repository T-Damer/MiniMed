import type { MedicalDocumentSummary } from '@localmed/contracts';
import { For, type JSX } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { ListGroup, ListRow, type ListTileTone } from '@/components/ListRow';
import { displayDocumentTitle } from '@/features/library/document-display';
import {
  type SearchResultDocumentKind,
  searchResultDocumentKind,
} from '@/features/search/ScopedMedicalCore';
import type { SearchMeaning } from '@/features/search/search-meanings';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import { getPluralMessage } from '@/i18n/browser-i18n';

export type { SearchMeaning } from '@/features/search/search-meanings';

/** Lists every document a query phrase may refer to as explicit choices. */
export function SearchMeaningChoices(props: {
  readonly meanings: readonly SearchMeaning[];
  readonly documentsById: ReadonlyMap<string, MedicalDocumentSummary>;
  readonly onOpen: (documentId: string) => void;
}): JSX.Element {
  const visual = (documentId: string) => {
    const document = props.documentsById.get(documentId);
    return RESULT_KIND_VISUALS[document ? searchResultDocumentKind(document) : 'reference'];
  };
  return (
    <aside class="search-meanings" aria-label="Значения запроса">
      <For each={props.meanings}>
        {(meaning) => (
          <section class="search-meanings__phrase">
            <p class="search-meanings__label">
              «{meaning.phrase}» —{' '}
              {getPluralMessage('search_meaning_count', meaning.alternatives.length)}, выберите
              нужный
            </p>
            <ChoiceChipList label={`Значения «${meaning.phrase}»`}>
              <For each={meaning.alternatives}>
                {(alternative) => (
                  <ChoiceChip
                    icon={
                      <AppGlyph
                        name={visual(alternative.documentId).icon}
                        class="choice-chip__glyph"
                      />
                    }
                    detail={visual(alternative.documentId).label}
                    onClick={() => props.onOpen(alternative.documentId)}
                  >
                    {alternative.title}
                  </ChoiceChip>
                )}
              </For>
            </ChoiceChipList>
          </section>
        )}
      </For>
    </aside>
  );
}

/** The tile colour of each kind of document in a list row. */
const KIND_TONES: Readonly<Record<SearchResultDocumentKind, ListTileTone>> = {
  medication: 'green',
  'clinical-recommendation': 'blue',
  legal: 'gray',
  calculator: 'orange',
  assessment: 'purple',
  reference: 'teal',
};

/**
 * Documents whose titles carry the query words and that the results above do not list (owner
 * 2026-11-13: a document appears once). A narrower article («Пневмония у детей») is often one.
 */
export function SearchTitleExtras(props: {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly onOpen: (documentId: string) => void;
}): JSX.Element {
  return (
    <ListGroup class="search-title-extras" heading="Ещё по названию" label="Ещё по названию">
      <For each={props.documents}>
        {(document) => {
          const kind = searchResultDocumentKind(document);
          return (
            <ListRow
              class="search-title-extras__row"
              icon={RESULT_KIND_VISUALS[kind].icon}
              tone={KIND_TONES[kind]}
              title={displayDocumentTitle(document)}
              subtitle={RESULT_KIND_VISUALS[kind].label}
              onClick={() => props.onOpen(document.id)}
            />
          );
        }}
      </For>
    </ListGroup>
  );
}
