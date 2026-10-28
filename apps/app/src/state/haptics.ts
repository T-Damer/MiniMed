import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { getVibrationEnabled } from '@/state/app-preferences';
import { nativeAndroidHapticImpact } from '@/state/native-haptics';

export type HapticStrength = 'selection' | 'light' | 'medium' | 'heavy';

/** Browser vibration pulses (ms): a tick for selection up to a firm thump for destructive taps. */
export const WEB_VIBRATION_MS: Readonly<Record<HapticStrength, number>> = {
  selection: 5,
  light: 10,
  medium: 16,
  heavy: 26,
};

/** Android Chrome and installed PWAs; iOS Safari has no vibration API. */
function webVibrate(strength: HapticStrength): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  return navigator.vibrate(WEB_VIBRATION_MS[strength]);
}

export function hapticFeedback(strength: HapticStrength): boolean {
  if (!getVibrationEnabled()) return false;

  if (Capacitor.getPlatform() === 'android') {
    nativeAndroidHapticImpact(strength);
    return true;
  }

  if (Capacitor.isNativePlatform()) {
    if (strength === 'selection') {
      void Haptics.selectionChanged().catch(() => undefined);
      return true;
    }
    const style =
      strength === 'heavy'
        ? ImpactStyle.Heavy
        : strength === 'medium'
          ? ImpactStyle.Medium
          : ImpactStyle.Light;
    void Haptics.impact({ style }).catch(() => undefined);
    return true;
  }

  return webVibrate(strength);
}
