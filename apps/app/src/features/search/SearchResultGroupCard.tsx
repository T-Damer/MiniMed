import type { SearchResult, SearchResultGroup } from '@localmed/contracts';
import { children, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
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
}): JSX.Element {
  // Resolved once: the header row gives up room to the action only when it shows.
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
  // One finding per result (owner 2026-10-20): the best fragment, and a tap opens the document.
  const best = (): SearchResult | undefined => orderResultsForDisplay(props.group.results)[0];
  // A drug opens on its own screen and a catalogue pointer holds no text of the document (its
  // anchors are the pointer's); every other document opens at the fragment that was found.
  const openingAnchor = (): string | null =>
    props.group.documentKind === 'medication' || props.group.contentKind === 'pointer'
      ? null
      : (best()?.anchor ?? null);
  const open = (): void => props.onOpenDocument(props.group.documentId, openingAnchor());
  const hasAction = () => action() !== undefined;
  return (
    <section class="result-group" data-document-id={props.group.documentId}>
      {/* The download offer sits in the header row, beside the button that opens the document. */}
      <div class="result-group__head">
        <button
          type="button"
          class="result-group-header result-group-header--in-head"
          onClick={open}
        >
          <span
            class="result-group-header__index"
            classList={{ 'result-group-header__index--under-action': hasAction() }}
            aria-hidden="true"
          >
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
        <Show when={hasAction()}>
          <div class="result-group__head-action">{action()}</div>
        </Show>
      </div>
      <Show when={best()}>
        {(result) => (
          <div class="result-group__snippets">
            <SearchResultFragment
              result={result()}
              selected={props.selectedChunkId === result().chunkId}
              onOpen={open}
            />
          </div>
        )}
      </Show>
    </section>
  );
}
