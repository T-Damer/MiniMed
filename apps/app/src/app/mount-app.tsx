import { render } from 'solid-js/web';

import { App } from '@/app/App';

/**
 * Mounts the app. The diaries copy swaps this module for `app/mount-diaries.tsx` (vite.config.ts
 * `diariesEntry`), which shows the sign-in alone until the doctor is in.
 */
export function mountApp(root: HTMLElement): void {
  render(() => <App />, root);
}
