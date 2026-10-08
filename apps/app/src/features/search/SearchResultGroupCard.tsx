import type { SearchResult, SearchResultGroup } from '@localmed/contracts';
import { children, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Disclosure } from '@/components/Disclosure';
import { IcdText } from '@/components/IcdText';
import { isIcd11DocumentId } from '@/features/icd11/icd11-document';
import { SearchResultFragment } from '@/features/search/SearchResultFragment';
import { orderResultsForDisplay } from '@/features/search/search-result-presentation';
import { RESULT_TYPE_VISUALS, resultTypeVisual } from '@/features/search/searchResultKindVisuals';
import { pluralRu } from '@/i18n/labels';
import '@/features/search/search-result-group.css';

export function SearchResultGroupCard(props: {
  readonly group: SearchResultGroup;
  readonly index: number;
  readonly selectedChunkId: string | undefined;
  readonly action: JSX.Element;
  readonly onOpenDocument: (documentId: string) => void;
  readonly onOpenResult: (result: SearchResult) => void;
}): JSX.Element {
  // Resolved once: the first line of the header gives up room to the action only when it shows.
  const action = children(() => props.action);
  const kind = () =>
    isIcd11DocumentId(props.group.documentId)
      ? RESULT_TYPE_VISUALS.icd11
      : resultTypeVisual(props.group);
  // Only what changes how a hit should be read; storage details (pointer, summary, full text)
  // stay out of the result. A term found as itself is the card's type («Определение»).
  const contentLabel = (): string | undefined =>
    props.group.terminologyMatch === 'term-mention'
      ? 'Вхождение термина в источнике'
      : props.group.terminologyMatch === 'related-term'
        ? 'Смежное понятие MeSH — не клинический вывод'
        : undefined;
  const results = () => {
    const ordered = orderResultsForDisplay(props.group.results);
    return props.group.documentKind === 'medication' ? ordered.slice(0, 3) : ordered;
  };
  const renderExcerpt = (result: SearchResult): JSX.Element => (
    <SearchResultFragment
      result={result}
      selected={props.selectedChunkId === result.chunkId}
      onOpen={() => props.onOpenResult(result)}
    />
  );
  return (
    <section class="result-group" data-document-id={props.group.documentId}>
      <div
        class="result-group__head"
        classList={{ 'result-group__head--with-action': action() !== undefined }}
      >
        <button
          type="button"
          class="result-group-header"
          onClick={() => props.onOpenDocument(props.group.documentId)}
        >
          <span
            class="result-group-header__index"
            classList={{ 'result-group-header__index--under-action': action() !== undefined }}
            aria-hidden="true"
          >
            {String(props.index + 1).padStart(2, '0')}
          </span>

          <span class="result-group-header__body">
            <span
              class="result-group-header__kind"
              classList={{ 'result-group-header__kind--with-action': action() !== undefined }}
            >
              <AppGlyph name={kind().icon} class="result-group-header__kind-icon" />
              <span class="result-group-header__kind-label">{kind().label}</span>
            </span>
            <Show when={contentLabel()}>
              {(label) => <span class="result-group-header__content-kind">{label()}</span>}
            </Show>
            <strong class="result-group-header__title">
              <IcdText text={props.group.title} />
            </strong>
          </span>
        </button>
        {action()}
      </div>
      <div class="result-group__snippets">
        <For each={results().slice(0, 1)}>{renderExcerpt}</For>
        <Show when={results().length > 1}>
          <Disclosure
            variant="inline"
            class="result-group__more"
            title={`Найдено ещё в ${results().length - 1} ${pluralRu(results().length - 1, 'фрагменте', 'фрагментах', 'фрагментах')}`}
          >
            <For each={results().slice(1)}>{renderExcerpt}</For>
          </Disclosure>
        </Show>
      </div>
    </section>
  );
}
