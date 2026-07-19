import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, Match, onCleanup, onMount, Show, Switch } from 'solid-js';

import { createBrowserCore } from '../composition/create-browser-core';
import { DocumentLibrary } from '../features/library/DocumentLibrary';
import { SearchWorkspace } from '../features/search/SearchWorkspace';
import { StatusPanel } from '../features/status/StatusPanel';

type View = 'search' | 'documents' | 'status';

interface ReadyState {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
}

const VIEW_LABELS: Readonly<Record<View, { number: string; title: string }>> = {
  search: { number: '01', title: 'Поиск' },
  documents: { number: '02', title: 'Архив' },
  status: { number: '03', title: 'Система' },
};

export function App(): JSX.Element {
  const [view, setView] = createSignal<View>('search');
  const [ready, setReady] = createSignal<ReadyState>();
  const [error, setError] = createSignal<string>();
  let coreToClose: MedicalCore | undefined;

  onMount(async () => {
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

  return (
    <div class="app-shell archive-app">
      <header class="topbar archive-rail">
        <button class="brand archive-brand" type="button" onClick={() => setView('search')}>
          <span class="brand-monogram" aria-hidden="true">
            LM
          </span>
          <span class="brand-copy">
            <small>ЛОКАЛЬНАЯ МЕДИЦИНСКАЯ</small>
            <strong>КАРТОТЕКА</strong>
          </span>
          <span class="brand-index">ПИЛОТ РФ</span>
        </button>

        <nav class="archive-tabs" aria-label="Основная навигация">
          {(Object.entries(VIEW_LABELS) as [View, { number: string; title: string }][]).map(
            ([key, item]) => (
              <button
                classList={{ active: view() === key }}
                type="button"
                onClick={() => setView(key)}
              >
                <span>{item.number}</span>
                {item.title}
              </button>
            ),
          )}
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
          <main>
            <Switch>
              <Match when={view() === 'search'}>
                <SearchWorkspace core={state().core} />
              </Match>
              <Match when={view() === 'documents'}>
                <DocumentLibrary core={state().core} />
              </Match>
              <Match when={view() === 'status'}>
                <StatusPanel core={state().core} initialStatus={state().status} />
              </Match>
            </Switch>
          </main>
        )}
      </Show>

      <footer class="footer-note archive-footer">
        <span>MINIMED / BUILD 0.3.0-alpha.5</span>
        <span>Публичный пилот: краткие карточки по КР · сверяйте актуальный первоисточник</span>
        <span>OFFLINE FIRST / RETRIEVAL BEFORE GENERATION</span>
      </footer>
    </div>
  );
}
