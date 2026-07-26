import type { MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { createBrowserCore } from '@/composition/create-browser-core';
import {
  type InitializedMedicalCore,
  initializeMedicalCore,
  swapMedicalCore,
} from '@/composition/medical-core-lifecycle';
import { KnowledgeBaseView } from '@/features/knowledge/KnowledgeBaseView';
import { DocumentOverlayHost } from '@/features/library/DocumentOverlayHost';
import { LocalModelController } from '@/features/models/controller';
import { GroundedMedicalCore } from '@/features/models/GroundedMedicalCore';
import { ModelNavIndicator } from '@/features/models/ModelNavIndicator';
import { ModelSettings } from '@/features/models/ModelSettings';
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { NotesView } from '@/features/notes/NotesView';
import { SearchHome } from '@/features/search/SearchHome';
import { StatusPanel } from '@/features/status/StatusPanel';
import { notifyContentChanged } from '@/state/content-events';

type View = 'search' | 'modules' | 'notes' | 'status';

const VIEWS: readonly {
  readonly id: View;
  readonly label: string;
  readonly icon: AppGlyphName;
}[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'modules', label: 'База знаний', icon: 'modules' },
  { id: 'notes', label: 'Заметки', icon: 'notes' },
  { id: 'status', label: 'Настройки', icon: 'brain' },
];

const DEFAULT_MODEL_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/models/catalog.preview.json';
const DEFAULT_MODEL_ASSET_BASE_URL = '';

