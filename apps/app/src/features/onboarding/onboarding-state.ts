import { createSignal } from 'solid-js';

const [restartRequests, setRestartRequests] = createSignal(0);

/** Counts calls to {@link restartOnboarding}; the app shell reacts to every increase. */
export const onboardingRestartRequests = restartRequests;

/**
 * Runs the tour again from the intro (a «Пройти обучение заново» button in Settings calls this).
 * It does nothing while the tour is already on screen.
 */
export function restartOnboarding(): void {
  setRestartRequests((count) => count + 1);
}
