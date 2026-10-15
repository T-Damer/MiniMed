import { getUsefulFeaturesHidden, setUsefulFeaturesHidden } from '@/state/app-preferences';

/** What the notice says after the carousel is closed: where the way back is. */
export const USEFUL_FEATURES_HIDDEN_NOTICE = 'Вернуть можно в настройках';

/** One notice id: closing, restoring and closing again never stack notices. */
export const USEFUL_FEATURES_NOTICE_ID = 'useful-features-hidden';

/** Whether the carousel «Полезные функции» shows on the search home. */
export function usefulFeaturesShown(): boolean {
  return !getUsefulFeaturesHidden();
}

/** The Settings switch: on shows the carousel, off hides it. */
export function setUsefulFeaturesShown(shown: boolean): void {
  setUsefulFeaturesHidden(!shown);
}

/**
 * The carousel's own close control. The choice is stored like any other switch, and the notice
 * tells where it can be undone: Settings is the one place that brings the carousel back.
 */
export function hideUsefulFeatures(announce: (message: string) => void): void {
  setUsefulFeaturesShown(false);
  announce(USEFUL_FEATURES_HIDDEN_NOTICE);
}
