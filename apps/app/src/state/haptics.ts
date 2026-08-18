import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { getVibrationEnabled } from '@/state/app-preferences';
import { nativeAndroidHapticImpact } from '@/state/native-haptics';

export type HapticStrength = 'selection' | 'light' | 'medium' | 'heavy';

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

  return false;
}
