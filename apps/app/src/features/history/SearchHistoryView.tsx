import { For, type JSX, Show } from 'solid-js';

import type { SearchHistoryEntry } from './search-history';

interface SearchHistoryViewProps {
  readonly entries: readonly SearchHistoryEntry[];
  readonly onOpen: (query: string) => void;
  readonly onClear: () => void;
}

const MODE_LABELS: Readonly<Record<SearchHistoryEntry['modeUsed'], string>> = {
  lexical: 'FTS5',
  semantic: 'VECTOR',
  hybrid: 'FTS5 + VECTOR',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function SearchHistoryView(props: SearchHistoryViewProps): JSX.Element {
  return (
    <section class="history-page archive-status-page" aria-labelledby="history-title">
      <div class="folder-tab">ЖУРНАЛ / ПОИСКИ</div>
      <header class="history-page-heading">
        <div>
          <p class="archive-kicker">Локально на устройстве</p>
          <h1 id="history-title">История поиска</h1>
          <p>
            Запросы не синхронизируются и не отправляются в сеть. Откройте запись, чтобы продолжить
            поиск с тем же текстом.
          </p>
        </div>
        <Show when={props.entries.length > 0}>
          <button class="history-clear" type="button" onClick={props.onClear}>
            Очистить журнал
          </button>
        </Show>
      </header>

      <Show
        when={props.entries.length > 0}
        fallback={
          <div class="history-empty paper-card">
            <span>LM–LOG</span>
            <h2>Журнал пока пуст</h2>
            <p>Выполненные поиски появятся здесь с режимом и количеством найденных документов.</p>
          </div>
        }
      >
        <div class="history-ledger-list">
          <For each={props.entries}>
            {(entry, index) => (
              <button class="history-ledger-entry" type="button" onClick={() => props.onOpen(entry.query)}>
                <span class="history-entry-index">{String(index() + 1).padStart(2, '0')}</span>
                <span class="history-entry-copy">
                  <strong>{entry.query}</strong>
                  <small>{formatDate(entry.searchedAt)}</small>
                </span>
                <span class="history-entry-metrics">
                  <b>{entry.resultCount} док.</b>
                  <small>{MODE_LABELS[entry.modeUsed]}</small>
                </span>
                <span class="history-entry-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
