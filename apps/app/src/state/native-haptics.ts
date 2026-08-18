import { Capacitor, registerPlugin } from '@capacitor/core';

import type { HapticStrength } from '@/state/haptics';

interface LocalMedHapticsPlugin {
  impact(options: { readonly style: HapticStrength }): Promise<void>;
}

const localMedHaptics = registerPlugin<LocalMedHapticsPlugin>('LocalMedHaptics');

export function isAndroidNativeHapticsAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export function nativeAndroidHapticImpact(style: HapticStrength): void {
  if (!isAndroidNativeHapticsAvailable()) return;
  void localMedHaptics.impact({ style }).catch(() => undefined);
}
