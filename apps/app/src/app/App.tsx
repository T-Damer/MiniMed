import type { CoreStatus, MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '../components/AppGlyph';
import { BrandMark } from '../components/BrandMark';
import { createBrowserCore } from '../composition/create-browser-core';
import { SearchHistoryView } from '../features/history/SearchHistoryView';
import { DocumentLibrary } from '../features/library/DocumentLibrary';
import { refreshContentModuleCatalog } from '../features/modules/catalog-service';
import { ModuleCatalogView } from '../features/modules/ModuleCatalogView';
import { SearchWorkspace } from '../features/search/SearchWorkspace';
import { StatusPanel } from '../features/status/StatusPanel';
import { replaySearch } from '../state/search-history';

type View = 'search' | 'documents' | 'modules' | 'history' | 'status';

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
  { id: 'documents', label: 'Архив и карта', icon: 'archive' },
  { id: 'modules', label: 'Модули знаний', icon: 'modules' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'status', label: 'Система', icon: 'system' },
];

function viewFromLocation(): View {
  const value = window.location.hash.replace(/^#\/?/u, '');
  return VIEWS.some((item) => item.id === value) ? (value as View) : 'search';
}

function availableModuleCount(modules: readonly { releaseState: string }[]): number {
  return modules.filter((module) => module.releaseState === 'published').length;
}

export function App(): JSX.Element {
  const [view, setView] = createSignal<View>(viewFromLocation());
  const [ready, setReady] = createSignal<ReadyState>();
  const [error, setError] = createSignal<string>();
  const [moduleUpdateCount, setModuleUpdateCount] = createSignal(0);
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  let coreToClose: MedicalCore | undefined;

  const navigate = (next: View): void => {
    setView(next);
    if (next === 'modules') setModuleUpdateCount(0);
    window.history.replaceState({ view: next }, '', `#/${next}`);
  };

  const handleHashChange = (): void => {
    const next = viewFromLocation();
    setView(next);
    if (next === 'modules') setModuleUpdateCount(0);
  };

  const handleScroll = (): void => setShowScrollTop(window.scrollY > 560);

  onMount(async () => {
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    try {
      const core = await createBrowserCore();
      coreToClose = core;
      const initialized = await core.initialize();
      if (!initialized.ok) {
        setError(initialized.error.message);
        return;
      }
      setReady({ core, status: initialized.value });
      void refreshContentModuleCatalog()
        .then((result) => {
          if (view() !== 'modules') setModuleUpdateCount(availableModuleCount(result.catalog.modules));
        })
        .catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось запустить локальное ядро.');
    }
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
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
              <Show when={item.id === 'modules' && moduleUpdateCount() > 0}>
                <span class="app-nav-badge" aria-label={`Обновлений модулей: ${moduleUpdateCount()}`}>
                  {moduleUpdateCount() > 9 ? '9+' : moduleUpdateCount()}
                </span>
              </Show>
            </button>
          ))}
        </nav>

        <div
          class="app-core-indicator"
          title={ready() ? 'Локальное ядро готово' : (error() ?? 'Запуск')}
        >
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
            <section
              class="app-view"
              hidden={view() !== 'search'}
              aria-hidden={view() !== 'search'}
            >
              <SearchWorkspace core={state().core} />
            </section>
            <section
              class="app-view"
              hidden={view() !== 'documents'}
              aria-hidden={view() !== 'documents'}
            >
              <DocumentLibrary core={state().core} />
            </section>
            <section
              class="app-view"
              hidden={view() !== 'modules'}
              aria-hidden={view() !== 'modules'}
            >
              <ModuleCatalogView
                status={state().status}
                active={view() === 'modules'}
                onAvailableUpdates={(count) => {
                  if (view() !== 'modules') setModuleUpdateCount(count);
                }}
              />
            </section>
            <section
              class="app-view"
              hidden={view() !== 'history'}
              aria-hidden={view() !== 'history'}
            >
              <SearchHistoryView
                onReplay={(query) => {
                  navigate('search');
                  requestAnimationFrame(() => replaySearch(query));
                }}
              />
            </section>
            <section
              class="app-view"
              hidden={view() !== 'status'}
              aria-hidden={view() !== 'status'}
            >
              <StatusPanel core={state().core} initialStatus={state().status} />
            </section>
          </main>
        )}
      </Show>

      <Show when={showScrollTop()}>
        <button
          class="scroll-top-button"
          type="button"
          aria-label="Вернуться наверх"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <AppGlyph name="arrow-up" />
        </button>
      </Show>
    </div>
  );
}
