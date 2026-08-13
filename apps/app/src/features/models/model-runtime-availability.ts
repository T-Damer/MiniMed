import type { LocalModelDescriptor, LocalModelDeviceProfile } from '@/features/models/types';

export function runtimeAvailableForDevice(
  model: LocalModelDescriptor,
  device: LocalModelDeviceProfile,
): boolean {
  return model.artifacts.some((artifact) => {
    if (!artifact.published || !artifact.platforms.includes(device.platform)) return false;
    if (artifact.runtime === 'wllama-web') return true;
    if (artifact.runtime === 'llama-native')
      return device.platform === 'android' && device.nativeContainer;
    return false; // cactus-native/litert-native: no runtime implementation exists.
  });
}
