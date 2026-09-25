import { render } from 'solid-js/web';

import { DiaryApp } from '@/diary/DiaryApp';
import '@/styles/theme.css';
import '@/styles/theme-dark.css';
import '@/diary/diary-page.css';

const root = document.getElementById('diary-root');
if (!root) throw new Error('Diary root element is missing.');
render(() => <DiaryApp />, root);

// Only the diary's own worker, scoped to diary/: the app worker precaches the medical core.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((cause: unknown) => {
    console.warn('Дневник не сможет открываться без сети:', cause);
  });
}
