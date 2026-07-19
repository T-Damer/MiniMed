import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { createBrowserCore } from '../composition/create-browser-core';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import {
  clearSearchHistory,
  readSearchHistory,
  recordSearchHistory,
  type SearchHistoryEntry,
} from '../features/history/search-history';
import { SearchHistoryView } from '../features/history/SearchHistoryView';
import { DocumentLibrary } from '../features/library/DocumentLibrary';
import { SearchWorkspace, type SearchRestoreRequest } from '../features/search/SearchWorkspace';
import { StatusPanel } from '../features/status/StatusPanel';

type View = 'search' | 'documents' | 'history' | 'status';

interface ReadyState {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
}

interface ViewLabel {
  readonly title: string;
  readonly icon: NavIconName;
}

const VIEW_LABELS: Readonly<Record<View, ViewLabel>> = {
  search: { title: 'Поиск', icon: 'search' },
  documents: { title: 'Архив', icon: 'archive' },
  history: { title: 'История', icon: 'history' },
  status: { title: 'Система', icon: 'status' },
};

export function App(): JSX.Element {
  const [view, setView] = createSignal<View>('search');
  const [ready, setReady] = createSignal<ReadyState>();
  const [error, setError] = createSignal<string>();
  const [history, setHistory] = createSignal<readonly SearchHistoryEntry[]>([]);
  const [restoreRequest, setRestoreRequest] = createSignal<SearchRestoreRequest>();
  let restoreSequence = 0;
  let coreToClose: MedicalCore | undefined;

  onMount(async () => {
    setHistory(readSearchHistory());
    try {
      const core = await createBrowserCore();
      coreToClose = core;
      const initialized = await core.initialize();
      if (!initialized.ok) {
        setError(initialized.error.message);
        return;
      }
      setReady({ core, status: initialized.value });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось запустить локальное ядро.');
    }
  });

  onCleanup(() => {
    if (coreToClose) void coreToClose.close();
  });

  function recordHistory(input: Omit<SearchHistoryEntry, 'id' | 'searchedAt'>): void {
    setHistory((current) => recordSearchHistory(current, input));
  }

  function openHistoryQuery(query: string): void {
    restoreSequence += 1;
    setRestoreRequest({ id: restoreSequence, query });
    setView('search');
  }

  return (
    <div class="app-shell archive-app">
      <header class="topbar archive-rail">
        <button class="brand archive-brand" type="button" onClick={() => setView('search')}>
          <img class="brand-icon" src="./favicon.svg" alt="" aria-hidden="true" />
          <span class="brand-copy">
            <small>ЛОКАЛЬНАЯ МЕДИЦИНСКАЯ</small>
            <strong>КАРТОТЕКА</strong>
          </span>
          <span class="brand-index">ПИЛОТ РФ</span>
        </button>

        <nav class="archive-tabs icon-tabs" aria-label="Основная навигация">
          <For each={Object.entries(VIEW_LABELS) as [View, ViewLabel][] }>
            {([key, item]) => (
              <button
                classList={{ active: view() === key }}
                type="button"
                title={item.title}
                aria-label={item.title}
                aria-current={view() === key ? 'page' : undefined}
                onClick={() => setView(key)}
              >
                <NavIcon name={item.icon} />
                <span>{item.title}</span>
              </button>
            )}
          </For>
        </nav>

        <div class="status-pill archive-status">
          <span class="status-dot" />
          <span>
            <small>ЯДРО</small>
            <strong>{ready() ? 'ГОТОВО' : error() ? 'ОШИБКА' : 'ЗАПУСК'}</strong>
          </span>
        </div>
      </header>

      <Show
        when={ready()}
        fallback={
          <main class="boot-screen archive-boot">
            <div class="boot-card paper-sheet">
              <span class="boot-spinner" />
              <p class="archive-kicker">SQLITE / FTS5 / PUBLIC PILOT</p>
              <h1>{error() ? 'Архив не открылся' : 'Открываем локальный фонд…'}</h1>
              <p>
                {error() ?? 'Загружаем скомпилированную базу и проверяем полнотекстовый индекс.'}
              </p>
              <div class="boot-ledger" aria-hidden="true">
                <span>SCHEMA</span>
                <b>02</b>
                <span>MODE</span>
                <b>LOCAL</b>
                <span>NETWORK</span>
                <b>NOT REQUIRED</b>
              </div>
            </div>
          </main>
        }
      >
        {(state) => (
          <main class="app-content">
            <div class="app-view" hidden={view() !== 'search'}>
              <SearchWorkspace
                core={state().core}
                history={history()}
                restoreRequest={restoreRequest()}
                onHistoryEntry={recordHistory}
              />
            </div>
            <div class="app-view" hidden={view() !== 'documents'}>
              <DocumentLibrary core={state().core} />
            </div>
            <div class="app-view" hidden={view() !== 'history'}>
              <SearchHistoryView
                entries={history()}
                onOpen={openHistoryQuery}
                onClear={() => setHistory(clearSearchHistory())}
              />
            </div>
            <div class="app-view" hidden={view() !== 'status'}>
              <StatusPanel core={state().core} initialStatus={state().status} />
            </div>
          </main>
        )}
      </Show>

      <footer class="footer-note archive-footer">
        <span>MINIMED / BUILD 0.3.0-alpha.5</span>
        <span>Публичный пилот · локальный поиск · сверяйте первоисточник</span>
        <span>OFFLINE FIRST</span>
      </footer>
    </div>
  );
}
