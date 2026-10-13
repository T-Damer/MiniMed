import type { CoreIdentityHit, MedicalCore, SearchResultGroup } from '@localmed/contracts';
import { createEffect, createSignal, For, type JSX, on, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { loadEtymology } from '@/features/reader-dictionary/etymology';
import {
  closeReaderDictionary,
  readerDictionaryRequest,
} from '@/features/reader-dictionary/reader-dictionary-state';
import {
  resolveSelectionTerm,
  type SelectionLookup,
} from '@/features/reader-dictionary/selection-term';
import { CoreIdentityMatches } from '@/features/search/CoreIdentityMatches';
import { selectDefinitionPreview } from '@/features/search/definition-preview';
import { openDocumentOverlay } from '@/state/document-navigation';
import { requestSearchEverywhere } from '@/state/search-history';
import '@/features/reader-dictionary/reader-dictionary.css';

const RESULTS_SHOWN = 5;

type LookupState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly lookup: SelectionLookup }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'error'; readonly message: string };

function firstAnchor(group: SearchResultGroup): string | null {
  return group.results[0]?.anchor ?? null;
}

/**
 * «Найти в словаре»: the definition preview of a word or phrase selected in a reader — the same
 * card search shows above its results (definition in the source's own words, its source, other
 * senses, «Подробнее») — with the entry's origin when the installed dictionary states one. A
 * selection no dictionary names shows the documents found for it and «Искать везде».
 */
export function ReaderDictionarySheet(props: {
  readonly core: MedicalCore | undefined;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [state, setState] = createSignal<LookupState>({ kind: 'loading' });
  // The last request stays on screen while the sheet plays its exit.
  const [shown, setShown] = createSignal(readerDictionaryRequest());
  const [origin, setOrigin] = createSignal<readonly string[]>([]);
  const [originError, setOriginError] = createSignal(false);
  let generation = 0;

  createEffect(
    on(
      () => [readerDictionaryRequest(), props.core] as const,
      ([request, core]) => {
        if (!request) return;
        setShown(request);
        const token = ++generation;
        setState({ kind: 'loading' });
        setOrigin([]);
        setOriginError(false);
        if (!core) {
          setState({ kind: 'error', message: 'Поиск ещё не готов.' });
          return;
        }
        void resolveSelectionTerm(request.text, (query) =>
          core.search({
            query,
            mode: 'lexical',
            analysisMode: 'lookup',
            filters: {},
            limit: 8,
            includeSuggestions: false,
          }),
        ).then(
          async (lookup) => {
            if (token !== generation) return;
            if (!lookup) {
              setState({ kind: 'invalid' });
              return;
            }
            setState({ kind: 'ready', lookup });
            const primary = selectDefinitionPreview(lookup.identities, lookup.matched)?.main
              .primary;
            if (!primary) return;
            try {
              const notes = await loadEtymology(core, primary);
              if (token === generation) setOrigin(notes.map((note) => note.statement));
            } catch {
              if (token === generation) setOriginError(true);
            }
          },
          (cause: unknown) => {
            if (token !== generation) return;
            setState({
              kind: 'error',
              message: cause instanceof Error ? cause.message : 'Не удалось выполнить поиск.',
            });
          },
        );
      },
    ),
  );

  const title = (): string => {
    const current = state();
    return current.kind === 'ready' ? current.lookup.text : (shown()?.text ?? 'Словарь');
  };
  const searchAll = (text: string): void => {
    closeReaderDictionary();
    requestSearchEverywhere(text);
  };
  const openGroup = (group: SearchResultGroup): void => {
    closeReaderDictionary();
    openDocumentOverlay(group.documentId, firstAnchor(group), { preferSummary: true });
  };

  return (
    <OverlayDialog
      open={readerDictionaryRequest() !== undefined}
      title={title()}
      onClose={closeReaderDictionary}
    >
      <div class="reader-dictionary" data-testid="reader-dictionary">
        <Show when={state().kind === 'loading'}>
          <p class="reader-dictionary__status" role="status" aria-label="Ищем в словаре">
            <span class="reader-dictionary__spinner" aria-hidden="true" />
          </p>
        </Show>
        <Show when={state().kind === 'invalid'}>
          <p class="reader-dictionary__status" role="status">
            Выделите слово или короткую фразу.
          </p>
        </Show>
        <Show
          when={(() => {
            const current = state();
            return current.kind === 'error' ? current.message : undefined;
          })()}
        >
          {(message) => (
            <p class="reader-dictionary__status reader-dictionary__status--error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={(() => {
            const current = state();
            return current.kind === 'ready' ? current.lookup : undefined;
          })()}
        >
          {(lookup) => (
            <>
              <Show when={lookup().correction}>
                {(correction) => (
                  <p class="reader-dictionary__note" data-testid="reader-dictionary-correction">
                    Показано по: {correction().correctedQuery}
                  </p>
                )}
              </Show>
              <Show
                when={lookup().identities.length > 0 && props.core}
                fallback={
                  <ResultsList
                    groups={lookup().groups}
                    text={lookup().text}
                    onOpen={openGroup}
                    onSearchAll={searchAll}
                  />
                }
              >
                {(core) => (
                  <>
                    <CoreIdentityMatches
                      hits={lookup().identities as readonly CoreIdentityHit[]}
                      query={lookup().matched}
                      groups={lookup().groups}
                      core={core() as MedicalCore}
                      onContentChanged={props.onContentChanged}
                    />
                    <Show when={origin().length > 0}>
                      <section class="reader-dictionary__origin" aria-label="Происхождение">
                        <h3 class="reader-dictionary__origin-title">Происхождение</h3>
                        <For each={origin()}>
                          {(statement) => (
                            <blockquote class="reader-dictionary__origin-text">
                              {statement}
                            </blockquote>
                          )}
                        </For>
                      </section>
                    </Show>
                    <Show when={originError()}>
                      <p class="reader-dictionary__note" role="alert">
                        Не удалось прочитать происхождение слова.
                      </p>
                    </Show>
                    <SearchAllButton text={lookup().text} onSearchAll={searchAll} />
                  </>
                )}
              </Show>
            </>
          )}
        </Show>
      </div>
    </OverlayDialog>
  );
}

