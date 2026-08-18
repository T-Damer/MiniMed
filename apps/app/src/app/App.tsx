import { type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
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
import { AssessmentsView } from '@/features/assessments/AssessmentsView';
import { CalculatorsView } from '@/features/calculators/CalculatorsView';
import { KnowledgeBaseView } from '@/features/knowledge/KnowledgeBaseView';
import { DocumentPageHost } from '@/features/library/DocumentPageHost';
import { NotesView } from '@/features/notes/NotesView';
import { SearchHome } from '@/features/search/SearchHome';
import { SettingsView } from '@/features/settings/SettingsView';
import type { AppUpdateProgress } from '@/state/app-update';
import { rememberReturnTo } from '@/state/return-navigation';

export function App(): JSX.Element {
  const session = useAppSession();
  const navigation = useRootNavigation();
  const bottomNav = useBottomNav({
    view: navigation.view,
    navigate: navigation.navigate,
    enabled: () => Boolean(session.ready()),
  });
  useFindShortcut();
  useNativeBack({ view: navigation.view, navigate: navigation.navigate });

  const rootPane = (id: RootView, content: JSX.Element): JSX.Element => (
    <section
      class="app-view"
      classList={navigation.rootViewClasses(id)}
      hidden={navigation.documentReadActive() || !navigation.isViewVisible(id)}
      aria-hidden={navigation.view() !== id}
    >
      {content}
    </section>
  );

  return (
    <div
      class="app-shell archive-app"
      classList={{
        'app-shell--booting': !session.ready(),
        'app-shell--native': session.isNativeShell,
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
      <main class="app-main">
        {rootPane('assessments', <AssessmentsView />)}
        {rootPane('calculators', <CalculatorsView />)}
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
              {rootPane(
                'search',
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
                  appUpdateReady={Boolean(session.appUpdateWorker() || session.availableApkUrl())}
                  appUpdating={session.appUpdating()}
                  {...(session.appUpdateProgress()
                    ? { appUpdateProgress: session.appUpdateProgress() as AppUpdateProgress }
                    : {})}
                  onActivateAppUpdate={session.activateAvailableUpdate}
                />,
              )}
              {rootPane(
                'modules',
                <KnowledgeBaseView
                  core={state().core}
                  status={state().status}
                  active={navigation.view() === 'modules'}
                  onContentChanged={session.connectInstalledModules}
                  onAvailableUpdates={session.setAvailableModuleCount}
                />,
              )}
              {rootPane(
                'settings',
                <SettingsView controller={session.modelController} status={state().status} />,
              )}
              {rootPane(
                'notes',
                <NotesView
                  core={session.searchCore() ?? state().core}
                  active={navigation.view() === 'notes'}
                />,
              )}
              <Show when={navigation.documentReadActive()}>
                <section class="app-view app-view--document-read active" aria-hidden={false}>
                  <DocumentPageHost
                    getCore={() => state().core}
                    reconnectContent={session.connectInstalledModules}
                  />
                </section>
              </Show>
            </>
          )}
        </Show>
      </main>

      <Show when={session.ready()}>
        <AppBottomNav
          view={navigation.view}
          dragIndex={bottomNav.dragIndex}
          dragging={bottomNav.dragging}
          pressed={bottomNav.pressed}
          availableModuleCount={session.availableModuleCount}
          downloadedModuleCount={session.downloadedModuleCount}
          dueReminderCount={session.dueReminderCount}
          modelController={session.modelController}
          bubbleStyle={bottomNav.bubbleStyle}
          bindNav={bottomNav.bindNav}
          onPointerDown={bottomNav.handlePointerDown}
          onPointerMove={bottomNav.handlePointerMove}
          onPointerUp={bottomNav.handlePointerUp}
          onPointerCancel={bottomNav.handlePointerCancel}
          onItemClick={bottomNav.handleClick}
        />
      </Show>

      <Show when={session.ready() && navigation.showScrollTop()}>
        <button
          class="scroll-top-button"
          classList={{ 'scroll-top-button--notes': navigation.view() === 'notes' }}
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
