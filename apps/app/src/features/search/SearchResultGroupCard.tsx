import type { SearchResult, SearchResultGroup } from '@localmed/contracts';
import { children, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Disclosure } from '@/components/Disclosure';
import { IcdText } from '@/components/IcdText';
import { isIcd11DocumentId } from '@/features/icd11/icd11-document';
import { AtcMatchBadge } from '@/features/medications/AtcMatchBadge';
import { SearchResultFragment } from '@/features/search/SearchResultFragment';
import {
  orderResultsForDisplay,
  softBreakPluses,
  splitResultTitle,
} from '@/features/search/search-result-presentation';
import { RESULT_TYPE_VISUALS, resultTypeVisual } from '@/features/search/searchResultKindVisuals';
import { pluralRu } from '@/i18n/labels';
import '@/features/search/search-result-group.css';

export function SearchResultGroupCard(props: {
  readonly group: SearchResultGroup;
  readonly index: number;
  readonly selectedChunkId: string | undefined;
  readonly action: JSX.Element;
  /** Tells this card from another of the same title (publisher, edition); unset on a unique card. */
  readonly qualifier?: string | undefined;
  /** `anchor` is the place of the best match: the reader opens there, not at the top. */
  readonly onOpenDocument: (documentId: string, anchor?: string | null) => void;
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
  const title = () => splitResultTitle(props.group.title);
  const hasMeta = () =>
    title().meta !== undefined ||
    contentLabel() !== undefined ||
    props.group.atcMatch !== undefined ||
    props.qualifier !== undefined;
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
  // A drug opens on its own screen and a catalogue pointer holds no text of the document (its
  // anchors are the pointer's); every other document opens at the fragment that was found.
  const openingAnchor = (): string | null =>
    props.group.documentKind === 'medication' || props.group.contentKind === 'pointer'
      ? null
      : (results()[0]?.anchor ?? null);
  const moreCount = () => results().length - 1;
  return (
    <section class="result-group" data-document-id={props.group.documentId}>
      <button
        type="button"
        class="result-group-header"
        onClick={() => props.onOpenDocument(props.group.documentId, openingAnchor())}
      >
        <span class="result-group-header__index" aria-hidden="true">
          {String(props.index + 1).padStart(2, '0')}
        </span>

        <span class="result-group-header__body">
          <span class="result-group-header__kind">
            <AppGlyph name={kind().icon} class="result-group-header__kind-icon" />
            <span class="result-group-header__kind-label">{kind().label}</span>
          </span>
          <strong class="result-group-header__title">
            <IcdText text={softBreakPluses(title().title)} />
          </strong>
          <Show when={hasMeta()}>
            <span class="result-group-header__meta">
              <Show when={title().meta}>
                {(meta) => <span class="result-group-header__meta-item">{meta()}</span>}
              </Show>
              <Show when={contentLabel()}>
                {(label) => <span class="result-group-header__meta-item">{label()}</span>}
              </Show>
              <Show when={props.qualifier}>
                {(qualifier) => <span class="result-group-header__meta-item">{qualifier()}</span>}
              </Show>
              <Show when={props.group.atcMatch}>
                {(match) => <AtcMatchBadge class="result-group-header__atc" match={match()} />}
              </Show>
            </span>
          </Show>
        </span>
      </button>
      <div class="result-group__snippets">
        <For each={results().slice(0, 1)}>{renderExcerpt}</For>
      </div>
      <Show
        when={moreCount() > 0}
        fallback={
          <Show when={action() !== undefined}>
            <div class="result-group__foot">{action()}</div>
          </Show>
        }
      >
        <Disclosure
          variant="inline"
          class="result-group__more"
          action={action()}
          title={`Ещё ${moreCount()} ${pluralRu(moreCount(), 'фрагмент', 'фрагмента', 'фрагментов')}`}
        >
          <For each={results().slice(1)}>{renderExcerpt}</For>
        </Disclosure>
      </Show>
    </section>
  );
}