function SearchAllButton(props: {
  readonly text: string;
  readonly onSearchAll: (text: string) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="reader-dictionary__action"
      data-testid="reader-dictionary-search-all"
      onClick={() => props.onSearchAll(props.text)}
    >
      <AppGlyph name="search" class="reader-dictionary__action-icon" />
      Искать везде
    </button>
  );
}

function ResultsList(props: {
  readonly groups: readonly SearchResultGroup[];
  readonly text: string;
  readonly onOpen: (group: SearchResultGroup) => void;
  readonly onSearchAll: (text: string) => void;
}): JSX.Element {
  return (
    <>
      <p class="reader-dictionary__note" data-testid="reader-dictionary-empty">
        В словаре нет определения.
      </p>
      <Show when={props.groups.length > 0}>
        <ul class="reader-dictionary__results" aria-label="Найдено в документах">
          <For each={props.groups.slice(0, RESULTS_SHOWN)}>
            {(group) => (
              <li class="reader-dictionary__result-item">
                <button
                  type="button"
                  class="reader-dictionary__result"
                  onClick={() => props.onOpen(group)}
                >
                  <span class="reader-dictionary__result-title">{group.title}</span>
                  <Show when={group.results[0]?.snippet}>
                    {(snippet) => (
                      <span class="reader-dictionary__result-snippet">
                        {snippet().replace(/^…\s*/u, '')}
                      </span>
                    )}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <SearchAllButton text={props.text} onSearchAll={props.onSearchAll} />
    </>
  );
}
