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

/**
 * Hand-off from the splash: the onboarding registers how it takes the boot surface over, the app
 * shell asks for it when it reveals the first screen. Returns true when the onboarding has taken
 * the surface (and removed it); false means the shell should fade the surface out as usual.
 */
export type OnboardingHandOff = (removeSurface: () => void) => Promise<boolean>;

/** How long the shell waits for the onboarding to register before it fades the surface out. */
export const HAND_OFF_WAIT_MS = 1_500;

let registered: OnboardingHandOff | undefined;
let waiting: Array<() => void> = [];

export function registerOnboardingHandOff(handOff: OnboardingHandOff): () => void {
  registered = handOff;
  for (const wake of waiting) wake();
  waiting = [];
  return () => {
    if (registered === handOff) registered = undefined;
  };
}

export async function handOffToOnboarding(removeSurface: () => void): Promise<boolean> {
  if (!registered) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, HAND_OFF_WAIT_MS);
      waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return registered ? registered(removeSurface) : false;
}
