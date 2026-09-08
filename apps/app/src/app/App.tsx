import {
  createEffect,
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { Toaster } from 'solid-sonner';

import { AppBottomNav } from '@/app/AppBottomNav';
import { BootScreen } from '@/app/BootScreen';
import { COMPACT_ROOT_VIEWS, compactRootView, ROOT_VIEWS, type RootView } from '@/app/root-view';
import { useAppSession } from '@/app/use-app-session';
import { useBottomNav } from '@/app/use-bottom-nav';
import { useFindShortcut } from '@/app/use-find-shortcut';
import { useNativeBack } from '@/app/use-native-back';
import { useRootNavigation } from '@/app/use-root-navigation';
import { AppGlyph } from '@/components/AppGlyph';
import { FloatingWindowLayer } from '@/components/FloatingWindowLayer';
import { medicalImageViewerActive } from '@/features/library/document-reading-mode';
import {
  isUserLibraryCatalogRoute,
  USER_LIBRARY_CATALOG_HASH,
} from '@/features/library/user-library-routing';
import {
  getFloatingWindowsEnabled,
  getSplitNavigation,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import { parseDocumentReadRoute } from '@/state/document-route';
import { createFloatingWindows } from '@/state/floating-windows';
import { rememberReturnTo } from '@/state/return-navigation';
import {
  ROUTE_WINDOW_REQUEST_EVENT,
  type RouteWindowRequestDetail,
} from '@/state/route-window-request';

const loadAssessmentsView = () =>
  import('@/features/assessments/AssessmentsView').then(({ AssessmentsView: component }) => ({
    default: component,
  }));
const loadCalculatorsView = () =>
  import('@/features/calculators/CalculatorsView').then(({ CalculatorsView: component }) => ({
    default: component,
  }));
const loadKnowledgeBaseView = () =>
  import('@/features/knowledge/KnowledgeBaseView').then(({ KnowledgeBaseView: component }) => ({
    default: component,
  }));
const DocumentPageHost = lazy(() =>
  import('@/features/library/DocumentPageHost').then(({ DocumentPageHost: component }) => ({
    default: component,
  })),
);
const loadNotesView = () =>
  import('@/features/notes/NotesView').then(({ NotesView: component }) => ({
    default: component,
  }));
const loadSearchHome = () =>
  import('@/features/search/SearchHome').then(({ SearchHome: component }) => ({
    default: component,
  }));
const loadSettingsView = () =>
  import('@/features/settings/SettingsView').then(({ SettingsView: component }) => ({
    default: component,
  }));

const AssessmentsView = lazy(loadAssessmentsView);
const CalculatorsView = lazy(loadCalculatorsView);
const KnowledgeBaseView = lazy(loadKnowledgeBaseView);
const NotesView = lazy(loadNotesView);
const SearchHome = lazy(loadSearchHome);
const SettingsView = lazy(loadSettingsView);

const rootViewLoaders: Readonly<Record<RootView, () => Promise<unknown>>> = {
  search: loadSearchHome,
  modules: loadKnowledgeBaseView,
  assessments: loadAssessmentsView,
  calculators: loadCalculatorsView,
  notes: loadNotesView,
  settings: loadSettingsView,
};

function preloadRootView(view: RootView): void {
  void rootViewLoaders[view]().catch(() => undefined);
}

export function App(): JSX.Element {
  const floatingWindowParams = new URLSearchParams(window.location.search);
  const embeddedFloatingWindow = floatingWindowParams.has('minimed-floating');
  const scaledFloatingWindow =
    embeddedFloatingWindow && floatingWindowParams.get('minimed-floating-scale') !== '0';
  const session = useAppSession();
  const navigation = useRootNavigation();
  const [shellReady, setShellReady] = createSignal(document.readyState === 'complete');
  const [splitNavigation, setSplitNavigation] = createSignal(getSplitNavigation());
  const [currentHash, setCurrentHash] = createSignal(window.location.hash);
  let lastPersonalHash = USER_LIBRARY_CATALOG_HASH;
  const expandedNavigation = () => splitNavigation() && Boolean(session.ready());
  const navItems = () => (expandedNavigation() ? ROOT_VIEWS : COMPACT_ROOT_VIEWS);
  const navView = () =>
    expandedNavigation() ? navigation.view() : compactRootView(navigation.view(), currentHash());
  const navigateTab = (next: RootView): void => {
    if (!expandedNavigation() && next === 'notes') {
      window.location.hash = navView() === 'notes' ? USER_LIBRARY_CATALOG_HASH : lastPersonalHash;
      return;
    }
    navigation.navigate(next);
  };
  const personalDocumentActive = () => parseDocumentReadRoute(currentHash())?.kind === 'user';
  const personalLibraryActive = () =>
    isUserLibraryCatalogRoute(currentHash().replace(/^#\/?/u, ''));
  const showingBootScreen = () =>
    !shellReady() ||
    (!session.ready() &&
      navigation.view() !== 'notes' &&
      navigation.view() !== 'settings' &&
      !personalLibraryActive() &&
      !personalDocumentActive());
  onMount(() => {
    const refresh = () => {
      const hash = window.location.hash;
      setCurrentHash(hash);
      if (hash.startsWith('#/notes') || hash.startsWith(USER_LIBRARY_CATALOG_HASH))
        lastPersonalHash = hash;
    };
    refresh();
    window.addEventListener('hashchange', refresh);
    onCleanup(() => window.removeEventListener('hashchange', refresh));
  });
  const floatingWindows = createFloatingWindows();
  const [floatingWindowsEnabled, setFloatingWindowsEnabled] = createSignal(
    getFloatingWindowsEnabled(),
  );
  onMount(() => {
    // Local diagnostic marks: shell interactivity and searchable content are independent gates.
    let navigationFrame: number | undefined;
    const showShell = () => {
      navigationFrame = requestAnimationFrame(() => {
        setShellReady(true);
        performance.mark('minimed:navigation-ready');
      });
    };
    if (document.readyState === 'complete') showShell();
    else window.addEventListener('load', showShell, { once: true });
    onCleanup(() => {
      window.removeEventListener('load', showShell);
      if (navigationFrame !== undefined) cancelAnimationFrame(navigationFrame);
    });
    const unsubscribePreferences = subscribeAppPreferences((preferences) => {
      setFloatingWindowsEnabled(preferences.floatingWindowsEnabled);
      setSplitNavigation(preferences.splitNavigation);
    });
    const syncFloatingViewport = (): void => {
      if (!embeddedFloatingWindow) return;
      document.documentElement.style.setProperty(
        '--floating-viewport-width',
        `${window.innerWidth}px`,
      );
      document.documentElement.style.setProperty(
        '--floating-viewport-height',
        `${window.innerHeight}px`,
      );
    };
    const currentOwnerRoute = (): string => window.location.hash || `#/${navigation.view()}`;
    const handleRouteWindowRequest = (event: Event): void => {
      if (embeddedFloatingWindow || !navigation.documentReadActive()) return;
      const request = event as CustomEvent<RouteWindowRequestDetail>;
      if (
        request.detail &&
        floatingWindows.openTransient(
          request.detail.view,
          request.detail.route,
          currentOwnerRoute(),
        )
      ) {
        event.preventDefault();
      }
    };
    const closeTransientWindows = (): void => {
      floatingWindows.closeTransientOutside(currentOwnerRoute());
    };
    window.addEventListener(ROUTE_WINDOW_REQUEST_EVENT, handleRouteWindowRequest);
    window.addEventListener('hashchange', closeTransientWindows);
    if (embeddedFloatingWindow) {
      syncFloatingViewport();
      window.addEventListener('resize', syncFloatingViewport);
    }
    onCleanup(unsubscribePreferences);
    onCleanup(() => {
      window.removeEventListener(ROUTE_WINDOW_REQUEST_EVENT, handleRouteWindowRequest);
      window.removeEventListener('hashchange', closeTransientWindows);
      window.removeEventListener('resize', syncFloatingViewport);
      document.documentElement.style.removeProperty('--floating-viewport-width');
      document.documentElement.style.removeProperty('--floating-viewport-height');
    });
  });
  createEffect(() => {
    if (floatingWindowsEnabled()) return;
    for (const windowState of floatingWindows.windows()) {
      if (!windowState.ownerRoute) floatingWindows.close(windowState.id);
    }
  });
  const bottomNav = useBottomNav({
    view: navView,
    items: navItems,
    navigate: navigateTab,
    enabled: () => true,
  });
  useFindShortcut();
  useNativeBack({ view: navigation.view, navigate: navigation.navigate });

  const collapseFloatingWindow = (id: string): void => {
    const windowState = floatingWindows.windowFor(id);
    floatingWindows.close(id);
    if (windowState && windowState.route !== window.location.hash) {
      window.location.hash = windowState.route;
    }
  };

  const closeFloatingWindow = (id: string): void => {
    floatingWindows.close(id);
  };

  const currentRoute = (): string => window.location.hash || `#/${navigation.view()}`;
  const currentFloatingWindow = () =>
    floatingWindows.windowForRoute(navigation.view(), currentRoute());

  const rootPane = (id: RootView, content: () => JSX.Element): JSX.Element => (
    <section
      class="app-view"
      classList={{
        ...navigation.rootViewClasses(id),
        'app-view--floating-child': embeddedFloatingWindow,
        'app-view--floating-child-scaled': scaledFloatingWindow,
      }}
      hidden={
        showingBootScreen() || navigation.documentReadActive() || !navigation.isViewVisible(id)
      }
      aria-hidden={showingBootScreen() || navigation.view() !== id}
    >
      {/* Keep-alive: construct on first visit, then stay mounted so tab switches
          preserve composer drafts, scroll position, and per-view state. */}
      <Show when={navigation.hasMountedView(id)}>
        <Suspense
          fallback={
            <div
              class="app-view__loading page-surface page-grain"
              role="status"
              aria-live="polite"
              aria-label="Загрузка страницы"
            >
              <span class="app-view__spinner" aria-hidden="true" />
            </div>
          }
        >
          <Dynamic component={content} />
        </Suspense>
      </Show>
    </section>
  );

  return (
    <div
      class="app-shell archive-app"
      classList={{
        'app-shell--booting': showingBootScreen(),
        'app-shell--native': session.isNativeShell,
        'app-shell--medical-image': medicalImageViewerActive(),
        'app-shell--chrome-hidden': navigation.chromeHidden(),
        'app-shell--floating-child': embeddedFloatingWindow,
        'app-shell--floating-child-scaled': scaledFloatingWindow,
        'app-shell--floating-fullscreen': Boolean(floatingWindows.fullscreenWindowId()),
      }}
    >
      <Portal>
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
      </Portal>
      <main
        class="app-main"
        classList={{
          'app-main--floating-child': embeddedFloatingWindow,
          'app-main--floating-child-scaled': scaledFloatingWindow,
          'app-main--medical-image': medicalImageViewerActive(),
        }}
      >
        {rootPane('settings', () => (
          <SettingsView
            status={session.ready()?.status}
            appUpdateReady={Boolean(session.appUpdateWorker() || session.availableApkUrl())}
            appUpdating={session.appUpdating()}
            appUpdateChecking={session.appUpdateChecking()}
            appUpdateUpToDate={session.appUpdateUpToDate()}
            appUpdateProgress={session.appUpdateProgress()}
            appUpdateError={session.appUpdateError()}
            appUpdateCancellable={session.appUpdateCancellable()}
            onCheckAppUpdate={session.checkAvailableUpdate}
            onActivateAppUpdate={session.activateAvailableUpdate}
            onCancelAppUpdate={session.cancelAvailableUpdate}
          />
        ))}
        {rootPane('modules', () => (
          <KnowledgeBaseView
            core={session.ready()?.core}
            status={session.ready()?.status}
            active={navigation.view() === 'modules'}
            onContentChanged={session.connectInstalledModules}
            onAvailableUpdates={session.setAvailableModuleCount}
          />
        ))}
        {rootPane('notes', () => (
          <NotesView
            core={session.searchCore() ?? session.ready()?.core}
            active={navigation.view() === 'notes'}
            backToFiles={!expandedNavigation()}
          />
        ))}
        <Show when={showingBootScreen()}>
          <BootScreen
            appLoading={!shellReady()}
            error={session.error()}
            bootSlow={session.bootSlow()}
            coreDownloadRequired={session.coreDownloadRequired()}
            coreDownloading={session.coreDownloading()}
            coreProgress={session.coreProgress()}
            onDownloadCore={session.downloadCore}
          />
        </Show>
        <Show when={session.ready()}>
          {(state) => (
            <>
              {rootPane('assessments', () => (
                <AssessmentsView active={navigation.view() === 'assessments'} />
              ))}
              {rootPane('calculators', () => (
                <CalculatorsView />
              ))}
              {rootPane('search', () => (
                <SearchHome
                  baseCore={session.searchCore() ?? state().core}
                  onContentChanged={session.connectInstalledModules}
                  splitNavigation={splitNavigation()}
                  active={navigation.view() === 'search'}
                  onOpenKnowledgeBase={() => navigation.navigate('modules')}
                  {...(session.availableUpdateVersion()
                    ? { appUpdateVersion: session.availableUpdateVersion() as string }
                    : {})}
                  onOpenAppUpdateSettings={() => {
                    rememberReturnTo();
                    navigation.navigate('settings');
                  }}
                />
              ))}
            </>
          )}
        </Show>
        <Show
          when={navigation.documentReadActive() && (session.ready() || personalDocumentActive())}
        >
          <section class="app-view app-view--document-read active" aria-hidden={false}>
            <Suspense
              fallback={
                <div
                  class="app-view__loading page-surface page-grain"
                  role="status"
                  aria-live="polite"
                  aria-label="Загрузка страницы"
                >
                  <span class="app-view__spinner" aria-hidden="true" />
                </div>
              }
            >
              <DocumentPageHost
                getCore={() => session.ready()?.core}
                reconnectContent={session.connectInstalledModules}
              />
            </Suspense>
          </section>
        </Show>
      </main>

      <Show
        when={
          session.ready() &&
          !embeddedFloatingWindow &&
          (floatingWindowsEnabled() || floatingWindows.hasTransientWindows())
        }
      >
        <FloatingWindowLayer manager={floatingWindows} onClose={closeFloatingWindow} />
      </Show>

      <Show
        when={
          shellReady() &&
          !embeddedFloatingWindow &&
          !medicalImageViewerActive() &&
          !floatingWindows.fullscreenWindowId()
        }
      >
        <Portal>
          <AppBottomNav
            downloadsReady={() => Boolean(session.ready())}
            view={navView}
            items={navItems}
            dragIndex={bottomNav.dragIndex}
            dragging={bottomNav.dragging}
            pressed={bottomNav.pressed}
            availableModuleCount={session.availableModuleCount}
            downloadedModuleCount={session.downloadedModuleCount}
            dueReminderCount={session.dueReminderCount}
            appUpdateReady={() => Boolean(session.appUpdateWorker() || session.availableApkUrl())}
            bubbleStyle={bottomNav.bubbleStyle}
            bindNav={bottomNav.bindNav}
            onPrefetch={preloadRootView}
            onPointerDown={bottomNav.handlePointerDown}
            onPointerMove={bottomNav.handlePointerMove}
            onPointerUp={bottomNav.handlePointerUp}
            onPointerCancel={bottomNav.handlePointerCancel}
            onItemClick={bottomNav.handleClick}
          />
        </Portal>
      </Show>

      <div id="app-floating-controls" class="floating-window-controls">
        <Show
          when={
            session.ready() &&
            !embeddedFloatingWindow &&
            floatingWindowsEnabled() &&
            navigation.view() !== 'settings' &&
            !floatingWindows.fullscreenWindowId()
          }
        >
          <button
            class="floating-window-toggle floating-window-controls__item"
            type="button"
            aria-label={
              currentFloatingWindow()
                ? 'Вернуть страницу в обычный режим'
                : 'Открыть страницу в маленьком окне'
            }
            title={currentFloatingWindow() ? 'Вернуть в обычный режим' : 'Маленькое окно'}
            onClick={() => {
              const windowState = currentFloatingWindow();
              if (windowState) {
                collapseFloatingWindow(windowState.id);
              } else {
                floatingWindows.open(navigation.view(), currentRoute());
              }
            }}
          >
            <AppGlyph
              name={currentFloatingWindow() ? 'browsers' : 'frame-corners'}
              class="floating-window-toggle__icon"
            />
          </button>
        </Show>
        <Show
          when={
            session.ready() &&
            !embeddedFloatingWindow &&
            !floatingWindows.fullscreenWindowId() &&
            navigation.showScrollTop()
          }
        >
          <button
            class="scroll-top-button floating-window-controls__item"
            type="button"
            aria-label="Вернуться наверх"
            onClick={navigation.scrollToTop}
          >
            <AppGlyph name="arrow-up" class="scroll-top-button__icon" />
          </button>
        </Show>
      </div>
    </div>
  );
}
