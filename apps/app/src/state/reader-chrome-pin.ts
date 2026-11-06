import { createRoot, createSignal } from 'solid-js';

import {
  APP_PREFERENCES_EVENT,
  type AppPreferences,
  loadAppPreferences,
  setReaderChromePinned,
} from '@/state/app-preferences';

/**
 * Whether the reader's top bar is pinned (owner 2026-11-06: an option to keep it in place). One
 * signal for the whole app, kept in step with the saved preference.
 */
const pin = createRoot(() => {
  const [pinned, setPinned] = createSignal(
    typeof window === 'undefined' ? false : loadAppPreferences().readerChromePinned,
  );
  if (typeof window !== 'undefined') {
    window.addEventListener(APP_PREFERENCES_EVENT, (event) => {
      const detail = (event as CustomEvent<AppPreferences>).detail;
      setPinned(detail.readerChromePinned);
    });
  }
  return { pinned, setPinned };
});

export const readerChromePinned = pin.pinned;

export function toggleReaderChromePinned(): void {
  setReaderChromePinned(!pin.pinned());
}