function viewFromLocation(): View {
  const value = window.location.hash.replace(/^#\/?/u, '');
  if (value === 'documents') return 'modules';
  if (value === 'history') return 'search';
  return VIEWS.some((item) => item.id === value) ? (value as View) : 'search';
}

function countAvailableModules(
  modules: readonly { releaseState: string; tags: readonly string[] }[],
): number {
  return modules.filter(
    (module) =>
      module.releaseState === 'published' && !module.tags.includes('individual-recommendation'),
  ).length;
}

function environmentFlag(name: string, fallback: boolean): boolean {
  const value = import.meta.env[name]?.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function createLocalModelController(): LocalModelController {
  const configuredCatalogUrl = import.meta.env.VITE_LOCAL_MODEL_CATALOG_URL?.trim();
  const remoteCatalogUrl =
    configuredCatalogUrl === 'bundled' ? '' : configuredCatalogUrl || DEFAULT_MODEL_CATALOG_URL;
  const mirrorBaseUrl =
    import.meta.env.VITE_LOCAL_MODEL_ASSET_BASE_URL?.trim() || DEFAULT_MODEL_ASSET_BASE_URL;
  return new LocalModelController({
    remoteCatalogUrl,
    mirrorBaseUrl,
    allowUpstreamFallback: environmentFlag('VITE_LOCAL_MODEL_ALLOW_UPSTREAM', true),
    allowAutomationDownloads: environmentFlag('VITE_LOCAL_MODEL_ALLOW_AUTOMATION_DOWNLOADS', false),
    defaultAutoLoad: environmentFlag('VITE_LOCAL_MODEL_AUTOLOAD', true),
  });
}

export function App(): JSX.Element {
  const [view, setView] = createSignal<View>(viewFromLocation());
  const [ready, setReady] = createSignal<InitializedMedicalCore>();
  const [error, setError] = createSignal<string>();
  const [availableModuleCount, setAvailableModuleCount] = createSignal(0);
  const [downloadedModuleCount, setDownloadedModuleCount] = createSignal(0);
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  const modelController = createLocalModelController();
  const [assistantCore, setAssistantCore] = createSignal<GroundedMedicalCore>();
  let coreToClose: MedicalCore | undefined;
  let unsubscribeInstalledModules: (() => void) | undefined;
  let unsubscribeModuleRuntime: (() => void) | undefined;

  const navigate = (next: View): void => {
    setView(next);
    window.history.replaceState({ view: next }, '', `#/${next}`);
  };

  const handleHashChange = (): void => {
    setView(viewFromLocation());
  };

  const handleScroll = (): void => {
    setShowScrollTop(window.scrollY > 560);
  };

  const connectInstalledModules = async (): Promise<void> => {
    const current = ready();
    if (!current) throw new Error('Локальный поиск ещё не готов.');
    const next = await swapMedicalCore(current, createBrowserCore, (core) => {
      const assistant = assistantCore();
      if (assistant) assistant.setBase(core);
      else setAssistantCore(new GroundedMedicalCore(core, modelController));
    });
    coreToClose = next.core;
    setReady(next);
    notifyContentChanged();
  };

  onMount(async () => {
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    const bindModuleRuntime = (runtime: ReturnType<typeof getContentModuleRuntime>): void => {
      unsubscribeInstalledModules?.();
      const syncInstalledCount = (): void => {
        setDownloadedModuleCount(runtime.listInstalled().length);
      };
      syncInstalledCount();
      unsubscribeInstalledModules = runtime.subscribe(syncInstalledCount);
    };
    bindModuleRuntime(getContentModuleRuntime(MODULE_CATALOG));
    unsubscribeModuleRuntime = subscribeContentModuleRuntime(bindModuleRuntime);
    try {
      const initialized = await initializeMedicalCore(createBrowserCore);
      coreToClose = initialized.core;
      setAssistantCore(new GroundedMedicalCore(initialized.core, modelController));
      setReady(initialized);
      void modelController.start();
      void refreshContentModuleCatalog()
        .then((result) => {
          setAvailableModuleCount(countAvailableModules(result.catalog.modules));
        })
        .catch(() => undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось открыть локальную базу знаний.',
      );
    }
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
    unsubscribeInstalledModules?.();
    unsubscribeModuleRuntime?.();
    if (coreToClose) void coreToClose.close();
    void modelController.dispose();
  });

  return (
    <div class="app-shell archive-app">
      <Show
        when={ready()}
        fallback={
          <main class="boot-screen archive-boot">
            <div class="boot-card paper-sheet">
              <span class="boot-spinner" />
              <p class="archive-kicker">Локальная медицинская база</p>
              <h1>{error() ? 'База не открылась' : 'Открываем документы…'}</h1>
              <p>{error() ?? 'Подготавливаем локальный поиск. Интернет для работы не нужен.'}</p>
            </div>
          </main>
        }
      >
        {(state) => (
          <>
            <main class="app-main">
              <section
                class="app-view"
                classList={{ active: view() === 'search' }}
                hidden={view() !== 'search'}
                aria-hidden={view() !== 'search'}
              >
                <SearchHome
                  baseCore={state().core}
                  assistantCore={assistantCore()}
                  onOpenKnowledgeBase={() => navigate('modules')}
                />
              </section>
              <section
                class="app-view"
                classList={{ active: view() === 'modules' }}
                hidden={view() !== 'modules'}
                aria-hidden={view() !== 'modules'}
              >
                <KnowledgeBaseView
                  core={state().core}
                  status={state().status}
                  active={view() === 'modules'}
                  onContentChanged={connectInstalledModules}
                  onAvailableUpdates={setAvailableModuleCount}
                />
              </section>
              <section
                class="app-view"
                classList={{ active: view() === 'notes' }}
                hidden={view() !== 'notes'}
                aria-hidden={view() !== 'notes'}
              >
                <NotesView />
              </section>
              <section
                class="app-view model-status-view"
                classList={{ active: view() === 'status' }}
                hidden={view() !== 'status'}
                aria-hidden={view() !== 'status'}
              >
                <section class="settings-intro paper-card">
                  <div>
                    <p class="archive-kicker">Поиск остаётся доступным всегда</p>
                    <h1>Настройки</h1>
                  </div>
                  <p>
                    Обычный FTS5/vector-поиск полностью локален и не требует модели. Модель нужна
                    только для диагностического разбора найденных источников и может быть отключена.
                  </p>
                </section>
                <ModelSettings controller={modelController} />
                <details class="system-technical-panel">
                  <summary>Техническая информация о приложении</summary>
                  <StatusPanel core={state().core} initialStatus={state().status} />
                </details>
              </section>
            </main>
            <ContentDownloadStatus floating />
            <DocumentOverlayHost
              getCore={() => state().core}
              reconnectContent={connectInstalledModules}
            />
            <nav class="app-bottom-nav" aria-label="Разделы приложения">
              {VIEWS.map((item) => {
                const label = () =>
                  item.id === 'modules'
                    ? `${item.label}, доступно: ${availableModuleCount()}, загружено: ${downloadedModuleCount()}`
                    : item.label;
                return (
                  <div class="app-nav-item">
                    <Show when={item.id === 'status'}>
                      <ModelNavIndicator controller={modelController} />
                    </Show>
                    <button
                      class="app-nav-button"
                      classList={{ active: view() === item.id }}
                      type="button"
                      aria-label={label()}
                      title={label()}
                      onClick={() => navigate(item.id)}
                    >
                      <AppGlyph name={item.icon} />
                      <Show when={item.id === 'modules' && availableModuleCount() > 0}>
                        <span class="app-nav-badge available" aria-hidden="true">
                          {availableModuleCount() > 99 ? '99+' : availableModuleCount()}
                        </span>
                      </Show>
                      <Show when={item.id === 'modules' && downloadedModuleCount() > 0}>
                        <span class="app-nav-badge downloaded" aria-hidden="true">
                          {downloadedModuleCount() > 99 ? '99+' : downloadedModuleCount()}
                        </span>
                      </Show>
                    </button>
                  </div>
                );
              })}
            </nav>
          </>
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
