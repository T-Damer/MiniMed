import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '../components/AppGlyph';
import { BrandMark } from '../components/BrandMark';
import { createBrowserCore } from '../composition/create-browser-core';
import { SearchHistoryView } from '../features/history/SearchHistoryView';
import { DocumentLibrary } from '../features/library/DocumentLibrary';
import { SearchWorkspace } from '../features/search/SearchWorkspace';
import { StatusPanel } from '../features/status/StatusPanel';
import { replaySearch } from '../state/search-history';

type View = 'search' | 'documents' | 'history' | 'status';

interface ReadyState {
  readonly core: MedicalCore;
  readonly status: CoreStatus;
}

const VIEWS: readonly {
  readonly id: View;
  readonly label: string;
  readonly icon: AppGlyphName;
}[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'documents', label: 'Архив и граф', icon: 'archive' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'status', label: 'Система', icon: 'system' },
];

function viewFromLocation(): View {
  const value = window.location.hash.replace(/^#\/?/u, '');
  return VIEWS.some((item) => item.id === value) ? (value as View) : 'search';
}

export function App(): JSX.Element {
  const [view, setView] = createSignal<View>(viewFromLocation());
  const [ready, setReady] = createSignal<ReadyState>();
  const [error, setError] = createSignal<string>();
  let coreToClose: MedicalCore | undefined;

  const navigate = (next: View): void => {
    setView(next);
    window.history.replaceState({ view: next }, '', `#/${next}`);
  };

  const handleHashChange = (): void => {
    setView(viewFromLocation());
  };

  onMount(async () => {
    window.addEventListener('hashchange', handleHashChange);
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
    window.removeEventListener('hashchange', handleHashChange);
    if (coreToClose) void coreToClose.close();
  });

  return (
    <div class="app-shell archive-app">
      <header class="app-topbar">
        <button class="app-brand-button" type="button" onClick={() => navigate('search')}>
          <BrandMark class="app-brand-mark" />
          <span class="app-brand-copy">
            <strong>MiniMed</strong>
            <small>локальная медицинская картотека</small>
          </span>
        </button>

        <nav class="app-nav-icons" aria-label="Разделы приложения">
          {VIEWS.map((item) => (
            <button
              class="app-nav-button"
              classList={{ active: view() === item.id }}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={() => navigate(item.id)}
            >
              <AppGlyph name={item.icon} />
            </button>
          ))}
        </nav>

        <div class="app-core-indicator" title={ready() ? 'Локальное ядро готово' : error() ?? 'Запуск'}>
          <i />
          <span>{ready() ? 'локально' : error() ? 'ошибка' : 'запуск'}</span>
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
            </div>
          </main>
        }
      >
        {(state) => (
          <main class="app-main">
            <section class="app-view" hidden={view() !== 'search'} aria-hidden={view() !== 'search'}>
              <SearchWorkspace core={state().core} />
            </section>
            <section
              class="app-view"
              hidden={view() !== 'documents'}
              aria-hidden={view() !== 'documents'}
            >
              <DocumentLibrary core={state().core} />
            </section>
            <section class="app-view" hidden={view() !== 'history'} aria-hidden={view() !== 'history'}>
              <SearchHistoryView
                onReplay={(query) => {
                  navigate('search');
                  requestAnimationFrame(() => replaySearch(query));
                }}
              />
            </section>
            <section class="app-view" hidden={view() !== 'status'} aria-hidden={view() !== 'status'}>
              <StatusPanel core={state().core} initialStatus={state().status} />
            </section>
          </main>
        )}
      </Show>
    </div>
  );
}
