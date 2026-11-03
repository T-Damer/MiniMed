import { render } from 'solid-js/web';

import { DiaryApp } from '@/diary/DiaryApp';
import { listenForInstallPrompt } from '@/diary/install-state';
import { installWebThemeColor } from '@/state/web-theme-color';
import '@/styles/theme.css';
import '@/diary/diary-shell.css';
import '@/styles/theme-dark-diary.css';
import '@/diary/diary-page.css';
import '@/diary/diary-care.css';
import '@/styles/paper-dots.css';
import '@/styles/scrollbars.css';

// Thin theme-coloured page scrollbar like the main app's (scrollbars.css), not the browser's grey one.
document.documentElement.classList.add('scrollbar-themed');
// Chrome offers its install prompt once, early: listen before anything renders.
listenForInstallPrompt();

const root = document.getElementById('diary-root');
if (!root) throw new Error('Diary root element is missing.');
render(() => <DiaryApp />, root);
// The status bar of the installed diary takes the header's colour (owner 2026-11-03).
installWebThemeColor();

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
