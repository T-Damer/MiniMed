import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistoryEntry,
  replaySearch,
  SEARCH_HISTORY_EVENT,
  type SearchHistoryEntry,
} from '@/state/search-history';

const HISTORY_LIMIT = 12;

const MODE_LABELS: Readonly<Record<SearchHistoryEntry['modeUsed'], string>> = {
  lexical: 'FTS5',
  semantic: 'VECTOR',
  hybrid: 'FTS5 + VECTOR',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function SearchHistoryPanel(): JSX.Element {
  const [entries, setEntries] = createSignal<readonly SearchHistoryEntry[]>([]);
  const [open, setOpen] = createSignal(false);

  const refresh = (): void => {
    setEntries(loadSearchHistory().slice(0, HISTORY_LIMIT));
  };

  onMount(() => {
    refresh();
    window.addEventListener(SEARCH_HISTORY_EVENT, refresh);
  });
  onCleanup(() => window.removeEventListener(SEARCH_HISTORY_EVENT, refresh));

  return (
    <>
      <button
        class="search-history-fab"
        type="button"
        aria-label={open() ? 'Скрыть историю поиска' : 'Показать историю поиска'}
        aria-expanded={open()}
        onClick={() => setOpen((current) => !current)}
      >
        <AppGlyph name="menu" />
      </button>

      <Show when={open()}>
        <div
          class="search-history-drawer-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <aside class="search-history-panel" aria-label="Недавние поисковые запросы">
            <header class="search-history-panel-header">
              <div>
                <span>
                  <AppGlyph name="history" />
                  Недавние запросы
                </span>
                <small>{entries().length}</small>
              </div>
              <button type="button" aria-label="Закрыть историю" onClick={() => setOpen(false)}>
                <AppGlyph name="close" />
              </button>
            </header>

            <div class="search-history-panel-body">
              <Show
                when={entries().length > 0}
                fallback={
                  <p class="search-history-panel-empty">
                    История появится после первого поиска и останется только на этом устройстве.
                  </p>
                }
              >
                <ol>
                  <For each={entries()}>
                    {(entry) => (
                      <li>
                        <button
                          class="search-history-panel-replay"
                          type="button"
                          title={entry.query}
                          onClick={() => {
                            replaySearch(entry.query);
                            setOpen(false);
                          }}
                        >
                          <strong>{entry.query}</strong>
                          <small>
                            {formatDate(entry.createdAt)} · {entry.resultCount} док. ·{' '}
                            {MODE_LABELS[entry.modeUsed]}
                          </small>
                        </button>
                        <button
                          class="search-history-panel-remove"
                          type="button"
                          aria-label={`Удалить запрос: ${entry.query}`}
                          onClick={() =>
                            setEntries(removeSearchHistoryEntry(entry.id).slice(0, HISTORY_LIMIT))
                          }
                        >
                          <AppGlyph name="close" />
                        </button>
                      </li>
                    )}
                  </For>
                </ol>
                <button
                  class="search-history-panel-clear"
                  type="button"
                  onClick={() => {
                    clearSearchHistory();
                    setEntries([]);
                  }}
                >
                  Очистить историю
                </button>
              </Show>
            </div>
          </aside>
        </div>
      </Show>
    </>
  );
}
