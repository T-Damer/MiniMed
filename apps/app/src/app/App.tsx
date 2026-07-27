import type { MedicalCore } from '@localmed/contracts';
import { createOverlayScrollbars } from 'overlayscrollbars-solid';
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
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { NotesView } from '@/features/notes/NotesView';
import { SearchHome } from '@/features/search/SearchHome';
import { WorkerSearchMedicalCore } from '@/features/search/WorkerSearchMedicalCore';
import {
  APP_UPDATE_READY_EVENT,
  type AppUpdateReadyDetail,
  activateAppUpdate,
} from '@/state/app-update';
import { notifyContentChanged } from '@/state/content-events';
import { dueReminderNotes, loadPatientNotes, PATIENT_NOTES_EVENT } from '@/state/patient-notes';

type View = 'search' | 'modules' | 'notes';
type RootNavigationDirection = 'forward' | 'backward';

interface RootNavigationMotion {
  readonly view: View;
  readonly direction: RootNavigationDirection;
}

const VIEWS: readonly {
  readonly id: View;
  readonly label: string;
  readonly icon: AppGlyphName;
}[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'modules', label: 'База знаний', icon: 'modules' },
  { id: 'notes', label: 'Заметки', icon: 'notes' },
];
const VIEW_ORDER = new Map(VIEWS.map((item, index) => [item.id, index]));

const DEFAULT_MODEL_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/models/catalog.preview.json';
const DEFAULT_MODEL_ASSET_BASE_URL = '';

