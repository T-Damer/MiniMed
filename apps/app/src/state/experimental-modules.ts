import { createSignal } from 'solid-js';

import { getExperimentalModulesEnabled, subscribeAppPreferences } from '@/state/app-preferences';

const [enabled, setEnabled] = createSignal(getExperimentalModulesEnabled());
let subscribed = false;

/**
 * Tracked accessor for the experimental-modules setting, so features gated by it (the draft
 * definition reference and its «Словарь» entry points) appear or disappear without a reload.
 */
export function experimentalModulesEnabled(): boolean {
  if (!subscribed && typeof window !== 'undefined') {
    subscribed = true;
    subscribeAppPreferences((preferences) => setEnabled(preferences.experimentalModulesEnabled));
  }
  return enabled();
}
