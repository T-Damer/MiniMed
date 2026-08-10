import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { MedicalCore } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Toaster } from 'solid-sonner';

import { nativeBackAction } from '@/app/native-back';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { createBrowserCore } from '@/composition/create-browser-core';
import {
  type InitializedMedicalCore,
  initializeMedicalCore,
  swapMedicalCore,
} from '@/composition/medical-core-lifecycle';
import { AssessmentsView } from '@/features/assessments/AssessmentsView';
import { CalculatorsView } from '@/features/calculators/CalculatorsView';
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
  peekContentModuleRuntime,
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
import { installButtonHaptics } from '@/state/haptics';
import { dueReminderNotes, loadPatientNotes, PATIENT_NOTES_EVENT } from '@/state/patient-notes';

type View = 'search' | 'modules' | 'assessments' | 'calculators' | 'notes';
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
  { id: 'assessments', label: 'Тесты', icon: 'list-checks' },
  { id: 'calculators', label: 'Калькуляторы', icon: 'calculator' },
  { id: 'notes', label: 'Заметки', icon: 'notes' },
];
const VIEW_ORDER = new Map(VIEWS.map((item, index) => [item.id, index]));

const DEFAULT_MODEL_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/models/catalog.preview.json';
const DEFAULT_MODEL_ASSET_BASE_URL = '';
const SLOW_BOOT_DELAY_MS = 10_000;
const ROOT_NAVIGATION_MOTION_MS = 240;

