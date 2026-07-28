import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistoryEntry,
  SEARCH_HISTORY_EVENT,
  type SearchHistoryEntry,
} from '@/state/search-history';

const HISTORY_LIMIT = 12;
const CLOSE_DURATION_MS = 180;

interface SearchHistoryPanelProps {
  readonly onReplay: (entry: SearchHistoryEntry) => void;
}

const MODE_LABELS: Readonly<Record<SearchHistoryEntry['modeUsed'], string>> = {
  lexical: 'FTS5',
  semantic: 'VECTOR',
  hybrid: 'FTS5 + VECTOR',
};

const SCOPE_LABELS: Readonly<Record<SearchHistoryEntry['scope'], string>> = {
  diagnosis: 'Диагноз',
  guidelines: 'КР',
  medications: 'Препараты',
  legal: 'Право',
  all: 'Все источники',
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

export function SearchHistoryPanel(props: SearchHistoryPanelProps): JSX.Element {
  const [entries, setEntries] = createSignal<readonly SearchHistoryEntry[]>([]);
  const [open, setOpen] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = (): void => {
    setEntries(loadSearchHistory().slice(0, HISTORY_LIMIT));
  };
  const close = (): void => {
    if (!open() || closing()) return;
    setClosing(true);
    closeTimer = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_DURATION_MS);
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };

  onMount(() => {
    refresh();
    window.addEventListener(SEARCH_HISTORY_EVENT, refresh);
    window.addEventListener('keydown', handleKeyDown);
  });
  onCleanup(() => {
    window.removeEventListener(SEARCH_HISTORY_EVENT, refresh);
    window.removeEventListener('keydown', handleKeyDown);
    if (closeTimer) clearTimeout(closeTimer);
  });

  return (
    <>
      <button
        class="search-history-fab"
        type="button"
        aria-label={open() ? 'Скрыть историю поиска' : 'Показать историю поиска'}
        aria-expanded={open()}
        onClick={() => {
          if (open()) close();
          else setOpen(true);
        }}
      >
        <AppGlyph name="menu" />
      </button>

      <Show when={open()}>
        <div
          class="search-history-drawer-backdrop"
          classList={{ closing: closing() }}
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) close();
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
              <button type="button" aria-label="Закрыть историю" onClick={close}>
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
                            props.onReplay(entry);
                            close();
                          }}
                        >
                          <strong>{entry.query}</strong>
                          <small>
                            {formatDate(entry.createdAt)} · {entry.resultCount} док. ·{' '}
                            {SCOPE_LABELS[entry.scope]} · {MODE_LABELS[entry.modeUsed]}
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
