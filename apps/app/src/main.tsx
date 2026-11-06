import { Capacitor } from '@capacitor/core';
import { render } from 'solid-js/web';
import { BootScreen } from '@/app/BootScreen';
import { lockNativeSafeBottom } from '@/app/lock-native-safe-bottom';
import { mountApp } from '@/app/mount-app';
import { installPressFeedback } from '@/components/press-feedback';
import { listenForInstallPrompt } from '@/diary/install-state';
import { registerAppServiceWorker } from '@/state/app-update';
import { installChunkRecovery } from '@/state/chunk-recovery';
import { installMotionManager } from '@/state/motion';
import { startReminderNotifications } from '@/state/reminder-notifications';
import { isStandbyTab, resumeFromStandby } from '@/state/tab-takeover';
import { installTheme } from '@/state/theme';
import 'overlayscrollbars/overlayscrollbars.css';
import '@/styles/theme.css';
import '@/styles/zIndex.css';
import '@/styles/animations.css';
import '@/styles/breakpoints.css';
import '@/styles/motion-tokens.css';
import '@/styles/global.css';
import '@/styles/archive-search.css';
import '@/styles/mobile-shell.css';
import '@/styles/modules.css';
import '@/styles/clinical-ux.css';
import '@/styles/clinical-results.css';
import '@/styles/doctor-ux.css';
import '@/styles/dataset-ux.css';
import '@/styles/search-doctor-ux.css';
import '@/styles/bottom-nav.css';
import '@/styles/page-chrome.css';
import '@/styles/compact-release.css';
import '@/styles/search-scope-radio.css';
import '@/styles/unified-catalog.css';
import '@/styles/download-status.css';
import '@/styles/document-page.css';
import '@/styles/medications.css';
import '@/styles/conditions.css';
import '@/styles/herbal.css';
import '@/styles/assessments.css';
import '@/styles/calculators.css';
import '@/styles/score-scale.css';
import '@/styles/tool-routes.css';
import '@/styles/settings.css';
import '@/styles/tool-link-icons.css';
import '@/styles/components.css';
import '@/styles/notifications.css';
import '@/styles/news-badge.css';
import '@/styles/user-library.css';
import '@/styles/user-reader.css';
import '@/styles/theme-dark.css';
import '@/styles/context-menu.css';
import '@/styles/library-polish.css';
import '@/styles/notes-polish.css';
import '@/styles/reader-polish.css';
import '@/styles/floating-windows.css';
import '@/styles/primary-depth.css';
import '@/styles/readability.css';
import '@/styles/scrollbars.css';
import '@/styles/paper-dots.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

installChunkRecovery();
const stopMotionManager = installMotionManager();
const stopPressFeedback = installPressFeedback();
const stopTheme = installTheme();
// Thin theme-coloured page scrollbar in WebKit engines without `scrollbar-width` (scrollbars.css).
document.documentElement.classList.add('scrollbar-themed');
// A tab that was asked to hand the database to another one opens nothing: the reload released its
// workers and locks, and this page only offers to take the database back (state/tab-takeover.ts).
const standby = isStandbyTab();
if (standby) {
  render(
    () => (
      <BootScreen
        error={undefined}
        bootSlow={false}
        waitingForOtherTab
        onUseHere={resumeFromStandby}
      />
    ),
    root,
  );
} else {
  // The diaries copy mounts its sign-in alone when nobody is in (app/mount-diaries.tsx).
  mountApp(root);
}
const stopNativeSafeBottomLock = standby ? () => undefined : lockNativeSafeBottom();
const stopReminderNotifications = standby ? () => undefined : startReminderNotifications();
// The browser's bars take the header's colour (an installed diaries app above all); the Android
// app colours its own.
let stopThemeColor = (): void => undefined;
if (Capacitor.getPlatform() === 'android') {
  // The transparent status bar shows the page header: its icons take the shade it needs.
  void Promise.all([import('@/state/web-theme-color'), import('@/state/native-system-ui')])
    .then(([{ watchTopEdgeContrast }, { setTopEdgeStatusBarIcons }]) => {
      stopThemeColor = watchTopEdgeContrast(setTopEdgeStatusBarIcons);
    })
    .catch((cause: unknown) => {
      console.warn('Значки status bar не будут следовать странице:', cause);
    });
}
if (!Capacitor.isNativePlatform()) {
  // Chrome offers its install prompt once, early: the diaries app's install row needs it.
  listenForInstallPrompt();
  // Full screen installed app: the cutout inset pinned, so pulling the bars down moves nothing.
  void import('@/state/fullscreen-inset')
    .then(({ pinFullscreenTopInset }) => pinFullscreenTopInset())
    .catch((cause: unknown) => {
      console.warn('Отступ под вырез экрана не закреплён:', cause);
    });
  void import('@/state/web-theme-color')
    .then(({ installWebThemeColor }) => {
      stopThemeColor = installWebThemeColor();
    })
    .catch((cause: unknown) => {
      console.warn('Цвет панели браузера не будет следовать странице:', cause);
    });
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopMotionManager();
    stopPressFeedback();
    stopTheme();
    stopNativeSafeBottomLock();
    stopReminderNotifications();
    stopThemeColor();
  });
}

if (!standby && 'serviceWorker' in navigator && import.meta.env.PROD) {
  void registerAppServiceWorker().catch(() => {
    console.warn('Не удалось проверить обновление приложения.');
  });
}