function viewFromLocation(): View {
  const value = window.location.hash.replace(/^#\/?/u, '');
  if (value === 'documents') return 'modules';
  if (value === 'status' || value.startsWith('modules/')) return 'modules';
  if (value === 'assessments' || value.startsWith('assessments/')) return 'assessments';
  if (value === 'calculators' || value.startsWith('calculators/')) return 'calculators';
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
  const [bootSlow, setBootSlow] = createSignal(false);
  const [availableModuleCount, setAvailableModuleCount] = createSignal(0);
  const [downloadedModuleCount, setDownloadedModuleCount] = createSignal(0);
  const [dueReminderCount, setDueReminderCount] = createSignal(0);
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  const [appUpdateWorker, setAppUpdateWorker] = createSignal<ServiceWorker>();
  const [appUpdating, setAppUpdating] = createSignal(false);
  const modelController = createLocalModelController();
  const [assistantCore, setAssistantCore] = createSignal<GroundedMedicalCore>();
  const [searchCore, setSearchCore] = createSignal<WorkerSearchMedicalCore>();
  let coreToClose: MedicalCore | undefined;
  let unsubscribeInstalledModules: (() => void) | undefined;
  let unsubscribeModuleRuntime: (() => void) | undefined;
  let nativeBackListener: Awaited<ReturnType<typeof NativeApp.addListener>> | undefined;
  let stopButtonHaptics: (() => void) | undefined;
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let rootNavigationMotionTimer: ReturnType<typeof setTimeout> | undefined;
  const rootNavigationQueue: Array<{ readonly next: View; readonly commit: () => void }> = [];

  const moveToRootView = (next: View): boolean => {
    const current = view();
    if (current === next) return false;
    setRootNavigationMotion({
      view: next,
      direction:
        (VIEW_ORDER.get(next) ?? 0) > (VIEW_ORDER.get(current) ?? 0) ? 'forward' : 'backward',
    });
    if (rootNavigationMotionTimer) clearTimeout(rootNavigationMotionTimer);
    rootNavigationMotionTimer = setTimeout(
      () => setRootNavigationMotion(undefined),
      ROOT_NAVIGATION_MOTION_MS,
    );
    setView(next);
    return true;
  };

  const runNextRootNavigation = (): void => {
    const request = rootNavigationQueue.shift();
    if (!request) return;

    const current = view();
    if (current === request.next) {
      request.commit();
      runNextRootNavigation();
      return;
    }
    request.commit();
    runNextRootNavigation();
  };

  const transitionToRootView = (next: View, commit: () => void): boolean => {
    const plannedView = rootNavigationQueue[rootNavigationQueue.length - 1]?.next ?? view();
    if (plannedView === next) {
      if (rootNavigationQueue.length === 0) commit();
      return false;
    }
    rootNavigationQueue.push({ next, commit });
    runNextRootNavigation();
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
    transitionToRootView(next, () => {
      const changed = view() !== next;
      moveToRootView(next);
      const oldURL = window.location.href;
      window.history.replaceState({ view: next }, '', `#/${next}`);
      window.dispatchEvent(
        new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
      );
      window.scrollTo({ top: 0, behavior: changed ? 'instant' : 'smooth' });
    });
  };

  const handleHashChange = (): void => {
    const next = viewFromLocation();
    if (next === view()) return;
    transitionToRootView(next, () => {
      moveToRootView(next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  };

  const handleScroll = (): void => {
    setShowScrollTop(window.scrollY > 48);
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
    setDownloadedModuleCount(peekContentModuleRuntime()?.listInstalled().length ?? 0);
    notifyContentChanged();
  };

  const refreshDueReminders = (): void => {
    setDueReminderCount(dueReminderNotes(loadPatientNotes()).length);
  };
  let reminderTimer: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    stopButtonHaptics = installButtonHaptics();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.addEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    refreshDueReminders();
    reminderTimer = setInterval(refreshDueReminders, 30_000);
    handleScroll();
    if (Capacitor.getPlatform() === 'android') {
      nativeBackListener = await NativeApp.addListener('backButton', ({ canGoBack }) => {
        const openDialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
        const openDialog = openDialogs[openDialogs.length - 1];
        if (openDialog) {
          const closeButton = openDialog.querySelector<HTMLButtonElement>(
            '.overlay-dialog-header button',
          );
          closeButton?.click();
          if (!closeButton) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return;
        }
        if (document.querySelector('.search-history-drawer-backdrop, .reader-column.open')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return;
        }
        const route = window.location.hash.replace(/^#\/?/u, '');
        const action = nativeBackAction(route, view(), canGoBack);
        if (action === 'history') {
          window.history.back();
        } else if (action === 'search') {
          navigate('search');
        } else {
          void NativeApp.minimizeApp();
        }
      });
    }
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
    bootTimer = setTimeout(() => setBootSlow(true), SLOW_BOOT_DELAY_MS);
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
    } finally {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = undefined;
    }
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.removeEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    if (reminderTimer) clearInterval(reminderTimer);
    if (bootTimer) clearTimeout(bootTimer);
    if (rootNavigationMotionTimer) clearTimeout(rootNavigationMotionTimer);
    unsubscribeInstalledModules?.();
    unsubscribeModuleRuntime?.();
    void nativeBackListener?.remove();
    stopButtonHaptics?.();
    if (coreToClose) void coreToClose.close();
    const activeSearchCore = searchCore();
    if (activeSearchCore) void activeSearchCore.close();
    void modelController.dispose();
  });

  return (
    <div class="app-shell archive-app" classList={{ 'app-shell--booting': !ready() }}>
      <Toaster
        class="app-notification-host"
        position="top-center"
        closeButton
        duration={4200}
        containerAriaLabel="Уведомления"
        toastOptions={{
          className: 'app-notification',
          closeButtonAriaLabel: 'Закрыть уведомление',
        }}
      />
      <main class="app-main">
        <section
          class="app-view"
          classList={rootViewClasses('assessments')}
          hidden={view() !== 'assessments'}
          aria-hidden={view() !== 'assessments'}
        >
          <AssessmentsView />
        </section>
        <section
          class="app-view"
          classList={rootViewClasses('calculators')}
          hidden={view() !== 'calculators'}
          aria-hidden={view() !== 'calculators'}
        >
          <CalculatorsView />
        </section>

        <Show
          when={ready()}
          fallback={
            <Show when={view() !== 'assessments' && view() !== 'calculators'}>
              <section class="boot-screen boot-screen--shell-booting archive-boot">
                <div class="boot-card paper-sheet">
                  <span class="boot-spinner" />
                  <p class="archive-kicker">Локальная медицинская база</p>
                  <h1>{error() ? 'База не открылась' : 'Открываем документы…'}</h1>
                  <p>
                    {error() ??
                      (bootSlow()
                        ? 'Загрузка базы занимает необычно много времени. Оставьте окно открытым, мы продолжаем загрузку в фоне.'
                        : 'Подготавливаем локальный поиск. Интернет для работы не нужен.')}
                  </p>
                  <Show when={error() || bootSlow()}>
                    <button type="button" onClick={() => window.location.reload()}>
                      Повторить загрузку
                    </button>
                  </Show>
                </div>
              </section>
            </Show>
          }
        >
          {(state) => (
            <>
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
                <NotesView core={searchCore() ?? state().core} active={view() === 'notes'} />
              </section>
              <Show when={showBrowserFooter}>
                <footer class="app-footer">
                  <ReleaseLinks />
                </footer>
              </Show>
            </>
          )}
        </Show>
      </main>

      <Show when={ready()}>
        {(state) => (
          <>
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
          </>
        )}
      </Show>

      <Show when={ready()}>
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
                  classList={{ 'app-nav-button--active': view() === item.id }}
                  type="button"
                  aria-label={label()}
                  aria-current={view() === item.id ? 'page' : undefined}
                  title={label()}
                  onClick={() => navigate(item.id)}
                >
                  <AppGlyph
                    name={item.icon}
                    class={`app-nav-button__icon${view() === item.id ? ' app-nav-button__icon--active' : ''}`}
                  />
                  <Show when={item.id === 'modules' && availableModuleCount() > 0}>
                    <span class="app-nav-badge app-nav-badge--available" aria-hidden="true">
                      {availableModuleCount() > 99 ? '99+' : availableModuleCount()}
                    </span>
                  </Show>
                  <Show when={item.id === 'modules' && downloadedModuleCount() > 0}>
                    <span class="app-nav-badge app-nav-badge--downloaded" aria-hidden="true">
                      {downloadedModuleCount() > 99 ? '99+' : downloadedModuleCount()}
                    </span>
                  </Show>
                  <Show when={item.id === 'notes' && dueReminderCount() > 0}>
                    <span class="app-nav-badge app-nav-badge--reminder" aria-hidden="true">
                      {dueReminderCount() > 9 ? '9+' : dueReminderCount()}
                    </span>
                  </Show>
                </button>
              </div>
            );
          })}
        </nav>
      </Show>

      <Show when={ready() && showScrollTop()}>
        <button
          class="scroll-top-button"
          classList={{ 'scroll-top-button--notes': view() === 'notes' }}
          type="button"
          aria-label="Вернуться наверх"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <AppGlyph name="arrow-up" class="scroll-top-button__icon" />
        </button>
      </Show>
    </div>
  );
}
