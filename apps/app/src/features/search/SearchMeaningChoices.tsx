import type { MedicalDocumentSummary } from '@localmed/contracts';
import { For, type JSX } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import type { DocumentLinkAlternative } from '@/features/library/document-medication-links';
import { searchResultDocumentKind } from '@/features/search/ScopedMedicalCore';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import { getPluralMessage } from '@/i18n/browser-i18n';

export interface SearchMeaning {
  readonly phrase: string;
  readonly alternatives: readonly DocumentLinkAlternative[];
}

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
