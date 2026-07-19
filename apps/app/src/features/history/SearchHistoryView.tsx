import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '../../components/AppGlyph';
import {
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistoryEntry,
  type SearchHistoryEntry,
  SEARCH_HISTORY_EVENT,
} from '../../state/search-history';

interface SearchHistoryViewProps {
  readonly onReplay: (query: string) => void;
}

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

export function SearchHistoryView(props: SearchHistoryViewProps): JSX.Element {
  const [entries, setEntries] = createSignal<readonly SearchHistoryEntry[]>([]);

  const refresh = (): void => setEntries(loadSearchHistory());

  onMount(() => {
    refresh();
    window.addEventListener(SEARCH_HISTORY_EVENT, refresh);
  });

  onCleanup(() => window.removeEventListener(SEARCH_HISTORY_EVENT, refresh));

  return (
    <section class="history-view page-surface" aria-label="История поиска">
      <header class="subpage-heading">
        <div>
          <p class="archive-kicker">Локальный журнал</p>
          <h1>История поиска</h1>
          <p>Запросы хранятся только на этом устройстве. Клинический текст не отправляется в сеть.</p>
        </div>
        <Show when={entries().length > 0}>
          <button
            class="subtle-action"
            type="button"
            onClick={() => {
              clearSearchHistory();
              setEntries([]);
            }}
          >
            Очистить журнал
          </button>
        </Show>
      </header>

      <Show
        when={entries().length > 0}
        fallback={
          <div class="history-empty paper-card">
            <AppGlyph name="history" />
            <h2>Журнал пока пуст</h2>
            <p>После первого поиска здесь появятся запрос, время, число найденных документов и режим.</p>
          </div>
        }
      >
        <div class="history-list" role="list">
          <For each={entries()}>
            {(entry, index) => (
              <article class="history-entry paper-card" role="listitem">
                <button class="history-replay" type="button" onClick={() => props.onReplay(entry.query)}>
                  <span class="history-sequence">{String(index() + 1).padStart(2, '0')}</span>
                  <span class="history-copy">
                    <strong>{entry.query}</strong>
                    <small>
                      {formatDate(entry.createdAt)} · {entry.resultCount} док. · {MODE_LABELS[entry.modeUsed]}
                    </small>
                  </span>
                  <span class="history-arrow" aria-hidden="true">↗</span>
                </button>
                <button
                  class="history-remove"
                  type="button"
                  aria-label="Удалить запись"
                  onClick={() => setEntries(removeSearchHistoryEntry(entry.id))}
                >
                  <AppGlyph name="close" />
                </button>
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
