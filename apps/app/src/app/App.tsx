import { type JSX, lazy, Show, Suspense } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { Toaster } from 'solid-sonner';

import { AppBottomNav } from '@/app/AppBottomNav';
import { BootScreen } from '@/app/BootScreen';
import type { RootView } from '@/app/root-view';
import { useAppSession } from '@/app/use-app-session';
import { useBottomNav } from '@/app/use-bottom-nav';
import { useFindShortcut } from '@/app/use-find-shortcut';
import { useNativeBack } from '@/app/use-native-back';
import { useRootNavigation } from '@/app/use-root-navigation';
import { AppGlyph } from '@/components/AppGlyph';
import { FloatingWindowLayer } from '@/components/FloatingWindowLayer';
import { DocumentBookModeButton } from '@/features/library/DocumentBookModeButton';
import { createFloatingWindows } from '@/state/floating-windows';
import { rememberReturnTo } from '@/state/return-navigation';

const AssessmentsView = lazy(() =>
  import('@/features/assessments/AssessmentsView').then(({ AssessmentsView: component }) => ({
    default: component,
  })),
);
const CalculatorsView = lazy(() =>
  import('@/features/calculators/CalculatorsView').then(({ CalculatorsView: component }) => ({
    default: component,
  })),
);
const KnowledgeBaseView = lazy(() =>
  import('@/features/knowledge/KnowledgeBaseView').then(({ KnowledgeBaseView: component }) => ({
    default: component,
  })),
);
const DocumentPageHost = lazy(() =>
  import('@/features/library/DocumentPageHost').then(({ DocumentPageHost: component }) => ({
    default: component,
  })),
);
const NotesView = lazy(() =>
  import('@/features/notes/NotesView').then(({ NotesView: component }) => ({
    default: component,
  })),
);
const SearchHome = lazy(() =>
  import('@/features/search/SearchHome').then(({ SearchHome: component }) => ({
    default: component,
  })),
);
const SettingsView = lazy(() =>
  import('@/features/settings/SettingsView').then(({ SettingsView: component }) => ({
    default: component,
  })),
);

