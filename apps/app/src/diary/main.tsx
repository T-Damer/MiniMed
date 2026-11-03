import { render } from 'solid-js/web';

import { DiaryApp } from '@/diary/DiaryApp';
import { listenForInstallPrompt } from '@/diary/install-state';
import { applyWhenQuiet } from '@/state/auto-update';
import { pinFullscreenTopInset } from '@/state/fullscreen-inset';
import { installWebThemeColor } from '@/state/web-theme-color';
import '@/styles/theme.css';
import '@/diary/diary-shell.css';
import '@/styles/theme-dark-diary.css';
import '@/diary/diary-page.css';
import '@/diary/diary-care.css';
import '@/styles/paper-dots.css';
import '@/styles/scrollbars.css';

import { RELEASE_VERSION } from '../../../../release';

// Thin theme-coloured page scrollbar like the main app's (scrollbars.css), not the browser's grey one.
document.documentElement.classList.add('scrollbar-themed');
// Chrome offers its install prompt once, early: listen before anything renders.
listenForInstallPrompt();

const root = document.getElementById('diary-root');
if (!root) throw new Error('Diary root element is missing.');
render(() => <DiaryApp />, root);
// The status bar of the installed diary takes the header's colour (owner 2026-11-03).
installWebThemeColor();
// Full screen installed diary: the cutout inset pinned, so pulling the bars down moves nothing.
pinFullscreenTopInset();

// Sounds and haptics on every tap, with the same switches as the app («Ещё» → «Звуки», «Вибрация»).
// Loaded after the first paint: the diary opens without waiting for the audio engine.
void import('@/state/ui-feedback')
  .then(({ installUiFeedback }) => installUiFeedback())
  .catch((cause: unknown) => {
    console.warn('Звуки и вибрация дневника не включились:', cause);
  });

// Only the diary's own worker, scoped to diary/: the app worker precaches the medical core.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((cause: unknown) => {
    console.warn('Дневник не сможет открываться без сети:', cause);
  });
}

// The diary page is served from its cache while the worker fetches the newest one (DIARY21, owner
// 2026-11-03: «just open it and get the new version»): when the published build is newer than this
// one, the page reloads into it while still untouched, else the next time it is hidden. Once per
// version, so a cache that is not yet refreshed cannot loop.
const RELOADED_KEY = 'minimed.diary.reloaded-for';
if (import.meta.env.PROD && navigator.onLine) {
  void fetch(new URL('../build-manifest.json', window.location.href), { cache: 'no-store' })
    .then(
      (response): Promise<{ version?: unknown }> =>
        response.ok ? response.json() : Promise.resolve({}),
    )
    .then(({ version }) => {
      if (typeof version !== 'string' || version === RELEASE_VERSION) return;
      if (window.sessionStorage.getItem(RELOADED_KEY) === version) return;
      applyWhenQuiet(() => {
        window.sessionStorage.setItem(RELOADED_KEY, version);
        window.location.reload();
      });
    })
    .catch((cause: unknown) => {
      console.debug('Проверка новой версии дневника не удалась:', cause);
    });
}
