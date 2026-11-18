import type { SearchResult, SearchResultGroup } from '@localmed/contracts';
import { createMemo, createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { IcdText } from '@/components/IcdText';
import { ListRow } from '@/components/ListRow';
import { isIcd11DocumentId } from '@/features/icd11/icd11-document';
import { AtcMatchBadge } from '@/features/medications/AtcMatchBadge';
import { SearchResultFragment } from '@/features/search/SearchResultFragment';
import {
  orderResultsForDisplay,
  softBreakPluses,
  splitResultTitle,
} from '@/features/search/search-result-presentation';
import {
  RESULT_ROW_TONES,
  RESULT_TYPE_VISUALS,
  resultTypeVisual,
} from '@/features/search/searchResultKindVisuals';
import { browserI18n } from '@/i18n';
import '@/features/search/search-result-group.css';

/** Another source of the same name, listed under the card that leads it. */
export interface ResultSource {
  readonly documentId: string;
  readonly icon: AppGlyphName;
  readonly label: string;
}

export function SearchResultGroupCard(props: {
  readonly group: SearchResultGroup;
  readonly selectedChunkId: string | undefined;
  readonly action: JSX.Element;
  readonly qualifier?: string | undefined;
  readonly source?: string | undefined;
  readonly onOpenDocument: (documentId: string, anchor?: string | null) => void;
  readonly sources?: readonly ResultSource[] | undefined;
  readonly inText?: boolean | undefined;
  readonly loadContext?: ((result: SearchResult) => Promise<string | undefined>) | undefined;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const excerptId = createUniqueId();
  const kind = () =>
    isIcd11DocumentId(props.group.documentId)
      ? RESULT_TYPE_VISUALS.icd11
      : resultTypeVisual(props.group);
  const title = () => splitResultTitle(props.group.title);
  const best = createMemo(() => orderResultsForDisplay(props.group.results)[0]);
  const open = (): void => {
    const anchor =
      props.group.documentKind === 'medication' || props.group.contentKind === 'pointer'
        ? null
        : (best()?.anchor ?? null);
    props.onOpenDocument(props.group.documentId, anchor);
  };
  const sources = (): JSX.Element => (
    <Show when={props.sources?.length ? props.sources : undefined}>
      {(entries) => (
        <ul class="result-group__sources" aria-label="Другие источники">
          <For each={entries()}>
            {(entry) => (
              <li class="result-group__source-item">
                <button
                  type="button"
                  class="result-group__source"
                  data-document-id={entry.documentId}
                  onClick={() => props.onOpenDocument(entry.documentId, null)}
                >
                  <AppGlyph name={entry.icon} class="result-group__source-icon" />
                  <span class="result-group__source-label">{entry.label}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      )}
    </Show>
  );
  const subtitle = () => (
    <>
      <span class="result-group-header__kind-label">{kind().label}</span>
      <Show when={title().meta || props.qualifier}>
        {' '}
        · {[title().meta, props.qualifier].filter(Boolean).join(' · ')}
      </Show>
      <Show when={props.group.atcMatch}>
        {(match) => <AtcMatchBadge class="result-group-header__atc" match={match()} />}
      </Show>
    </>
  );
  return (
    <ListRow
      class="result-group search-result-item"
      mainClass="result-group-header search-result-item__open"
      data-document-id={props.group.documentId}
      data-testid="search-result"
      icon={kind().icon}
      tone={RESULT_ROW_TONES[props.group.documentKind ?? 'reference']}
      title={
        <strong class="result-group-header__title search-result-item__title">
          <IcdText text={softBreakPluses(title().title)} />
        </strong>
      }
      subtitle={props.inText ? undefined : subtitle()}
      selected={best() !== undefined && props.selectedChunkId === best()?.chunkId}
      onClick={open}
      action={
        props.inText && best() ? (
          <button
            type="button"
            class="search-result-item__disclosure"
            aria-controls={excerptId}
            aria-expanded={expanded()}
            aria-label={browserI18n.getMessage(
              expanded() ? 'search_hide_excerpt' : 'search_show_excerpt',
              title().title,
            )}
            onClick={() => setExpanded((open) => !open)}
          >
            <AppGlyph
              name="caret-down"
              class={`search-result-item__disclosure-icon${expanded() ? ' search-result-item__disclosure-icon--open' : ''}`}
            />
          </button>
        ) : (
          props.action
        )
      }
      details={
        props.inText ? (
          <div id={excerptId} class="search-result-item__details" hidden={!expanded()}>
            <Show when={expanded() ? best() : undefined}>
              {(result) => (
                <SearchResultFragment
                  result={result()}
                  source={props.source ?? kind().label}
                  loadContext={props.loadContext}
                />
              )}
            </Show>
            <Show when={expanded()}>
              {sources()}
              <Show when={props.action}>
                <div class="search-result-item__detail-action">{props.action}</div>
              </Show>
            </Show>
          </div>
        ) : props.sources?.length ? (
          sources()
        ) : undefined
      }
    />
  );
}