export function App(): JSX.Element {
  const embeddedFloatingWindow = new URLSearchParams(window.location.search).has(
    'minimed-floating',
  );
  const scaledFloatingWindow =
    embeddedFloatingWindow &&
    new URLSearchParams(window.location.search).get('minimed-floating-scale') === '1';
  const session = useAppSession();
  const navigation = useRootNavigation();
  const floatingWindows = createFloatingWindows();
  const bottomNav = useBottomNav({
    view: navigation.view,
    navigate: navigation.navigate,
    enabled: () => Boolean(session.ready()),
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
        'app-view--floating-child-scaled': scaledFloatingWindow,
      }}
      hidden={navigation.documentReadActive() || !navigation.isViewVisible(id)}
      aria-hidden={navigation.view() !== id}
    >
      {/* Keep-alive: construct on first visit, then stay mounted so tab switches
          preserve composer drafts, scroll position, and per-view state. */}
      <Show when={navigation.hasMountedView(id)}>
        <Suspense
          fallback={
            <div class="app-view__loading" role="status" aria-live="polite">
              Загрузка страницы…
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
        'app-shell--booting': !session.ready(),
        'app-shell--native': session.isNativeShell,
        'app-shell--floating-child': embeddedFloatingWindow,
        'app-shell--floating-child-scaled': scaledFloatingWindow,
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
        }}
      >
        {rootPane('assessments', () => (
          <AssessmentsView />
        ))}
        {rootPane('calculators', () => (
          <CalculatorsView />
        ))}
        <Show
          when={session.ready()}
          fallback={
            <Show when={navigation.view() !== 'assessments' && navigation.view() !== 'calculators'}>
              <BootScreen error={session.error()} bootSlow={session.bootSlow()} />
            </Show>
          }
        >
          {(state) => (
            <>
              {rootPane('search', () => (
                <SearchHome
                  baseCore={session.searchCore() ?? state().core}
                  assistantCore={session.assistantCore()}
                  localModelController={session.modelController}
                  active={navigation.view() === 'search'}
                  onOpenKnowledgeBase={() => navigation.navigate('modules')}
                  onOpenModelSettings={() => {
                    rememberReturnTo();
                    navigation.navigate('settings');
                  }}
                  {...(session.availableUpdateVersion()
                    ? { appUpdateVersion: session.availableUpdateVersion() as string }
                    : {})}
                  onOpenAppUpdateSettings={() => {
                    rememberReturnTo();
                    navigation.navigate('settings');
                  }}
                />
              ))}
              {rootPane('modules', () => (
                <KnowledgeBaseView
                  core={state().core}
                  status={state().status}
                  active={navigation.view() === 'modules'}
                  onContentChanged={session.connectInstalledModules}
                  onAvailableUpdates={session.setAvailableModuleCount}
                />
              ))}
              {rootPane('settings', () => (
                <SettingsView
                  controller={session.modelController}
                  status={state().status}
                  appUpdateReady={Boolean(session.appUpdateWorker() || session.availableApkUrl())}
                  appUpdating={session.appUpdating()}
                  appUpdateChecking={session.appUpdateChecking()}
                  appUpdateUpToDate={session.appUpdateUpToDate()}
                  appUpdateProgress={session.appUpdateProgress()}
                  appUpdateError={session.appUpdateError()}
                  onCheckAppUpdate={session.checkAvailableUpdate}
                  onActivateAppUpdate={session.activateAvailableUpdate}
                />
              ))}
              {rootPane('notes', () => (
                <NotesView
                  core={session.searchCore() ?? state().core}
                  active={navigation.view() === 'notes'}
                />
              ))}
              <Show when={navigation.documentReadActive()}>
                <section class="app-view app-view--document-read active" aria-hidden={false}>
                  <Suspense
                    fallback={
                      <div class="app-view__loading" role="status" aria-live="polite">
                        Загрузка документа…
                      </div>
                    }
                  >
                    <DocumentPageHost
                      getCore={() => state().core}
                      reconnectContent={session.connectInstalledModules}
                    />
                  </Suspense>
                </section>
              </Show>
            </>
          )}
        </Show>
      </main>

      <Show when={session.ready() && !embeddedFloatingWindow}>
        <FloatingWindowLayer manager={floatingWindows} onClose={closeFloatingWindow} />
      </Show>

      <Show when={session.ready() && !embeddedFloatingWindow}>
        <Portal>
          <AppBottomNav
            view={navigation.view}
            dragIndex={bottomNav.dragIndex}
            dragging={bottomNav.dragging}
            pressed={bottomNav.pressed}
            availableModuleCount={session.availableModuleCount}
            downloadedModuleCount={session.downloadedModuleCount}
            dueReminderCount={session.dueReminderCount}
            appUpdateReady={() => Boolean(session.appUpdateWorker() || session.availableApkUrl())}
            modelController={session.modelController}
            bubbleStyle={bottomNav.bubbleStyle}
            bindNav={bottomNav.bindNav}
            onPointerDown={bottomNav.handlePointerDown}
            onPointerMove={bottomNav.handlePointerMove}
            onPointerUp={bottomNav.handlePointerUp}
            onPointerCancel={bottomNav.handlePointerCancel}
            onItemClick={bottomNav.handleClick}
          />
        </Portal>
      </Show>

      <div id="app-floating-controls" class="floating-window-controls">
        <Show when={session.ready() && !embeddedFloatingWindow}>
          <DocumentBookModeButton />
        </Show>
        <Show
          when={
            session.ready() &&
            !embeddedFloatingWindow &&
            !navigation.documentReadActive() &&
            navigation.view() !== 'settings'
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
        <Show when={session.ready() && !embeddedFloatingWindow && navigation.showScrollTop()}>
          <button
            class="scroll-top-button floating-window-controls__item"
            type="button"
            aria-label="Вернуться наверх"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <AppGlyph name="arrow-up" class="scroll-top-button__icon" />
          </button>
        </Show>
      </div>
    </div>
  );
}