function viewFromLocation(): View {
  const value = window.location.hash.replace(/^#\/?/u, '');
  if (value === 'documents') return 'modules';
  if (value === 'status' || value.startsWith('modules/')) return 'modules';
  if (value.startsWith('notes/')) return 'notes';
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
  const showBrowserFooter = !('Capacitor' in window);
  const [view, setView] = createSignal<View>(viewFromLocation());
  const [rootNavigationMotion, setRootNavigationMotion] = createSignal<RootNavigationMotion>();
  const [ready, setReady] = createSignal<InitializedMedicalCore>();
  const [error, setError] = createSignal<string>();
  const [availableModuleCount, setAvailableModuleCount] = createSignal(0);
  const [downloadedModuleCount, setDownloadedModuleCount] = createSignal(0);
  const [dueReminderCount, setDueReminderCount] = createSignal(0);
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  const [appUpdateWorker, setAppUpdateWorker] = createSignal<ServiceWorker>();
  const [appUpdating, setAppUpdating] = createSignal(false);
  const modelController = createLocalModelController();
  const [assistantCore, setAssistantCore] = createSignal<GroundedMedicalCore>();
  const [searchCore, setSearchCore] = createSignal<WorkerSearchMedicalCore>();
  const [initializePageScroll, pageScroll] = createOverlayScrollbars({
    options: { scrollbars: { autoHide: 'scroll' } },
    defer: true,
  });
  let coreToClose: MedicalCore | undefined;
  let unsubscribeInstalledModules: (() => void) | undefined;
  let unsubscribeModuleRuntime: (() => void) | undefined;

  const moveToRootView = (next: View): boolean => {
    const current = view();
    if (current === next) return false;
    setRootNavigationMotion({
      view: next,
      direction:
        (VIEW_ORDER.get(next) ?? 0) > (VIEW_ORDER.get(current) ?? 0) ? 'forward' : 'backward',
    });
    setView(next);
    return true;
  };

  const rootViewClasses = (target: View): Readonly<Record<string, boolean>> => {
    const motion = rootNavigationMotion();
    return {
      active: view() === target,
      'root-view-enter-forward': motion?.view === target && motion.direction === 'forward',
      'root-view-enter-backward': motion?.view === target && motion.direction === 'backward',
    };
  };

  const navigate = (next: View): void => {
    // Re-tapping the active section is the mobile shorthand for "back to the top of this page".
    const changed = moveToRootView(next);
    const oldURL = window.location.href;
    window.history.replaceState({ view: next }, '', `#/${next}`);
    window.dispatchEvent(
      new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
    );
    window.scrollTo({ top: 0, behavior: changed ? 'instant' : 'smooth' });
  };

  const handleHashChange = (): void => {
    const next = viewFromLocation();
    if (moveToRootView(next)) window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleScroll = (): void => {
    setShowScrollTop(window.scrollY > 560);
  };

  const handleAppUpdate = (event: Event): void => {
    setAppUpdateWorker((event as CustomEvent<AppUpdateReadyDetail>).detail.worker);
  };

  const connectInstalledModules = async (): Promise<void> => {
    const current = ready();
    if (!current) throw new Error('Локальный поиск ещё не готов.');
    const next = await swapMedicalCore(current, createBrowserCore, (core) => {
      const previousSearchCore = searchCore();
      const nextSearchCore = new WorkerSearchMedicalCore(core);
      setSearchCore(nextSearchCore);
      if (previousSearchCore) void previousSearchCore.close();
      const assistant = assistantCore();
      if (assistant) assistant.setBase(nextSearchCore);
      else setAssistantCore(new GroundedMedicalCore(nextSearchCore, modelController));
    });
    coreToClose = next.core;
    setReady(next);
    notifyContentChanged();
  };

  const refreshDueReminders = (): void => {
    setDueReminderCount(dueReminderNotes(loadPatientNotes()).length);
  };
  let reminderTimer: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    initializePageScroll(document.body);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.addEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    refreshDueReminders();
    // Due-ness changes with the clock, not only with edits.
    reminderTimer = setInterval(refreshDueReminders, 30_000);
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
      const initializedSearchCore = new WorkerSearchMedicalCore(initialized.core);
      coreToClose = initialized.core;
      setSearchCore(initializedSearchCore);
      setAssistantCore(new GroundedMedicalCore(initializedSearchCore, modelController));
      setReady(initialized);
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
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.removeEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    if (reminderTimer) clearInterval(reminderTimer);
    unsubscribeInstalledModules?.();
    unsubscribeModuleRuntime?.();
    if (coreToClose) void coreToClose.close();
    const activeSearchCore = searchCore();
    if (activeSearchCore) void activeSearchCore.close();
    pageScroll()?.destroy();
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
                classList={rootViewClasses('search')}
                hidden={view() !== 'search'}
                aria-hidden={view() !== 'search'}
              >
                <SearchHome
                  baseCore={searchCore() ?? state().core}
                  assistantCore={assistantCore()}
                  onOpenKnowledgeBase={() => navigate('modules')}
                />
              </section>
              <section
                class="app-view"
                classList={rootViewClasses('modules')}
                hidden={view() !== 'modules'}
                aria-hidden={view() !== 'modules'}
              >
                <KnowledgeBaseView
                  core={state().core}
                  status={state().status}
                  controller={modelController}
                  active={view() === 'modules'}
                  onContentChanged={connectInstalledModules}
                  onAvailableUpdates={setAvailableModuleCount}
                />
              </section>
              <section
                class="app-view"
                classList={rootViewClasses('notes')}
                hidden={view() !== 'notes'}
                aria-hidden={view() !== 'notes'}
              >
                <NotesView core={searchCore() ?? state().core} />
              </section>
              <Show when={showBrowserFooter}>
                <footer class="app-footer">
                  <a href="https://github.com/T-Damer/MiniMed" target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                  <a href="https://github.com/T-Damer/MiniMed/releases/download/v0.6.3/MiniMed-0.6.3-rf-public-pilot-debug.apk">
                    Android APK
                  </a>
                </footer>
              </Show>
            </main>
            <div class="floating-system-status" aria-live="polite">
              <Show when={appUpdateWorker()}>
                {(worker) => (
                  <button
                    class="content-download-pill app-update-pill"
                    type="button"
                    disabled={appUpdating()}
                    onClick={() => {
                      setAppUpdating(true);
                      activateAppUpdate(worker());
                    }}
                  >
                    <AppGlyph name="refresh" />
                    <span>{appUpdating() ? 'Обновляем приложение…' : 'Обновить приложение'}</span>
                  </button>
                )}
              </Show>
              <ContentDownloadStatus floating />
            </div>
            <DocumentOverlayHost
              getCore={() => state().core}
              reconnectContent={connectInstalledModules}
            />
            <nav class="app-bottom-nav" aria-label="Разделы приложения">
              {VIEWS.map((item) => {
                const label = () => {
                  if (item.id === 'modules') {
                    return `${item.label}, доступно: ${availableModuleCount()}, загружено: ${downloadedModuleCount()}`;
                  }
                  if (item.id === 'notes' && dueReminderCount() > 0) {
                    return `${item.label}, напоминаний: ${dueReminderCount()}`;
                  }
                  return item.label;
                };
                return (
                  <div class="app-nav-item">
                    <Show when={item.id === 'modules'}>
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
                      <Show when={item.id === 'notes' && dueReminderCount() > 0}>
                        <span class="app-nav-badge reminder" aria-hidden="true">
                          {dueReminderCount() > 9 ? '9+' : dueReminderCount()}
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
