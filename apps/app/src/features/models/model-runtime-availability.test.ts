import { describe, expect, it } from 'vitest';

import { parseLocalModelCatalog } from '@/features/models/catalog';
import rawCatalog from '@/features/models/catalog.preview.json';
import { runtimeAvailableForDevice } from '@/features/models/model-runtime-availability';
import type { LocalModelDeviceProfile } from '@/features/models/types';

const catalog = parseLocalModelCatalog(rawCatalog);
const vikhr = catalog.models.find((model) => model.id === 'vikhr-qwen2.5-0.5b-q4');
if (!vikhr) throw new Error('Fixture catalog is missing vikhr-qwen2.5-0.5b-q4.');

function device(overrides: Partial<LocalModelDeviceProfile> = {}): LocalModelDeviceProfile {
  return {
    platform: 'browser',
    nativeContainer: false,
    deviceMemoryGb: 4,
    hardwareConcurrency: 4,
    freeStorageBytes: 1_000_000_000,
    webgpu: false,
    saveData: false,
    effectiveConnectionType: '4g',
    automation: false,
    cpuProbeScore: 1000,
    fingerprint: 'test',
    ...overrides,
  };
}

describe('runtimeAvailableForDevice', () => {
  it('is available in a plain browser via wllama-web', () => {
    expect(runtimeAvailableForDevice(vikhr, device())).toBe(true);
  });

  it('is available on native Android via llama-native even without wllama-web', () => {
    expect(
      runtimeAvailableForDevice(vikhr, device({ platform: 'android', nativeContainer: true })),
    ).toBe(true);
  });

  it('still reports available on Android WebView-without-native-shell via wllama-web', () => {
    expect(
      runtimeAvailableForDevice(vikhr, device({ platform: 'android', nativeContainer: false })),
    ).toBe(true);
  });

  it('is unavailable on iOS, where no runtime is implemented yet', () => {
    expect(
      runtimeAvailableForDevice(vikhr, device({ platform: 'ios', nativeContainer: true })),
    ).toBe(false);
  });
});
